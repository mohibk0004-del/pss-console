const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const executable=path.join(process.env.LOCALAPPDATA,'Programs','PSS Console','PSS Console.exe');
 const instance=await electron.launch({executablePath:executable,args:['--data-dir='+path.join(work,'installed-profile')],env,timeout:30000});const report={};
 try{
  const page=await instance.firstWindow();await page.waitForFunction(()=>!!window.pss);const invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});
  let state;for(let i=0;i<120;i++){state=await invoke('state');if(state.helper&&!state.discovering)break;await delay(500);}assert.equal(state.helper,true);assert.equal(state.discovering,false);
  report.executable=executable;report.packaged=await instance.evaluate(({app})=>app.isPackaged);assert.equal(report.packaged,true);report.games=state.entries.filter(e=>e.kind==='game').length;report.browser=state.browser;
  const readStartup=async()=>{try{return (await exec('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v','PSS Console'],{windowsHide:true})).stdout;}catch{return '';}};
  await invoke('settings',{startup:false,onboarded:true,sounds:0});assert.equal(await readStartup(),'');report.startupDisable=true;
  await invoke('settings',{startup:true});const registry=await readStartup();assert.ok(registry.includes('"'+executable+'" --startup'));report.startupEnable=true;report.startup={registry:registry.trim(),electronQuery:await instance.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath,args:['--startup']}))};
  report.shortcuts=await instance.evaluate(({globalShortcut})=>({home:globalShortcut.isRegistered('CommandOrControl+Alt+Home'),desktop:globalShortcut.isRegistered('CommandOrControl+Alt+D'),keyboard:globalShortcut.isRegistered('CommandOrControl+Alt+K')}));assert.ok(Object.values(report.shortcuts).every(Boolean));
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"(New-Object -ComObject WScript.Shell).SendKeys('^%{HOME}')"],{windowsHide:true});
  await page.getByRole('heading',{name:'Control center',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();report.globalMenuShortcut=true;
  await invoke('desktop');assert.equal((await invoke('state')).mode,'desktop');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);await invoke('home');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);report.fullscreenDesktopRoundtrip=true;
  report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;
 }finally{await instance.close();await fs.writeFile(path.join(out,'PSS-Installed-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
