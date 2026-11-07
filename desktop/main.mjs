import {setNativeLanguage,t} from './i18n.mjs';
import {app,BrowserWindow,ipcMain,dialog,safeStorage,shell} from 'electron';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
import {Studio,draftPlan,validatePlan} from './core.mjs';
import {RigAgent} from './agent.mjs';
import {Workflow} from './workflow.mjs';
import {Generator} from './generation.mjs';
import {randomUUID} from 'node:crypto';
const dir=path.dirname(fileURLToPath(import.meta.url));let win,studio,agent,workflow,generator;const captureWaiters=new Map();
if(process.env.RIG_STUDIO_DATA)app.setPath('userData',path.resolve(process.env.RIG_STUDIO_DATA));
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{win?.show();win?.focus();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{agent?.cancel();generator?.cancel();studio?.cancel();});
app.whenReady().then(async()=>{
studio=new Studio({dataDir:path.join(app.getPath('userData'),'workspace'),workerPath:app.isPackaged?path.join(process.resourcesPath,'blender','worker.py'):path.join(dir,'../blender/worker.py'),secretStore:{available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)},onEvent:e=>{if(win&&!win.isDestroyed())win.webContents.send('studio:job',e);}});
await studio.init();workflow=new Workflow(studio);await workflow.init();generator=new Generator(studio,workflow);
agent=new RigAgent({studio,workflow,generator,onEvent:e=>{if(win&&!win.isDestroyed())win.webContents.send('studio:agent',e);},capture:(request,signal)=>new Promise((resolve,reject)=>{
 if(!win||win.isDestroyed())return reject(Error('预览窗口已关闭'));const requestId=randomUUID();
 const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);captureWaiters.delete(requestId);};
 const abort=()=>{cleanup();reject(Error('截图已取消'));};
 const timer=setTimeout(()=>{cleanup();reject(Error('读取模型截图超时'));},45000);
 captureWaiters.set(requestId,{resolve:value=>{cleanup();value.error?reject(Error(value.error)):resolve(value.images);}});signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)return abort();win.webContents.send('studio:capture',{...request,requestId});
})});
function handle(name,fn){ipcMain.handle(`studio:${name}`,async(event,...args)=>{if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('请求来源无效');if((agent.active||generator.active)&&['settings','import','ai','bind','importPlan','canvasMutate','runNode','editModel','inspectScene'].includes(name))throw Error('Agent 正在运行，请先等待完成或停止');return fn(...args);});}
handle('setLanguage',value=>setNativeLanguage(value));
handle('canvas',()=>workflow.state());
handle('canvasContext',id=>workflow.context(id));
handle('canvasMutate',action=>workflow.mutate(action));
handle('inspectScene',args=>studio.inspectScene(args));
handle('thumbnail',async({id,image})=>{const a=studio.asset(id),dir=path.join(studio.dataDir,'thumbnails'),file=path.join(dir,id+'.jpg');if(image){if(typeof image!=='string'||image.length>500000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))throw Error('缩略图格式无效');await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,Buffer.from(image.split(',')[1],'base64'));a.hasThumbnail=true;await studio.persist();}try{return 'data:image/jpeg;base64,'+(await fs.readFile(file)).toString('base64');}catch{return '';}});
handle('runNode',async({id,resume=false})=>{
 const node=workflow.node(id);if(node.kind==='generate')return generator.run(id,{resume});
 if(studio.active||studio.starting)throw Error('已有本地任务执行中');node.status='running';delete node.error;await workflow.save();
 try{const context=workflow.context(id);let result;
  if(node.kind==='bind')result=await studio.bind(context);
  else if(node.kind==='edit')result=await studio.editModel({assetId:context.targetId,sourceId:context.sourceId,code:node.code,description:node.title});
  else throw Error('请选择绑定、编辑或生成节点');await workflow.record(id,result);workflow.graph.compareIds=[...new Set([context.sourceId,result.asset.id].filter(Boolean))];await workflow.save();return result;
 }catch(e){node.status='error';node.error=e.message;await workflow.save();throw e;}
});
handle('agentHistory',args=>agent.history(args));handle('agentTurn',args=>agent.turn(args));handle('agentCancel',()=>agent.cancel());
handle('captureReply',value=>{if(value&&typeof value.requestId==='string')captureWaiters.get(value.requestId)?.resolve(value);});
handle('state',()=>studio.state());handle('settings',v=>studio.saveSettings(v));handle('detect',()=>studio.detectBlender());handle('check',p=>studio.checkBlender(p));
handle('chooseBlender',async()=>{const r=await dialog.showOpenDialog(win,{title:t('选择本机 Blender'),properties:['openFile'],filters:process.platform==='win32'?[{name:'Blender',extensions:['exe']}]:[]});if(r.canceled)return null;let p=r.filePaths[0];if(process.platform==='darwin'&&p.endsWith('.app'))p=path.join(p,'Contents/MacOS/Blender');return p;});
handle('import',async role=>{const r=await dialog.showOpenDialog(win,{title:role==='source'?t('选择带动作的源模型'):t('选择目标外观模型'),properties:['openFile'],filters:[{name:t('GLB 模型'),extensions:['glb']}]});return r.canceled?null:studio.importAsset(r.filePaths[0],role);});
handle('read',id=>studio.readAsset(id));handle('draft',({sourceId,targetId})=>draftPlan(studio.asset(sourceId),studio.asset(targetId)));handle('ai',data=>studio.aiPlan(data));handle('bind',data=>studio.bind(data));handle('cancel',()=>{agent.cancel();generator.cancel();studio.cancel();});
handle('validatePlan',({plan,sourceId,targetId})=>validatePlan(plan,studio.asset(sourceId),studio.asset(targetId)));
handle('testAPI',async()=>{await studio.requestAI([{role:'user',content:'Reply with OK.'}]);return {ok:true};});
handle('importPlan',async({sourceId,targetId})=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:t('绑定方案'),extensions:['json']}]});if(r.canceled)return null;const st=await fs.stat(r.filePaths[0]);if(st.size>2*1024*1024)throw Error('方案文件过大');return validatePlan(JSON.parse(await fs.readFile(r.filePaths[0],'utf8')),studio.asset(sourceId),studio.asset(targetId));});
handle('exportPlan',async({plan,sourceId,targetId})=>{const clean=validatePlan(plan,studio.asset(sourceId),studio.asset(targetId));const r=await dialog.showSaveDialog(win,{defaultPath:'rig-plan.json',filters:[{name:t('绑定方案'),extensions:['json']}]});if(!r.canceled)await fs.writeFile(r.filePath,JSON.stringify(clean,null,2));return !r.canceled;});
handle('export',async id=>{const asset=studio.asset(id);if(asset.role!=='result')throw Error('请选择一个处理结果');const r=await dialog.showSaveDialog(win,{defaultPath:asset.name,filters:[{name:t('GLB 模型'),extensions:['glb']}]});if(r.canceled)return false;if(path.resolve(r.filePath)!==path.resolve(asset.path))await fs.copyFile(asset.path,r.filePath);return true;});
handle('reveal',async id=>{const run=studio.runs.find(r=>r.id===id);if(!run)throw Error('记录不存在');const error=await shell.openPath(run.jobDir);if(error)throw Error(error);});
handle('openBlend',async id=>{const run=studio.runs.find(r=>r.id===id);if(!run)throw Error('记录不存在');const file=path.join(run.jobDir,'project.blend');await fs.access(file);const child=spawn(studio.settings.blenderPath,[file],{detached:true,stdio:'ignore',shell:false});child.on('error',()=>{});child.unref();});
function createWindow(){
 win=new BrowserWindow({width:1500,height:960,minWidth:1100,minHeight:720,backgroundColor:'#10141d',title:'Rig Studio',autoHideMenuBar:true,webPreferences:{preload:path.join(dir,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
 win.on('closed',()=>agent.cancel());
 const url=!app.isPackaged?process.env.RIG_STUDIO_DEV_URL:null;if(url&&/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))win.loadURL(url);else win.loadFile(path.join(dir,'../dist/index.html'));
}
createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});

}).catch(error=>{console.error(error);dialog.showErrorBox(t('Rig Studio 启动失败'),error.message);app.quit();});
