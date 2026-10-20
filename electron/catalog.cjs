const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const idFor = value => crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0,20);
const read = async p => { try { return await fs.readFile(p, 'utf8'); } catch { return ''; } };
const exists = async p => !!p && !!(await fs.stat(p).catch(()=>null));
const files = async p => (await fs.readdir(p,{withFileTypes:true}).catch(()=>[]));
const val = (text,key) => text.match(new RegExp('"'+key+'"\\s+"([^"\\r\\n]*)"','i'))?.[1]?.replace(/\\\\/g,'\\') || '';
const blocked = /(?:unins|uninstall|setup|install(?:er)?|redist|crash|diagnostic|benchmark|updat(?:e|er)|vcredist|directx|anti.?cheat|unitycrash|ue4prereq|support|easyanticheat|battleye)/i;
function media(jellyfin='http://127.0.0.1:8096') {
 return [
 ['netflix','Netflix','https://www.netflix.com','#b20710','Films, series, and your next obsession.'],
 ['spotify','Spotify','https://open.spotify.com','#156d39','Your music. Your moment.'],
 ['prime','Prime Video','https://www.primevideo.com','#064c80','A world of stories, ready to play.'],
 ['youtube','YouTube','https://www.youtube.com','#b91b27','Find something worth watching.'],
 ['max','HBO / Max','https://www.max.com','#2035a5','Extraordinary entertainment.'],
 ['jellyfin','Jellyfin',jellyfin,'#473581','Your collection. Your cinema.'],
 ['browser','Browser','https://search.brave.com','#873d22','The web, from the comfort of your couch.']
 ].map(([id,title,target,color,description])=>({id:'media-'+id,title,target,color,description,source:id==='browser'?'Default browser':'Streaming',kind:'media',launchType:'web'}));
}
async function steam(roots) {
 const out=[]; const libraries=new Set(roots.filter(Boolean));
 for(const root of [...libraries]) { const text=await read(path.join(root,'steamapps','libraryfolders.vdf')); for(const m of text.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g,'\\')); }
 for(const root of libraries) for(const f of await files(path.join(root,'steamapps'))) {
  if(!/^appmanifest_\d+\.acf$/.test(f.name)) continue;
  const text=await read(path.join(root,'steamapps',f.name)); const id=val(text,'appid'), title=val(text,'name');
  if(!id||!title||/Steamworks|Redistributables|Proton|Steam Linux|SteamVR|Dedicated Server/i.test(title)) continue;
  if(!await exists(path.join(root,'steamapps','common',val(text,'installdir'))))continue;
  let artwork,backdrop;
  for(const base of roots.filter(Boolean)) {
   const cache=path.join(base,'appcache','librarycache');
   const nested=await files(path.join(cache,id));
   for(const a of nested) {if(/library_600x900|library_capsule/.test(a.name)) artwork=path.join(cache,id,a.name);if(/library_hero\.(?:jpg|png|webp)$/i.test(a.name))backdrop=path.join(cache,id,a.name);}
   if(!artwork && await exists(path.join(cache,id+'_library_600x900.jpg')))artwork=path.join(cache,id+'_library_600x900.jpg');
   if(!backdrop && await exists(path.join(cache,id+'_library_hero.jpg')))backdrop=path.join(cache,id+'_library_hero.jpg');
  }
  out.push({id:'steam-'+id,title,source:'Steam',kind:'game',target:'steam://rungameid/'+id,launchType:'uri',artwork,backdrop,steamId:id});
 }
 return out;
}
async function epic() {
 const root=path.join(process.env.ProgramData||'C:\\ProgramData','Epic','EpicGamesLauncher','Data','Manifests'),out=[];
 for(const f of await files(root)) {if(!f.name.endsWith('.item'))continue;try {const j=JSON.parse(await read(path.join(root,f.name)));if(j.bIsIncompleteInstall||!j.LaunchExecutable||!await exists(j.InstallLocation))continue;out.push({id:'epic-'+j.AppName,title:j.DisplayName,source:'Epic',kind:'game',target:'com.epicgames.launcher://apps/'+encodeURIComponent([j.CatalogNamespace,j.CatalogItemId,j.AppName].filter(Boolean).join(':'))+'?action=launch&silent=true',launchType:'uri'});}catch{}}
 return out;
}
async function riot() {
 const data=JSON.parse(await read(path.join(process.env.ProgramData||'C:\\ProgramData','Riot Games','RiotClientInstalls.json'))||'{}');const out=[];
 for(const [dir,client] of Object.entries(data.associated_client||{})) {
  if(!await exists(dir)||!await exists(client))continue;
  const title=/valorant/i.test(dir)?'VALORANT':/league/i.test(dir)?'League of Legends':/2xko/i.test(dir)?'2XKO':path.basename(path.dirname(dir));
  const product=/valorant/i.test(dir)?'valorant':/league/i.test(dir)?'league_of_legends':/2xko/i.test(dir)?'lion':null;
  if(product)out.push({id:'riot-'+product+(/pbe/i.test(dir)?'-pbe':''),title:title+(/pbe/i.test(dir)?' PBE':''),source:'Riot',kind:'game',target:client,args:['--launch-product='+product,'--launch-patchline='+(/pbe/i.test(dir)?'pbe':'live')],cwd:path.dirname(client),launchType:'exe',description:product==='valorant'?'Precision. Teamwork. One more round.':'Your next match starts here.'});
 }
 const client=data.rc_live||data.rc_default;
 if(client&&await exists(client))for(const product of ['league_of_legends','teamfighttactics','valorant','lion'])for(const patch of ['live','pbe']) {
  const metadata=path.join(process.env.ProgramData||'C:\\ProgramData','Riot Games','Metadata',product+'.'+patch);
  for(const file of await files(metadata)){
   if(!file.name.endsWith('.product_settings.yaml'))continue;const text=await read(path.join(metadata,file.name));const dir=text.match(/^product_install_full_path:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
   if(!dir||!await exists(dir))continue;const id='riot-'+product+(patch==='pbe'?'-pbe':'');if(out.some(e=>e.id===id))continue;
   const title=({league_of_legends:'League of Legends',teamfighttactics:'Teamfight Tactics',valorant:'VALORANT',lion:'2XKO'})[product];
   out.push({id,title:title+(patch==='pbe'?' PBE':''),source:'Riot',kind:'game',target:client,args:['--launch-product='+product,'--launch-patchline='+patch],cwd:path.dirname(client),launchType:'exe'});
  }
 }
 return out;
}
async function scanFolders(roots) {
 const out=[];
 async function walk(root,depth=0) {
  if(depth>3||out.length>=400)return;
  for(const f of await files(root)) {if(out.length>=400)break;if(blocked.test(f.name))continue;const p=path.join(root,f.name);if(f.isDirectory()){await walk(p,depth+1);continue;}if(!/\.(exe|lnk)$/i.test(f.name))continue;const st=await fs.stat(p).catch(()=>null);if(!st||(/\.exe$/i.test(p)&&st.size<100000))continue;
   const name=f.name.replace(/\.(exe|lnk)$/i,'');out.push({id:'local-'+idFor(p),title:name,source:'Standalone',kind:'game',target:p,cwd:root,launchType:/\.lnk$/i.test(p)?'shortcut':'exe',candidate:true});
  }
 }
 for(const root of roots||[])await walk(root);
 return out;
}
function mergeEntries(current,incoming) {
 const map=new Map(current.map(x=>[x.id,x]));
 for(const e of incoming) {const old=map.get(e.id);map.set(e.id,{...old,...e,artwork:old?.customArtwork?old.artwork:e.artwork||old?.artwork,backdrop:old?.customBackdrop?old.backdrop:e.backdrop||old?.backdrop,favorite:old?.favorite||false,lastPlayed:old?.lastPlayed||0,customArtwork:old?.customArtwork,customBackdrop:old?.customBackdrop});}
 return [...map.values()];
}
function normalizeUrl(value) {const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error('Use an http:// or https:// address.');return u.href;}
module.exports={idFor,read,exists,files,val,blocked,media,steam,epic,riot,scanFolders,mergeEntries,normalizeUrl};
