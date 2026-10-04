import fs from 'node:fs';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
export async function newRigFixture(who){
 const b=fs.readFileSync(new URL('../../public/assets/lab3d/'+who+'.glb',import.meta.url)),n=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+n)),d=structuredClone(doc);
 d.images=[];d.textures=[];d.materials=[{}];for(const m of d.meshes)for(const p of m.primitives)p.material=0;
 d.extensionsRequired=d.extensionsRequired.filter(x=>x!=='EXT_texture_webp');
 const j=Buffer.from(JSON.stringify(d)),pad=Buffer.alloc(Math.ceil(j.length/4)*4,32);j.copy(pad);const bin=b.subarray(20+n),out=Buffer.alloc(20+pad.length+bin.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(pad.length,12);out.writeUInt32LE(0x4e4f534a,16);pad.copy(out,20);bin.copy(out,20+pad.length);
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.length),'');gltf.scene.updateMatrixWorld(true);
 return {root:gltf.scene,doc,blob:b.subarray(28+n)};
}
