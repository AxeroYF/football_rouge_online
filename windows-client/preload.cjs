const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{action:name=>ipcRenderer.invoke('desktop-action',name),subscribe:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop-status',listener);return()=>ipcRenderer.removeListener('desktop-status',listener);}});
