const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const c=require('../electron/catalog.cjs');const {splitArguments,sourceOf}=require('../electron/discovery.cjs');
test('Steam discovers installed titles across libraries and ignores support packages',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pss-steam-'));try{
  const second=path.join(dir,'Other Drive');await fs.mkdir(path.join(dir,'steamapps','common','One'),{recursive:true});await fs.mkdir(path.join(second,'steamapps','common','Two'),{recursive:true});
  await fs.writeFile(path.join(dir,'steamapps','libraryfolders.vdf'),'"libraryfolders" { "1" { "path" "'+second.replace(/\\/g,'\\\\')+'" } }');
  await fs.writeFile(path.join(dir,'steamapps','appmanifest_123.acf'),'"AppState" { "appid" "123" "name" "First Game" "installdir" "One" }');
  await fs.writeFile(path.join(second,'steamapps','appmanifest_456.acf'),'"AppState" { "appid" "456" "name" "Second Game" "installdir" "Two" }');
  await fs.writeFile(path.join(dir,'steamapps','appmanifest_789.acf'),'"AppState" { "appid" "789" "name" "Uninstalled Game" "installdir" "Missing" }');
  await fs.writeFile(path.join(dir,'steamapps','appmanifest_228980.acf'),'"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "One" }');
  const result=await c.steam([dir]);assert.deepEqual(result.map(e=>e.id).sort(),['steam-123','steam-456']);assert.equal(result[0].launchType,'uri');assert.equal(result[0].target,'steam://rungameid/123');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Riot uses installed product path and client rather than bypassing client',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pss-riot-'));const previous=process.env.ProgramData;try{
  process.env.ProgramData=dir;await fs.mkdir(path.join(dir,'Riot Games'),{recursive:true});const game=path.join(dir,'VALORANT','live'),client=path.join(dir,'RiotClientServices.exe');await fs.mkdir(game,{recursive:true});await fs.writeFile(client,'test fixture');
  await fs.writeFile(path.join(dir,'Riot Games','RiotClientInstalls.json'),JSON.stringify({associated_client:{[game]:client,[path.join(dir,'missing','League')]:client}}));
  const entries=await c.riot();assert.equal(entries.length,1);assert.equal(entries[0].target,client);assert.deepEqual(entries[0].args,['--launch-product=valorant','--launch-patchline=live']);
 }finally{if(previous===undefined)delete process.env.ProgramData;else process.env.ProgramData=previous;await fs.rm(dir,{recursive:true,force:true});}
});
test('Standalone scan excludes installers/crash handlers and never silently installs candidates',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pss-games-'));try{
  await fs.mkdir(path.join(dir,'Actual Game'));for(const name of ['Game.exe','CrashHandler.exe','unins000.exe','setup.exe'])await fs.writeFile(path.join(dir,'Actual Game',name),Buffer.alloc(110000));
  await fs.writeFile(path.join(dir,'Actual Game','Play.lnk'),'shortcut fixture');const entries=await c.scanFolders([dir]);assert.deepEqual(entries.map(e=>e.title).sort(),['Game','Play']);assert.ok(entries.every(e=>e.candidate));assert.equal(entries.find(e=>e.title==='Play').launchType,'shortcut');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Rescan preserves favorites, recency and custom art without duplicating IDs',()=>{
 const list=c.mergeEntries([{id:'a',title:'Old',favorite:true,lastPlayed:999,artwork:'custom.png',customArtwork:true}],[{id:'a',title:'New',artwork:'scan.png'},{id:'b',title:'Other'}]);assert.equal(list.length,2);assert.deepEqual({...list[0]},{id:'a',title:'New',favorite:true,lastPlayed:999,artwork:'custom.png',customArtwork:true,backdrop:undefined,customBackdrop:undefined});
});
test('Website targets reject privileged protocols',()=>{for(const url of ['file:///C:/Windows','javascript:alert(1)','steam://run/10','data:text/html,test'])assert.throws(()=>c.normalizeUrl(url));assert.equal(c.normalizeUrl('https://example.com'),'https://example.com/');});
test('Argument parser retains quoted paths and separate flags',()=>{assert.deepEqual(splitArguments('--game "C:\\Games\\My Game" --flag'),['--game','C:\\Games\\My Game','--flag']);assert.equal(sourceOf('Game','Electronic Arts'),'EA');});
test('Jellyfin media tile uses existing server and service list is complete',()=>{const entries=c.media('http://server:8096');assert.equal(entries.find(e=>e.id==='media-jellyfin').target,'http://server:8096');for(const key of ['netflix','spotify','prime','youtube','max','jellyfin','browser'])assert.ok(entries.some(e=>e.id==='media-'+key));});
