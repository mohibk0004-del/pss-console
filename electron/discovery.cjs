const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const c=require('./catalog.cjs');
const roots=[process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean);
const cleanExe=value=>(value?.match(/^"([^"]+)"/)?.[1]||value?.replace(/,\s*-?\d+$/,'')||'').trim();
const sourceOf=(title,publisher='')=>/Riot|VALORANT|League of Legends/i.test(title+' '+publisher)?'Riot':/GOG/i.test(publisher)?'GOG':/Ubisoft|Uplay/i.test(publisher)?'Ubisoft':/Blizzard|Activision|Battle\.net/i.test(publisher)?'Battle.net':/Electronic Arts|EA Games|EA Sports/i.test(publisher)?'EA':null;
async function discover(system,folders=[]) {
 const warnings=[...(system.warnings||[])],steamRoots=roots.map(x=>path.join(x,'Steam'));
 const steamShortcut=(system.shortcuts||[]).find(x=>/^Steam$/i.test(x.title));if(steamShortcut)steamRoots.push(path.dirname(steamShortcut.target));
 const groups=await Promise.allSettled([c.steam(steamRoots),c.epic(),c.riot(),c.scanFolders(folders)]);
 let entries=[],candidates=[];
 groups.forEach((r,i)=>{if(r.status==='fulfilled'){if(i===3)candidates.push(...r.value);else entries.push(...r.value);}else warnings.push(['Steam','Epic','Riot','Folder scan'][i]+': '+r.reason.message);});
 const registry=system.installed||[];
 for(const item of registry) {
  const source=sourceOf(item.title,item.publisher);
  if(!source||source==='Riot'||/launcher|connect|runtime|sdk|anti.?cheat|redistributable|EA app|Battle.net|GOG Galaxy/i.test(item.title))continue;
  if(!item.location||!await c.exists(item.location))continue;
  if(source==='Ubisoft'&&/^Uplay Install \d+$/i.test(item.key)) {
   entries.push({id:'ubisoft-'+item.key.match(/\d+/)[0],title:item.title,source,kind:'game',target:'uplay://launch/'+item.key.match(/\d+/)[0]+'/0',launchType:'uri'});continue;
  }
  if(source==='GOG') {
   let found=false;for(const f of await c.files(item.location)){if(!/^goggame-\d+\.info$/.test(f.name))continue;try{const info=JSON.parse(await c.read(path.join(item.location,f.name)));const task=info.playTasks?.find(t=>t.isPrimary)||info.playTasks?.find(t=>t.type==='FileTask');if(task?.path){const target=path.resolve(item.location,task.path);if(await c.exists(target)){entries.push({id:'gog-'+info.gameId,title:info.name||item.title,source,kind:'game',target,args:task.arguments?splitArguments(task.arguments):[],cwd:path.resolve(item.location,task.workingDir||'.'),launchType:'exe'});found=true;}}}catch{}}
   if(found)continue;
  }
  const link=(system.shortcuts||[]).find(s=>s.title.toLowerCase()===item.title.toLowerCase());
  if(link){entries.push(shortcut(link,source));continue;}
  const exe=cleanExe(item.icon);
  if(/\.exe$/i.test(exe)&&!c.blocked.test(path.basename(exe))&&await c.exists(exe)) candidates.push({id:'local-'+c.idFor(exe),title:item.title,source,kind:'game',target:exe,cwd:path.dirname(exe),launchType:'exe',candidate:true});
 }
 for(const s of system.shortcuts||[]) {
  if(c.blocked.test(s.title)||!s.target)continue;
  const known=registry.find(i=>i.title.toLowerCase()===s.title.toLowerCase());
  const source=known?sourceOf(known.title,known.publisher):null;
  const standalone=/\.exe$/i.test(s.target)&&!/[\\/](?:windows|program files(?: \(x86\))?)[\\/]/i.test(s.target);
  const looksGame=source||standalone||/[\\/](?:games|steamapps|epic games|gog games|riot games|ubisoft|battle\.net)[\\/]/i.test(s.target)||/--exec=.?launch|--launch-product|steam:\/\//i.test(s.args||'');
  if(!looksGame||/Steam$|Epic Games Launcher|Ubisoft Connect|Riot Client|GOG Galaxy|Battle.net$|EA app$/i.test(s.title))continue;
  if(entries.some(e=>e.title.toLowerCase()===s.title.toLowerCase())||(/Riot/i.test(s.target)&&entries.some(e=>e.source==='Riot'&&e.title.toLowerCase()===s.title.toLowerCase())))continue;
  candidates.push(shortcut(s,source||'Standalone'));
 }
 // MSIX games expose MicrosoftGame.config; non-game apps never enter this import.
 try {
  const script=`$ErrorActionPreference='SilentlyContinue'; $result=@(); Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.InstallLocation } | ForEach-Object { $config=Join-Path $_.InstallLocation 'MicrosoftGame.config'; if(Test-Path -LiteralPath $config) { $m=Get-AppxPackageManifest -Package $_.PackageFullName; [xml]$g=Get-Content -LiteralPath $config -Raw; $title=$g.Game.ShellVisuals.DefaultDisplayName; if(-not $title -or $title -like 'ms-resource:*'){$title=$_.Name}; foreach($a in $m.Package.Applications.Application) { $result+=@{title=$title; target=($_.PackageFamilyName+'!'+$a.Id)} } } }; ConvertTo-Json -InputObject @($result) -Compress`;
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:25000,maxBuffer:1024*1024});
  for(const item of JSON.parse(stdout||'[]'))entries.push({id:'xbox-'+c.idFor(item.target),title:item.title,source:'Xbox',kind:'game',target:item.target,launchType:'app'});
 }catch(e){warnings.push('Xbox discovery unavailable; add game’s Start Menu shortcut manually.');}
 const unique=list=>[...new Map(list.map(e=>[e.id,e])).values()];entries=unique(entries);candidates=unique(candidates).filter(e=>!entries.some(i=>i.id===e.id||i.title.toLowerCase()===e.title.toLowerCase())).map(e=>({...e,candidate:true}));
 return {entries,candidates,warnings};
}
function shortcut(s,source){return {id:'shortcut-'+c.idFor(s.path),title:s.title,source,kind:'game',target:s.path,cwd:s.cwd||undefined,launchType:'shortcut',candidate:true};}
function splitArguments(s){const out=[];for(const m of s.matchAll(/"((?:[^"\\]|\\.)*)"|([^\s"]+)/g))out.push((m[1]??m[2]).replace(/\\"/g,'"'));return out;}
module.exports={discover,splitArguments,sourceOf};
