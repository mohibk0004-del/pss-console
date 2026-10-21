const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['state','handoffRetry','handoffYield','controlOverlay','scan','import','remove','favorite','launch','settings','pickFile','pickFolder','add','artwork','desktop','home','quit','volume','power','keyboard','keyboardSend','keyboardClose','runningFocus','runningClose','browse']);
contextBridge.exposeInMainWorld('pss',Object.freeze({
 invoke:(command,data)=>allowed.has(command)?ipcRenderer.invoke('pss:command',command,data):Promise.reject(new Error('Unknown command.')),
 onEvent:handler=>{const listener=(_,event)=>handler(event);ipcRenderer.on('pss:event',listener);return()=>ipcRenderer.removeListener('pss:event',listener);}
}));
