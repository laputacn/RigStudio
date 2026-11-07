const {contextBridge,ipcRenderer}=require('electron');
const invoke=name=>(...args)=>ipcRenderer.invoke('studio:'+name,...args);
contextBridge.exposeInMainWorld('rigStudio',{
 setLanguage:invoke('setLanguage'),canvas:invoke('canvas'),canvasContext:invoke('canvasContext'),canvasMutate:invoke('canvasMutate'),runNode:invoke('runNode'),thumbnail:invoke('thumbnail'),inspectScene:invoke('inspectScene'),
 validatePlan:invoke('validatePlan'),state:invoke('state'),saveSettings:invoke('settings'),detectBlender:invoke('detect'),checkBlender:invoke('check'),chooseBlender:invoke('chooseBlender'),importModel:invoke('import'),readAsset:invoke('read'),draftPlan:invoke('draft'),aiPlan:invoke('ai'),bind:invoke('bind'),cancel:invoke('cancel'),testAPI:invoke('testAPI'),importPlan:invoke('importPlan'),exportPlan:invoke('exportPlan'),exportResult:invoke('export'),revealRun:invoke('reveal'),openBlend:invoke('openBlend'),
 agentHistory:invoke('agentHistory'),agentTurn:invoke('agentTurn'),agentCancel:invoke('agentCancel'),captureReply:invoke('captureReply'),
 onAgent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('studio:agent',listener);return()=>ipcRenderer.removeListener('studio:agent',listener);},
 onCapture:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('studio:capture',listener);return()=>ipcRenderer.removeListener('studio:capture',listener);},
 onJob:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('studio:job',listener);return()=>ipcRenderer.removeListener('studio:job',listener);}
});
