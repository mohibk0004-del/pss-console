import {useState,type ReactNode} from 'react';
import {Play,Home,Monitor,Volume2,VolumeX,X,Gamepad2} from 'lucide-react';
import type {Entry} from './types';

type Action=(command:string,data?:unknown)=>Promise<unknown>;
export function LaunchScreen({entry,phase,waiting,artwork,action}:{entry:Entry;phase:string;waiting?:boolean;artwork:ReactNode;action:Action}){
 return <main className="handoff-screen" aria-label="Game transition" style={entry.backdrop?{backgroundImage:`linear-gradient(#1111149c,#111114ed),url("${entry.backdrop}")`}:undefined}>
  <div className="handoff-content"><div className="handoff-cover">{artwork}</div><p className="handoff-status" role="status">{phase==='resuming'?'Returning to your game':waiting?'Still starting':'Starting your '+(entry.kind==='game'?'game':'app')}</p><h1>{entry.title}</h1><p className="handoff-caption">{phase==='resuming'?'Pick up where you left off.':waiting?'Your launcher may need you to sign in. Check it, or return home.':'Your game or launcher will open shortly.'}</p></div>
  <div className="handoff-actions">{phase==='launching'&&<button className="secondary-button" autoFocus onClick={()=>void action('handoffYield')}>Show game or launcher</button>}<button className="text-button" onClick={()=>void action('home')}><Home size={18}/>Return home</button></div>
 </main>;
}
export function GameOverlay({entry,artwork,resuming,notice,action}:{entry:Entry;artwork:ReactNode;resuming:boolean;notice:string;action:Action}){
 const [confirmClose,setConfirmClose]=useState(false),[closing,setClosing]=useState(false);
 return <main className={'game-overlay '+(resuming?'resuming':'')} aria-label="In-game control center">
  <header className="game-overlay-header"><div className="overlay-artwork">{artwork}</div><div><p className="overlay-eyebrow"><Gamepad2 size={16}/>Control center</p><h1>{entry.title}</h1><p className="overlay-caption">{closing?'Waiting for game to close…':'Game stays running'}</p></div><button className="icon-button" aria-label="Resume game" onClick={()=>void action('runningFocus',entry.id)}><X/></button></header>
  {confirmClose?<section className="overlay-confirm" aria-label="Close game confirmation"><p>Close {entry.title}? Save your progress first.</p><div><button className="secondary-button" autoFocus data-overlay-cancel onClick={()=>setConfirmClose(false)}>Keep playing</button><button className="secondary-button" onClick={async()=>{setClosing(true);setConfirmClose(false);const result=await action('runningClose',entry.id);if(!result)setClosing(false);}}>Close game</button></div></section>:<nav className="overlay-controls" aria-label="Game controls">
   <button className="overlay-resume" autoFocus disabled={resuming} onClick={()=>void action('runningFocus',entry.id)}><Play fill="currentColor"/><span>{resuming?'Resuming…':'Resume'}</span></button>
   <button onClick={()=>void action('home')}><Home/><span>Home</span></button>
   <button onClick={()=>void action('volume','down')}><Volume2/><span>Volume −</span></button>
   <button onClick={()=>void action('volume','up')}><Volume2/><span>Volume +</span></button>
   <button onClick={()=>void action('volume','mute')}><VolumeX/><span>Mute</span></button>
   <button onClick={()=>void action('desktop')}><Monitor/><span>Windows</span></button>
   <button disabled={closing} onClick={()=>setConfirmClose(true)}><X/><span>Close game</span></button>
  </nav>}
  <footer className="overlay-footer"><span>{notice||'Back / Esc to resume'}</span><span>Ctrl + Alt + Home · Console menu</span></footer>
 </main>;
}
