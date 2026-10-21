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
module.exports={matchesGame};
