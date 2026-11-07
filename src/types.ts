export type V3=[number,number,number];
export interface Bone {name:string;parent:string|null;head:V3;tail:V3;deform:boolean;weightedVertices?:number;source?:string}
export interface Plan {version:number;mode:'existing'|'new';yaw:number;translationScale:number;notes:string;bones:(Bone&{source:string})[]}
export interface Asset {id:string;name:string;path:string;role:'source'|'target'|'result';bytes:number;createdAt:string;bounds:{min:V3;max:V3};height:number;rigged:boolean;bones:Bone[];animations:{name:string;duration:number}[];vertices:number;triangles:number;meshes:number;warnings:string[];hasThumbnail?:boolean}
export interface Report {warnings:string[];reloaded:boolean;binding:string;clips:{name:string;duration:number;samples:number}[];samples:{clip:string;frame:number;phase:number;finite:boolean;lowestY:number;possibleSelfIntersections:number|null}[]}
export interface Run {id:string;assetId:string;sourceId:string;targetId:string;createdAt:string;plan:Plan;clips:string[];report:Report;jobDir:string}
export interface Settings {blenderPath:string;baseUrl:string;model:string;rememberKey:boolean;hasKey:boolean;canRememberKey:boolean;agentSteps?:number;blenderAttempts?:number;providers?:Record<string,{model?:string}>;providerKeyStatus?:Record<string,boolean>;apiMode?:'auto'|'responses'|'chat'}
export interface ProcessingOptions {fps:number;decimateRatio:number;selfContact:boolean}
export interface AgentMessage {id:string;role:'user'|'assistant'|'tool'|'system';text:string;createdAt:string;status?:string;tool?:string;resultId?:string}
export interface AgentContext {nodeId?:string;plan?:Plan;clips:string[];options:ProcessingOptions;resultId?:string;created?:string[]}
export interface AgentEvent {nodeId?:string;type:'message'|'context'|'result'|'status'|'idle';sourceId?:string;targetId?:string;message?:AgentMessage;text?:string;plan?:Plan;options?:ProcessingOptions;clips?:string[];asset?:Asset;run?:Run}
export interface CaptureRequest {requestId:string;assetId:string;clip:string;phase:number;rest:boolean}
export interface JobEvent {id:string;kind:string;state:'running'|'done'|'error'|'cancelled';progress?:number;message:string}
export interface CanvasNode {id:string;kind:'source'|'target'|'generate'|'bind'|'edit'|'result';title:string;position:{x:number;y:number};assetId?:string;outputId?:string;status:string;error?:string;progress?:number;plan?:Plan;clips?:string[];options?:ProcessingOptions;provider?:string;prompt?:string;model?:string;code?:string;instruction?:string;task?:{id:string;provider:string;stage:string}}
export interface CanvasEdge {id:string;source:string;target:string;sourceHandle:string;targetHandle:string}
export interface CanvasGraph {version:number;nodes:CanvasNode[];edges:CanvasEdge[];selectedId:string;compareIds:string[];viewport:{x:number;y:number;zoom:number}}
export interface CanvasContext extends AgentContext {sourceId:string;targetId:string}
export interface StudioAPI {
 setLanguage?(value:'en'|'zh-CN'):Promise<string>;
 canvas():Promise<CanvasGraph>;canvasContext(id:string):Promise<CanvasContext>;canvasMutate(action:Record<string,unknown>):Promise<{graph:CanvasGraph;nodeId?:string}>;
 runNode(args:{id:string;resume?:boolean}):Promise<unknown>;thumbnail(args:{id:string;image?:string}):Promise<string>;
 inspectScene(args:Record<string,unknown>):Promise<{data:unknown;images:string[]}>;

 agentHistory(args:{nodeId?:string;sourceId:string;targetId:string}):Promise<{messages:AgentMessage[];context?:AgentContext}>;
 agentTurn(args:{nodeId?:string;sourceId:string;targetId:string;message:string;plan?:Plan;clips:string[];options:ProcessingOptions;resultId?:string;images:string[]}):Promise<AgentContext>;
 agentCancel():Promise<void>;captureReply(args:{requestId:string;images?:string[];error?:string}):Promise<void>;
 onAgent(callback:(event:AgentEvent)=>void):()=>void;onCapture(callback:(request:CaptureRequest)=>void):()=>void;
 validatePlan(args:{plan:Plan;sourceId:string;targetId:string}):Promise<Plan>;
 state():Promise<{settings:Settings;assets:Asset[];runs:Run[]}>;
 saveSettings(s:Partial<Settings>&{apiKey?:string;clearKey?:boolean;providerKeys?:Record<string,string>;clearProvider?:string}):Promise<Settings>;
 detectBlender():Promise<string>;checkBlender(path?:string):Promise<{version:string;path:string}>;chooseBlender():Promise<string|null>;
 importModel(role:'source'|'target'):Promise<Asset|null>;readAsset(id:string):Promise<Uint8Array>;
 draftPlan(ids:{sourceId:string;targetId:string}):Promise<Plan>;
 aiPlan(args:{sourceId:string;targetId:string;images:string[];instruction:string}):Promise<Plan>;
 bind(args:{sourceId:string;targetId:string;plan:Plan;clips:string[];options:{fps:number;decimateRatio:number;selfContact:boolean}}):Promise<{asset:Asset;run:Run}>;
 cancel():Promise<void>;testAPI():Promise<{ok:boolean}>;
 importPlan(ids:{sourceId:string;targetId:string}):Promise<Plan|null>;exportPlan(args:{sourceId:string;targetId:string;plan:Plan}):Promise<boolean>;
 exportResult(id:string):Promise<boolean>;revealRun(id:string):Promise<void>;openBlend(id:string):Promise<void>;
 onJob(callback:(event:JobEvent)=>void):()=>void;
}
declare global {interface Window {rigStudio?:StudioAPI}}
