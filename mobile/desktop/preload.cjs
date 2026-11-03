const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('shiyeDesktop',Object.freeze({request:payload=>ipcRenderer.invoke('shiye:request',payload)}));
