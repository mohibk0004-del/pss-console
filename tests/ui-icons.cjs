const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),http=require('node:http'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process');const exec=require('node:util').promisify(execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(out,'..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e55b25"/><circle cx="32" cy="32" r="18" fill="white"/></svg>';
 const server=http.createServer((req,res)=>{if(req.url==='/icon.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(svg);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<link href="/icon.svg" rel="icon"><title>Local service</title>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await electron.launch({args:[root,'--smoke','--data-dir='+path.join(work,'icons-profile')],cwd:root,env});const report={};
 try{
  const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.pss);
  const invoke=(op,data)=>page.evaluate(({op,data})=>window.pss.invoke(op,data),{op,data});
  for(let i=0;i<150;i++){const s=await invoke('state');if(s.helper&&!s.discovering)break;await delay(300);}
  assert.equal((await invoke('state')).discovering,false);
  for(const e of (await invoke('state')).entries.filter(e=>e.title.startsWith('Icon Test ')||e.title==='Local Icon Test'))await invoke('remove',e.id);
  await invoke('settings',{onboarded:true,sounds:0,reducedMotion:false});
  const send=async action=>{await instance.evaluate(({BrowserWindow},action)=>BrowserWindow.getAllWindows()[0].webContents.send('pss:event',{type:'input',action}),action);await delay(100);console.log(action,await focused());};
  const focused=()=>page.evaluate(()=>document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent);
  await page.getByRole('button',{name:'Media',exact:true}).click();await delay(100);
  await send('up');await send('right');await delay(60);assert.equal(await focused(),'Media');
  await send('right');await delay(60);assert.equal(await focused(),'Search library');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'solid');
  await send('confirm');await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('heading',{name:'Search',exact:true}).count());
  report.search=true;await send('back');await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await focused(),'Search library');await send('right');await delay(60);assert.equal(await focused(),'Settings');
  await send('confirm');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  assert.equal(await page.locator('dialog').evaluate(el=>getComputedStyle(el).animationName),'ps5-panel');report.settings=true;
  // Long settings/library dialogs must still scroll to a focus target below the viewport.
  await page.evaluate(()=>{
   const dialog=document.querySelector('dialog');
   for(const el of dialog.querySelectorAll('button,input,select,textarea'))if(!el.disabled){el.dataset.testDisabled='true';el.disabled=true;}
   const list=document.createElement('div');list.id='scroll-focus-test';list.style.cssText='position:relative;height:250vh';
   const first=document.createElement('button'),last=document.createElement('button');first.textContent='Scroll start';last.textContent='Scroll end';last.id='scroll-focus-end';last.style.cssText='position:absolute;top:180vh';list.append(first,last);dialog.querySelector('.dialog-body').append(list);first.focus();
  });
  await send('down');assert.equal(await page.evaluate(()=>document.activeElement.id),'scroll-focus-end');report.longDialogNavigation=true;
  await page.evaluate(()=>{document.querySelector('#scroll-focus-test').remove();for(const el of document.querySelectorAll('[data-test-disabled]')){el.disabled=false;delete el.dataset.testDisabled;}});
  await send('back');await page.getByRole('dialog').waitFor({state:'detached'});await send('right');await delay(60);assert.equal(await focused(),'Profile');
  await send('confirm');await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();report.profile=true;await send('back');await page.getByRole('dialog').waitFor({state:'detached'});
  await send('down');await delay(80);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('selected')),true);report.headerReturnToRail=true;
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.brand-icon')).length===7&&Array.from(document.querySelectorAll('.brand-icon')).every(img=>img.complete&&img.naturalWidth>0));
  report.bundledBrandIcons=await page.locator('.brand-icon').count();
  const game=path.join(process.env.WINDIR,'System32','notepad.exe'),shortcut=path.join(work,'Icon Test Shortcut.lnk');
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$link=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PSS_ICON_LINK);$link.TargetPath=$env:PSS_ICON_EXE;$link.IconLocation=$env:PSS_ICON_EXE+',0';$link.Save()"],{windowsHide:true,env:{...process.env,PSS_ICON_LINK:shortcut,PSS_ICON_EXE:game}});
  for(const target of [game,shortcut]){
   await invoke('add',{kind:'game',title:'Icon Test '+path.extname(target),target});
   const e=(await invoke('state')).entries.find(e=>e.target===target);assert.ok(e.artwork?.startsWith('data:image/png;base64,'));assert.ok(e.iconArtwork);report[path.extname(target)+'Icon']=true;
  }
  const target='http://127.0.0.1:'+server.address().port+'/';await invoke('add',{kind:'media',title:'Local Icon Test',target});
  const custom=(await invoke('state')).entries.find(e=>e.target===target);assert.ok(custom.artwork?.startsWith('pss-asset:'));assert.ok(custom.iconArtwork);
  await page.getByRole('button',{name:'Local Icon Test',exact:true}).evaluate(el=>el.focus());
  await page.waitForFunction(()=>{const img=document.activeElement.querySelector('img');return img?.complete&&img.naturalWidth>0;});report.customWebsiteIcon=true;
  // A broken custom image must recover to a usable tile, rather than a broken-image glyph.
  const image=page.getByRole('button',{name:'Local Icon Test',exact:true}).locator('img');await image.dispatchEvent('error');assert.equal(await page.getByRole('button',{name:'Local Icon Test',exact:true}).locator('.site-monogram').count(),1);report.brokenImageFallback=true;
  for(const e of (await invoke('state')).entries.filter(e=>e.title.startsWith('Icon Test ')||e.title==='Local Icon Test'))await invoke('remove',e.id);
  await page.reload();await page.waitForFunction(()=>!!window.pss);await page.getByRole('button',{name:'Media',exact:true}).click();await delay(250);
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1920,1080));await delay(150);await page.screenshot({path:path.join(out,'PSS-Media-Preview.png')});
  await page.getByRole('button',{name:'Settings',exact:true}).focus();await delay(180);await page.screenshot({path:path.join(out,'PSS-Header-Focus.png')});
  await invoke('settings',{reducedMotion:true});assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');report.reducedMotion=true;
  await invoke('settings',{reducedMotion:false});
  assert.deepEqual(errors,[]);report.rendererErrors=errors;report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;}finally{await instance.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'PSS-UI-Icons-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
