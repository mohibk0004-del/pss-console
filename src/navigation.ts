export function moveFocus(direction: string) {
 const dialog=Array.from(document.querySelectorAll('dialog[open]')).at(-1);
 const root=dialog||document;
 const all=Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]')).filter(el=>{
  const r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&!el.closest('[inert]');
 });
 const current=document.activeElement as HTMLElement;
 if(!all.includes(current)){all[0]?.focus();return;}
 if(current instanceof HTMLInputElement&&current.type==='range'&&(direction==='left'||direction==='right')) {
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(current,String(Number(current.value)+(direction==='left'?-1:1)*Number(current.step||1)));current.dispatchEvent(new Event('input',{bubbles:true}));current.dispatchEvent(new Event('change',{bubbles:true}));return;
 }
 const r=current.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
 const horizontal=direction==='left'||direction==='right',sign=direction==='left'||direction==='up'?-1:1;
 let best:HTMLElement|undefined,score=Infinity;
 for(const el of all){if(el===current)continue;const b=el.getBoundingClientRect(),dx=b.x+b.width/2-x,dy=b.y+b.height/2-y;const along=horizontal?dx:dy,across=horizontal?dy:dx;if(along*sign<4)continue;const s=Math.abs(along)+Math.abs(across)*3.5;if(s<score){score=s;best=el;}}
 best?.focus({preventScroll:true});best?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
