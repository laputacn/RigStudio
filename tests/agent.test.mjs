import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Studio,draftPlan,blenderExecutable,validatePlan} from '../desktop/core.mjs';
import {RigAgent,checkImages} from '../desktop/agent.mjs';

const source={id:'source',name:'source.glb',height:2,bounds:{min:[-1,0,-1],max:[1,2,1]},rigged:true,bones:[{name:'body',parent:null,head:[0,0,0],tail:[0,1,0],weightedVertices:20,deform:true}],animations:[{name:'Run',duration:1}],triangles:100,vertices:50,warnings:[]};
const target={...source,id:'target',name:'target.glb',rigged:false,bones:[],animations:[]};
const call=(name,args,id='call1')=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id});
const say=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
async function fixture(fn,mode='responses'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rig-agent-')),requests=[],events=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push({url:req.url,body});try{const value=await fn(body,requests.length);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}catch(e){res.statusCode=500;res.end(JSON.stringify({error:{message:e.message}}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const studio=new Studio({dataDir:dir,secretStore:{available:()=>false}});await studio.init();studio.key='TEST_KEY_DO_NOT_PERSIST';studio.settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test-tool-model',apiMode:mode};studio.assets.set(source.id,source);studio.assets.set(target.id,target);
 let bindCalls=0,captureCalls=0;
 studio.bind=async input=>{bindCalls++;const asset={...target,id:'result'+bindCalls,role:'result',rigged:true,animations:source.animations},run={id:asset.id,assetId:asset.id,sourceId:source.id,targetId:target.id,plan:input.plan,clips:input.clips,report:{reloaded:true,warnings:[],clips:[{name:'Run'}]}};studio.assets.set(asset.id,asset);studio.runs.push(run);return {asset,run};};
 const agent=new RigAgent({studio,onEvent:e=>events.push(e),capture:async()=>{captureCalls++;return ['data:image/jpeg;base64,YQ==','data:image/jpeg;base64,Yg=='];}});
 return {studio,agent,requests,events,dir,get binds(){return bindCalls;},get captures(){return captureCalls;},input:{sourceId:source.id,targetId:target.id,message:'绑定当前动作',plan:draftPlan(source,target),clips:['Run'],options:{fps:30,decimateRatio:1,selfContact:true},images:[]},async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}};
}
test('Responses agent edits, binds, sees real capture results, and persists conversation without keys or images',async()=>{
 const f=await fixture((body,n)=>{
  if(n===1)return {output:[{type:'reasoning',id:'reasoning1',encrypted_content:'opaque-state'},call('edit_bones',{edits_json:JSON.stringify([{name:'body',tail:[0,1.2,0]}])})]};
  if(n===2){assert(body.input.some(i=>i.encrypted_content==='opaque-state'));assert(body.input.some(i=>i.type==='function_call_output'&&i.call_id==='call1'));return {output:[call('bind_model',{},'call2')]};}
  assert(body.input.some(i=>Array.isArray(i.content)&&i.content.some(c=>c.type==='input_image')));return {output:[say('已绑定并检查中段截图。')]};
 });
 try{const result=await f.agent.turn(f.input);assert.equal(f.binds,1);assert.equal(f.captures,2);assert.equal(result.plan.bones[0].tail[1],1.2);assert.equal(result.created.length,1);assert(f.requests.every(r=>r.url==='/v1/responses'&&r.body.store===false));const history=await f.agent.history(f.input);assert.equal(history.context.resultId,'result1');assert(history.messages.some(m=>m.role==='tool'&&m.resultId==='result1'));const files=await fs.readdir(path.join(f.dir,'conversations'));const saved=await fs.readFile(path.join(f.dir,'conversations',files[0]),'utf8');assert(!saved.includes(f.studio.key));assert(!saved.includes('data:image'));}finally{await f.close();}
});
test('Chat Completions tool errors are returned for correction and future turns include user history',async()=>{
 const f=await fixture((body,n)=>{
  const c=n===1?call('set_processing',{clips:['Invented']},'bad'):n===2?call('set_processing',{clips:['Run'],decimateRatio:.5},'good'):null;
  if(n===2)assert(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='bad'&&m.content.includes('error')));
  return {choices:[{message:c?{role:'assistant',content:null,tool_calls:[{id:c.call_id,type:'function',function:{name:c.name,arguments:c.arguments}}]}:{role:'assistant',content:'方案已更新。'}}]};
 },'chat');
 try{const r=await f.agent.turn(f.input);assert.equal(r.options.decimateRatio,.5);assert.equal(f.binds,0);await f.agent.turn({...f.input,message:'解释上一轮改动'});assert(f.requests.at(-1).body.messages.some(m=>m.content==='绑定当前动作'));assert(f.events.some(e=>e.message?.status==='error'));}finally{await f.close();}
});
test('unknown tool cannot execute code, change files or start Blender',async()=>{
 const f=await fixture((body,n)=>n===1?{output:[call('execute_python',{code:'dangerous()'})]}:{output:[say('该操作不可用。')]});
 try{await f.agent.turn(f.input);assert.equal(f.binds,0);assert(f.requests[1].body.input.some(i=>i.type==='function_call_output'&&i.output.includes('未开放的工具')));}finally{await f.close();}
});
test('agent stops at three binding attempts and does not invent a fourth result',async()=>{
 const f=await fixture((body,n)=>n<=4?{output:[call('bind_model',{},'bind'+n)]}:{output:[say('已达到本轮上限。')]});
 try{const r=await f.agent.turn(f.input);assert.equal(f.binds,3);assert.equal(r.created.length,3);assert(f.requests[4].body.input.some(i=>i.type==='function_call_output'&&i.output.includes('三次绑定尝试')));}finally{await f.close();}
});
test('cancel aborts an in-flight API request and unlocks the next turn',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(async()=>{await gate;return {output:[say('late')]};});
 try{const running=f.agent.turn(f.input);while(!f.requests.length)await new Promise(r=>setTimeout(r,10));f.agent.cancel();await assert.rejects(running,/已停止本轮/);assert.equal(f.agent.active,null);assert.equal(f.binds,0);release();}finally{release();await f.close();}
});
test('reject fake animation captures, external images, and all nondeforming plans',async()=>{
 const f=await fixture(()=>({output:[say('OK')]}));try{const ctx={sourceId:'source',targetId:'target',clips:['Run'],captures:0};await assert.rejects(f.agent.snapshot(ctx,{model:'target',rest:false},new AbortController().signal),/没有此动作/);assert.equal(f.captures,0);assert.throws(()=>checkImages(['https://example.com/picture.png']));const p=draftPlan(source,target);p.bones.forEach(b=>b.deform=false);assert.throws(()=>validatePlan(p,source,target),/变形/);assert.equal(blenderExecutable('C:\\Program Files\\Blender\\blender-launcher.exe'),'C:\\Program Files\\Blender\\blender.exe');}finally{await f.close();}
});
