"""Versioned Blender editing bridge. Runs on a private copy, never the input path.
This is an application guard, not an OS security sandbox. See README.
"""
import ast, builtins, json, math, hashlib, traceback, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix
import worker as w

ALLOWED_IMPORTS={'bpy','bmesh','mathutils','math','numpy','statistics','itertools','collections','random','json'}
BLOCKED_NAMES={'open','exec','eval','compile','globals','locals','vars','getattr','setattr','delattr','__import__','breakpoint','input','help','exit','quit'}
BLOCKED_ATTRS={'wm','script','text','libraries','handlers','driver_namespace','preferences','load','save','save_render','save_as','filepath','filepath_raw','open','user_resource','script_paths','register_class','unregister_class','import_scene','export_scene','import_mesh','export_mesh','file','tofile','fromfile','memmap','loadtxt','savetxt','ctypes','ctypeslib'}
def validate_code(code):
 if not isinstance(code,str)or not code.strip()or len(code)>60000:raise ValueError('Python 脚本需要 1–60000 字符')
 tree=ast.parse(code,filename='agent_edit.py')
 for n in ast.walk(tree):
  if isinstance(n,(ast.Import,ast.ImportFrom)):
   names=[n.module]if isinstance(n,ast.ImportFrom)else[a.name for a in n.names]
   if any(not name or name.split('.')[0]not in ALLOWED_IMPORTS for name in names):raise ValueError('只允许 Blender 与数值计算模块；不能执行系统命令、网络或文件操作')
  if isinstance(n,ast.Name)and(n.id in BLOCKED_NAMES or n.id.startswith('__')):raise ValueError('不允许使用：'+n.id)
  if isinstance(n,ast.Attribute)and(n.attr.startswith('_')or n.attr in BLOCKED_ATTRS):raise ValueError('不允许直接使用属性：'+n.attr+'；文件输出由工作区负责')
 return tree

def digest(objects):
 result={}
 for ob in objects:
  if ob.type!='MESH':continue
  mesh=ob.data
  positions=hashlib.sha256();uv=hashlib.sha256();weights=hashlib.sha256()
  for v in mesh.vertices:
   positions.update(str(tuple(round(x,7)for x in v.co)).encode());weights.update(str([(g.group,round(g.weight,7))for g in v.groups]).encode())
  for layer in mesh.uv_layers:
   for p in layer.data:uv.update(str(tuple(round(x,7)for x in p.uv)).encode())
  result[ob.name]={'vertices':len(mesh.vertices),'polygons':len(mesh.polygons),'positions':positions.hexdigest(),'uv':uv.hexdigest(),'weights':weights.hexdigest(),'shapeKeys':[k.name for k in mesh.shape_keys.key_blocks]if mesh.shape_keys else []}
 return result

