import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Asset = {parts:string[];bytes:number};
export function createCharacterRenderer(host:HTMLElement, asset:Asset, mobile:boolean, status:(message:string)=>void){
 const renderer=new THREE.WebGLRenderer({antialias:!mobile,alpha:true});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,mobile?1.25:2));
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,100);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=false;
 const abort=new AbortController();let modelWidth=1.8;let disposed=false,model:THREE.Object3D|null=null;
 host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D character. Drag to rotate; pinch or scroll to zoom.');
 scene.add(new THREE.HemisphereLight(0xd9f4ff,0x394451,2.4));
 const key=new THREE.DirectionalLight(0xffeddd,1.7);key.position.set(3,4,4);scene.add(key);
 const rim=new THREE.DirectionalLight(0x65cbd9,.65);rim.position.set(-3,2,-2);scene.add(rim);
 function render(){if(!disposed&&!document.hidden)renderer.render(scene,camera);}
 function reset(){const distance=Math.max(.9,.5*modelWidth/camera.aspect)/Math.tan(THREE.MathUtils.degToRad(17.5))*1.15;camera.position.set(0,.9,distance);controls.target.set(0,.9,0);controls.minDistance=.7;controls.maxDistance=Math.max(7,distance*2);controls.update();render();}
 function resize(){const {width,height}=host.getBoundingClientRect();camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();renderer.setSize(width,height);reset();}
 function release(root:THREE.Object3D){
  const textures=new Set<THREE.Texture>(),materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
  root.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;geometries.add(m.geometry);for(const mat of Array.isArray(m.material)?m.material:[m.material]){materials.add(mat);for(const value of Object.values(mat))if(value instanceof THREE.Texture)textures.add(value);}
   if((m as THREE.SkinnedMesh).isSkinnedMesh)(m as THREE.SkinnedMesh).skeleton.dispose();});
  for(const t of textures){t.dispose();const image=t.source.data;if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap)image.close();}
  materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
 }
 function lost(e:Event){e.preventDefault();status('3D was interrupted. Try again, or return to the cinematic game.');}
 renderer.domElement.addEventListener('webglcontextlost',lost);
 controls.addEventListener('change',render);document.addEventListener('visibilitychange',render);
 const observer=new ResizeObserver(resize);observer.observe(host);reset();resize();
 const timeout=setTimeout(()=>abort.abort(),90000);
 void(async()=>{
  try{
   const chunks:Uint8Array[]=[];let loaded=0;
   for(const part of asset.parts){const response=await fetch(part,{signal:abort.signal});if(!response.ok)throw new Error('Model download failed');const chunk=new Uint8Array(await response.arrayBuffer());chunks.push(chunk);loaded+=chunk.length;if(!disposed)status(`Loading character · ${Math.round(loaded/asset.bytes*100)}%`);}
   if(disposed)return;const joined=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
   const gltf=await new GLTFLoader().parseAsync(joined.buffer,'');if(disposed){release(gltf.scene);return;}
   model=gltf.scene;
   // Preview-only response for skin and fabric. Keep source GLBs and maps intact.
   model.traverse(object=>{
    const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
     if(!(material instanceof THREE.MeshStandardMaterial))continue;
     material.metalness=0;
     material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.78);'
     );};
     material.customProgramCacheKey=()=> 'tmb-character-matte-v1';
     material.needsUpdate=true;
    }
   });
   const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
   const scale=1.8/Math.max(size.y,.001);modelWidth=size.x*scale;model.scale.multiplyScalar(scale);model.position.add(new THREE.Vector3(-center.x*scale,-bounds.min.y*scale,-center.z*scale));
   scene.add(model);reset();status('Ready · Drag to rotate. Pinch or scroll to zoom.');
  }catch{if(!disposed)status('Could not load this character. Try again or choose Mobile 1K.');}
  finally{clearTimeout(timeout);}
 })();
 return {reset,rotate:(direction:number)=>{if(model){model.rotation.y+=direction*Math.PI/8;render();}},dispose:()=>{disposed=true;clearTimeout(timeout);abort.abort();observer.disconnect();controls.dispose();document.removeEventListener('visibilitychange',render);renderer.domElement.removeEventListener('webglcontextlost',lost);if(model)release(model);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
