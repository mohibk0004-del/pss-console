import {useEffect,useRef} from 'react';
type Cue='Move'|'Select'|'Back'|'Startup';
const bank=new Map<Cue,HTMLAudioElement>();
let lastMove=0,lastSelection=0;
function play(cue:Cue,volume:number) {
 if(volume<=0||document.hidden)return;
 const now=performance.now();
 if(cue==='Move'&&(now-lastMove<70||now-lastSelection<90))return;
 if(cue==='Move')lastMove=now;else lastSelection=now;
 let audio=bank.get(cue);
 if(!audio){audio=new Audio(new URL('sounds/'+cue+'.wav',document.baseURI).href);audio.preload='auto';bank.set(cue,audio);}
 audio.volume=Math.max(0,Math.min(1,volume));audio.currentTime=0;
 void audio.play().catch(()=>{});
}
export function useConsoleSounds(volume:number) {
 const current=useRef(volume);current.current=volume;
 useEffect(()=>{
  const timer=setTimeout(()=>play('Startup',current.current*.65),1000);
  const focus=(e:FocusEvent)=>{if((e.target as HTMLElement)?.closest('button,input,select'))play('Move',current.current);};
  const click=(e:MouseEvent)=>{const target=(e.target as HTMLElement)?.closest('button,input[type=checkbox]');if(!target)return;const label=(target.getAttribute('aria-label')||target.textContent||'').trim();play(/^(close|cancel|back|return to windows|windows|quit|dismiss)/i.test(label)?'Back':'Select',current.current);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')play('Back',current.current);};
  const controller=(e:CustomEvent<string>)=>{if(e.detail==='back')play('Back',current.current);};
  const visibility=()=>{if(document.hidden)for(const audio of bank.values())audio.pause();};
  document.addEventListener('focusin',focus);document.addEventListener('click',click);document.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);window.addEventListener('pss-controller',controller as EventListener);
  return()=>{clearTimeout(timer);document.removeEventListener('focusin',focus);document.removeEventListener('click',click);document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pss-controller',controller as EventListener);for(const audio of bank.values())audio.pause();};
 },[]);
}
