"""Local Blender worker with a versioned editing bridge.
All interchange coordinates are glTF +Y-up world coordinates.
"""
import argparse,sys,json,math,traceback,hashlib,struct
from pathlib import Path
import bpy,bmesh
from mathutils.kdtree import KDTree
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree


def event(message,progress=0):
 print('RIG_EVENT '+json.dumps({'message':message,'progress':progress},ensure_ascii=False),flush=True)
def vec(v):return [float(x) for x in v]
def to_gltf(v):return [float(v.x),float(v.z),float(-v.y)]
def to_blender(v):return Vector((v[0],-v[2],v[1]))
def import_glb(file):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(file),merge_vertices=False)
 return [o for o in bpy.data.objects if o not in before and not any(c.name.startswith('glTF_not_exported') for c in o.users_collection)]
def armature(objects):
 rigs=[o for o in objects if o.type=='ARMATURE']
 if len(rigs)>1:raise ValueError('当前版本需要每个模型只有一套骨架，请先在 Blender 中整理多骨架模型')
 return rigs[0] if rigs else None

def clear_animation(objects):
 for ob in objects:
  if ob.animation_data:
   ob.animation_data.action=None
   for track in ob.animation_data.nla_tracks:track.mute=True;track.is_solo=False
  if ob.type=='ARMATURE':
   for bone in ob.pose.bones:bone.matrix_basis=Matrix.Identity(4)
 bpy.context.view_layer.update()

def bounds(objects):
 pts=[]
 for ob in objects:
  if ob.type=='MESH':pts.extend([to_gltf(ob.matrix_world@Vector(p))for p in ob.bound_box])
 if not pts:raise ValueError('文件中没有可处理的网格')
 low=[min(p[i] for p in pts)for i in range(3)];high=[max(p[i]for p in pts)for i in range(3)]
 return {'min':low,'max':high}

def clip_bindings(objects):
 bindings={}
 for ob in objects:
  owners=[ob]+([ob.data.shape_keys]if ob.type=='MESH'and ob.data.shape_keys else [])
  for owner in owners:
   ad=owner.animation_data
   if not ad:continue
   for track in ad.nla_tracks:
    if len(track.strips)!=1:continue
    strip=track.strips[0]
    if not strip.action:continue
    name=track.name;slot=getattr(strip,'action_slot',None)
    bindings.setdefault(name,[]).append((owner,strip.action,slot))
   if not ad.nla_tracks and ad.action:bindings.setdefault(ad.action.name,[]).append((owner,ad.action,getattr(ad,'action_slot',None)))
 return bindings

def activate(binding):
 for owner,action,slot in binding:
  owner.animation_data_create();owner.animation_data.action=action
  if slot is not None:owner.animation_data.action_slot=slot

def summary(objects,clips=None):
 rigs=[o for o in objects if o.type=='ARMATURE'];meshes=[o for o in objects if o.type=='MESH'];box=bounds(objects);height=box['max'][1]-box['min'][1]
 if height<1e-8:raise ValueError('模型高度为零')
 bone_info=[]
 for rig in rigs:
  weights={b.name:0 for b in rig.data.bones}
  for ob in meshes:
   if not any(m.type=='ARMATURE'and m.object==rig for m in ob.modifiers):continue
   groups={g.index:g.name for g in ob.vertex_groups}
   for v in ob.data.vertices:
    for g in v.groups:
     name=groups.get(g.group)
     if name in weights and g.weight>1e-5:weights[name]+=1
  for b in rig.data.bones:bone_info.append({'name':b.name,'parent':b.parent.name if b.parent else None,'head':to_gltf(rig.matrix_world@b.head_local),'tail':to_gltf(rig.matrix_world@b.tail_local),'deform':b.use_deform,'weightedVertices':weights[b.name]})
 animation=[]
 for name,items in (clips if clips is not None else clip_bindings(objects)).items():
  start=min(float(a.frame_range[0])for _,a,_ in items);end=max(float(a.frame_range[1])for _,a,_ in items);animation.append({'name':name,'duration':(end-start)/bpy.context.scene.render.fps})
 warnings=[]
 if len(rigs)>1:warnings.append('包含多套骨架，当前版本需先合并/拆分后处理')
 triangles=sum(sum(max(0,len(p.vertices)-2)for p in o.data.polygons)for o in meshes)
 if triangles>250000:warnings.append('面数较高，建议在绑定时启用适量减面')
 if any(o.data.shape_keys for o in meshes):warnings.append('已有形态键：绑定时会保留；源表情到目标形态键的语义转换需单独制作')
 return {'bounds':box,'height':height,'bones':bone_info,'animations':animation,'rigged':any(b['weightedVertices']>0 for b in bone_info),'meshes':len(meshes),'vertices':sum(len(o.data.vertices)for o in meshes),'triangles':triangles,'warnings':warnings}