def detailed(objects,region=None):
 result={'coordinateSystem':'WORLD glTF +Y up. Blender native coordinates use +Z up; use to_blender/to_gltf.', 'summary':w.summary(objects),'meshes':[],'materials':[],'textures':[]}
 for ob in objects:
  if ob.type!='MESH':continue
  mesh=ob.data;mesh.calc_loop_triangles();world=ob.matrix_world;uv=mesh.uv_layers.active
  missing_weights=sum(1 for v in mesh.vertices if not any(g.weight>1e-5 for g in v.groups))
  samples=[];indices=[]
  for v in mesh.vertices:
   p=w.to_gltf(world@v.co)
   if region and not all(region['min'][i]<=p[i]<=region['max'][i]for i in range(3)):continue
   indices.append(v.index)
  for index in indices[::max(1,math.ceil(len(indices)/96))][:96]:
   v=mesh.vertices[index];samples.append({'index':index,'position':w.to_gltf(world@v.co),'weights':{ob.vertex_groups[g.group].name:round(g.weight,5)for g in v.groups if g.weight>1e-4}})
  zero=0;ratios=[];outside=0
  if uv:
   for tri in mesh.loop_triangles:
    a,b,c=[uv.data[i].uv for i in tri.loops];area=abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))*.5
    wa,wb,wc=[world@mesh.vertices[i].co for i in tri.vertices];surface=(wb-wa).cross(wc-wa).length*.5
    if area<1e-12:zero+=1
    elif surface>1e-12:ratios.append(math.sqrt(surface/area))
   outside=sum(1 for d in uv.data if any(x<0 or x>1 for x in d.uv))
  ratios.sort();pct=lambda q:ratios[min(len(ratios)-1,int(len(ratios)*q))]if ratios else None
  result['meshes'].append({'name':ob.name,'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'bounds':w.bounds([ob]),'modifiers':[{'name':m.name,'type':m.type}for m in ob.modifiers],'vertexGroups':[g.name for g in ob.vertex_groups],'unweightedVertices':missing_weights,'shapeKeys':[k.name for k in mesh.shape_keys.key_blocks]if mesh.shape_keys else [],'uvLayers':[u.name for u in mesh.uv_layers],'uv':{'degenerateTriangles':zero,'outsideUnitCorners':outside,'worldUnitsPerUVUnitP05':pct(.05),'worldUnitsPerUVUnitP50':pct(.5),'worldUnitsPerUVUnitP95':pct(.95),'note':'UV 密度差异是线索，不是贴图拉伸已修复的证明。'},'selectedVertexCount':len(indices),'vertexSamples':samples})
 used_materials={mat for ob in objects if ob.type=='MESH' for mat in ob.data.materials if mat}
 used_images={node.image for mat in used_materials if mat.use_nodes for node in mat.node_tree.nodes if node.type=='TEX_IMAGE'and node.image}
 for mat in used_materials:
  result['materials'].append({'name':mat.name,'nodes':[{'name':n.name,'type':n.type,'image':n.image.name if n.type=='TEX_IMAGE'and n.image else None}for n in mat.node_tree.nodes]if mat.use_nodes else []})
 for im in used_images:
  if im.type=='RENDER_RESULT':continue
  result['textures'].append({'name':im.name,'width':im.size[0],'height':im.size[1],'channels':im.channels,'colorSpace':im.colorspace_settings.name,'loaded':bool(im.size[0])})
 return result

class EditContext:
 def __init__(self,job):self.job=job;self.report={};self.images=[]
 def inspect(self,region=None):return detailed(list(bpy.context.scene.objects),region)
 def mesh(self,name):
  ob=bpy.data.objects.get(name)
  if not ob or ob.type!='MESH':raise ValueError('网格不存在：'+name)
  return ob
 def stretch(self,name,axis,pivot,start,end,factor,side=1,move_bones=False):
  """Stretch glTF-world axis beyond pivot, smoothly weighted over [start,end].
  Applies identical displacement to all shape keys. Optional bone adjustment
  changes rest joints; animation/skin quality must subsequently be reviewed.
  """
  if axis not in (0,1,2)or factor<=0 or factor>5 or end<=start or side not in(-1,1):raise ValueError('局部拉伸参数无效')
  ob=self.mesh(name);inv=ob.matrix_world.inverted();changed=0
  def adjust(p):
   a=w.to_gltf(p);d=side*(a[axis]-pivot);t=min(1,max(0,(d-start)/(end-start)));blend=t*t*(3-2*t);a[axis]+=(a[axis]-pivot)*(factor-1)*blend;return w.to_blender(a)
  mesh=ob.data
  if mesh.shape_keys:
   for key in mesh.shape_keys.key_blocks:
    for v in key.data:v.co=inv@adjust(ob.matrix_world@v.co)
  else:
   for v in mesh.vertices:
    before=v.co.copy();v.co=inv@adjust(ob.matrix_world@v.co);changed+=int((before-v.co).length>1e-8)
  mesh.update()
  if move_bones:
   rigs={m.object for m in ob.modifiers if m.type=='ARMATURE'and m.object}
   for rig in rigs:
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT');rinv=rig.matrix_world.inverted()
    for bone in rig.data.edit_bones:bone.head=rinv@adjust(rig.matrix_world@bone.head);bone.tail=rinv@adjust(rig.matrix_world@bone.tail)
    bpy.ops.object.mode_set(mode='OBJECT')
  self.report.setdefault('operations',[]).append({'type':'stretch','mesh':name,'axis':axis,'factor':factor,'changedVertices':changed,'adjustedRestBones':move_bones})
  return changed
 def texture_preview(self,name):
  im=bpy.data.images.get(name)
  if not im or not im.size[0]:raise ValueError('贴图不存在或无法读取：'+name)
  copy=im.copy();ratio=min(1,1024/max(copy.size));copy.scale(max(1,int(copy.size[0]*ratio)),max(1,int(copy.size[1]*ratio)))
  file=Path(self.job['jobDir'])/('texture-'+str(len(self.images))+'.png');copy.file_format='PNG';copy.filepath_raw=str(file);copy.save();bpy.data.images.remove(copy);self.images.append({'path':str(file),'label':'texture: '+name});return '贴图预览已返回'
 def render(self,view='front',clip='',phase=.5,checker=False):
  objects=list(bpy.context.scene.objects);bindings=w.clip_bindings(objects);w.clear_animation(objects)
  if clip:
   if clip not in bindings:raise ValueError('动作不存在：'+clip)
   w.activate(bindings[clip]);start=min(a.frame_range[0]for _,a,_ in bindings[clip]);end=max(a.frame_range[1]for _,a,_ in bindings[clip]);bpy.context.scene.frame_set(int(start+(end-start)*max(0,min(phase,1))))
  meshobjs=[o for o in objects if o.type=='MESH'];box=w.bounds(meshobjs);center=w.to_blender([(a+b)/2 for a,b in zip(box['min'],box['max'])]);extent=max(b-a for a,b in zip(box['min'],box['max']));extent=max(.01,extent)
  scene=bpy.context.scene;old_camera=scene.camera;old_world=scene.world;created=[];materials=[]
  try:
   world=bpy.data.worlds.new('ReviewWorld');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.15,.18,.23,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.8;scene.world=world
   camdata=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',camdata);scene.collection.objects.link(cam);created.append(cam);camdata.type='ORTHO';camdata.ortho_scale=extent*1.35
   points={'front':(0,-1,.15),'back':(0,1,.15),'side':(1,0,.15),'left':(-1,0,.15),'top':(0,0,1),'perspective':(1,-1,.6)};direction=Vector(points.get(view,points['perspective']));cam.location=center+direction.normalized()*extent*3;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
   for pos,power in [((1,-2,3),850),((-2,-1,1),500),((0,2,2),700)]:
    light=bpy.data.lights.new('ReviewLight','AREA');light.energy=power*extent**2;light.shape='DISK';light.size=extent*2;ob=bpy.data.objects.new('ReviewLight',light);scene.collection.objects.link(ob);created.append(ob);ob.location=center+Vector(pos)*extent;ob.rotation_euler=(center-ob.location).to_track_quat('-Z','Y').to_euler()
   if checker:
    mat=bpy.data.materials.new('UV Review');mat.use_nodes=True;nodes=mat.node_tree.nodes;check=nodes.new('ShaderNodeTexChecker');check.inputs['Scale'].default_value=20;uv=nodes.new('ShaderNodeTexCoord');mat.node_tree.links.new(uv.outputs['UV'],check.inputs['Vector']);mat.node_tree.links.new(check.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    for ob in meshobjs:
     materials.append((ob,list(ob.data.materials)));ob.data.materials.clear();ob.data.materials.append(mat)
   scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';file=Path(self.job['jobDir'])/('review-'+str(len(self.images))+'.png');scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);self.images.append({'path':str(file),'label':f'{view} clip={clip} phase={phase} checker={checker}'})
  finally:
   scene.camera=old_camera;scene.world=old_world
   for ob,mats in materials:ob.data.materials.clear();[ob.data.materials.append(m)for m in mats]
   for ob in created:bpy.data.objects.remove(ob,do_unlink=True)
   w.clear_animation(objects)
  return '渲染图已返回'

def main(job):
 # The main process stages GLB and (when available) the packed .blend in this job.
 if job.get('blendInput'):
  bpy.ops.wm.open_mainfile(filepath=job['blendInput'],load_ui=False,use_scripts=False)
 else:w.import_glb(job['input'])
 objects=list(bpy.context.scene.objects);bindings=w.clip_bindings(objects);w.clear_animation(objects);before=w.summary(objects,bindings);before_hash=digest(objects)
 context=EditContext(job)
 if job['task']=='scene':
  data=detailed(objects,job.get('region'))
  for name in job.get('textures',[])[:4]:context.texture_preview(name)
  for view in job.get('views',[])[:4]:context.render(view=view,clip=job.get('clip',''),phase=job.get('phase',.5),checker=job.get('checker',False))
  return {'details':data,'images':context.images}
 code=job['code'];tree=validate_code(code);Path(job['jobDir'],'agent_edit.py').write_text(code,encoding='utf8')
 allowed={k:v for k,v in vars(builtins).items()if k not in BLOCKED_NAMES and not k.startswith('_')}
 def safe_import(name,globals=None,locals=None,fromlist=(),level=0):
  if level or name.split('.')[0]not in ALLOWED_IMPORTS:raise ImportError('模块未开放：'+name)
  return builtins.__import__(name,globals,locals,fromlist,level)
 allowed['__import__']=safe_import
 env={'__builtins__':allowed,'bpy':bpy,'bmesh':bmesh,'Vector':Vector,'Matrix':Matrix,'math':math,'studio':context,'to_blender':w.to_blender,'to_gltf':w.to_gltf}
 w.event('在独立副本执行 Blender 编辑脚本',.3);exec(compile(tree,'agent_edit.py','exec'),env,env)
 if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
 objects=[o for o in bpy.context.scene.objects if o.type in{'MESH','ARMATURE','EMPTY'}];bpy.context.view_layer.update();after_hash=digest(objects)
 for ob in objects:
  if ob.type=='MESH':
   if not all(math.isfinite(x)for v in ob.data.vertices for x in v.co):raise ValueError('编辑产生非有限网格坐标，未发布结果')
   if any(m.type=='ARMATURE'and m.object for m in ob.modifiers):
    rigs={b.name for m in ob.modifiers if m.type=='ARMATURE'and m.object for b in m.object.data.bones if b.use_deform};groups={g.index for g in ob.vertex_groups if g.name in rigs};missing=sum(not any(g.group in groups and g.weight>1e-5 for g in v.groups)for v in ob.data.vertices)
    if missing:raise ValueError(f'{ob.name} 有 {missing} 个顶点没有变形骨骼权重，未发布结果')
 if not any(o.type=='MESH'and len(o.data.polygons)for o in objects):raise ValueError('编辑后没有可导出的模型')
 warnings=['编辑脚本已在副本执行；数值检查不代表动作和纹理的视觉质量已通过。']
 changed=[name for name,value in after_hash.items()if before_hash.get(name)!=value]
 report={'binding':'Blender Python 编辑','description':job.get('description',''),'before':before_hash,'after':after_hash,'changedMeshes':changed,'details':context.report,'warnings':warnings,'clips':[],'samples':[]}
 newbindings=w.clip_bindings(objects);w.clear_animation(objects);durations={c['name']:c['duration']for c in w.summary(objects,newbindings)['animations']}
 baseline={c['name']:c['duration']for c in before['animations']};input_durations={c['name']:c['duration']for c in job.get('inputAnimations',[])}
 for name,duration in list(durations.items()):
  if name in input_durations and abs(duration-baseline.get(name,-1))<1e-5:durations[name]=input_durations[name]
 bpy.context.scene.frame_start=min(0,math.floor(min((a.frame_range[0]for items in newbindings.values()for _,a,_ in items),default=0)))
 bpy.context.scene.frame_end=max(1,math.ceil(max((a.frame_range[1]for items in newbindings.values()for _,a,_ in items),default=1)))
 out=Path(job['jobDir'])/'edited.glb';blend=Path(job['jobDir'])/'project.blend'
 bpy.ops.object.select_all(action='DESELECT')
 for ob in objects:ob.select_set(True)
 bpy.context.view_layer.objects.active=next(o for o in objects if o.type=='MESH')
 bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend));w.event('导出编辑版本并重新读取验证',.8)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_frame_range=False,export_anim_slide_to_zero=True,export_yup=True,export_skins=True,export_morph=True,export_morph_animation=True,export_materials='EXPORT',export_image_format='AUTO',export_force_sampling=True)
 w.restore_clip_durations(out,durations,normalize_start=True)
 bpy.ops.wm.read_factory_settings(use_empty=True);loaded=w.import_glb(out);clips=w.clip_bindings(loaded);w.clear_animation(loaded);after=w.summary(loaded,clips)
 lost=set(c['name']for c in before['animations'])-set(c['name']for c in after['animations'])
 if lost and not job.get('allowAnimationRemoval',False):raise ValueError('编辑导出丢失原有动作：'+', '.join(lost)+'。如确需删除必须显式允许。')
 for clip in after['animations']:
  expected=durations.get(clip['name'])
  if expected is not None and abs(clip['duration']-expected)>max(.002,expected*.001):raise ValueError('编辑导出动作时长改变：'+clip['name'])
 report['clips']=after['animations'];report['reloaded']=True;report['outputSummary']=after;report['bytes']=out.stat().st_size
 if lost:report['warnings'].append('按编辑指令移除动作：'+', '.join(lost))
 Path(job['jobDir'],'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 return {'output':str(out),'blend':str(blend),'summary':after,'report':report,'images':context.images}
