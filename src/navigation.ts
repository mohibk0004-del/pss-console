export function moveFocus(direction: string) {
 const dialog=Array.from(document.querySelectorAll('dialog[open]')).at(-1);
 const root=document.querySelector('.soft-keyboard-overlay')||dialog||document;
 const all=Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]')).filter(el=>{
  const r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&!el.closest('[inert]');
 });
 const current=document.activeElement as HTMLElement;
 if(!all.includes(current)){all[0]?.focus();return;}
 const focus=(el?:HTMLElement|null)=>{el?.focus({preventScroll:true});el?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});};
 // Home rows are explicit: geometry must not send header navigation into offscreen tiles.
 if(!dialog&&!document.querySelector('.soft-keyboard-overlay')){
  const header=all.filter(el=>el.closest('.topbar'));
  const rail=all.filter(el=>el.closest('.tile-rail'));
  if(header.includes(current)){
   const index=header.indexOf(current);
   if(direction==='left'||direction==='right')focus(header[index+(direction==='left'?-1:1)]);
   else if(direction==='down')focus(document.querySelector<HTMLElement>('.tile.selected')||rail[0]);
   return;
  }
  if(rail.includes(current)){
   const index=rail.indexOf(current);
   if(direction==='left'||direction==='right'){focus(rail[index+(direction==='left'?-1:1)]);return;}
   if(direction==='up'){
    const x=current.getBoundingClientRect().x;
    focus(header.reduce<HTMLElement|undefined>((best,el)=>!best||Math.abs(el.getBoundingClientRect().x-x)<Math.abs(best.getBoundingClientRect().x-x)?el:best,undefined));return;
   }
   if(direction==='down'){focus(document.querySelector<HTMLElement>('.feature-actions button'));return;}
  }
 }
 if(current instanceof HTMLInputElement&&current.type==='range'&&(direction==='left'||direction==='right')) {
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(current,String(Number(current.value)+(direction==='left'?-1:1)*Number(current.step||1)));current.dispatchEvent(new Event('input',{bubbles:true}));current.dispatchEvent(new Event('change',{bubbles:true}));return;
 }
 const r=current.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
 const horizontal=direction==='left'||direction==='right',sign=direction==='left'||direction==='up'?-1:1;
 let best:HTMLElement|undefined,score=Infinity;
 for(const el of all){if(el===current)continue;const b=el.getBoundingClientRect();if(root===document&&(b.right<=0||b.left>=innerWidth||b.bottom<=0||b.top>=innerHeight))continue;const dx=b.x+b.width/2-x,dy=b.y+b.height/2-y;const along=horizontal?dx:dy,across=horizontal?dy:dx;if(along*sign<4)continue;const s=Math.abs(along)+Math.abs(across)*3.5;if(s<score){score=s;best=el;}}
 best?.focus({preventScroll:true});best?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
