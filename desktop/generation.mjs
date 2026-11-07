import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import dns from 'node:dns/promises';
import {setTimeout as delay} from 'node:timers/promises';
export const providers={tripo:{base:'https://openapi.tripo3d.ai/v3',model:'v3.1-20260211'},meshy:{base:'https://api.meshy.ai/openapi/v2',model:'meshy-7.1'}};
export function createRequest(provider,{prompt,model,previewId}){
 if(provider==='tripo')return {path:'/generation/text-to-model',body:{prompt,model:model||providers.tripo.model}};
 if(provider==='meshy')return {path:'/text-to-3d',body:previewId?{mode:'refine',preview_task_id:previewId,enable_pbr:true}:{mode:'preview',prompt,ai_model:model||providers.meshy.model,should_remesh:true}};
 throw Error('请选择 Tripo 或 Meshy');
}
export function taskResult(provider,value){
 const d=provider==='tripo'?value.data:value;const state=String(d?.status||'').toLowerCase();return {state,progress:Number(d?.progress||0),url:provider==='tripo'?d?.output?.model_url:d?.model_urls?.glb,error:d?.error?.message||d?.task_error?.message||d?.message};
}
export async function publicURL(raw){
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('模型下载地址必须为公共 HTTPS');
 const entries=await dns.lookup(u.hostname,{all:true});if(entries.some(({address:a})=>/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|::ffff:)/i.test(a)))throw Error('不允许从内部网络地址下载模型');return u.href;
}
export class Generator {
 constructor(studio,workflow){this.studio=studio;this.workflow=workflow;this.active=null;}
 cancel(){this.active?.abort();this.studio.cancel();}
 async request(provider,route,body,signal){
  const key=this.studio.providerKeys[provider];if(!key)throw Error('请在设置中填写 '+provider+' API Key');
  const r=await fetch(providers[provider].base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
  let d;try{d=await r.json();}catch{throw Error(provider+' 返回无法读取的响应');}if(!r.ok||d.code&&d.code!==0)throw Error(provider+' '+r.status+'：'+JSON.stringify(d).split(key).join('[KEY]').slice(0,500));return d;
 }
 async run(nodeId,{resume=false}={}){
  if(this.active||this.studio.active)throw Error('已有任务执行中');const node=this.workflow.node(nodeId);if(node.kind!=='generate')throw Error('请选择生成节点');
  const provider=node.provider||'tripo';if(!providers[provider])throw Error('生成服务无效');if(!this.studio.providerKeys[provider])throw Error('请在设置中填写 '+provider+' API Key');
  if(!node.prompt?.trim()||node.prompt.length>6000)throw Error('请填写 1–6000 字的模型描述');
  if(node.outputId&&!resume)throw Error('这个节点已有结果，请创建分支后再次生成');
  if(node.task&&!resume)throw Error('这个节点已有远程任务，请继续查询，或创建分支发起新任务');
  if(resume&&!node.task)throw Error('这个节点没有可继续查询的任务');
  if(node.task&&node.task.provider!==provider)throw Error('任务服务与节点配置不同，请恢复原服务或创建分支');
  const controller=new AbortController();this.active=controller;const signal=controller.signal;
  node.status='running';delete node.error;await this.workflow.save();
  try{
   const create=async(previewId)=>{const request=createRequest(provider,{prompt:node.prompt,model:node.model,previewId});const d=await this.request(provider,request.path,request.body,signal);const id=provider==='tripo'?d.data?.task_id:d.result;if(typeof id!=='string'||!/^[\w-]+$/.test(id))throw Error('生成接口未返回任务编号');node.task={provider,id,stage:previewId?'refine':provider==='meshy'?'preview':'generate',previewId,createdAt:new Date().toISOString()};await this.workflow.save();};
   if(!node.task)await create();
   let url='';const started=Date.now();
   while(Date.now()-started<45*60*1000){
    signal.throwIfAborted();const t=node.task;const value=await this.request(provider,provider==='tripo'?'/tasks/'+t.id:'/text-to-3d/'+t.id,undefined,signal);const result=taskResult(provider,value);node.progress=result.progress;
    this.studio.onEvent({id:node.id,kind:'generate',state:'running',progress:result.progress/100,message:`${provider} · ${t.stage} · ${result.progress}%`});
    if(['success','succeeded'].includes(result.state)){
     if(provider==='meshy'&&t.stage==='preview'){await create(t.id);continue;}
     if(!result.url)throw Error('远程任务完成但没有 GLB 下载地址');url=result.url;break;
    }
    if(['failed','cancelled','canceled','expired','banned','unknown'].includes(result.state))throw Error('生成任务 '+result.state+'：'+(result.error||'请检查服务商任务记录'));
    await delay(4000,undefined,{signal});
   }
   if(!url)throw Error('查询已超过 45 分钟；任务编号已保存，可稍后继续查询');
   const dir=path.join(this.studio.dataDir,'generated',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,provider+'.glb');
   let response;for(let i=0;i<5;i++){url=await publicURL(url);response=await fetch(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),url).href;continue;}break;}
   if(!response?.ok||!response.body)throw Error('无法下载生成的 GLB');
   const handle=await fs.open(file,'w');let total=0;try{for await(const data of response.body){total+=data.length;if(total>512*1024*1024)throw Error('生成模型超过 512 MB');await handle.write(data);}}finally{await handle.close();}
   signal.throwIfAborted();const asset=await this.studio.importAsset(file,'target');asset.name=node.title+'.glb';asset.provider=provider;await this.studio.persist();await this.workflow.record(nodeId,{asset});return asset;
  }catch(e){node.status=signal.aborted?'interrupted':'error';node.error=signal.aborted?'已停止本地等待；远程任务可能仍在执行，可继续查询，避免重复扣费。':e.message;await this.workflow.save();throw Error(node.error);}finally{this.active=null;}
 }
}