def inspect(job):
 event('正在读取模型、骨架与动作清单',.2);objects=import_glb(job['input']);clips=clip_bindings(objects);clear_animation(objects)
 data=summary(objects,clips);data['sha256']=hashlib.sha256(Path(job['input']).read_bytes()).hexdigest();event('模型检查完成',1);return data

def sort_specs(specs):
 result=[];pending=list(specs);names={b['name']for b in specs}
 while pending:
  ready=[b for b in pending if b.get('parent')not in names or any(p['name']==b['parent']for p in result)]
  if not ready:raise ValueError('绑定方案包含循环父子关系')
  result.extend(ready);pending=[b for b in pending if b not in ready]
 return result

def surface_weights(point,coords,triangle,weights):
 a,b,c=(coords[i] for i in triangle);u=b-a;v=c-a;p=point-a
 d00=u.dot(u);d01=u.dot(v);d11=v.dot(v);den=d00*d11-d01*d01
 if abs(den)<1e-30:return weights[min(triangle,key=lambda i:(coords[i]-point).length_squared)]
 y=(d11*p.dot(u)-d01*p.dot(v))/den;z=(d00*p.dot(v)-d01*p.dot(u))/den
 result={}
 for index,factor in zip(triangle,(1-y-z,y,z)):
  for name,weight in weights[index].items():result[name]=result.get(name,0)+max(0,min(1,factor))*weight
 return result

