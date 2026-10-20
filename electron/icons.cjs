const fs=require('node:fs/promises');
const path=require('node:path');

// Bound downloads and keep icons local. No renderer requests or third-party favicon services.
async function download(url){
 const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error('Unsupported icon URL');
 const response=await fetch(u,{signal:AbortSignal.timeout(2500)});
 if(!response.ok)throw Error('Icon unavailable');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512*1024)throw Error('Icon too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return {data:Buffer.concat(chunks),type:response.headers.get('content-type')||'',url:response.url};
}
async function websiteIcon(target,directory,id){
 const cached=path.join(directory,id+'-site-icon');
 for(const ext of ['png','svg','ico','jpg','webp']){const file=cached+'.'+ext;if(await fs.stat(file).catch(()=>null))return file;}
 const candidates=[];
 try{
  const page=await download(target);
  if(page.type.includes('text/html')){
   const html=page.data.toString('utf8');
   for(const tag of html.matchAll(/<link\b[^>]*>/gi)){
    const attrs={};for(const a of tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4];
    if(/(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attrs.rel||'')&&attrs.href)candidates.push(new URL(attrs.href.replace(/&amp;/g,'&'),page.url).href);
   }
  }
 }catch{}
 candidates.push(new URL('/favicon.ico',target).href);
 for(const url of [...new Set(candidates)].slice(0,4))try{
  const {data,type}=await download(url);
  const ext=type.includes('svg')?'svg':type.includes('png')?'png':type.includes('jpeg')?'jpg':type.includes('webp')?'webp':/image\/(?:x-icon|vnd.microsoft.icon)/.test(type)?'ico':null;
  if(!ext||!data.length)continue;const file=cached+'.'+ext;await fs.writeFile(file,data);return file;
 }catch{}
 return undefined;
}
module.exports={websiteIcon};
