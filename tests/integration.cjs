const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs/promises');const http=require('node:http');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,limit=30000){const end=Date.now()+limit;while(Date.now()<end){const value=await fn();if(value)return value;await delay(150);}throw Error('Timed out: '+label);}
(async()=>{
 await fs.mkdir(work,{recursive:true});let typed='',requests=0;const report={};
 const server=http.createServer((req,res)=>{if(req.url.startsWith('/report')){typed=new URL(req.url,'http://localhost').searchParams.get('text');res.end('ok');return;}requests++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PSS Browser Probe</title><body style="background:#112033;color:#eef3ff;font:24px Segoe UI;padding:50px"><h1>PSS browser integration check</h1><p>Temporary local page. No account data accessed.</p><input id="probe" autofocus placeholder="Controller keyboard test" style="font:24px Segoe UI;padding:15px;width:70%"><script>document.getElementById("probe").addEventListener("input",e=>fetch("/report?text="+encodeURIComponent(e.target.value)));</script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await electron.launch({args:[root,'--smoke','--data-dir='+path.join(work,'smoke-profile')],cwd:root,env});let page;let browserClosed=false;
 try{
  page=await instance.firstWindow();await page.waitForFunction(()=>!!window.pss);await until(async()=>{const s=await page.evaluate(()=>window.pss.invoke('state'));return s.helper&&!s.discovering;},'initial scan',90000);
  const invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});
  let s=await invoke('state');report.discovery={games:s.entries.filter(e=>e.kind==='game').length,browser:s.browser,riot:s.entries.filter(e=>e.source==='Riot').map(e=>e.title)};
  await invoke('settings',{onboarded:true,sounds:0});
  // Real browser, existing Brave profile, temporary local page only.
  console.log('Integration: launching Brave');await invoke('browse',url);await until(()=>requests>0,'Brave local page');const running=await until(async()=>{const s=await invoke('state');return s.running.find(e=>e.id==='media-browser'&&e.window);},'browser window tracking');
  report.braveLaunch={httpReached:true,windowTracked:!!running.window};
  console.log('Integration: browser tracked; opening keyboard');await invoke('keyboard');await until(async()=>(await invoke('state')).mode==='keyboard','keyboard overlay');
  console.log('Integration: keyboard open');await page.screenshot({path:path.join(out,'PSS-Keyboard-Preview.png')});
  console.log('Integration: sending text');await invoke('keyboardSend',{text:'PSS keyboard 123',enter:false});await until(()=>typed==='PSS keyboard 123','native browser text injection');report.nativeTextEntry=typed;
  console.log('Integration: closing browser');await invoke('runningClose','media-browser');browserClosed=true;
  await until(async()=>!(await invoke('state')).running.some(e=>e.id==='media-browser'),'browser close tracking');report.appCloseTracking=true;
  await invoke('home');
  // All controls remain inside viewport at supported desktop resolutions.
  for(const [width,height]of [[1280,720],[1920,1080],[2560,1440],[3840,2160]]){
   await instance.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.waitForTimeout(250);
   await page.getByRole('button',{name:'Games',exact:true}).click();
   const tile=page.getByRole('button',{name:'Red Dead Redemption 2',exact:true});await tile.focus();await page.waitForTimeout(300);
   const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,featureBottom:document.querySelector('.feature').getBoundingClientRect().bottom,footerTop:document.querySelector('.bottom-bar').getBoundingClientRect().top,scrollWidth:document.documentElement.scrollWidth}));
   report['layout'+width]=layout;assert.ok(layout.featureBottom<=layout.footerTop+2,'Feature overlaps footer at '+width);assert.ok(layout.scrollWidth<=layout.width,'Horizontal overflow '+width);
   if(width===1920)await page.screenshot({path:path.join(out,'PSS-Preview.png')});if(width===3840)await page.screenshot({path:path.join(out,'PSS-4K-Preview.png')});
  }
  // Recoverable errors and custom service persistence.
  await assert.rejects(()=>invoke('add',{kind:'game',title:'Missing',target:'C:\\PSS-NONEXISTENT\\game.exe'}),/existing/);
  await invoke('add',{kind:'media',title:'PSS temporary test service',target:url});let added=(await invoke('state')).entries.find(e=>e.title==='PSS temporary test service');assert.ok(added);await invoke('remove',added.id);report.customServiceAddRemove=true;
  await invoke('desktop');assert.equal((await invoke('state')).mode,'desktop');await invoke('home');report.desktopRoundTrip=true;
  report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;try{await page.screenshot({path:path.join(out,'PSS-Integration-Failure.png')});}catch{}throw e;
 }finally{if(!browserClosed&&page)await page.evaluate(()=>window.pss.invoke('runningClose','media-browser')).catch(()=>{});await instance.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'PSS-Integration-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
