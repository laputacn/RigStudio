import bpy,sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
parts=[]
for name,loc,scale in [('Body',(0,0,1),(0.5,.3,.8)),('LeftArm',(-1,0,1.5),(.7,.18,.18)),('RightArm',(1,0,1.5),(.7,.18,.18))]:
 bpy.ops.mesh.primitive_cube_add(size=2,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);parts.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();ob=parts[0];ob.name='CharacterMesh'
mat=bpy.data.materials.new('CheckerMaterial');mat.use_nodes=True;image=bpy.data.images.new('QA_Checker',width=64,height=64);image.pixels=[v for y in range(64)for x in range(64)for v in ((.8,.45,.18,1)if(x//8+y//8)%2 else(.15,.4,.7,1))];image.pack();tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color']);ob.data.materials.append(mat)
rigdata=bpy.data.armatures.new('Rig');rig=bpy.data.objects.new('Rig',rigdata);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
root=rigdata.edit_bones.new('Body');root.head=(0,0,.2);root.tail=(0,0,1.8)
for side,x in [('L',-1),('R',1)]:
 b=rigdata.edit_bones.new('Arm.'+side);b.head=(x*.4,0,1.5);b.tail=(x*1.7,0,1.5);b.parent=root
bpy.ops.object.mode_set(mode='OBJECT');groups={n:ob.vertex_groups.new(name=n)for n in ['Body','Arm.L','Arm.R']}
for v in ob.data.vertices:
 p=ob.matrix_world@v.co;name='Arm.L'if p.x<-.5 else 'Arm.R'if p.x>.5 else 'Body';groups[name].add([v.index],1,'REPLACE')
mod=ob.modifiers.new('Skin','ARMATURE');mod.object=rig
rig.animation_data_create();action=bpy.data.actions.new('Wave');rig.animation_data.action=action
for f,angle in [(0,0),(15,.35),(30,0)]:
 for bone in rig.pose.bones:
  bone.rotation_mode='XYZ';bone.rotation_euler.z=angle if bone.name=='Arm.L'else -angle if bone.name=='Arm.R'else 0;bone.keyframe_insert('rotation_euler',frame=f)
slot=rig.animation_data.action_slot;rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='Wave';strip=t.strips.new('Wave',0,action);strip.action_slot=slot;t.mute=True
for b in rig.pose.bones:b.rotation_euler=(0,0,0)
bpy.context.scene.render.fps=30
bpy.ops.export_scene.gltf(filepath=sys.argv[-1],export_format='GLB',export_animation_mode='NLA_TRACKS')
