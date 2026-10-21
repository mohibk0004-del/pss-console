const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,globalShortcut,shell,protocol,net,screen}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {spawn}=require('node:child_process');const readline=require('node:readline');const {pathToFileURL}=require('node:url');
const {matchesGame,readyWindow,windowScore}=require('./sessions.cjs');const c=require('./catalog.cjs');const {websiteIcon}=require('./icons.cjs');const {discover,splitArguments}=require('./discovery.cjs');
const TEST=process.argv.includes('--smoke');
const dataFlag=process.argv.find(x=>x.startsWith('--data-dir='));if(dataFlag)app.setPath('userData',dataFlag.slice(11));
protocol.registerSchemesAsPrivileged([{scheme:'pss-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,tray,helper,ready=false,quitting=false,consoleMode=true,keyboardOpen=false;
let seq=0,pending=new Map(),controller={connected:false,name:'No controller',family:'xbox',count:0};
let entries=[],settings={startup:!TEST,reducedMotion:false,sounds:.15,profile:process.env.USERNAME||'Player',jellyfin:'http://127.0.0.1:8096',folders:[],browser:'',uiScale:1,onboarded:false};
let system={installed:[],shortcuts:[]},windows=[],running=[],warnings=[],browser='',mode='shell';let storeQueue=Promise.resolve();let scanPromise=null;let scanCache=null;let keyboardBounds;let discovering=true;
const assetPaths=new Map();
const sessions=new Map();let hiddenIds=new Set();let activeSessionId=null,overlayId=null,handoff=null,handoffTimer=null,presentationEpoch=0;
const userDir=()=>app.getPath('userData');
const helperExe=()=>path.join(app.isPackaged?path.join(process.resourcesPath,'helper'):path.join(__dirname,'..','native','publish'),'PssHelper.exe');
function emit(event){if(win&&!win.isDestroyed())win.webContents.send('pss:event',event);}
function asset(file){if(!file)return undefined;if(file.startsWith('data:image/'))return file;const id=c.idFor(file);assetPaths.set(id,file);return 'pss-asset://local/'+id;}
function publicEntry(e){return {...e,artwork:asset(e.artwork),backdrop:asset(e.backdrop)};}
function state(){return {entries:entries.map(publicEntry),settings,controller,running,helper:ready,version:app.getVersion(),mode:consoleMode?mode:'desktop',browser:browser?path.basename(browser,'.exe'):'Default browser',warnings,discovering,overlayId,handoff};}
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
  if(event.type==='input'){if(event.action==='system'){void systemMenu().catch(err=>log(err.message));return;}if(event.action==='home'){home();return;}if(event.action==='keyboard'){openKeyboard();return;}emit(event);return;}
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
 for(const e of list.filter(e=>['exe','shortcut'].includes(e.launchType)&&(!e.artwork||(!e.customArtwork&&(e.iconArtwork||e.artwork.startsWith('data:image/'))&&e.iconVersion!==2)))){
  try{
   const link=e.launchType==='shortcut'?shell.readShortcutLink(e.target):{target:e.target};
   const sources=[...(link.icon?[{path:link.icon,index:link.iconIndex||0}]:[]),{path:link.target,index:0}];let data;
   for(const source of sources){if(!await c.exists(source.path))continue;data=await rpc('icon',source).catch(()=>null);if(data)break;}
   if(!data){const icon=await app.getFileIcon(link.target||e.target,{size:'large'});if(!icon.isEmpty())data=icon.toDataURL();}
   if(data){e.artwork=data;e.iconArtwork=true;e.iconVersion=2;}
  }catch{}
 }
 const sites=list.filter(e=>!e.artwork&&e.launchType==='web'&&!e.id.startsWith('media-'));let siteIndex=0;
 async function siteWorker(){while(siteIndex<sites.length){const e=sites[siteIndex++];e.artwork=await websiteIcon(e.target,path.join(userDir(),'artwork'),e.id);if(e.artwork)e.iconArtwork=true;}}
 await Promise.all([siteWorker(),siteWorker(),siteWorker()]);
}
function matchWindow(entry,w,before,session){
 if(w.pid===process.pid||w.process==='PssHelper'||!w.title)return false;
 const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(entry.kind==='media')return path.basename(browser||'brave.exe','.exe').toLowerCase()===w.process.toLowerCase()&&!before.has(w.window);
 return matchesGame(entry,w,session);
}
function clearHandoff(){if(handoffTimer)clearTimeout(handoffTimer);handoffTimer=null;if(handoff?.token&&ready)void rpc('cancelActivation',{token:handoff.token}).catch(()=>{});handoff=null;}
function endSession(id,s){
 if(sessions.get(id)!==s)return;sessions.delete(id);
 if(consoleMode&&!keyboardOpen&&activeSessionId===id&&(mode==='game'||mode==='browser'||overlayId===id||handoff?.id===id))void home();
}
function updateSessions(){
 let changed=false;
 for(const [id,s]of sessions){const e=entries.find(e=>e.id===id);if(!e){sessions.delete(id);continue;}
  const gameCandidates=e.kind==='game'?windows.filter(w=>matchWindow(e,w,s.before,s)).sort((a,b)=>windowScore(e,b,s)-windowScore(e,a,s)||Number(readyWindow(b))-Number(readyWindow(a))||Number(b.foreground)-Number(a.foreground)):[];
  const attention=gameCandidates.find(w=>/\b(?:system error|application error|fatal error)\b/i.test(w.title)||(w.className==='#32770'&&w.foreground));
  if(attention&&e.id!=='riot-valorant'&&activeSessionId===id&&consoleMode&&(handoff?.id===id||mode==='game')&&!handoff?.failed)void gameAttention(id,attention);
  const found=e.kind==='game'?(attention&&activeSessionId===id&&e.id!=='riot-valorant'?attention:gameCandidates[0]):(s.window?windows.find(w=>w.window===s.window):null)||windows.find(w=>matchWindow(e,w,s.before,s));
  if(found){
   if(s.window!==found.window)changed=true;s.window=found.window;s.pid=found.pid;s.seen=true;s.misses=0;s.missingSince=0;
   if(handoff?.id===id&&handoff.phase==='launching'&&!handoff.failed&&!handoff.busy){
    const now=Date.now();if(s.candidate!==found.window){s.candidate=found.window;s.candidateSince=now;}
    if(e.id==='riot-valorant'||(readyWindow(found)&&now-s.candidateSince>=400))void finishLaunch(id);
   }
  }else if(s.seen){
   s.candidate='';
   s.misses++;s.missingSince||=Date.now();
   if(s.misses>=3&&!s.checking){
    if(e.kind==='media'){endSession(id,s);changed=true;}
    else{s.checking=true;void rpc('processAlive',{pid:s.pid}).then(alive=>{
     if(sessions.get(id)===s&&s.misses>=3&&(!alive||Date.now()-s.missingSince>=15000)){endSession(id,s);updateSessions();publish();}
    }).catch(err=>log(err.message)).finally(()=>{s.checking=false;});}
   }
  }else if(Date.now()-s.started>300000){sessions.delete(id);changed=true;}
 }
 const next=[...sessions].map(([id,s])=>({id,title:entries.find(e=>e.id===id)?.title||id,pid:s.pid||0,kind:entries.find(e=>e.id===id)?.kind||'game',window:s.window||''}));
 if(JSON.stringify(running)!==JSON.stringify(next)){running=next;changed=true;}if(changed)publish();
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function gameAttention(id,dialog){
 if(handoff?.recovering)return;
 if(!handoff)handoff={id,phase:'launching'};
 const flow=handoff,epoch=presentationEpoch;flow.recovering=true;flow.failed=true;flow.busy=false;
 if(handoffTimer)clearTimeout(handoffTimer);handoffTimer=null;
 if(flow.token)void rpc('cancelActivation',{token:flow.token}).catch(()=>{});
 prepareGameScreen();publish();
 const detail=await rpc('windowText',{window:dialog.window}).catch(()=>dialog.title);
 if(epoch!==presentationEpoch||!consoleMode||handoff!==flow)return;
 flow.detail=detail||dialog.title;flow.waiting=true;await setMode('launching');publish();void log('handoff attention '+JSON.stringify({id,title:dialog.title,detail:flow.detail}));
}
async function finishLaunch(id){
 if(handoff?.id!==id||handoff.phase!=='launching')return;
 const e=entries.find(e=>e.id===id);
 if(e?.kind==='game'&&e.id!=='riot-valorant')return transferGame(id);
 const epoch=presentationEpoch;clearHandoff();publish();
 if(!consoleMode||overlayId)return;
 win.hide();await setMode(e?.kind==='media'?'browser':'game');
 if(epoch===presentationEpoch&&consoleMode&&sessions.get(id)?.window)await rpc('focus',{window:sessions.get(id).window}).catch(err=>log(err.message));
}
function prepareGameScreen(){win.setAlwaysOnTop(false);win.setMinimumSize(800,500);win.setBounds(screen.getPrimaryDisplay().bounds);win.setFullScreen(!TEST);if(TEST)win.setBounds({x:40,y:40,width:1280,height:720});win.showInactive();}
async function transferGame(id){
 if(!handoff||handoff.busy)return false;
 const flow=handoff,epoch=presentationEpoch,session=sessions.get(id),entry=entries.find(e=>e.id===id);
 if(!session||!entry)return false;
 flow.busy=true;flow.failed=false;flow.token=String(epoch);overlayId=null;publish();prepareGameScreen();await setMode('launching');
 const valid=()=>!quitting&&consoleMode&&epoch===presentationEpoch&&handoff===flow&&!flow.recovering;
 if(!valid())return false;
 if(flow.phase==='resuming'&&windows.some(w=>w.window===session.window&&w.minimized))await rpc('restore',{window:session.window}).catch(()=>false);
 const deadline=Date.now()+5000;let stableWindow='',stableSince=0;
 while(valid()&&Date.now()<deadline){
  windows=await rpc('windows',{},1000).catch(()=>[]);if(!valid())return false;
  const candidates=windows.filter(w=>readyWindow(w)&&matchWindow(entry,w,session.before,session)).sort((a,b)=>windowScore(entry,b,session)-windowScore(entry,a,session));
  const candidate=candidates[0];
  if(!candidate){stableWindow='';await pause(200);continue;}
  if(stableWindow!==candidate.window){stableWindow=candidate.window;stableSince=Date.now();await pause(400);continue;}
  if(Date.now()-stableSince<400){await pause(100);continue;}
  session.window=candidate.window;session.pid=candidate.pid;
  void log('handoff candidate '+JSON.stringify({id,window:candidate.window,pid:candidate.pid,process:candidate.process,ready:true,elapsed:Date.now()-session.started}));
  const result=await rpc('activate',{window:candidate.window,token:flow.token,timeoutMs:Math.max(1,Math.min(2000,deadline-Date.now()))},3000).catch(()=>({focused:false}));
  if(!valid())return false;
  if(result.focused){
   // Keep artwork behind the game while its first window settles or is replaced.
   let settled=true;const settleUntil=Math.min(deadline,Date.now()+1200);
   while(valid()&&Date.now()<settleUntil){await pause(200);if(!valid())return false;windows=await rpc('windows',{},1000).catch(()=>[]);if(!valid())return false;if(!windows.some(w=>w.window===candidate.window&&w.foreground&&readyWindow(w))){settled=false;break;}}
   if(settled&&valid()){
    void log('handoff focused '+JSON.stringify({id,window:candidate.window,elapsed:Date.now()-session.started}));
    if(flow.phase==='launching'&&!flow.covered){
     flow.covered=true;if(handoffTimer)clearTimeout(handoffTimer);handoffTimer=setTimeout(async()=>{
      const latest=await rpc('windows',{},1000).catch(()=>[]);if(!valid())return;
      if(latest.some(w=>w.foreground&&readyWindow(w)&&matchWindow(entry,w,session.before,session))){clearHandoff();win.hide();publish();}
      else{flow.busy=false;void transferGame(id);}
     },8000);handoffTimer.unref();await setMode('game');publish();return true;
    }
    clearHandoff();overlayId=null;win.hide();await setMode('game');publish();return true;
   }
  }
  void log('handoff activation not settled '+id);await pause(200);
 }
 if(valid()){flow.busy=false;flow.failed=true;flow.waiting=true;win.show();win.focus();publish();void log('handoff recovery '+id);}
 return false;
}
async function resumeSession(id){
 if(!consoleMode)return false;const openingEpoch=presentationEpoch;
 const session=sessions.get(id);if(!session?.window)throw new Error('App window not found yet.');
 if(ready){windows=await rpc('windows');updateSessions();}if(openingEpoch!==presentationEpoch||!consoleMode)return false;if(!windows.some(w=>w.window===session.window))throw new Error('Game window is changing or has closed. Try again in a moment.');
 const epoch=++presentationEpoch;activeSessionId=id;handoff={id,phase:'resuming'};publish();
 await pause(settings.reducedMotion?0:160);if(epoch!==presentationEpoch||!consoleMode)return false;
 if(entries.find(e=>e.id===id)?.kind==='game'&&id!=='riot-valorant')return transferGame(id);
 clearHandoff();overlayId=null;win.hide();win.setAlwaysOnTop(false);await setMode(entries.find(e=>e.id===id)?.kind==='media'?'browser':'game');
 if(epoch!==presentationEpoch||!consoleMode)return false;
 const focused=await rpc('focus',{window:session.window}).catch(()=>false);
 if(!focused&&epoch===presentationEpoch){await home();emit({type:'notice',message:'Windows could not bring the app forward. Select it from the taskbar, then try again.'});}
 publish();return focused;
}
async function systemMenu(){
 if(!consoleMode)return home();
 if(overlayId)return resumeSession(overlayId).catch(err=>{emit({type:'notice',message:err.message});});
 const openingEpoch=presentationEpoch;if(ready){windows=await rpc('windows');updateSessions();}if(openingEpoch!==presentationEpoch||!consoleMode)return;
 const foreground=windows.find(w=>w.foreground);const selected=[...sessions].find(([,s])=>s.window===foreground?.window)?.[0]||activeSessionId;
 const session=sessions.get(selected);
 if(!session?.window){if(win.isVisible()&&mode==='shell')emit({type:'input',action:'control'});else await home();return;}
 activeSessionId=selected;overlayId=selected;keyboardOpen=false;clearHandoff();const epoch=++presentationEpoch;
 const area=screen.getDisplayMatching(win.getBounds()).workArea;
 const width=Math.round(Math.min(area.width-48,Math.max(1120,area.width*.65))),height=Math.round(Math.min(area.height-48,Math.max(380,area.height*.34)));
 win.setFullScreen(false);win.setMinimumSize(600,280);win.setBounds({x:Math.round(area.x+(area.width-width)/2),y:area.y+area.height-height-24,width,height});
 win.setAlwaysOnTop(true,'floating');await setMode('overlay');if(epoch!==presentationEpoch||!consoleMode||overlayId!==selected)return;publish();win.show();win.focus();emit({type:'overlay'});
}
function spawnDetached(file,args=[],options={}){return new Promise((resolve,reject)=>{const p=spawn(file,args,{detached:true,stdio:'ignore',windowsHide:false,...options});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve(p.pid);});});}
async function launch(id){
 const e=entries.find(e=>e.id===id);if(!e)throw new Error('Library entry no longer exists.');
 const existing=sessions.get(id);if(existing?.window&&windows.some(w=>w.window===existing.window))return resumeSession(id);
 if(handoff)throw new Error('Another app is still starting. Return home before launching again.');
 const epoch=++presentationEpoch;consoleMode=true;overlayId=null;handoff={id,phase:'launching'};publish();await pause(settings.reducedMotion?0:180);if(epoch!==presentationEpoch||!consoleMode)return false;
 let executable=e.launchType==='exe'?e.target:'';if(e.launchType==='shortcut')try{executable=shell.readShortcutLink(e.target).target;}catch{}
 try{
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
 sessions.set(id,{started:Date.now(),before,pid,executable,window:'',seen:false,misses:0});activeSessionId=id;e.lastPlayed=Date.now();await save();
 if(epoch===presentationEpoch&&consoleMode){await setMode('launching');handoffTimer=setTimeout(()=>{if(handoff?.id===id&&epoch===presentationEpoch){handoff.waiting=true;publish();}},12000);handoffTimer.unref();}
 emit({type:'launched',data:{title:e.title,kind:e.kind}});updateSessions();publish();
 }catch(err){if(epoch===presentationEpoch){clearHandoff();await home();}throw err;}
}
async function home(){++presentationEpoch;clearHandoff();overlayId=null;consoleMode=true;keyboardOpen=false;win.setAlwaysOnTop(false);win.setMinimumSize(800,500);const bounds=screen.getPrimaryDisplay().bounds;win.setBounds(bounds);win.setFullScreen(!TEST);if(TEST)win.setBounds({x:40,y:40,width:1280,height:720});win.show();win.focus();await setMode('shell');emit({type:'home',data:{entryId:activeSessionId}});publish();}
async function desktop(){const epoch=++presentationEpoch;clearHandoff();overlayId=null;keyboardOpen=false;consoleMode=false;win.setAlwaysOnTop(false);emit({type:'desktop'});win.hide();await setMode('desktop');if(ready&&epoch===presentationEpoch&&!consoleMode)await rpc('desktop');publish();}
async function openKeyboard(){if(!consoleMode)return;if(!ready)return;const openingEpoch=++presentationEpoch;const browserWindow=[...running].reverse().find(r=>r.kind==='media'&&r.window)?.window||'';const target=await rpc('keyboardPrepare',{window:browserWindow}).catch(()=>false);if(openingEpoch!==presentationEpoch||!consoleMode)return;if(!target){emit({type:'notice',message:'Open a browser or media tile first, then press Ctrl + Alt + K.'});return;}overlayId=null;clearHandoff();keyboardOpen=true;keyboardBounds=screen.getPrimaryDisplay().workArea;win.setFullScreen(false);win.setMinimumSize(600,280);win.setBounds({x:keyboardBounds.x+Math.round((keyboardBounds.width-Math.min(1100,keyboardBounds.width))/2),y:keyboardBounds.y+keyboardBounds.height-Math.min(470,Math.round(keyboardBounds.height*.55)),width:Math.min(1100,keyboardBounds.width),height:Math.min(470,Math.round(keyboardBounds.height*.55))});win.setAlwaysOnTop(true,'floating');win.show();win.focus();await setMode('keyboard');if(openingEpoch!==presentationEpoch||!consoleMode)return;emit({type:'keyboard',data:{open:true}});publish();}
async function closeKeyboard(){if(!consoleMode){keyboardOpen=false;win.setAlwaysOnTop(false);return false;}keyboardOpen=false;emit({type:'keyboard',data:{open:false}});win.hide();win.setAlwaysOnTop(false);await setMode('browser');}
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
 case 'handoffRetry':if(handoff&&!handoff.busy){handoff.failed=false;handoff.recovering=false;handoff.detail='';return transferGame(handoff.id);}return false;
 case 'handoffYield':if(handoff){const entry=entries.find(e=>e.id===handoff.id),session=sessions.get(handoff.id);const epoch=++presentationEpoch;clearHandoff();overlayId=null;win.setAlwaysOnTop(false);win.hide();await setMode(entry?.kind==='media'?'browser':'game');if(epoch===presentationEpoch&&consoleMode&&session?.window)await rpc('focus',{window:session.window}).catch(()=>false);return true;}return false;case 'controlOverlay':return systemMenu();case 'desktop':return desktop();case 'home':return home();case 'quit':quitting=true;app.quit();return true;
 case 'volume':if(!['up','down','mute'].includes(data))throw new Error('Invalid volume action.');return rpc('volume',{action:data});
 case 'keyboard':return openKeyboard();
 case 'keyboardClose':return closeKeyboard();
 case 'keyboardSend':{const d=ensureObject(data);if(!keyboardOpen)throw new Error('Open browser keyboard first.');await rpc('text',{text:String(d.text||'').slice(0,4096)});if(d.enter)await rpc('key',{key:'enter'});return closeKeyboard();}
 case 'runningFocus':return resumeSession(data);
 case 'runningClose':{const s=sessions.get(data);if(!s?.window)throw new Error('App window not found.');const closed=await rpc('close',{window:s.window});if(!closed)throw new Error('Windows could not request an app exit. Close it from inside the game or app.');return true;}
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
  if(!TEST){globalShortcut.register('CommandOrControl+Alt+Home',()=>systemMenu().catch(err=>log(err.message)));globalShortcut.register('CommandOrControl+Alt+D',()=>desktop());globalShortcut.register('CommandOrControl+Alt+K',()=>openKeyboard());}
  if(process.env.PSS_DEV_URL)await win.loadURL(process.env.PSS_DEV_URL);else await win.loadFile(path.join(__dirname,'..','dist','index.html'));
  win.show();startHelper();initial().catch(e=>{discovering=false;warnings.push(e.message);publish();log(e.stack||e.message);});
 });
 app.on('before-quit',()=>{quitting=true;clearHandoff();globalShortcut.unregisterAll();if(helper&&!helper.killed){helper.stdin.end();setTimeout(()=>helper?.kill(),1200).unref();}tray?.destroy();});
 app.on('window-all-closed',()=>{if(quitting)app.quit();});
}