def new_rig(specs,meshes,diagnostics=None):
 if not any(s.get('deform',True) for s in specs):raise ValueError('方案没有启用任何变形骨骼，请校正方案')
 diagnostics=diagnostics if diagnostics is not None else []
 data=bpy.data.armatures.new('TargetRig');rig=bpy.data.objects.new('TargetRig',data);bpy.context.collection.objects.link(rig)
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
 for spec in sort_specs(specs):
  b=data.edit_bones.new(spec['name']);b.head=to_blender(spec['head']);b.tail=to_blender(spec['tail']);b.use_deform=spec.get('deform',True)
  if spec.get('parent'):b.parent=data.edit_bones[spec['parent']]
 bpy.ops.object.mode_set(mode='OBJECT')
 # Solve on a world-space copy. Dense triangulations can make Blender's heat
 # system singular even when manifold. Reduce only the solver copy, then project
 # interpolated surface weights to the untouched target (including UV seams).
 unweighted=0;filled=0;total=0;deform={b.name for b in data.bones if b.use_deform}
 for ob in meshes:
  span=max(ob.dimensions)
  if span<=1e-10 or not ob.data.polygons:raise ValueError(f'{ob.name} 没有可用于蒙皮的表面')
  box=[ob.matrix_world@Vector(p) for p in ob.bound_box];low=Vector(tuple(min(p[i]for p in box)-span*.1 for i in range(3)));high=Vector(tuple(max(p[i]for p in box)+span*.1 for i in range(3)))
  if not any(all(min(b.head_local[i],b.tail_local[i])<=high[i] and max(b.head_local[i],b.tail_local[i])>=low[i] for i in range(3)) for b in data.bones if b.use_deform):raise ValueError(f'{ob.name} 与变形骨骼范围完全错开，请检查坐标、单位和关节位置')
  proxy=ob.copy();proxy.data=ob.data.copy();proxy.animation_data_clear();bpy.context.collection.objects.link(proxy);proxy.name='WeightProxy_'+ob.name
  proxy.shape_key_clear();proxy.modifiers.clear();proxy.vertex_groups.clear();proxy.data.transform(ob.matrix_world);proxy.parent=None;proxy.matrix_world=Matrix.Identity(4)
  bm=bmesh.new();bm.from_mesh(proxy.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=max(1e-9,span*1e-6));bm.to_mesh(proxy.data);bm.free();proxy.data.update()
  stats={'mesh':ob.name,'originalVertices':len(ob.data.vertices),'originalTriangles':sum(len(p.vertices)-2 for p in ob.data.polygons),'weldedVertices':len(proxy.data.vertices),'attempts':[]};diagnostics.append(stats)
  reduced=False;weights=[]
  for attempt in range(2):
   proxy.vertex_groups.clear();proxy.modifiers.clear()
   if len(proxy.data.polygons)>100000 or attempt:
    if reduced or len(proxy.data.polygons)<1000:break
    event('为高密度或求解失败的网格建立低面数蒙皮副本',.22)
    bpy.ops.object.select_all(action='DESELECT');proxy.select_set(True);bpy.context.view_layer.objects.active=proxy
    mod=proxy.modifiers.new('WeightSolver_reduce','DECIMATE');mod.ratio=min(.5,40000/len(proxy.data.polygons));mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name);reduced=True
   bpy.ops.object.select_all(action='DESELECT');proxy.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
   event('Blender 正在计算自动蒙皮权重',.25)
   try:bpy.ops.object.parent_set(type='ARMATURE_AUTO')
   except RuntimeError as e:stats['solverMessage']=str(e)
   groups={g.index:g.name for g in proxy.vertex_groups}
   weights=[{groups[g.group]:g.weight for g in v.groups if groups.get(g.group)in deform and math.isfinite(g.weight)and g.weight>1e-7}for v in proxy.data.vertices]
   valid=sum(bool(w)for w in weights);stats['attempts'].append({'vertices':len(weights),'weightedVertices':valid,'reduced':reduced})
   if valid and valid>=len(weights)*.99:break
  stats.update(proxyVertices=len(proxy.data.vertices),proxyTriangles=sum(len(p.vertices)-2 for p in proxy.data.polygons),reducedProxy=reduced)
  if not weights or sum(bool(w)for w in weights)<len(weights)*.99:
   bpy.data.objects.remove(proxy,do_unlink=True)
   raise ValueError(f'{ob.name} 的 Blender 热权重求解失败（计算网格 {sum(bool(w)for w in weights)}/{len(weights)} 个顶点有权重）。已尝试焊接/低面数副本；请检查关节位置或修复网格，未导出结果。')
  coords=[v.co.copy()for v in proxy.data.vertices];tree=KDTree(len(coords));valid_tree=KDTree(sum(bool(w)for w in weights))
  for i,p in enumerate(coords):
   tree.insert(p,i)
   if weights[i]:valid_tree.insert(p,i)
  tree.balance();valid_tree.balance();proxy.data.calc_loop_triangles();triangles=[tuple(t.vertices)for t in proxy.data.loop_triangles];surface=BVHTree.FromPolygons(coords,triangles,all_triangles=True)if reduced else None
  world=ob.matrix_world.copy();ob.parent=rig;ob.matrix_parent_inverse=rig.matrix_world.inverted();ob.matrix_world=world
  mod=ob.modifiers.new('RigStudio_armature','ARMATURE');mod.object=rig
  dest={name:ob.vertex_groups.get(name)or ob.vertex_groups.new(name=name)for name in deform}
  mesh_missing=0;max_distance=0
  for v in ob.data.vertices:
   point=world@v.co;total+=1
   if surface:
    location,normal,index,distance=surface.find_nearest(point)
    values=surface_weights(location,coords,triangles[index],weights)if index is not None and distance<=span*.02 else {}
   else:
    _,index,distance=tree.find(point);values=weights[index]
   max_distance=max(max_distance,distance or 0)
   if not values:
    _,index,distance=valid_tree.find(point)
    if distance<=span*.02:values=weights[index];filled+=1
   values=sorted(((n,w)for n,w in values.items()if w>1e-7 and math.isfinite(w)),key=lambda x:x[1],reverse=True)[:4];amount=sum(w for _,w in values)
   if not amount:unweighted+=1;mesh_missing+=1
   else:
    for name,weight in values:dest[name].add([v.index],weight/amount,'REPLACE')
  stats.update(unweightedVertices=mesh_missing,maxProjectionDistance=max_distance)
  bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
  bpy.data.objects.remove(proxy,do_unlink=True)
 if unweighted:raise ValueError(f'自动蒙皮有 {unweighted}/{total} 个顶点未绑定。请校正关节位置或在 Blender 修复；未生成伪成功结果。')
 if filled>total*.01:raise ValueError(f'需要邻近补齐的顶点超过 1%（{filled}/{total}），请修复局部网格或关节，未导出结果。')

 return rig,filled

