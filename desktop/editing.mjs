import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';

export async function imageResults(result){
 const images=[],labels=[];for(const item of (result.images||[]).slice(0,6)){
  const file=path.resolve(item.path),root=path.resolve(result.jobDir)+path.sep;if(!file.startsWith(root)||path.extname(file)!=='.png')throw Error('检查图片路径无效');
  const data=await fs.readFile(file);if(data.length>2_100_000)continue;images.push('data:image/png;base64,'+data.toString('base64'));labels.push(item.label);
 }return {images,labels};
}
export async function inspectScene(studio,{assetId,region,views=[],textures=[],clip='',phase=.5,checker=false}){
 const asset=studio.asset(assetId);
 if(region&&(['min','max'].some(k=>!Array.isArray(region[k])||region[k].length!==3||!region[k].every(Number.isFinite))||region.min.some((v,i)=>v>region.max[i])))throw Error('局部区域坐标无效');
 if(!Array.isArray(views)||views.length>4||views.some(v=>!['front','side','back','left','top','perspective'].includes(v))||!Array.isArray(textures)||textures.length>4)throw Error('检查视角或贴图数量无效');
 if(!Number.isFinite(phase)||phase<0||phase>1)throw Error('动作相位无效');
 const previous=studio.runs.find(r=>r.assetId===assetId),blendInput=previous?path.join(previous.jobDir,'project.blend'):undefined;
 const result=await studio.run('scene',{input:asset.path,blendInput,stageInput:true,inputAssetId:assetId,region,views,textures,clip,phase,checker});const media=await imageResults(result);return {data:{...result.details,imageLabels:media.labels},images:media.images};
}
export async function editModel(studio,{assetId,code,description='',sourceId='',allowAnimationRemoval=false}){
 const asset=studio.asset(assetId);if(typeof code!=='string'||!code.trim()||code.length>60000)throw Error('编辑脚本需要 1–60000 字符');
 if(sourceId)studio.asset(sourceId);
 const previous=studio.runs.find(r=>r.assetId===assetId),blendInput=previous?path.join(previous.jobDir,'project.blend'):undefined;
 const result=await studio.run('python',{input:asset.path,blendInput,stageInput:true,inputAssetId:assetId,inputAnimations:asset.animations,code,description:String(description).slice(0,2000),allowAnimationRemoval:allowAnimationRemoval===true});
 const stat=await fs.stat(result.output),id=randomUUID(),now=new Date().toISOString();const output={...result.summary,id,name:(description||asset.name.replace(/\.glb$/i,'')+' · 编辑').slice(0,100)+'.glb',path:result.output,bytes:stat.size,role:'result',createdAt:now};
 const run={id,assetId:id,sourceId:sourceId||previous?.sourceId||'',targetId:assetId,kind:'edit',createdAt:now,clips:output.animations.map(a=>a.name),report:result.report,jobDir:result.jobDir};
 studio.assets.set(id,output);studio.runs.unshift(run);await studio.persist();return {asset:output,run,...await imageResults(result)};
}
export const blenderHelp=`Blender editing tools operate on a fresh copy and preserve all completed versions. inspect_blender_scene returns mesh names, WORLD glTF +Y-up bounds, sampled vertex indices/positions/weights, UV density, materials, textures, shape keys, bones. Use region_json {min:[x,y,z],max:[x,y,z]} to inspect a local area. views renders locally (CPU, may take time); textures returns named actual texture images. checker=true replaces materials temporarily with a UV checker only in review renders.
execute_blender_python runs Python within local Blender on input/target/result, exports GLB + packed .blend + script + validation report. Use bpy, bmesh, mathutils, numpy, math, json, statistics, itertools, collections, random; no OS/shell/network/file access. Available globals bpy,bmesh,Vector,Matrix,math,studio,to_blender,to_gltf. Blender native coords are Z-up; to_blender([x,y,z]) converts WORLD glTF Y-up into Blender coordinates, to_gltf(Vector) converts back. Mesh vertex .co is OBJECT LOCAL, use matrix_world to transform. Never reuse normalized preview coordinates.
studio.inspect(region=None): details; studio.mesh(name): bpy mesh object; studio.report is a JSON-serializable dictionary for measured results; studio.stretch(name,axis,pivot,start,end,factor,side=1,move_bones=False): smooth local elongation in WORLD glTF axis (0=X,1=Y,2=Z). Distance=side*(coordinate-pivot), blend rises smoothly from start to end; displacement=(coordinate-pivot)*(factor-1)*blend. Adjusts all shape keys; optional rest bone head/tail deformation. Use actual anatomy, not whole-object scaling. Review rest bones, weights and animation afterwards.
studio.texture_preview(image_name): adds a texture screenshot to result. studio.render(view='front',clip='',phase=.5,checker=False): adds a real render; front=glTF +Z, side=+X, back=-Z, left=-X, top=+Y, perspective. Up to six images returned. Default output preserves animation names, skin weights and morphs; failed weight/nonfinite checks or lost animations reject result. allow_animation_removal only if user explicitly requested deletion. Modifiers/constraints that GLB cannot represent need applying/baking; .blend retains editable data. No blanket promise that editing UV repairs painted textures. Inspect before editing, quantify actual changed region and compare real renders before claiming quality. Failed scripts return errors; fix and retry. Original meshes/weights/UV/materials stay unchanged unless requested. Existing edit_bones changes only rigging-plan coordinates, not mesh. To reshape, paint weights, edit rest bones, create morphs/IK/materials/UV or bake animation use execute_blender_python. Do not imply every UI-only Blender/add-on feature works in headless mode.`;
