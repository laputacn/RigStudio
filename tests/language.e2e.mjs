import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron,expect} from '@playwright/test';
const electronPath=process.env.ELECTRON_PATH||(await import('electron')).default;
const root=path.resolve(import.meta.dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'rig-language-')),out=path.join(root,'artifacts/language-qa');
await fs.mkdir(out,{recursive:true});
const errors=[],external=[];
let app;
async function launch(){
 app=await electron.launch({executablePath:process.env.ELECTRON_PATH||electronPath,args:[...(process.env.RIG_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(process.platform==='linux'?['--ozone-platform=x11','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),root],env:{...process.env,RIG_STUDIO_DATA:profile,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'},timeout:45000});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
 await page.waitForFunction(()=>!!window.rigStudio);
 return page;
}
async function switchLanguage(page,language){await page.locator('.canvas-appbar .language-control select').selectOption(language);await expect(page.locator('html')).toHaveAttribute('lang',language);}
try{
 let page=await launch();await expect(page.getByRole('button',{name:'Application settings',exact:true})).toBeEnabled();await expect(page.locator('html')).toHaveAttribute('lang','en');
 assert.equal(await page.locator('input[type=password]').count(),0,'No sign-in screen');
 await page.getByRole('button',{name:'Application settings',exact:true}).click();await page.getByLabel('Model ID',{exact:true}).fill('my-model-中文');
 await page.locator('.settings-modal .language-control select').selectOption('zh-CN');await expect(page.getByLabel('模型名称',{exact:true})).toHaveValue('my-model-中文');
 await page.locator('.settings-modal .language-control select').selectOption('en');await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('my-model-中文');await page.screenshot({path:out+'/settings-en.png'});await page.getByRole('button',{name:'Close settings',exact:true}).click();
 // Nodes contain local, user-owned content. Switching UI language must not rename or remount them.
 const created=await page.evaluate(async()=>{const result=await window.rigStudio.canvasMutate({type:'add',kind:'generate',data:{title:'小龙测试',provider:'meshy',model:'meshy-7.1',prompt:'用户提示词保持原文'}});return result.nodeId;});
 await page.reload();await expect(page.locator('.model-node').filter({hasText:'小龙测试'})).toBeVisible();
 await page.evaluate(()=>{window.__languageNode=document.querySelector('.model-node');});await switchLanguage(page,'zh-CN');assert.equal(await page.evaluate(()=>window.__languageNode===document.querySelector('.model-node')),true);await expect(page.locator('.model-node').filter({hasText:'小龙测试'})).toBeVisible();
 await switchLanguage(page,'en');await page.screenshot({path:out+'/canvas-en.png'});const graph=await page.evaluate(()=>window.rigStudio.canvas());assert.equal(graph.nodes.find(n=>n.id===created).title,'小龙测试');assert.equal(graph.nodes.find(n=>n.id===created).prompt,'用户提示词保持原文');
 await page.getByRole('button',{name:'Classic workbench',exact:true}).click();await expect(page.getByRole('button',{name:'Rigging workbench',exact:false})).toBeVisible();await page.locator('.topbar .language-control select').selectOption('zh-CN');await expect(page.getByRole('button',{name:'绑定工作台',exact:false})).toBeVisible();await page.screenshot({path:out+'/classic-zh.png'});await page.getByRole('button',{name:'返回节点画布',exact:true}).click();
 // Exercise the actual native IPC title without opening or importing a user file.
 await app.evaluate(({dialog})=>{globalThis.testDialogTitle='';dialog.showOpenDialog=async(_win,options)=>{globalThis.testDialogTitle=options.title;return {canceled:true,filePaths:[]};};});
 await page.evaluate(()=>window.rigStudio.importModel('source'));assert.equal(await app.evaluate(()=>globalThis.testDialogTitle),'选择带动作的源模型');await switchLanguage(page,'en');await page.evaluate(()=>window.rigStudio.importModel('source'));assert.equal(await app.evaluate(()=>globalThis.testDialogTitle),'Select an animated source model');
 await switchLanguage(page,'zh-CN');await app.close();app=undefined;page=await launch();await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');await expect(page.locator('.model-node').filter({hasText:'小龙测试'})).toBeVisible();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: default English, both workspaces, settings drafts, stable nodes, native dialogs, restart persistence; no paid API calls.');
} catch(error){if(app){const p=await app.firstWindow();await p.screenshot({path:out+'/failure.png'});await fs.writeFile(out+'/failure.txt',await p.locator('body').innerText());}throw error;}
finally{await app?.close();await fs.rm(profile,{recursive:true,force:true});}
