const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');await fs.mkdir(work,{recursive:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await electron.launch({args:[root,'--smoke','--data-dir='+path.join(work,'smoke-profile')],cwd:root,env,timeout:30000});
 const errors=[];let report={};
 try{
  const page=await instance.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!window.pss);
  let settled;for(let i=0;i<90;i++){settled=await page.evaluate(()=>window.pss.invoke('state'));if(settled.helper&&!settled.discovering&&settled.entries.some(e=>e.kind==='game'))break;await page.waitForTimeout(1000);if(i%10===0)console.log('Waiting for discovery',JSON.stringify({helper:settled.helper,warnings:settled.warnings}));}
  const s=await page.evaluate(()=>window.pss.invoke('state'));
  report={helper:s.helper,browser:s.browser,games:s.entries.filter(e=>e.kind==='game').map(e=>({title:e.title,source:e.source})),media:s.entries.filter(e=>e.kind==='media').map(e=>e.title),controller:s.controller,warnings:s.warnings};
  assert.equal(s.helper,true);assert.match(s.browser,/brave/i);assert.ok(s.entries.some(e=>e.id==='riot-valorant'));assert.equal(s.settings.jellyfin,'http://127.0.0.1:8096');
  await page.evaluate(()=>window.pss.invoke('settings',{onboarded:true,sounds:0}));
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1920,1080));await page.waitForTimeout(900);
  await page.screenshot({path:path.join(out,'PSS-Preview.png')});
  await page.getByRole('button',{name:'Media',exact:true}).click();await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'PSS-Media-Preview.png')});
  await page.getByRole('button',{name:'Search library'}).click();await page.getByRole('textbox',{name:'Search games and apps'}).fill('valorant');assert.equal(await page.locator('.library-item').count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Open control center'}).click();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'PSS-Control-Center.png')});await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('checkbox',{name:'Reduced motion'}).check();assert.equal((await page.evaluate(()=>window.pss.invoke('state'))).settings.reducedMotion,true);await page.getByRole('checkbox',{name:'Reduced motion'}).uncheck();await page.getByRole('button',{name:'Close',exact:true}).click();
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,720));await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'PSS-1280-Preview.png')});
  await page.evaluate(()=>window.pss.invoke('desktop'));assert.equal((await page.evaluate(()=>window.pss.invoke('state'))).mode,'desktop');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await page.evaluate(()=>window.pss.invoke('home'));assert.equal((await page.evaluate(()=>window.pss.invoke('state'))).mode,'shell');assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  report.rendererErrors=errors;assert.deepEqual(errors,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;try{const p=await instance.firstWindow();await p.screenshot({path:path.join(out,'PSS-Test-Failure.png')});}catch{}throw e;
 }finally{await fs.writeFile(path.join(out,'PSS-Test-Report.json'),JSON.stringify(report,null,2));await instance.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
