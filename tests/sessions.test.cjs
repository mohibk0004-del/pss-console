const {test}=require('node:test'),assert=require('node:assert/strict');
const {matchesGame,readyWindow,windowScore}=require('../electron/sessions.cjs');
test('Game tracking uses resolved shortcut target despite a different game window title',()=>{
 assert.equal(matchesGame({title:'My customized title',launchType:'shortcut'},{title:'Loading level',process:'Spider-Man2',pid:123},{executable:'E:\\Games\\Spider-Man2.exe'}),true);
});
test('Launcher and browser windows never count as the game even with its title and spawn PID',()=>{
 for(const process of ['RiotClientServices','RiotClientUx','steam','EpicGamesLauncher','brave'])assert.equal(matchesGame({title:'VALORANT'},{title:'VALORANT',process,pid:50},{pid:50}),false);
});
test('Tracking follows a known game process through title changes',()=>{
 assert.equal(matchesGame({title:'Different title'},{title:'Loading',process:'GameMain',pid:91},{pid:91}),true);
 assert.equal(matchesGame({title:'Different title'},{title:'Unrelated editor',process:'Notepad',pid:92},{pid:91}),false);
});
test('Valorant tracking follows the game process, not another app with Valorant in its title',()=>{
 const entry={id:'riot-valorant',title:'VALORANT'};
 assert.equal(matchesGame(entry,{title:'Loading',process:'VALORANT-Win64-Shipping',pid:91}),true);
 assert.equal(matchesGame(entry,{title:'VALORANT notes',process:'Notepad',pid:92}),false);
});
test('Readiness excludes splash/tool, owned, minimized, cloaked and empty windows',()=>{
 const window={bounds:{width:1280,height:720},owner:'0'};
 assert.equal(readyWindow(window),true);
 for(const invalid of [{className:'#32770'},{minimized:true},{cloaked:true},{toolWindow:true},{owner:'123'},{bounds:{width:0,height:0}}])assert.equal(readyWindow({...window,...invalid}),false);
});
test('Executable and PID matches outrank title-only candidates',()=>{
 const entry={title:'Game'},session={executable:'C:\\Games\\Spider-Man2.exe',pid:123};
 assert.equal(windowScore(entry,{title:'Loading',process:'Spider-Man2',pid:456},session),3);
 assert.equal(windowScore(entry,{title:'Loading',process:'Other',pid:123},session),2);
 assert.equal(windowScore(entry,{title:'Game',process:'Other',pid:456},session),1);
});
