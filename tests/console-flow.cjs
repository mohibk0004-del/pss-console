const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const exec=require('node:util').promisify(require('node:child_process').execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(out,'..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,limit=30000){const end=Date.now()+limit;while(Date.now()<end){const value=await fn();if(value)return value;await delay(120);}throw Error('Timed out: '+label);}
(async()=>{
 const fixture=path.join(work,'Console Flow Probe');await fs.mkdir(fixture,{recursive:true});
 await exec('dotnet',['publish',path.join(__dirname,'fixtures/Probe.csproj'),'-c','Release','-o',fixture],{windowsHide:true});
 const game=path.join(fixture,'PssProbe.exe'),companion=path.join(fixture,'CompanionProbe.exe'),commands=path.join(fixture,'commands.txt'),otherCommands=path.join(fixture,'other-commands.txt');
 for(const p of [commands,otherCommands])await fs.unlink(p).catch(()=>{});await fs.copyFile(game,companion);
 const shortcut=path.join(fixture,'Console Game.lnk');
 await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$link=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PSS_LINK);$link.TargetPath=$env:PSS_EXE;$link.Arguments=$env:PSS_ARGS;$link.WorkingDirectory=$env:PSS_CWD;$link.Save()"],{windowsHide:true,env:{...process.env,PSS_LINK:shortcut,PSS_EXE:game,PSS_CWD:fixture,PSS_ARGS:'--delay 1400 --title "Different Window Caption" --commands "'+commands+'"'}});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.PSS_TEST_INSTALLED;const instance=await electron.launch({executablePath:packaged||undefined,args:[...(packaged?[]:[root]),'--smoke','--data-dir='+path.join(work,'console-flow-profile')],cwd:root,env});const report={};let invoke;const errors=[];
 try{
  const page=await instance.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.pss);
  invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});
  await until(async()=>{const s=await invoke('state');return s.helper&&!s.discovering;},'discovery',90000);await invoke('settings',{onboarded:true,sounds:0,reducedMotion:false});
  for(const e of (await invoke('state')).entries.filter(e=>e.title.startsWith('Console Flow ')||e.title==='Background Companion'))await invoke('remove',e.id);
  await invoke('add',{kind:'game',title:'Console Flow Game',target:shortcut});const id=(await invoke('state')).entries.find(e=>e.target===shortcut).id;
  const launch=invoke('launch',id);await page.getByRole('main',{name:'Game transition'}).waitFor();await launch;
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  await page.screenshot({path:path.join(out,'PSS-Launch-Transition.png')});report.launchScreen=true;
  const active=await until(async()=>(await invoke('state')).running.find(r=>r.id===id&&r.window),'shortcut window with different title');
  await until(async()=>!(await invoke('state')).handoff,'handoff end');assert.equal((await invoke('state')).mode,'game');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);report.gameHandoff=true;
  await invoke('controlOverlay');await page.getByRole('main',{name:'In-game control center'}).waitFor();assert.equal((await invoke('state')).mode,'overlay');
  const overlay=await instance.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {bounds:w.getBounds(),top:w.isAlwaysOnTop(),fullscreen:w.isFullScreen()};});assert.ok(overlay.top);assert.equal(overlay.fullscreen,false);assert.ok(overlay.bounds.height<600);await delay(220);
  await page.screenshot({path:path.join(out,'PSS-Game-Control-Center.png')});report.overlay=overlay;
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length),0);report.noIdleAnimationLoops=true;
  await page.getByRole('button',{name:'Close game',exact:true}).click();await page.getByRole('region',{name:'Close game confirmation'}).waitFor();await page.keyboard.press('Escape');assert.equal((await invoke('state')).overlayId,id);assert.equal(await page.getByRole('region',{name:'Close game confirmation'}).count(),0);report.closeConfirmationBack=true;
  await page.getByRole('button',{name:'Resume',exact:true}).click();await until(async()=>(await invoke('state')).mode==='game'&&!(await invoke('state')).overlayId,'resume');assert.equal((await invoke('state')).running.find(r=>r.id===id).pid,active.pid);assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),false);report.resumeSameProcess=true;
  await invoke('controlOverlay');await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('.console-shell').waitFor();assert.equal((await invoke('state')).mode,'shell');await page.getByRole('button',{name:'Resume Game',exact:true}).click();await until(async()=>(await invoke('state')).mode==='game','home resume');report.homeResume=true;
  await fs.writeFile(commands,'hide');await delay(6500);assert.ok((await invoke('state')).running.some(r=>r.id===id));assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);await fs.writeFile(commands,'show');await delay(1400);report.temporaryWindowLoss=true;
  // Another running game must not suppress return home when the active game exits.
  await invoke('home');await invoke('add',{kind:'game',title:'Background Companion',target:companion,args:'--title "Companion Window" --commands "'+otherCommands+'"'});
  const other=(await invoke('state')).entries.find(e=>e.target===companion).id;await invoke('launch',other);await until(async()=>(await invoke('state')).running.find(r=>r.id===other&&r.window),'companion');await until(async()=>!(await invoke('state')).handoff,'companion handoff');
  await invoke('home');await invoke('runningFocus',id);await fs.writeFile(commands,'exit');await until(async()=>!(await invoke('state')).running.some(r=>r.id===id),'active exit');await until(async()=>(await invoke('state')).mode==='shell','automatic return home');assert.ok((await invoke('state')).running.some(r=>r.id===other));assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);report.exitReturnsHomeWithOtherApps=true;
  await invoke('runningFocus',other);
  await page.evaluate(()=>Promise.all([window.pss.invoke('controlOverlay'),window.pss.invoke('desktop')]));assert.equal((await invoke('state')).mode,'desktop');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);report.desktopWinsOverlayRace=true;
  await invoke('keyboardClose');assert.equal((await invoke('state')).mode,'desktop');
  await invoke('home');await invoke('runningFocus',other);await invoke('controlOverlay');await page.getByRole('button',{name:'Windows',exact:true}).click();assert.equal((await invoke('state')).mode,'desktop');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),false);
  await fs.writeFile(otherCommands,'exit');await until(async()=>!(await invoke('state')).running.some(r=>r.id===other),'desktop exit',30000);assert.equal((await invoke('state')).mode,'desktop');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);report.desktopDisablesRestoration=true;
  await invoke('home');await invoke('launch',id);await until(async()=>(await invoke('state')).running.find(r=>r.id===id&&r.window),'close-request game');await until(async()=>!(await invoke('state')).handoff,'close-request handoff');await invoke('controlOverlay');
  await page.getByRole('button',{name:'Close game',exact:true}).click();await page.getByRole('region',{name:'Close game confirmation'}).getByRole('button',{name:'Close game',exact:true}).click();
  await until(async()=>!(await invoke('state')).running.some(r=>r.id===id)&&(await invoke('state')).mode==='shell','overlay close returns home');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),false);report.confirmedCloseReturnsHome=true;
  const missing=path.join(fixture,'MissingAfterImport.exe');await fs.copyFile(game,missing);await invoke('add',{kind:'game',title:'Console Flow Missing',target:missing});const missingId=(await invoke('state')).entries.find(e=>e.target===missing).id;await fs.unlink(missing);
  await assert.rejects(()=>invoke('launch',missingId),/missing/i);assert.equal((await invoke('state')).handoff,null);assert.equal((await invoke('state')).mode,'shell');report.launchFailureRecovery=true;
  await page.evaluate(id=>Promise.all([window.pss.invoke('launch',id),window.pss.invoke('desktop')]),id);assert.equal((await invoke('state')).mode,'desktop');assert.ok(!(await invoke('state')).running.some(r=>r.id===id));assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);report.desktopCancelsPendingLaunch=true;await invoke('home');
  await invoke('add',{kind:'game',title:'Console Flow Slow Start',target:game,args:'--delay 14500 --commands "'+commands+'"'});const slow=(await invoke('state')).entries.find(e=>e.target===game).id;
  await invoke('launch',slow);await until(async()=>(await invoke('state')).handoff?.waiting,'slow-start guidance',16000);assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);assert.ok(await page.getByText('Still starting',{exact:true}).count());report.slowStartKeepsShell=true;
  await until(async()=>(await invoke('state')).running.find(r=>r.id===slow&&r.window)&&!(await invoke('state')).handoff,'slow game ready',10000);await fs.writeFile(commands,'exit');await until(async()=>!(await invoke('state')).running.some(r=>r.id===slow),'slow game close');
  assert.deepEqual(errors,[]);report.rendererErrors=errors;report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;try{await(await instance.firstWindow()).screenshot({path:path.join(out,'PSS-Console-Flow-Failure.png')});}catch{}throw e;}finally{
  for(const p of [commands,otherCommands])await fs.writeFile(p,'exit').catch(()=>{});
  if(invoke)for(const e of (await invoke('state').catch(()=>({entries:[]}))).entries.filter(e=>e.title.startsWith('Console Flow ')||e.title==='Background Companion')){await invoke('runningClose',e.id).catch(()=>{});await invoke('remove',e.id).catch(()=>{});}
  await instance.close();await fs.writeFile(path.join(out,'PSS-Console-Flow-Report.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
