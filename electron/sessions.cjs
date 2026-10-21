const path=require('node:path');
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const broker=/^(?:steam|steamwebhelper|EpicGamesLauncher|RiotClientServices|RiotClientUx|RiotClientUxRender|Battle\.net|EADesktop|EALauncher|UbisoftConnect|GalaxyClient|explorer|brave|chrome|msedge|firefox)$/i;
function matchesGame(entry,window,session={}){
 if(!window.title||broker.test(window.process))return false;
 if(entry.id?.startsWith('riot-valorant'))return /^VALORANT(?:-Win64-Shipping)?$/i.test(window.process);
 if(entry.id?.startsWith('riot-league_of_legends'))return /^(?:LeagueClient(?:Ux)?|League of Legends)$/i.test(window.process);
 if(session.pid&&session.pid===window.pid)return true;
 const executable=session.executable||(entry.launchType==='exe'?entry.target:'');
 if(executable&&path.win32.basename(executable,'.exe').toLowerCase()===window.process.toLowerCase())return true;
 const title=normalize(entry.title);return title.length>=3&&normalize(window.title).includes(title);
}
function readyWindow(window){return window.className!=='#32770'&&!window.minimized&&!window.cloaked&&!window.toolWindow&&(!window.owner||window.owner==='0')&&window.bounds?.width>=320&&window.bounds?.height>=180;}
function windowScore(entry,window,session={}){
 if(!matchesGame(entry,window,session))return 0;
 const executable=session.executable||(entry.launchType==='exe'?entry.target:'');
 if(executable&&path.win32.basename(executable,'.exe').toLowerCase()===window.process.toLowerCase())return 3;
 return session.pid===window.pid?2:1;
}
module.exports={matchesGame,readyWindow,windowScore};
