import {t} from './i18n.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const kinds=new Set(['source','target','generate','bind','edit','result']);
const defaults=()=>({fps:30,decimateRatio:1,selfContact:true});
export class Workflow {
 constructor(studio){this.studio=studio;this.file=path.join(studio.dataDir,'canvas.json');this.graph={version:1,nodes:[],edges:[],selectedId:'',compareIds:[],viewport:{x:50,y:50,zoom:.8}};this.writes=Promise.resolve();}
 async init(){
  try{this.graph=JSON.parse(await fs.readFile(this.file,'utf8'));for(const n of this.graph.nodes)if(n.status==='running'){n.status='interrupted';n.error='上次运行中断；生成任务可继续查询，本地任务可重新执行。';}}catch(e){if(e.code!=='ENOENT')throw Error('画布文件无法读取，已保留原文件：'+e.message);this.migrate();}
  await this.save();return this.state();
 }
 migrate(){
  const ids=new Map();let s=0,targets=0;
  for(const a of this.studio.assets.values()){if(a.role==='result')continue;const n=this.add(a.role,{assetId:a.id,title:a.name,position:{x:a.role==='source'?0:300,y:(a.role==='source'?s++:targets++)*260}});ids.set(a.id,n.id);}
  let i=0;for(const r of [...this.studio.runs].reverse()){if(!this.studio.assets.has(r.assetId))continue;const n=this.add('bind',{title:t('历史绑定 {number}',{number:++i}),position:{x:620,y:(i-1)*260},plan:r.plan,clips:r.clips,options:defaults()});for(const [port,id]of [['source',r.sourceId],['target',r.targetId]])if(ids.has(id))this.connect(ids.get(id),n.id,port);this.addResult(n.id,r.assetId,false);}
 }
 state(){return structuredClone(this.graph);}
 async save(){const data=JSON.stringify(this.graph,null,2);this.writes=this.writes.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',data);await fs.rename(this.file+'.tmp',this.file);});await this.writes;}
 node(id){const n=this.graph.nodes.find(n=>n.id===id);if(!n)throw Error('画布节点不存在');return n;}
 add(kind,data={}){
  if(!kinds.has(kind)||this.graph.nodes.length>=1000)throw Error('节点类型无效或已达到 1000 个节点');
  if(data.assetId)this.studio.asset(data.assetId);
  const n={id:randomUUID(),kind,title:String(data.title||t({source:'动作原型',target:'目标模型',generate:'生成模型',bind:'绑定动作',edit:'Blender 编辑',result:'结果版本'}[kind])).slice(0,120),position:data.position||{x:100+(this.graph.nodes.length%4)*300,y:100+Math.floor(this.graph.nodes.length/4)*260},status:'idle',...structuredClone(data)};
  if(!Number.isFinite(n.position.x)||!Number.isFinite(n.position.y))throw Error('节点位置无效');
  this.graph.nodes.push(n);this.graph.selectedId=n.id;return n;
 }
 incoming(id,port){return this.graph.edges.find(e=>e.target===id&&e.targetHandle===port);}
 output(id){const n=this.node(id);return n.assetId||n.outputId||'';}
 connect(source,target,port){
  const a=this.node(source),b=this.node(target);if(source===target)throw Error('不能连接节点自身');
  if(!['source','target','generate','result'].includes(a.kind))throw Error('请从模型或结果节点输出连接');
  if(!(b.kind==='bind'&&['source','target'].includes(port)||b.kind==='edit'&&port==='input'))throw Error('请连接绑定节点的原型/目标端口，或编辑节点的输入端口');
  if(b.kind==='bind'&&port==='source'){const assetId=this.output(source);if(assetId&&!this.studio.asset(assetId).animations.length)throw Error('动作原型必须包含动作');}
  const visit=id=>id===source||this.graph.edges.filter(e=>e.source===id).some(e=>visit(e.target));if(visit(target))throw Error('连接会产生循环');
  this.graph.edges=this.graph.edges.filter(e=>!(e.target===target&&e.targetHandle===port));
  this.graph.edges.push({id:randomUUID(),source,target,targetHandle:port,sourceHandle:'output'});
  b.plan=undefined;b.outputId=undefined;b.status='idle';return b;
 }
 context(id){
  const n=this.node(id),byPort=port=>{const e=this.incoming(id,port);return e?this.output(e.source):'';};
  if(n.kind==='bind')return {nodeId:id,sourceId:byPort('source'),targetId:byPort('target'),plan:n.plan,clips:n.clips||[],options:n.options||defaults(),resultId:n.outputId||''};
  const assetId=n.kind==='edit'?byPort('input'):this.output(id),run=this.studio.runs.find(r=>r.assetId===assetId);
  return {nodeId:id,sourceId:run?.sourceId||'',targetId:assetId,plan:undefined,clips:(run?.clips||[]).filter(c=>!run?.sourceId||this.studio.asset(run.sourceId).animations.some(a=>a.name===c)),options:n.options||defaults(),resultId:n.kind==='edit'?n.outputId||'':run?assetId:''};
 }
 addResult(id,assetId,select=true){
  const parent=this.node(id);this.studio.asset(assetId);const count=this.graph.edges.filter(e=>e.source===id).length;
  const n=this.add('result',{title:`${parent.title} · v${count+1}`,assetId,status:'done',position:{x:parent.position.x+320,y:parent.position.y+count*240}});
  this.graph.edges.push({id:randomUUID(),source:id,target:n.id,sourceHandle:'output',targetHandle:'result'});parent.outputId=assetId;parent.status='done';delete parent.error;
  this.graph.selectedId=select?id:this.graph.selectedId;return n;
 }
 fork(id){
  let base=this.node(id);if(base.kind==='result'){const edge=this.graph.edges.find(e=>e.target===id);if(edge)base=this.node(edge.source);}
  if(!['bind','edit','generate'].includes(base.kind))throw Error('请选择绑定、编辑、生成或结果节点创建分支');
  const {id:_,outputId,assetId,status,error,task,...data}=structuredClone(base);
  const n=this.add(base.kind,{...data,title:base.title+t(' · 分支'),position:{x:base.position.x,y:Math.max(base.position.y+280,...this.graph.nodes.filter(x=>Math.abs(x.position.x-base.position.x)<100).map(x=>x.position.y+260))}});
  for(const e of this.graph.edges.filter(e=>e.target===base.id))this.graph.edges.push({...e,id:randomUUID(),target:n.id});return n;
 }
 async mutate(action){
  const previous=this.state();let value;
  try{
   if(action.type==='add'){if(!['source','target','generate','bind','edit'].includes(action.kind))throw Error('不能手动创建结果记录');const data={};for(const k of ['title','position','assetId','provider','prompt','model'])if(action.data?.[k]!==undefined)data[k]=action.data[k];value=this.add(action.kind,data);}
   else if(action.type==='connect')value=this.connect(action.source,action.target,action.port);
   else if(action.type==='fork')value=this.fork(action.id);
   else if(action.type==='patch'){
    const n=this.node(action.id),allowed=['title','plan','clips','options','provider','prompt','model','code','instruction'];if(n.kind==='result')allowed.splice(1);
    for(const k of Object.keys(action.patch||{})){if(!allowed.includes(k))throw Error('不允许修改节点字段：'+k);n[k]=structuredClone(action.patch[k]);}value=n;
   }else if(action.type==='move'){for(const item of action.nodes||[]){const n=this.node(item.id);if(!Number.isFinite(item.position?.x)||!Number.isFinite(item.position?.y))throw Error('节点坐标无效');n.position=item.position;}}
   else if(action.type==='select'){if(action.id)this.node(action.id);this.graph.selectedId=action.id;}
   else if(action.type==='compare'){if(!Array.isArray(action.ids)||action.ids.length>3)throw Error('最多同时对比三个模型');for(const id of action.ids)this.studio.asset(id);this.graph.compareIds=[...new Set(action.ids)];}
   else if(action.type==='viewport'){const v=action.viewport;if(![v?.x,v?.y,v?.zoom].every(Number.isFinite)||v.zoom<.1||v.zoom>3)throw Error('画布视角无效');this.graph.viewport=v;}
   else if(action.type==='remove'){this.node(action.id);this.graph.nodes=this.graph.nodes.filter(n=>n.id!==action.id);const downstream=this.graph.edges.filter(e=>e.source===action.id).map(e=>e.target);this.graph.edges=this.graph.edges.filter(e=>e.source!==action.id&&e.target!==action.id);for(const id of downstream){const n=this.node(id);if(n.kind!=='result'){n.plan=undefined;n.status='idle';n.outputId=undefined;}}if(this.graph.selectedId===action.id)this.graph.selectedId='';}
   else if(action.type==='disconnect'){const e=this.graph.edges.find(e=>e.id===action.id);if(!e)throw Error('连接不存在');if(this.node(e.target).kind==='result')throw Error('结果来源记录不能单独删除');const n=this.node(e.target);n.plan=undefined;n.outputId=undefined;n.status='idle';this.graph.edges=this.graph.edges.filter(e=>e.id!==action.id);}
   else throw Error('画布操作无效');
   if(JSON.stringify(this.graph).length>8_000_000)throw Error('画布数据过大');await this.save();return {graph:this.state(),nodeId:value?.id};
  }catch(e){this.graph=previous;throw e;}
 }
 async record(id,result){const n=this.addResult(id,result.asset.id);await this.save();return n;}
}
