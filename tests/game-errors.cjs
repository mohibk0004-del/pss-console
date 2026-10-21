const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const exec=require('node:util').promisify(require('node:child_process').execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(out,'../work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(150);}throw Error('Timed out: '+label);}
(async()=>{
 const fixture=path.join(work,'Modal Error Probe');await exec('dotnet',['publish',path.join(__dirname,'fixtures/Probe.csproj'),'-c','Release','-o',fixture],{windowsHide:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const packaged=process.env.PSS_TEST_INSTALLED;
 const instance=await electron.launch({executablePath:packaged||undefined,args:[...(packaged?[]:[root]),'--smoke','--data-dir='+path.join(work,'game-error-profile')],env,cwd:root});const report={};
 try{
  const page=await instance.firstWindow();await page.waitForFunction(()=>!!window.pss);const invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});
  await until(async()=>{const s=await invoke('state');return s.helper&&!s.discovering;},'ready');await invoke('settings',{onboarded:true,sounds:0});
  const target=path.join(fixture,'PssProbe.exe');await invoke('add',{kind:'game',title:'Modal Error Test',target,args:'--modal-error'});const id=(await invoke('state')).entries.find(e=>e.target===target).id;await invoke('launch',id);
  await until(async()=>(await invoke('state')).handoff?.detail?.includes('Probe runtime unavailable'),'runtime message');
  const state=await invoke('state'),session=state.running.find(r=>r.id===id);assert.ok(state.handoff.failed);assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  const helper=packaged?path.join(path.dirname(packaged),'resources/helper/PssHelper.exe'):path.join(root,'native/publish/PssHelper.exe');
  const windows=JSON.parse((await exec(helper,['--windows'],{windowsHide:true})).stdout).filter(w=>w.pid===session.pid);assert.ok(windows.length>=2);assert.match(windows.find(w=>w.window===session.window).title,/System Error/);report.errorDialogSelectedOverGame=true;report.actualMessageVisible=true;report.artworkRemainsVisible=true;
  await page.screenshot({path:path.join(out,'PSS-Native-Error-Recovery.png')});await invoke('runningClose',id);await until(async()=>(await invoke('state')).mode==='shell','normal dialog close returns home');report.normalCloseReturnsHome=true;await invoke('remove',id);report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;}finally{await instance.close();await fs.writeFile(path.join(out,'PSS-Game-Errors-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
