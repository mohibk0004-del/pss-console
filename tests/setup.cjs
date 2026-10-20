const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..'),work=path.resolve(root,'..','..','work');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const setup=path.join(out,'PSS-Builds','PSS-Console-Setup-'+require('../package.json').version+'-x64.exe'),dest=path.join(work,'Setup Test Console'),report={};
 const run=async(args,name)=>{const resultFile=path.join(work,'setup-'+name+'.json');await fs.unlink(resultFile).catch(()=>{});await exec(setup,['--headless','--no-startup','--no-shortcut','--no-sounds','--destination='+dest,'--report='+resultFile,...args],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});return JSON.parse(await fs.readFile(resultFile,'utf8'));};
 const userData=path.join(process.env.APPDATA,'pss-console','library.json');const original=await fs.readFile(userData,'utf8').catch(()=>null);
 try{
  const result=await run([],'install');assert.ok(result.Success);assert.ok(await fs.stat(path.join(dest,'PSS Console.exe')));assert.ok(await fs.stat(path.join(dest,'Uninstall PSS Console.exe')));assert.ok(await fs.stat(path.join(dest,'pss-install.json')));report.install=result;
  let prefs=JSON.parse(await fs.readFile(userData,'utf8'));assert.equal(prefs.settings.startup,false);assert.equal(prefs.settings.sounds,0);report.preferencesApplied=true;
  const updated=await run([],'update');assert.ok(updated.Success);report.update=updated;
  // The uninstaller preserves unknown files and user collection data by default.
  const personal=path.join(dest,'my-note.txt');await fs.writeFile(personal,'preserve this user file');
  const removed=await run(['--uninstall'],'uninstall');assert.ok(removed.Success);assert.ok(await fs.stat(personal));assert.equal(await fs.stat(path.join(dest,'PSS Console.exe')).catch(()=>null),null);assert.ok(await fs.stat(userData));report.uninstall=removed;report.unknownFilePreserved=true;report.collectionPreserved=true;
  await fs.unlink(personal);await fs.rmdir(dest);
  report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;
 }finally{if(original!==null)await fs.writeFile(userData,original);await fs.writeFile(path.join(out,'PSS-Custom-Setup-Report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