def optimize(meshes,ratio,warnings):
 if ratio>=.999:return
 for ob in meshes:
  if ob.data.shape_keys: warnings.append(f'{ob.name} 有形态键，为保留表情跳过减面');continue
  bpy.context.view_layer.objects.active=ob;mod=ob.modifiers.new('RigStudio_reduce','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
  bpy.ops.object.modifier_apply(modifier=mod.name)
 warnings.append('已对无形态键网格应用减面；UV 与材质保留，拓扑发生变化')

def evaluate_surface(meshes,contact=False):
 deps=bpy.context.evaluated_depsgraph_get();verts=[];tri=[];low=math.inf;finite=True
 for ob in meshes:
  ev=ob.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles();start=len(verts)
  for v in mesh.vertices:
   p=ev.matrix_world@v.co;finite=finite and all(math.isfinite(c)for c in p);low=min(low,p.z);verts.append(p.copy())
  tri.extend([tuple(start+i for i in t.vertices)for t in mesh.loop_triangles]);ev.to_mesh_clear()
 count=None
 if contact and len(tri)<=100000 and finite:
  tree=BVHTree.FromPolygons(verts,tri,all_triangles=True,epsilon=0)
  # Contacts between faces sharing an edge/vertex are normal topology, not warnings.
  count=sum(1 for a,b in tree.overlap(tree)if a<b and not(set(tri[a])&set(tri[b])))
 return {'finite':finite,'lowestY':float(low),'possibleSelfIntersections':count,'triangles':len(tri)}

def action_curves(action):
 if getattr(action,'is_action_layered',False):
  return [curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
 return list(action.fcurves)

def restore_clip_durations(file,durations,normalize_start=False):
 raw=file.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);offset=20+length;binary=bytearray(raw[offset+8:]);changed={}
 for a in doc.get('animations',[]):
  if a['name']not in durations:continue
  maximum=max(doc['accessors'][sampler['input']].get('max',[0])[0]for sampler in a['samplers']);wanted=durations[a['name']];minimum=min(doc['accessors'][sampler['input']].get('min',[0])[0]for sampler in a['samplers'])if normalize_start else 0;span=maximum-minimum
  if span<=0 or(abs(minimum)<1e-7 and abs(maximum-wanted)<1e-7):continue
  remap={}
  for sampler in a['samplers']:
   old=sampler['input']
   if old not in remap:
    acc=doc['accessors'][old];view=doc['bufferViews'][acc['bufferView']];start=view.get('byteOffset',0)+acc.get('byteOffset',0);stride=view.get('byteStride',4)
    values=[(struct.unpack_from('<f',binary,start+i*stride)[0]-minimum)*wanted/span for i in range(acc['count'])]
    binary.extend(b'\0'*(-len(binary)%4));newview=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(values)*4});binary.extend(struct.pack('<'+'f'*len(values),*values));remap[old]=len(doc['accessors']);doc['accessors'].append({'bufferView':newview,'componentType':5126,'count':len(values),'type':'SCALAR','min':[min(values)],'max':[max(values)]})
   sampler['input']=remap[old]
  changed[a['name']]=[maximum,wanted]
 doc['buffers'][0]['byteLength']=len(binary);data=json.dumps(doc,separators=(',',':')).encode();data+=b' '*(-len(data)%4);binary+=b'\0'*(-len(binary)%4)
 file.write_bytes(struct.pack('<III',0x46546c67,2,28+len(data)+len(binary))+struct.pack('<II',len(data),0x4e4f534a)+data+struct.pack('<II',len(binary),0x004e4942)+binary)
 return changed

