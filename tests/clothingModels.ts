/** Headless geometry/rig loader. Removes image references only; never alters positions or topology. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export async function clothingModel(file: string): Promise<THREE.SkinnedMesh> {
  const raw=readFileSync(file), jsonLength=raw.readUInt32LE(12), json=JSON.parse(raw.subarray(20,20+jsonLength).toString());
  const bin=raw.subarray(28+jsonLength);
  delete json.images;delete json.textures;delete json.samplers;
  for(const m of json.materials??[]) { delete m.extensions;delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture} }
  const drop=new Set(['EXT_texture_webp','KHR_texture_basisu','KHR_texture_transform']);
  for(const key of ['extensionsUsed','extensionsRequired'])json[key]=(json[key]??[]).filter((x:string)=>!drop.has(x));
  let text=Buffer.from(JSON.stringify(json));while(text.length%4)text=Buffer.concat([text,Buffer.from(' ')]);
  const b=Buffer.alloc(28+text.length+bin.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);text.copy(b,20);b.writeUInt32LE(bin.length,20+text.length);b.writeUInt32LE(0x004e4942,24+text.length);bin.copy(b,28+text.length);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf=await loader.parseAsync(b.buffer,'');const meshes:THREE.SkinnedMesh[]=[];
  gltf.scene.traverse(n=>{if((n as THREE.SkinnedMesh).isSkinnedMesh)meshes.push(n as THREE.SkinnedMesh)});
  meshes.sort((a,b)=>b.geometry.getAttribute('position').count-a.geometry.getAttribute('position').count);
  if(!meshes[0])throw Error('no skinned mesh in '+file);return meshes[0];
}
