const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs/promises');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const os=require('node:os');const assert=require('node:assert/strict');const exec=promisify(execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const instance=await electron.launch({args:[root,'--smoke','--data-dir='+path.join(work,'smoke-profile')],cwd:root,env});const report={};
 try{
  const page=await instance.firstWindow();await page.waitForFunction(()=>!!window.pss);for(let i=0;i<150;i++){const s=await page.evaluate(()=>window.pss.invoke('state'));if(s.helper&&!s.discovering)break;await delay(400);}
  await page.evaluate(()=>window.pss.invoke('settings',{sounds:0,onboarded:true}));await delay(600);
  report.font=await page.evaluate(async()=>{await document.fonts.ready;return {family:getComputedStyle(document.body).fontFamily,sst:document.fonts.check('20px SST'),heading:getComputedStyle(document.querySelector('h1')).fontFamily};});assert.ok(report.font.sst);assert.match(report.font.family,/SST/);
  report.audio=await page.evaluate(async()=>{const result={};for(const cue of ['Move','Select','Back','Startup']){const audio=new Audio(new URL('sounds/'+cue+'.wav',document.baseURI).href);audio.preload='metadata';await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=()=>reject(Error(cue+' could not load'));});result[cue]={duration:audio.duration};}return result;});
  report.effects=await page.evaluate(()=>({infiniteAnimations:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length,backdropFilter:getComputedStyle(document.querySelector('.console-shell')).backdropFilter,ambientChildren:document.querySelector('.ambient').children.length}));assert.equal(report.effects.infiniteAnimations,0);assert.equal(report.effects.ambientChildren,0);
  const metric=()=>instance.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,privateKB:p.memory.privateBytes,workingSetKB:p.memory.workingSetSize})));
  await metric();await delay(5000);report.visible=await metric();
  await page.evaluate(()=>window.pss.invoke('desktop'));await metric();await delay(5000);report.desktop=await metric();
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process -Name PssHelper | Where-Object { $_.Path -eq $env:PSS_HELPER_PATH } | ForEach-Object { @{ Id=$_.Id; CPU=$_.CPU; PrivateBytes=$_.PrivateMemorySize64 } } | ConvertTo-Json -Compress"],{windowsHide:true,env:{...process.env,PSS_HELPER_PATH:path.join(root,'native','publish','PssHelper.exe')}});report.helper=JSON.parse(stdout||'null');
  report.summary={visibleProcessCPU:report.visible.reduce((n,p)=>n+p.cpu,0),desktopProcessCPU:report.desktop.reduce((n,p)=>n+p.cpu,0),visiblePrivateMB:report.visible.reduce((n,p)=>n+(p.privateKB||0),0)/1024,desktopPrivateMB:report.desktop.reduce((n,p)=>n+(p.privateKB||0),0)/1024,logicalProcessors:os.cpus().length};
  await page.evaluate(()=>window.pss.invoke('home'));report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;}finally{await instance.close();await fs.writeFile(path.join(out,'PSS-Performance-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