def retarget(job):
 warnings=[];report={'warnings':warnings,'clips':[],'validation':'sampled; requires visual review','unchangedSource':True}
 event('导入动作源',.04);source_objects=import_glb(job['source']);source=armature(source_objects)
 if source is None:raise ValueError('动作源没有骨架')
 bindings=clip_bindings(source_objects);clear_animation(source_objects)
 for name in job['clips']:
  if name not in bindings:raise ValueError('找不到动作：'+name)
 source_rest={b.name:source.matrix_world@b.matrix_local for b in source.data.bones}
 event('导入目标并检查现有绑定',.12);target_objects=import_glb(job['target']);target=armature(target_objects);original_bindings=clip_bindings(target_objects);clear_animation(target_objects);meshes=[o for o in target_objects if o.type=='MESH']
 before=summary(target_objects,original_bindings);plan=job['plan'];specs=plan['bones'];ratio=job['options'].get('decimateRatio',1)
 if target is not None and not before['rigged']:raise ValueError('目标包含失效或未蒙皮的骨架，请先在 Blender 修复或移除后重新导入')
 if target is not None and ratio<.999:raise ValueError('已有有效绑定的目标暂不自动减面，以保留现有权重；请将减面比例设为 100%')
 for spec in specs:
  if spec['source']not in source.data.bones:raise ValueError('源骨骼不存在：'+spec['source'])
 if target is None:
  optimize(meshes,ratio,warnings);diagnostics=[]
  try:target,filled=new_rig(specs,meshes,diagnostics)
  finally:(Path(job['jobDir'])/'binding-diagnostics.json').write_text(json.dumps(diagnostics,ensure_ascii=False,indent=2),encoding='utf8')
  target_objects.append(target);report['binding']='new automatic weights; inspect joints and contacts';report['filledVertices']=filled;report['bindingMeshes']=diagnostics
  if any(d['reducedProxy']for d in diagnostics):warnings.append('使用低面数临时副本计算热权重，再按表面插值回传原网格；输出面数由减面设置决定，需复核翅膀、指尖等细节变形')
  if filled:warnings.append(f'{filled} 个孤立顶点使用附近已绑定表面的权重补齐，请复核局部变形')
 else:
  if any(spec['name']not in target.data.bones for spec in specs):raise ValueError('方案使用了不存在的目标骨骼')
  report['binding']='existing rig and weights preserved'
 target_rest={b.name:target.matrix_world@b.matrix_local for b in target.data.bones}
 ordered=[b for b in target.data.bones];mapping={s['name']:s['source']for s in specs};target_inverse=target.matrix_world.inverted();align=Matrix.Rotation(math.radians(plan.get('yaw',0)),4,'Z');scale=float(plan['translationScale']);fps=int(job['options']['fps']);source_fps=bpy.context.scene.render.fps
 # Work in stable world space. Pose-bone matrix assignment handles intermediate bones
 # and their rest axes; only motion deltas are copied, never source bone lengths.
 target.animation_data_create();existing_tracks=list(target.animation_data.nla_tracks)
 for ob in target_objects:
  owners=[ob]+([ob.data.shape_keys]if ob.type=='MESH'and ob.data.shape_keys else [])
  for owner in owners:
   if owner.animation_data:
    for t in owner.animation_data.nla_tracks:t.mute=True;t.name='原有 · '+t.name
 actions=[];pose_samples=[]
 for number,name in enumerate(job['clips']):
  event('烘焙动作：'+name,.35+.45*number/len(job['clips']))
  clear_animation(source_objects);clear_animation(target_objects);activate(bindings[name]);items=bindings[name]
  start=min(float(a.frame_range[0])for _,a,_ in items);end=max(float(a.frame_range[1])for _,a,_ in items);duration=(end-start)/source_fps
  # Evaluate source before changing the scene FPS (imported keys use source_fps).
  samples=max(2,math.ceil(duration*fps)+1);times=[duration*i/(samples-1)for i in range(samples)];desired_frames=[]
  for sec in times:
   frame=start+sec*source_fps;bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
   desired_frames.append({b.name:source.matrix_world@source.pose.bones[b.name].matrix for b in source.data.bones})
  clear_animation(source_objects);clear_animation(target_objects)
  action=bpy.data.actions.new('Transferred · '+name);target.animation_data.action=action
  previous_quats={}
  for sample,(sec,source_pose) in enumerate(zip(times,desired_frames)):
   frame=float(sample);bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
   translation_delta={};synthetic={}
   for sb in source.data.bones:
    sr=source_rest[sb.name];sw=source_pose[sb.name]
    if sb.parent:
     offset=source_rest[sb.parent.name].inverted()@sr.translation
     synthetic[sb.name]=synthetic[sb.parent.name]+source_pose[sb.parent.name].to_3x3()@offset
    else:synthetic[sb.name]=sr.translation.copy()
    translation_delta[sb.name]=sw.translation-synthetic[sb.name]
   current_world={}
   for b in ordered:
    tr=target_rest[b.name];pb=target.pose.bones[b.name]
    base=current_world[b.parent.name]@target_rest[b.parent.name].inverted()@tr if b.parent else tr.copy()
    desired=base
    if b.name in mapping:
     sb=mapping[b.name];sr=source_rest[sb];sw=source_pose[sb]
     if sw.to_3x3().determinant()<=0:raise ValueError('源骨架包含负缩放，请先在 Blender 烘焙变换')
     q=sw.to_quaternion();sc=sw.to_scale();reconstructed=Matrix.LocRotScale(sw.translation,q,sc)
     if max(abs(sw[i][j]-reconstructed[i][j])for i in range(4)for j in range(4))>1e-4:raise ValueError('源动画包含剪切变换，请先在 Blender 烘焙/整理骨架')
     delta=align.to_quaternion()@(q@sr.to_quaternion().inverted())@align.to_quaternion().inverted()
     ancestor=b.parent
     while ancestor and ancestor.name not in mapping:ancestor=ancestor.parent
     inherited=translation_delta[mapping[ancestor.name]] if ancestor else Vector((0,0,0))
     displacement=align.to_3x3()@(translation_delta[sb]-inherited)*scale
     world_scale=Vector(tuple(tr.to_scale()[i]*sc[i]/max(1e-8,sr.to_scale()[i])for i in range(3)))
     desired=Matrix.LocRotScale(base.translation+displacement,delta@tr.to_quaternion(),world_scale)
    current_world[b.name]=desired
    kwargs={'matrix':target_inverse@desired,'matrix_local':b.matrix_local,'invert':True}
    if b.parent:kwargs.update(parent_matrix=target_inverse@current_world[b.parent.name],parent_matrix_local=b.parent.matrix_local)
    pb.rotation_mode='QUATERNION';pb.matrix_basis=b.convert_local_to_pose(**kwargs)
    if b.name in mapping:
     quat=pb.rotation_quaternion.copy()
     if b.name in previous_quats and quat.dot(previous_quats[b.name])<0:quat.negate();pb.rotation_quaternion=quat
     previous_quats[b.name]=quat
     for channel in ['location','rotation_quaternion','scale']:pb.keyframe_insert(channel,frame=frame,group=b.name)
   if sample in {0,samples//4,samples//2,3*samples//4,samples-1}:
    bpy.context.view_layer.update();pose_samples.append((name,sec/duration if duration else 0,evaluate_surface(meshes,job['options'].get('selfContact',True))))
  for curve in action_curves(action):
   for key in curve.keyframe_points:key.interpolation='LINEAR'
  slot=getattr(target.animation_data,'action_slot',None);target.animation_data.action=None
  track=target.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,0,action)
  if slot is not None:strip.action_slot=slot
  track.mute=True;actions.append((name,action,slot,track));report['clips'].append({'name':name,'duration':duration,'samples':samples})
 warnings.append('未映射的目标骨骼保持局部静止姿势；源表情不会自动变成目标形态键')
 warnings.append('保留目标骨长，按位移比例迁移源根部与局部位移；未执行脚部 IK 和自动防穿插，需要逐动作复核')
 factor=fps/source_fps
 original_actions={a for items in original_bindings.values()for _,a,_ in items}
 strip_times=[]
 for ob in target_objects:
  owners=[ob]+([ob.data.shape_keys]if ob.type=='MESH'and ob.data.shape_keys else [])
  for owner in owners:
   if owner.animation_data:
    for track in owner.animation_data.nla_tracks:
     for strip in track.strips:
      if strip.action in original_actions:strip_times.append((strip,strip.frame_start,strip.frame_end,strip.action_frame_start,strip.action_frame_end))
 for a in original_actions:
  original_end=float(a.frame_range[1]);factor=math.ceil(original_end*fps/source_fps)/original_end if original_end>0 else fps/source_fps
  curves=action_curves(a)
  for fcurve in curves:
   for key in fcurve.keyframe_points:key.co.x*=factor;key.handle_left.x*=factor;key.handle_right.x*=factor
   fcurve.update()
 for strip,start,end,action_start,action_end in strip_times:
  strip.action_frame_start=action_start*fps/source_fps;strip.action_frame_end=math.ceil(action_end*fps/source_fps);strip.frame_start=start*fps/source_fps;strip.frame_end=math.ceil(end*fps/source_fps)
 bpy.context.scene.render.fps=fps
 for ob in source_objects:bpy.data.objects.remove(ob,do_unlink=True)
 clear_animation(target_objects);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
 report['samples']=[{'clip':name,'phase':frame,'frame':frame*next(c['duration']for c in report['clips']if c['name']==name)*fps,**s}for name,frame,s in pose_samples]
 if not all(s['finite']for _,_,s in pose_samples):raise ValueError('检测到非有限网格坐标，已停止导出')
 if any((s['possibleSelfIntersections']or 0)>0 for _,_,s in pose_samples):warnings.append('部分采样姿势存在非相邻三角形接触，请重点查看胸颈、腋下与嘴部；接触计数是复核提示，不等同于穿插已修复')
 if any(s['possibleSelfIntersections']is None for _,_,s in pose_samples):warnings.append('超过 10 万三角面的姿势跳过自接触检测，请手动查看')
 if before['animations']:warnings.append('目标原有动作以“原有 · ”前缀保留，新增动作独立命名')
 out=Path(job['jobDir'])/'retargeted.glb';blend=Path(job['jobDir'])/'project.blend'
 # Export only this target; source meshes, textures and bones must never leak into output.
 bpy.ops.object.select_all(action='DESELECT')
 for ob in target_objects:ob.select_set(True)
 bpy.context.view_layer.objects.active=target
 event('导出 GLB 与可编辑 Blender 工程',.87)
 bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_yup=True,export_skins=True,export_morph=True,export_morph_animation=True,export_materials='EXPORT',export_image_format='AUTO',export_force_sampling=True)
 report['samplingFps']=fps
 durations={c['name']:c['duration']for c in report['clips']};durations.update({'原有 · '+a['name']:a['duration']for a in before['animations']})
 report['durationRestoration']=restore_clip_durations(out,durations,normalize_start=True)
 (Path(job['jobDir'])/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf8')
 report['bytes']=out.stat().st_size;report['sourceHash']=hashlib.sha256(Path(job['source']).read_bytes()).hexdigest();report['targetHash']=hashlib.sha256(Path(job['target']).read_bytes()).hexdigest()
 event('重新读取导出文件检查动作与骨架',.94)
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=fps;reloaded=import_glb(out);reloaded_bindings=clip_bindings(reloaded);clear_animation(reloaded);after=summary(reloaded,reloaded_bindings)
 missing=set(job['clips'])-set(a['name']for a in after['animations'])
 if missing:raise ValueError('导出后缺少动作：'+', '.join(missing))
 report['outputSummary']=after;report['reloaded']=True
 (Path(job['jobDir'])/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 event('处理完成，请在对比视图复核动作',1)
 return {'output':str(out),'blend':str(blend),'summary':after,'report':report}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--job',required=True);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);job=json.loads(Path(args.job).read_text(encoding='utf8'));bpy.ops.wm.read_factory_settings(use_empty=True)
 try:
  if job['task'] in ('scene','python'):
   sys.path.insert(0,str(Path(__file__).parent));import editor;result=editor.main(job)
  else:result=inspect(job)if job['task']=='inspect'else retarget(job)if job['task']=='retarget'else (_ for _ in ()).throw(ValueError('未知任务'))
  Path(job['result']).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 except Exception as e:
  Path(job['result']).write_text(json.dumps({'error':str(e)},ensure_ascii=False),encoding='utf8');traceback.print_exc();raise
if __name__=='__main__':main()
