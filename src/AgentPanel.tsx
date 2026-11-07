import {t,useLanguage} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Square,Sparkles,Check,TriangleAlert,LoaderCircle} from 'lucide-react';
import {Viewer,type ViewHandle} from './Viewer';
import type {AgentContext,AgentMessage,Asset,CaptureRequest,Plan,ProcessingOptions,Settings} from './types';
const api=window.rigStudio;
const labels:Record<string,string>={inspect_canvas:'读取画布',create_node:'创建节点',connect_nodes:'连接节点',fork_node:'创建分支',select_node:'切换节点',set_node_parameters:'设置节点',generate_model:'生成模型',blender_capabilities:'读取 Blender 编辑接口',inspect_blender_scene:'检查网格与纹理',execute_blender_python:'执行 Blender 编辑',inspect_workspace:'检查模型与骨架',view_model:'查看模型截图',create_draft:'创建初始骨架',replace_plan:'更新绑定方案',edit_bones:'调整关节',set_processing:'调整动作与减面参数',bind_model:'执行 Blender 绑定',inspect_result:'检查结果'};
interface Props {nodeId?:string;sourceId:string;targetId:string;plan?:Plan;clips:string[];options:ProcessingOptions;resultId:string;settings:Settings;busy:boolean;captures:()=>string[];onBusy:(value:boolean)=>void;onContext:(context:AgentContext)=>void;onSettings:()=>void;onVersion:(id:string)=>void}
export function AgentPanel(props:Props){useLanguage();
 const [messages,setMessages]=useState<AgentMessage[]>([]),[text,setText]=useState(''),[running,setRunning]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const latest=useRef(props),list=useRef<HTMLDivElement>(null);latest.current=props;
 useEffect(()=>{let stale=false;setMessages([]);setError('');if(!api||(!props.nodeId&&(!props.sourceId||!props.targetId)))return;api.agentHistory({nodeId:props.nodeId,sourceId:props.sourceId,targetId:props.targetId}).then(s=>{if(!stale){setMessages(old=>[...s.messages,...old.filter(m=>!s.messages.some(n=>n.id===m.id))]);if(s.context&&!props.nodeId&&!latest.current.plan)latest.current.onContext(s.context);}}).catch(e=>!stale&&setError(String(e.message)));return()=>{stale=true;};},[props.nodeId,props.sourceId,props.targetId]);
 useEffect(()=>api?.onAgent(e=>{const p=latest.current;if(p.nodeId?e.nodeId!==p.nodeId:e.sourceId!==p.sourceId||e.targetId!==p.targetId)return;if(e.type==='message'&&e.message)setMessages(old=>old.some(m=>m.id===e.message!.id)?old:[...old,e.message!]);if(e.type==='status')setStatus(e.text||'');}),[]);
 useEffect(()=>{list.current?.scrollTo({top:list.current.scrollHeight,behavior:'smooth'});},[messages,status]);
 const send=async()=>{
  if(!api||running||props.busy||!text.trim())return;
  if(!props.settings.hasKey||!props.settings.model){props.onSettings();return;}
  setRunning(true);props.onBusy(true);setError('');setStatus('正在查看当前模型…');const message=text;setText('');
  try{const result=await api.agentTurn({nodeId:props.nodeId,sourceId:props.sourceId,targetId:props.targetId,plan:props.plan,clips:props.clips,options:props.options,resultId:props.resultId,message,images:props.captures()});await props.onContext(result);}
  catch(e){setError(String(e instanceof Error?e.message:e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}
  finally{setRunning(false);props.onBusy(false);setStatus('');}
 };
 return <section className="agent-panel" aria-label={t("Agent 对话")}><div className="agent-intro"><span className="agent-badge"><Sparkles size={15}/>{t("模型助手")}</span><span>{t("对话修改 · 独立版本")}</span></div><div className="agent-messages" ref={list} aria-live="polite">
  {!messages.length&&<div className="agent-welcome"><h3>{t("告诉我，你想怎么改。")}</h3><p>{t("选中画布节点后，我可以调用 Blender 编辑局部网格、权重、骨骼、UV、材质和表情，再保存独立版本供你对比。")}</p><div className="agent-suggestions">{[t("检查当前节点及其输入，拟合骨架并绑定所选动作。"),t("检查双臂网格，局部延长 15%，保持肩部过渡并检查纹理。"),t("先不要执行，解释当前方案里尾巴的骨骼是怎么对应的。")].map(s=><button key={s} disabled={running||props.busy} onClick={()=>setText(t(s))}>{t(s)}</button>)}</div></div>}
  {messages.map(m=><article key={m.id} className={'agent-message '+m.role+(m.status==='error'?' failed':'')}>
   {m.role==='tool'?<><span>{m.status==='error'?<TriangleAlert size={13}/>:<Check size={13}/>} {t(labels[m.tool||'']||m.tool||'')}</span>{m.status==='error'&&<p>{m.text}</p>}{m.resultId&&<button onClick={()=>props.onVersion(m.resultId!)}>{t("查看这个版本")}</button>}</>:<><small>{m.role==='user'?t("你"):m.role==='assistant'?t("模型助手"):t("任务状态")}</small><p>{m.text}</p></>}
  </article>)}
  {running&&<div className="agent-thinking"><LoaderCircle size={14} className="spin"/>{status.startsWith("正在执行：")?t(labels[status.slice(5)]||status):t(status)}</div>}
 </div>{error&&<div className="agent-error" role="alert">{t(error)}</div>}<div className="agent-composer"><textarea aria-label={t("给 Agent 的指令")} rows={3} placeholder={(props.nodeId||props.sourceId&&props.targetId)?t("例如：脖子关节太低，先检查侧视图，再调整并重绑。"):t("先导入动作原型和目标模型")} disabled={running||(!props.nodeId&&(!props.sourceId||!props.targetId))||!api} value={text} maxLength={12000} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><small>{t("Enter 发送 · Shift + Enter 换行")}</small>{running?<button aria-label={t("停止 Agent")} onClick={()=>api?.agentCancel()}><Square size={13}/>{t("停止")}</button>:<button className="primary" aria-label={t("发送给 Agent")} disabled={!text.trim()||props.busy||(!props.nodeId&&(!props.sourceId||!props.targetId))||!api} onClick={send}><ArrowUp size={16}/>{t("发送")}</button>}</div><p>{t("对话、骨架数据及请求查看的截图会发往你配置的 API；GLB 留在本机。")}</p></div></section>;
}

// A dedicated renderer keeps agent inspection independent of the user's live
// playback, camera and selected comparison version. It never reads arbitrary paths.
export function AgentCapture(){useLanguage();
 const [request,setRequest]=useState<CaptureRequest>(),[asset,setAsset]=useState<Asset>(),viewer=useRef<ViewHandle>(null);
 useEffect(()=>api?.onCapture(r=>setRequest(r)),[]);
 useEffect(()=>{if(!request||!api)return;let stale=false;let timer:ReturnType<typeof setTimeout>|undefined;
  (async()=>{try{const state=await api.state(),next=state.assets.find(a=>a.id===request.assetId);if(!next)throw Error('截图模型不存在');if(stale)return;setAsset(next);const started=Date.now();const poll=async()=>{if(stale)return;if(viewer.current?.ready(next.id)){try{const images=viewer.current.captures(request);await api.captureReply({requestId:request.requestId,images});setAsset(undefined);}catch(e){await api.captureReply({requestId:request.requestId,error:String(e)});}return;}if(Date.now()-started>35000){await api.captureReply({requestId:request.requestId,error:'模型尚未加载完成，无法截图'});return;}timer=setTimeout(poll,100);};timer=setTimeout(poll,100);}catch(e){if(!stale)await api.captureReply({requestId:request.requestId,error:String(e)});}})();
  return()=>{stale=true;clearTimeout(timer);};
 },[request]);
 return <div className="agent-capture-stage" aria-hidden="true">{asset&&<Viewer ref={viewer} asset={asset} skeleton={false} normalize={true}/>}</div>;
}
