const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(150);}throw Error('Timed out: '+label);}
(async()=>{
 const fixture=path.join(work,'PSS Test Game'),cwd=path.join(fixture,'Game Working Folder');await fs.mkdir(cwd,{recursive:true});
 await exec('dotnet',['publish',path.join(__dirname,'fixtures','Probe.csproj'),'-c','Release','-o',fixture],{windowsHide:true});
 const game=path.join(fixture,'PssProbe.exe'),reportFile=path.join(fixture,'launch-report.json'),shortcut=path.join(fixture,'Game Shortcut.lnk');
 const exeArgs='--marker "hello world" --report "'+reportFile+'"';
 const script="$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PSS_TEST_LINK); $s.TargetPath=$env:PSS_TEST_EXE; $s.Arguments=$env:PSS_TEST_ARGS; $s.WorkingDirectory=$env:PSS_TEST_CWD; $s.Save()";
 await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,PSS_TEST_LINK:shortcut,PSS_TEST_EXE:game,PSS_TEST_ARGS:'--marker "shortcut value" --report "'+reportFile+'"',PSS_TEST_CWD:cwd}});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const instance=await electron.launch({args:[root,'--smoke','--data-dir='+path.join(work,'smoke-profile')],cwd:root,env});const report={};let invoke;let activeId;
 try{
  const page=await instance.firstWindow();await page.waitForFunction(()=>!!window.pss);invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});await until(async()=>{const s=await invoke('state');return s.helper&&!s.discovering;},'helper');
  for(const type of ['exe','shortcut']){
   await fs.unlink(reportFile).catch(()=>{});await invoke('add',{kind:'game',title:'PSS Standalone Probe',target:type==='exe'?game:shortcut,args:type==='exe'?exeArgs:'',cwd:type==='exe'?cwd:''});
   const entry=(await invoke('state')).entries.find(e=>e.target===(type==='exe'?game:shortcut));assert.ok(entry);activeId=entry.id;await invoke('launch',entry.id);
   const launched=await until(async()=>{try{return JSON.parse(await fs.readFile(reportFile,'utf8'));}catch{return false;}},type+' report');
   assert.equal(launched.cwd,cwd);assert.equal(launched.args[1],type==='exe'?'hello world':'shortcut value');
   await until(async()=>(await invoke('state')).running.find(r=>r.id===entry.id&&r.window),type+' tracking');
   await invoke('home');await invoke('runningFocus',entry.id);await invoke('runningClose',entry.id);await until(async()=>!(await invoke('state')).running.some(r=>r.id===entry.id),type+' exit');
   await invoke('remove',entry.id);activeId=null;await invoke('home');report[type]={launch:true,workingDirectory:true,quotedArguments:true,windowTracking:true,resume:true,exit:true};
  }
  report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;
 }finally{if(activeId&&invoke){await invoke('runningClose',activeId).catch(()=>{});await invoke('remove',activeId).catch(()=>{});}await instance.close();await fs.writeFile(path.join(out,'PSS-Standalone-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
