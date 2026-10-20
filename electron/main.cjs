const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,globalShortcut,shell,protocol,net,screen}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {spawn}=require('node:child_process');const readline=require('node:readline');const {pathToFileURL}=require('node:url');
const c=require('./catalog.cjs');const {websiteIcon}=require('./icons.cjs');const {discover,splitArguments}=require('./discovery.cjs');
const TEST=process.argv.includes('--smoke');
const dataFlag=process.argv.find(x=>x.startsWith('--data-dir='));if(dataFlag)app.setPath('userData',dataFlag.slice(11));
protocol.registerSchemesAsPrivileged([{scheme:'pss-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,tray,helper,ready=false,quitting=false,consoleMode=true,keyboardOpen=false;
let seq=0,pending=new Map(),controller={connected:false,name:'No controller',family:'xbox',count:0};
let entries=[],settings={startup:!TEST,reducedMotion:false,sounds:.15,profile:process.env.USERNAME||'Player',jellyfin:'http://127.0.0.1:8096',folders:[],browser:'',uiScale:1,onboarded:false};
let system={installed:[],shortcuts:[]},windows=[],running=[],warnings=[],browser='',mode='shell';let storeQueue=Promise.resolve();let scanPromise=null;let scanCache=null;let keyboardBounds;let discovering=true;
const assetPaths=new Map();
const sessions=new Map();let hiddenIds=new Set();
const userDir=()=>app.getPath('userData');
const helperExe=()=>path.join(app.isPackaged?path.join(process.resourcesPath,'helper'):path.join(__dirname,'..','native','publish'),'PssHelper.exe');
function emit(event){if(win&&!win.isDestroyed())win.webContents.send('pss:event',event);}
function asset(file){if(!file)return undefined;if(file.startsWith('data:image/'))return file;const id=c.idFor(file);assetPaths.set(id,file);return 'pss-asset://local/'+id;}
function publicEntry(e){return {...e,artwork:asset(e.artwork),backdrop:asset(e.backdrop)};}
function state(){return {entries:entries.map(publicEntry),settings,controller,running,helper:ready,version:app.getVersion(),mode:consoleMode?mode:'desktop',browser:browser?path.basename(browser,'.exe'):'Default browser',warnings,discovering};}
function publish(){emit({type:'state',state:state()});}
function save(){storeQueue=storeQueue.catch(()=>{}).then(async()=>{await fs.mkdir(userDir(),{recursive:true});const file=path.join(userDir(),'library.json');await fs.writeFile(file+'.tmp',JSON.stringify({version:1,entries,settings,hiddenIds:[...hiddenIds]},null,2),'utf8');await fs.rename(file+'.tmp',file);});return storeQueue;}
function rpc(op,data={},timeout=20000){return new Promise((resolve,reject)=>{if(!helper||helper.killed||!helper.stdin.writable)return reject(new Error('Windows helper is unavailable. Restart PSS Console.'));const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Windows helper timed out: '+op));},timeout);pending.set(id,{resolve,reject,timer});helper.stdin.write(JSON.stringify({id,op,data})+'\n');});}
function windowHandle(){return win.getNativeWindowHandle().readBigUInt64LE().toString();}
async function setMode(next){mode=next;if(ready)await rpc('mode',{mode:next,window:Number(windowHandle()),browser:path.basename(browser||'brave.exe','.exe')}).catch(e=>log(e.message));}
async function log(message){await fs.mkdir(userDir(),{recursive:true});const file=path.join(userDir(),'diagnostics.log');const st=await fs.stat(file).catch(()=>null);if(st?.size>1024*1024)await fs.rename(file,file+'.old').catch(()=>{});await fs.appendFile(file,new Date().toISOString()+' '+message+'\n').catch(()=>{});}
function startHelper(){
 helper=spawn(helperExe(),[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 helper.on('error',e=>{warnings.push('Windows helper failed to start: '+e.message);publish();});
 helper.stderr.on('data',b=>log('helper: '+b.toString().slice(0,1000)));
 readline.createInterface({input:helper.stdout}).on('line',line=>{try{const event=JSON.parse(line);
  if(event.type==='reply'){const p=pending.get(event.id);if(p){clearTimeout(p.timer);pending.delete(event.id);event.error?p.reject(new Error(event.error)):p.resolve(event.data);}return;}
  if(event.type==='ready'){ready=true;if(!event.sdl)warnings.push('Controller support did not initialize. Keyboard and mouse remain available.');setMode(consoleMode?'shell':'desktop');publish();return;}
  if(event.type==='controller'){const changed=JSON.stringify(controller)!==JSON.stringify(event.data);controller=event.data;if(changed)publish();return;}
  if(event.type==='windows'){windows=event.data;updateSessions();return;}
  if(event.type==='input'){if(event.action==='home'){home();return;}if(event.action==='keyboard'){openKeyboard();return;}emit(event);return;}
  if(event.type==='error'){log(event.message);emit({type:'notice',message:event.message});}
 }catch(e){log('Invalid helper event: '+e.message);}});
 helper.on('exit',code=>{ready=false;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Windows helper stopped.'));}pending.clear();if(!quitting){warnings.push('Windows helper stopped. Restart PSS Console to restore controller support.');publish();log('helper exited: '+code);}});
}
async function waitReady(){for(let i=0;i<120;i++){if(ready)return;await new Promise(r=>setTimeout(r,100));}throw new Error('Windows helper did not initialize.');}
async function resolveBrowser(){
 const requested=settings.browser||system.browserPath;if(requested&&await c.exists(requested)){browser=requested;return;}
 const dirs=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean);
 const isBrave=/brave/i.test(system.browserProgId||'');
 if(isBrave||!system.browserProgId)for(const root of dirs){const file=path.join(root,'BraveSoftware','Brave-Browser','Application','brave.exe');if(await c.exists(file)){browser=file;return;}}
 browser='';
}
async function initial(){
 await waitReady();system=await rpc('discover',{},60000);await resolveBrowser();
 try{const response=await fetch('http://127.0.0.1:8096/System/Info/Public',{signal:AbortSignal.timeout(1800)});if(response.ok&&!settings.onboarded)settings.jellyfin='http://127.0.0.1:8096';}catch{}
 entries=entries.map(e=>e.id==='media-jellyfin'?{...e,target:settings.jellyfin}:e);
 await scan(false);
 if(app.isPackaged&&!TEST){app.setLoginItemSettings({openAtLogin:settings.startup,name:'PSS Console',path:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath,args:['--startup']});}
 discovering=false;await save();publish();
}
async function scan(refresh=true){
 if(scanPromise)return scanPromise;
 discovering=true;scanPromise=(async()=>{if(refresh){system=await rpc('discover',{},60000);await resolveBrowser();}const result=await discover(system,settings.folders);entries=c.mergeEntries(entries,result.entries.filter(e=>!hiddenIds.has(e.id)));warnings=result.warnings;scanCache=result;await hydrateArt(entries);await save();publish();return {entries:result.entries.map(publicEntry),candidates:result.candidates.map(publicEntry),warnings};})();
 try{return await scanPromise;}finally{scanPromise=null;discovering=false;publish();}
}
async function hydrateArt(list){
 await fs.mkdir(path.join(userDir(),'artwork'),{recursive:true});
 // Cached Steam assets provide real game artwork without requiring API keys.
 const tasks=list.filter(e=>e.steamId&&(!e.artwork||!e.backdrop));let next=0;
 async function worker(){while(next<tasks.length){const e=tasks[next++];for(const [field,name] of [['artwork','library_600x900.jpg'],['backdrop','library_hero.jpg']]){if(e[field]&&await c.exists(e[field]))continue;const file=path.join(userDir(),'artwork',e.steamId+'-'+name);if(await c.exists(file)){e[field]=file;continue;}try{const res=await fetch('https://cdn.akamai.steamstatic.com/steam/apps/'+e.steamId+'/'+name,{signal:AbortSignal.timeout(4500)});if(!res.ok||!res.headers.get('content-type')?.startsWith('image/'))continue;const data=Buffer.from(await res.arrayBuffer());if(data.length>8*1024*1024)continue;await fs.writeFile(file,data);e[field]=file;}catch{}}}}
 await Promise.all([worker(),worker(),worker()]);
 // Use local executable icons only when a title has no cover.
 for(const e of list.filter(e=>!e.artwork&&['exe','shortcut'].includes(e.launchType))){try{const icon=await app.getFileIcon(e.target,{size:'large'});if(!icon.isEmpty()){e.artwork=icon.toDataURL();e.iconArtwork=true;}}catch{}}
 const sites=list.filter(e=>!e.artwork&&e.launchType==='web'&&!e.id.startsWith('media-'));let siteIndex=0;
 async function siteWorker(){while(siteIndex<sites.length){const e=sites[siteIndex++];e.artwork=await websiteIcon(e.target,path.join(userDir(),'artwork'),e.id);if(e.artwork)e.iconArtwork=true;}}
 await Promise.all([siteWorker(),siteWorker(),siteWorker()]);
}
function matchWindow(entry,w,before){
 if(w.pid===process.pid||w.process==='PssHelper'||!w.title)return false;
 const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');const title=normalize(entry.title),wt=normalize(w.title);
 if(entry.kind==='media')return path.basename(browser||'brave.exe','.exe').toLowerCase()===w.process.toLowerCase()&&(!before.has(w.window)||wt.includes(normalize(entry.title.split(' / ')[0])));
 if(title.length>=3&&wt.includes(title))return true;
 if(entry.launchType==='exe'&&w.process.toLowerCase()===path.basename(entry.target,'.exe').toLowerCase()&&!/RiotClientServices|Battle.net|EADesktop|UbisoftConnect/i.test(w.process))return true;
 return false;
}
function updateSessions(){
 let changed=false;
 for(const [id,s]of sessions){const e=entries.find(e=>e.id===id);if(!e){sessions.delete(id);continue;}const found=(s.window?windows.find(w=>w.window===s.window):null)||windows.find(w=>!s.before.has(w.window)&&matchWindow(e,w,s.before))||windows.find(w=>matchWindow(e,w,s.before));
  if(found){if(s.window!==found.window)changed=true;s.window=found.window;s.pid=found.pid;s.seen=true;s.misses=0;}
  else if(s.seen){s.misses++;if(s.misses>=3){sessions.delete(id);changed=true;if(consoleMode&&!keyboardOpen&&!win.isFocused()&&[...sessions.values()].every(x=>!x.seen))home();}}
  else if(Date.now()-s.started>120000){sessions.delete(id);changed=true;}
 }
 const next=[...sessions].map(([id,s])=>({id,title:entries.find(e=>e.id===id)?.title||id,pid:s.pid||0,kind:entries.find(e=>e.id===id)?.kind||'game',window:s.window||''}));
 if(JSON.stringify(running)!==JSON.stringify(next)){running=next;changed=true;}if(changed)publish();
}
function spawnDetached(file,args=[],options={}){return new Promise((resolve,reject)=>{const p=spawn(file,args,{detached:true,stdio:'ignore',windowsHide:false,...options});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve(p.pid);});});}
async function launch(id){
 const e=entries.find(e=>e.id===id);if(!e)throw new Error('Library entry no longer exists.');
 const existing=sessions.get(id);if(existing?.window&&windows.some(w=>w.window===existing.window)){await setMode(e.kind==='media'?'browser':'game');win.hide();await rpc('focus',{window:existing.window});return;}
 let pid=0;if(ready)windows=await rpc('windows');const before=new Set(windows.map(w=>w.window));
 if(e.launchType==='web'){
  const url=c.normalizeUrl(e.id==='media-jellyfin'?settings.jellyfin:e.target);await resolveBrowser();
  if(browser&&/brave|chrome|msedge/i.test(path.basename(browser)))pid=await spawnDetached(browser,['--new-window','--start-fullscreen',url]);
  else if(browser&&/firefox/i.test(path.basename(browser)))pid=await spawnDetached(browser,['--new-window',url,'--kiosk']);
  else await shell.openExternal(url);
 }else if(e.launchType==='uri'){if(!/^(steam|com\.epicgames\.launcher|uplay|battlenet|origin2|origin):\/\//i.test(e.target))throw new Error('Unsupported game launcher URI.');await shell.openExternal(e.target);}
 else if(e.launchType==='app'){if(!/^[\w.\-]+_[\w]+![\w.\-]+$/.test(e.target))throw new Error('Invalid Windows app ID.');pid=await spawnDetached('explorer.exe',['shell:AppsFolder\\'+e.target]);}
 else if(e.launchType==='shortcut'){if(!await c.exists(e.target))throw new Error('Shortcut missing. Edit or remove this tile.');const error=await shell.openPath(e.target);if(error)throw new Error(error);}
 else {if(!await c.exists(e.target))throw new Error('Game executable missing. Edit or reimport this tile.');if(!/\.exe$/i.test(e.target))throw new Error('Choose an .exe game file.');pid=await spawnDetached(e.target,e.args||[],{cwd:e.cwd||path.dirname(e.target)});}
 sessions.set(id,{started:Date.now(),before,pid,window:'',seen:false,misses:0});e.lastPlayed=Date.now();await save();await setMode(e.kind==='media'?'browser':'game');emit({type:'launched',data:{title:e.title,kind:e.kind}});win.hide();updateSessions();publish();
}
async function home(){consoleMode=true;keyboardOpen=false;win.setAlwaysOnTop(false);win.setMinimumSize(800,500);const bounds=screen.getPrimaryDisplay().bounds;win.setBounds(bounds);win.setFullScreen(!TEST);if(TEST)win.setBounds({x:40,y:40,width:1280,height:720});win.show();win.focus();await setMode('shell');emit({type:'home'});publish();}
async function desktop(){keyboardOpen=false;consoleMode=false;await setMode('desktop');win.setAlwaysOnTop(false);emit({type:'desktop'});win.hide();if(ready)await rpc('desktop');publish();}
async function openKeyboard(){if(!consoleMode)return;if(!ready)return;const browserWindow=[...running].reverse().find(r=>r.kind==='media'&&r.window)?.window||'';const target=await rpc('keyboardPrepare',{window:browserWindow}).catch(()=>false);if(!target){emit({type:'notice',message:'Open a browser or media tile first, then press Ctrl + Alt + K.'});return;}keyboardOpen=true;keyboardBounds=screen.getPrimaryDisplay().workArea;win.setFullScreen(false);win.setMinimumSize(600,280);win.setBounds({x:keyboardBounds.x+Math.round((keyboardBounds.width-Math.min(1100,keyboardBounds.width))/2),y:keyboardBounds.y+keyboardBounds.height-Math.min(470,Math.round(keyboardBounds.height*.55)),width:Math.min(1100,keyboardBounds.width),height:Math.min(470,Math.round(keyboardBounds.height*.55))});win.setAlwaysOnTop(true,'floating');win.show();win.focus();await setMode('keyboard');emit({type:'keyboard',data:{open:true}});publish();}
async function closeKeyboard(){keyboardOpen=false;emit({type:'keyboard',data:{open:false}});win.hide();win.setAlwaysOnTop(false);await setMode('browser');}
function ensureObject(d){if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Invalid request.');return d;}
async function command(op,data){
 switch(op){
 case 'state':return state();
 case 'scan':return scan();
 case 'import':{if(!Array.isArray(data)||data.length>500)throw new Error('Choose up to 500 candidates.');if(!scanCache)throw new Error('Scan games first.');const accepted=scanCache.candidates.filter(e=>data.includes(e.id));for(const e of accepted){e.candidate=false;hiddenIds.delete(e.id);}entries=c.mergeEntries(entries,accepted);await hydrateArt(entries.filter(e=>accepted.some(a=>a.id===e.id)));await save();publish();return true;}
 case 'favorite':{const e=entries.find(x=>x.id===data);if(e)e.favorite=!e.favorite;await save();publish();return true;}
 case 'remove':hiddenIds.add(String(data));entries=entries.filter(e=>e.id!==data);sessions.delete(data);await save();publish();return true;
 case 'launch':return launch(String(data));
 case 'browse':{const url=c.normalizeUrl(String(data));const e=entries.find(e=>e.id==='media-browser');e.target=url;return launch(e.id);}
 case 'pickFile':{const result=await dialog.showOpenDialog(win,{title:'Choose game executable or shortcut',properties:['openFile'],filters:[{name:'Games',extensions:['exe','lnk']}]});return result.canceled?null:result.filePaths[0];}
 case 'pickFolder':{const result=await dialog.showOpenDialog(win,{title:'Choose games folder',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];}
 case 'add':{const d=ensureObject(data);const title=String(d.title||'').trim().slice(0,160);if(!title)throw new Error('Enter a title.');let e;if(d.kind==='media'){const target=c.normalizeUrl(String(d.target));e={id:d.id&&entries.some(x=>x.id===d.id)?d.id:'custom-'+c.idFor(target),title,source:'Custom service',kind:'media',target,launchType:'web'};}else{const target=path.resolve(String(d.target||''));if(!/\.(exe|lnk)$/i.test(target)||!await c.exists(target))throw new Error('Choose an existing .exe or .lnk.');e={id:d.id&&entries.some(x=>x.id===d.id)?d.id:'local-'+c.idFor(target),title,source:'Standalone',kind:'game',target,args:splitArguments(String(d.args||'')),cwd:d.cwd?path.resolve(String(d.cwd)):path.dirname(target),launchType:/\.lnk$/i.test(target)?'shortcut':'exe'};}hiddenIds.delete(e.id);entries=c.mergeEntries(entries,[e]);await hydrateArt(entries.filter(x=>x.id===e.id));await save();publish();return true;}
 case 'artwork':{const d=ensureObject(data),e=entries.find(e=>e.id===d.id);if(!e)throw new Error('Tile missing.');const result=await dialog.showOpenDialog(win,{title:d.backdrop?'Choose background':'Choose cover art',properties:['openFile'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}]});if(result.canceled)return false;await fs.mkdir(path.join(userDir(),'artwork'),{recursive:true});const target=path.join(userDir(),'artwork',e.id+(d.backdrop?'-backdrop':'-cover')+'-'+Date.now()+path.extname(result.filePaths[0]).toLowerCase());await fs.copyFile(result.filePaths[0],target);e[d.backdrop?'backdrop':'artwork']=target;e[d.backdrop?'customBackdrop':'customArtwork']=true;if(!d.backdrop)e.iconArtwork=false;await save();publish();return true;}
 case 'settings':{const d=ensureObject(data);if(typeof d.profile==='string')settings.profile=d.profile.trim().slice(0,40)||'Player';for(const k of ['startup','reducedMotion','onboarded'])if(typeof d[k]==='boolean')settings[k]=d[k];if(typeof d.sounds==='number')settings.sounds=Math.max(0,Math.min(1,d.sounds));if(typeof d.uiScale==='number')settings.uiScale=Math.max(.8,Math.min(1.3,d.uiScale));if(typeof d.jellyfin==='string'){settings.jellyfin=c.normalizeUrl(d.jellyfin);const e=entries.find(e=>e.id==='media-jellyfin');if(e)e.target=settings.jellyfin;}if(Array.isArray(d.folders))settings.folders=[...new Set(d.folders.filter(x=>typeof x==='string'&&path.isAbsolute(x)))].slice(0,20);if(typeof d.browser==='string'){if(d.browser&&!/\.exe$/i.test(d.browser))throw new Error('Browser must be an executable.');settings.browser=d.browser;await resolveBrowser();}if(app.isPackaged&&!TEST)app.setLoginItemSettings({openAtLogin:settings.startup,name:'PSS Console',path:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath,args:['--startup']});await save();publish();return true;}
 case 'desktop':return desktop();case 'home':return home();case 'quit':quitting=true;app.quit();return true;
 case 'volume':if(!['up','down','mute'].includes(data))throw new Error('Invalid volume action.');return rpc('volume',{action:data});
 case 'keyboard':return openKeyboard();
 case 'keyboardClose':return closeKeyboard();
 case 'keyboardSend':{const d=ensureObject(data);if(!keyboardOpen)throw new Error('Open browser keyboard first.');await rpc('text',{text:String(d.text||'').slice(0,4096)});if(d.enter)await rpc('key',{key:'enter'});return closeKeyboard();}
 case 'runningFocus':{const s=sessions.get(data);if(!s?.window)throw new Error('App window not found yet.');await setMode(entries.find(e=>e.id===data)?.kind==='media'?'browser':'game');win.hide();return rpc('focus',{window:s.window});}
 case 'runningClose':{const s=sessions.get(data);if(!s?.window)throw new Error('App window not found.');return rpc('close',{window:s.window});}
 case 'power':{if(!['sleep','restart','shutdown'].includes(data))throw new Error('Unknown power action.');if(TEST)throw new Error('Power disabled during tests.');if(data==='sleep'){await desktop();return rpc('sleep');}return spawnDetached('shutdown.exe',[data==='restart'?'/r':'/s','/t','0']);}
 default:throw new Error('Unknown command.');
 }
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',(_event,argv)=>{if(argv.includes('--quit-for-update')){quitting=true;app.quit();return;}home();});
 app.whenReady().then(async()=>{
  try{const saved=JSON.parse(await fs.readFile(path.join(userDir(),'library.json'),'utf8'));entries=saved.entries||[];hiddenIds=new Set(saved.hiddenIds||[]);settings={...settings,...saved.settings};}catch{}
  entries=c.mergeEntries(c.media(settings.jellyfin),entries).filter(e=>!hiddenIds.has(e.id));
  protocol.handle('pss-asset',request=>{const url=new URL(request.url);const p=assetPaths.get(url.pathname.slice(1));return p?net.fetch(pathToFileURL(p).href):new Response('Not found',{status:404});});
  win=new BrowserWindow({width:1280,height:720,minWidth:800,minHeight:500,show:false,frame:TEST,fullscreen:!TEST,backgroundColor:'#0a111c',title:'PSS Console',icon:path.join(__dirname,'..','assets','icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:true,autoplayPolicy:'no-user-gesture-required'}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file:')&&!url.startsWith('http://127.0.0.1:5173'))event.preventDefault();});
  win.on('close',event=>{if(!quitting){event.preventDefault();desktop();}});win.on('focus',()=>{if(consoleMode&&!keyboardOpen&&mode==='shell')setMode('shell');});
  ipcMain.handle('pss:command',async(event,op,data)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Untrusted sender.');try{return await command(op,data);}catch(e){log(op+': '+e.message);throw e;}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'..','assets','tray.png'));tray=new Tray(icon.isEmpty()?nativeImage.createEmpty():icon);tray.setToolTip('PSS Console');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open console',click:()=>home()},{label:'Return to Windows',click:()=>desktop()},{type:'separator'},{label:'Quit PSS Console',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',()=>home());
  if(!TEST){globalShortcut.register('CommandOrControl+Alt+Home',()=>home());globalShortcut.register('CommandOrControl+Alt+D',()=>desktop());globalShortcut.register('CommandOrControl+Alt+K',()=>openKeyboard());}
  if(process.env.PSS_DEV_URL)await win.loadURL(process.env.PSS_DEV_URL);else await win.loadFile(path.join(__dirname,'..','dist','index.html'));
  win.show();startHelper();initial().catch(e=>{discovering=false;warnings.push(e.message);publish();log(e.stack||e.message);});
 });
 app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();if(helper&&!helper.killed){helper.stdin.end();setTimeout(()=>helper?.kill(),1200).unref();}tray?.destroy();});
 app.on('window-all-closed',()=>{if(quitting)app.quit();});
}
