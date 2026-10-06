import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createLabPlayer,type Person,type PlayerPoses} from './lab-player';
import {visibleForInteraction} from './lab-interaction';
import {chapterOneShot} from './lab-direction';
import {walkable,findInteractionPoint} from './lab-navigation';
import {prepareSeatedSarah} from './seated-skin';
import {buildLab} from './lab-room';
import {spareChairHome,chairRetrievalPosition} from './lab-layout';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createBodyMotion} from './body-motion';
import { assetUrl } from '../../../lib/asset-url';
import { assertCompatibleRig } from './rig-contract';
import chapterCues from '../data/chapter1-cues.json';
import {labShot,measureEyeMount,firstPersonShot,type EyeMount,type LabView,type CameraGesture} from './lab-camera';
export type {LabView,CameraGesture} from './lab-camera';
import {jackOpening} from './jack-opening';
const staging=chapterCues.staging;

export type LabFrame={sceneId:string;queue:string;line:number;done:string[];speaker:string;sourceIndex?:number;elapsed?:number;paused:boolean;reducedMotion:boolean;interactive:boolean};
type Events={status:(text:string)=>void;ready:()=>void;arrived:()=>void;interact:(target:string)=>void;failed:()=>void;staging:(busy:boolean)=>void;control:(person:Person,message:string)=>void;view:(view:LabView)=>void};
export function createLabRenderer(host:HTMLElement,mobile:boolean,events:Events){
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=T.PCFSoftShadowMap;
 host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D TOMBS laboratory. Drag to look around; tap the terminal, communicator, or Sarah to interact.');
 const scene=new T.Scene();scene.background=new T.Color(0x09151d);scene.fog=new T.Fog(0x09151d,10,24);
 scene.add(new T.HemisphereLight(0xd5e9f4,0x40505b,2.3));
 const light=new T.DirectionalLight(0xffeed8,2.4);light.position.set(1,5,3);light.castShadow=!mobile;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-5;light.shadow.camera.right=5;light.shadow.camera.top=5;light.shadow.camera.bottom=-5;light.shadow.normalBias=.025;scene.add(light);
 const fill=new T.PointLight(0x53bacc,12,8,2);fill.position.set(-2,2,-1);scene.add(fill);
 const pmrem=new T.PMREMGenerator(renderer),environmentRoom=new RoomEnvironment();
 const environment=pmrem.fromScene(environmentRoom,.04);scene.environment=environment.texture;scene.environmentIntensity=.45;environmentRoom.dispose();pmrem.dispose();
 const room=buildLab(scene,mobile);
 const camera=new T.PerspectiveCamera(42,1,.05,35),controls=new OrbitControls(camera,renderer.domElement);
 controls.enablePan=true;controls.enableDamping=false;controls.minDistance=.45;controls.maxDistance=18;controls.zoomSpeed=.65;controls.rotateSpeed=.6;controls.panSpeed=.6;controls.maxPolarAngle=Math.PI*.48;controls.minPolarAngle=.25;
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),150000);
 let frame:LabFrame={sceneId:'alarm',queue:'wake',line:0,done:[],speaker:'',paused:false,reducedMotion:false,interactive:false};
 let closed=false,loaded=false,arrival=0,arrivalReported=false,clock=0,last=performance.now(),lastDraw=0,raf=0,autoCamera=true,view:LabView='room',blackUntil=0,approach=0,chairPull=0,jackGaze=0,sarahGaze=0,lastSource=0;
 const player=createLabPlayer(),keys=new Set<string>();let touchDirection={x:0,z:0};
 const marker=new T.Mesh(new T.RingGeometry(.15,.18,32),new T.MeshBasicMaterial({color:0x93ead7,transparent:true,opacity:.8,side:T.DoubleSide}));
 marker.rotation.x=-Math.PI/2;marker.position.y=.015;marker.visible=false;scene.add(marker);
 const selectedRing=new T.Mesh(new T.RingGeometry(.24,.26,32),new T.MeshBasicMaterial({color:0x93ead7,transparent:true,opacity:.55,side:T.DoubleSide}));
 selectedRing.rotation.x=-Math.PI/2;selectedRing.visible=false;scene.add(selectedRing);
 const desiredPos=new T.Vector3(),desiredTarget=new T.Vector3();
 let jack:T.Object3D|null=null,sarah:T.Object3D|null=null,jackMotion:ReturnType<typeof createBodyMotion>|null=null,sarahMotion:ReturnType<typeof createBodyMotion>|null=null;
 const eyeMounts:Partial<Record<Person,EyeMount>>={};let lookYaw=Math.PI,lookPitch=-.12;
 let desiredFov=48,webcamSpeaker='jack',directed=true,lastShot=-1;
 const targetFor=(selected:LabView)=>{
  if(selected==='firstperson')return;
  const shot=labShot(selected,camera.aspect,webcamSpeaker,['sarah','revoked'].includes(frame.sceneId));
  desiredPos.copy(shot.position);desiredTarget.copy(shot.target);desiredFov=shot.fov;
 };
 function applyView(selected:LabView){events.view(selected);controls.enableDamping=false;controls.update();view=selected;autoCamera=true;controls.enabled=!frame.paused&&view!=='firstperson';if(view==='firstperson'){const actor=player.selected==='jack'?jack:sarah;if(actor)lookYaw=actor.rotation.y;lookPitch=-.12;}targetFor(view);if(frame.reducedMotion&&view!=='firstperson'){camera.position.copy(desiredPos);controls.target.copy(desiredTarget);camera.fov=desiredFov;camera.updateProjectionMatrix();controls.update();}}
 function setView(selected:LabView){directed=false;applyView(selected);}
 function setGesture(selected:CameraGesture){controls.mouseButtons.LEFT=selected==='pan'?T.MOUSE.PAN:T.MOUSE.ROTATE;controls.touches.ONE=selected==='pan'?T.TOUCH.PAN:T.TOUCH.ROTATE;}
 function zoom(factor:number){if(view==='firstperson')return;directed=false;autoCamera=false;const offset=camera.position.clone().sub(controls.target);offset.setLength(T.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();}
 function resize(){const b=host.getBoundingClientRect();renderer.setSize(b.width,Math.max(1,b.height));camera.aspect=b.width/Math.max(1,b.height);camera.updateProjectionMatrix();targetFor(view);if(!loaded){camera.position.copy(desiredPos);controls.target.copy(desiredTarget);camera.fov=desiredFov;camera.updateProjectionMatrix();controls.update();}}
 const observer=new ResizeObserver(resize);observer.observe(host);resize();
 const dragStart=()=>{autoCamera=false;controls.enableDamping=!frame.reducedMotion;controls.dampingFactor=.12;};controls.addEventListener('start',dragStart);
 function poses():PlayerPoses{
  const pose=(actor:T.Object3D|null)=>({x:actor?.position.x??0,z:actor?.position.z??0,yaw:actor?.rotation.y??Math.PI,seat:actor?T.MathUtils.clamp(-actor.position.y/.35,0,1):0,visible:!!actor?.visible});
  return {jack:pose(jack),sarah:pose(sarah)};
 }
 function selectPerson(person:Person){
  if(player.select(person)){keys.clear();touchDirection={x:0,z:0};marker.visible=false;applyView('firstperson');events.control(person,`Controlling ${person==='jack'?'Jack':'Sarah'}. Tap the floor to walk.`);}
 }
 function requestInteraction(target:string,action=target){
  if(!frame.interactive||frame.paused||!loaded)return;
  const current=player.snapshot(),person=player.selected;
  const point=target==='sarah'?findInteractionPoint(current[person],current[person==='jack'?'sarah':'jack']):target==='comm'?{x:.8,z:.75}:person==='sarah'?{x:-1.8,z:.65}:{x:-.9,z:.65};
  if(point&&player.goTo(point,action)){applyView('firstperson');marker.position.set(point.x,.015,point.z);marker.visible=true;events.control(person,'Walking to the interaction…');}
  else events.control(person,'That spot is blocked. Try another position.');
 }
 function keyDown(e:KeyboardEvent){
  if(!frame.interactive||frame.paused||!loaded||e.ctrlKey||e.metaKey||e.altKey||['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName))return;
  const k=e.key.toLowerCase();if((e.target as HTMLElement)?.tagName==='BUTTON'&&['enter',' '].includes(k))return;if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){e.preventDefault();keys.add(k);marker.visible=false;if(view!=='firstperson')applyView('firstperson');}
  if(k==='c'&&!e.repeat){e.preventDefault();selectPerson(player.selected==='jack'?'sarah':'jack');}
 }
 const keyUp=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase()),clearKeys=()=>{keys.clear();touchDirection={x:0,z:0};};
 window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',clearKeys);
 const raycaster=new T.Raycaster();let pointer:{x:number;y:number;id:number}|null=null;const pointers=new Set<number>();let dragged=false;let lastPointer={x:0,y:0};
 function down(e:PointerEvent){if(view==='firstperson')renderer.domElement.setPointerCapture(e.pointerId);lastPointer={x:e.clientX,y:e.clientY};pointers.add(e.pointerId);if(pointers.size===1){pointer={x:e.clientX,y:e.clientY,id:e.pointerId};dragged=false;}else {dragged=true;directed=false;}}
 function move(e:PointerEvent){if(view==='firstperson'&&pointer&&pointers.size===1&&!frame.paused){lookYaw-=(e.clientX-lastPointer.x)*.004;lookPitch=T.MathUtils.clamp(lookPitch-(e.clientY-lastPointer.y)*.004,-1.55,1.05);lastPointer={x:e.clientX,y:e.clientY};}if(pointer&&Math.hypot(pointer.x-e.clientX,pointer.y-e.clientY)>7){dragged=true;directed=false;}}
 function cancel(e:PointerEvent){pointers.delete(e.pointerId);pointer=null;dragged=true;}
 function up(e:PointerEvent){
  pointers.delete(e.pointerId);const start=pointer;pointer=null;
  if(!start||dragged||pointers.size||start.id!==e.pointerId||Math.hypot(start.x-e.clientX,start.y-e.clientY)>7||!loaded||frame.paused||!frame.interactive)return;
  const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  for(const hit of raycaster.intersectObjects(scene.children,true)){
   if(!visibleForInteraction(hit.object))continue;
   let object:T.Object3D|null=hit.object;while(object&&!object.userData.target)object=object.parent;
   if(object?.userData.target){requestInteraction(object.userData.target);return;}
   // Opaque surfaces occlude controls; do not activate through desks or walls.
   if(hit.object instanceof T.Mesh){
    if(Math.abs(hit.point.y)<.1&&walkable(hit.point)&&player.goTo(hit.point)){
     if(view!=='firstperson')applyView('firstperson');marker.position.set(hit.point.x,.015,hit.point.z);marker.visible=true;events.control(player.selected,'Walking · tap a console or choose an objective to interact.');
    }
    break;
   }
  }
 }
 const manualWheel=()=>{directed=false;};renderer.domElement.addEventListener('wheel',manualWheel,{passive:true});
 renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointercancel',cancel);renderer.domElement.addEventListener('pointerup',up);
  function contextLost(e:Event){e.preventDefault();loaded=false;events.status('3D was interrupted. Retry this preview, or use Menu to return to the title.');events.failed();}
 renderer.domElement.addEventListener('webglcontextlost',contextLost);
 function release(root:T.Object3D){
  const textures=new Set<T.Texture>(),materials=new Set<T.Material>(),geometries=new Set<T.BufferGeometry>(),skeletons=new Set<T.Skeleton>();
  root.traverse(o=>{const m=o as T.Mesh;if(!m.isMesh)return;geometries.add(m.geometry);if((m as T.SkinnedMesh).isSkinnedMesh)skeletons.add((m as T.SkinnedMesh).skeleton);for(const mat of Array.isArray(m.material)?m.material:[m.material]){materials.add(mat);Object.values(mat).forEach(v=>{if(v instanceof T.Texture)textures.add(v);});}});
  skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();const im=t.source.data;if(typeof ImageBitmap!=='undefined'&&im instanceof ImageBitmap)im.close();});
 }
 const total=2984300+2707620;let bytes=0;
 async function load(person:'jack'|'sarah'){
  const response=await fetch(assetUrl(`/assets/lab3d/${person}.glb`),{signal:abort.signal});if(!response.ok)throw new Error(`${person} model unavailable (HTTP ${response.status})`);
  const array=await response.arrayBuffer();bytes+=array.byteLength;if(!closed)events.status(`Loading ${person==='jack'?'Jack':'Sarah'} · ${Math.round(bytes/total*100)}%`);
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(array,'');if(closed){release(gltf.scene);throw new Error('Closed');}
  const actor=gltf.scene;assertCompatibleRig(actor,person);eyeMounts[person]=measureEyeMount(actor);if(person==='sarah')prepareSeatedSarah(actor);
  actor.traverse(o=>{const m=o as T.Mesh;if(!m.isMesh)return;for(const mat of Array.isArray(m.material)?m.material:[m.material])for(const value of Object.values(mat))if(value instanceof T.Texture)value.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});
  actor.traverse(o=>{const mesh=o as T.Mesh;if(!mesh.isMesh)return;mesh.castShadow=!mobile;mesh.receiveShadow=false;mesh.frustumCulled=false;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(m instanceof T.MeshStandardMaterial){m.metalness=0;m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.78);');};m.customProgramCacheKey=()=> 'tmb-lab-matte-v1';}});
  scene.add(actor);return actor;
 }
 void(async()=>{
  try{
   jack=await load('jack');jackMotion=createBodyMotion(jack);jack.position.set(-.9,-.35,.45);jack.rotation.y=Math.PI;
   sarah=await load('sarah');sarahMotion=createBodyMotion(sarah);sarah.userData.target='sarah';sarah.visible=false;
   if(closed)return;loaded=true;events.status('');events.ready();
  }catch(error){if(!closed){console.error('Laboratory character loading failed',error);events.status(`Could not load the laboratory characters: ${error instanceof Error?error.message:'unknown error'}. Retry, or use Menu to return to the title.`);events.failed();}}
  finally{clearTimeout(timeout);}
 })();
 function tick(now:number){
  if(closed)return;raf=requestAnimationFrame(tick);const delta=Math.min((now-last)/1000,.06);last=now;
  if(document.hidden)return;
  if(mobile&&now-lastDraw<32)return;const dt=Math.min((now-lastDraw)/1000,.07);lastDraw=now;
  if(loaded&&!frame.paused&&!player.active){
   clock+=mobile?dt:delta;
   const entering=['sarah','revoked'].includes(frame.sceneId),step=mobile?dt:delta;
   if(frame.sourceIndex!==undefined)lastSource=frame.sourceIndex;
   const source=lastSource,blend=1-Math.exp(-step*4),smooth=T.MathUtils.smoothstep;
   if(jack){
    if(source>=staging.chairExchange)chairPull=Math.min(9,chairPull+step);
    const rise=smooth(chairPull,0,1.2),outbound=smooth(chairPull,1.2,3.5),returning=smooth(chairPull,4,7),jackSit=smooth(chairPull,7,9);
    const move=smooth(chairPull,.8,2.8),lower=smooth(chairPull,2.8,4.3);
    const opening=jackOpening(source,frame.elapsed??0,frame.reducedMotion);
    const retrieval=chairRetrievalPosition(outbound*(1-returning));
    jack.position.set(retrieval.x,-.35*(1-rise+jackSit),retrieval.z+opening.roll);
    const exchanging=chairPull>0&&chairPull<9;
    const personal=entering&&!exchanging&&((source>=staging.personal&&source<staging.warning)||source>=165||frame.speaker==='sarah');
    const sarahPersonal=entering&&!exchanging&&((source>=staging.personal&&source<staging.warning)||source>=165||frame.speaker==='jack');
    const jackTurn=personal?-.3:0,sarahTurn=sarahPersonal?.3:0;
    const jackWalking=(chairPull>1.2&&chairPull<3.5)||(chairPull>4&&chairPull<7);
    const jackYaw=jackWalking?(retrieval.yaw+(chairPull<4?0:Math.PI)):Math.PI-jackTurn;
    jack.rotation.y=T.MathUtils.lerp(jack.rotation.y,jackYaw,blend);
    // Jack gives Sarah the original chair. The spare returns to his own screen.
    room.jackChair.root.position.set(T.MathUtils.lerp(-.9,-1.8,move),0,.51+opening.roll);
    room.sarahChair.root.position.set(returning>0?retrieval.x:spareChairHome.x,0,returning>0?T.MathUtils.lerp(retrieval.z-.12,.51,jackSit):spareChairHome.z);
    room.sarahChair.seat.rotation.y=jackSit>0?jack.rotation.y-Math.PI:returning>0?retrieval.yaw:Math.PI;
    if(entering&&sarah){
     sarah.visible=true;arrival=Math.min(1.5,arrival+step);
     if(arrival>=1.5&&!arrivalReported){arrivalReported=true;events.arrived();}
     if(source>=staging.approach)approach=Math.min(5,approach+step);
     const travel=smooth(approach,0,5);
     const first=Math.min(1,travel/.7),second=Math.max(0,(travel-.7)/.3);
     sarah.position.set(T.MathUtils.lerp(T.MathUtils.lerp(2.65,.85,first),-.25,second),-.35*lower,T.MathUtils.lerp(T.MathUtils.lerp(-2.8,.85,first),.65,second));
     if(move>0){sarah.position.x=T.MathUtils.lerp(-.25,-1.8,move);sarah.position.z=T.MathUtils.lerp(.65,.45,move);}
     const targetYaw=approach<5?(travel<.7?-.46:-1.75):Math.PI-sarahTurn;
     sarah.rotation.y=T.MathUtils.lerp(sarah.rotation.y,targetYaw,blend);
     room.jackChair.seat.rotation.y=lower>0?sarah.rotation.y-Math.PI:0;
     room.tablet.visible=source>=staging.tablet;
     room.door.position.x=2.65+1.42*Math.min(smooth(arrival,0,1),1-smooth(approach,2,4));
     const gaze=(actor:T.Object3D,target:T.Object3D)=>{const d=target.position.clone().sub(actor.position);d.y=0;d.applyQuaternion(actor.quaternion.clone().invert());return T.MathUtils.clamp(Math.atan2(d.x,d.z),-.9,.9);};
     jackGaze=T.MathUtils.lerp(jackGaze,personal?gaze(jack,sarah):0,blend);
     sarahGaze=T.MathUtils.lerp(sarahGaze,sarahPersonal?gaze(sarah,jack):0,blend);
     sarahMotion?.pose(clock,lower>0?'seated':approach>0&&approach<5?'walk':'idle',frame.speaker==='sarah',lower>.95&&!sarahPersonal,frame.reducedMotion,sarahGaze,lower);
     if(chairPull>4&&chairPull<7)room.sarahChair.wheels.forEach(w=>w.rotateY(step*3));
    }
    if(opening.roll>0)room.jackChair.wheels.forEach(w=>w.rotation.y=opening.roll/.048);
    if(chairPull>.8&&chairPull<2.8)room.jackChair.wheels.forEach(w=>w.rotateY(step*3));
    jackMotion?.pose(clock,jackWalking?'walk':rise>.99&&jackSit===0?'idle':'seated',frame.speaker==='jack',!exchanging&&!personal&&source>5,frame.reducedMotion,jackGaze,1-rise+jackSit,opening);
   }
  }
  if(loaded&&player.active&&jack&&sarah){
   const returning=player.returning;player.tick(dt,frame.paused);
   if(!frame.paused&&player.exploring&&(keys.size||touchDirection.x||touchDirection.z)){
    const forward=camera.getWorldDirection(new T.Vector3());forward.y=0;forward.normalize();
    const right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0));
    const x=touchDirection.x+Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
    const z=touchDirection.z+Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown'));
    player.direct({x:forward.x*z+right.x*x,z:forward.z*z+right.z*x},dt);
   }
   if(!frame.paused)clock+=dt;
   const current=player.snapshot();
   for(const person of ['jack','sarah'] as const){
    const actor=person==='jack'?jack:sarah,motion=person==='jack'?jackMotion:sarahMotion,p=current[person];
    actor.position.set(p.x,-.35*p.seat,p.z);actor.rotation.y=p.yaw;actor.visible=p.visible;
    motion?.pose(clock,p.seat>0?'seated':player.walking[person]?'walk':'idle',false,false,frame.reducedMotion,0,p.seat);
   }
   if(autoCamera&&player.exploring&&view==='room'){
    const actor=current[player.selected];const target=new T.Vector3(actor.x,1,actor.z);
    // Keep the same front bearing on rotation; centre the controlled character.
    const offset=labShot('room',camera.aspect).position.sub(labShot('room',camera.aspect).target);
    desiredTarget.copy(target);desiredPos.copy(target).add(offset);
   }
   selectedRing.visible=player.exploring;const actor=current[player.selected];selectedRing.position.set(actor.x,.02,actor.z);
   const interaction=player.takeInteraction();if(interaction){marker.visible=false;events.interact(interaction);}
   if(returning&&!player.returning){if(directed)applyView(chapterOneShot(frame.sourceIndex??lastSource).view);events.staging(false);}
  }else selectedRing.visible=false;
  if(autoCamera&&view==='webcam'&&jack&&!player.active){
   const nearSarah=sarah&&approach>=5;
   if(camera.aspect<1){const subject=nearSarah&&webcamSpeaker==='sarah'?sarah!:jack;desiredTarget.set(subject.position.x,subject.position.y+1.57,subject.position.z);}
   else if(nearSarah)desiredTarget.set((jack.position.x+sarah!.position.x)/2,(jack.position.y+sarah!.position.y)/2+1.57,.5);
   else desiredTarget.set(jack.position.x,jack.position.y+1.57,jack.position.z);
  }
  if(view==='firstperson'&&loaded){const person=player.active?player.selected:'jack',actor=person==='jack'?jack:sarah,mount=eyeMounts[person];if(actor&&mount){const shot=firstPersonShot(actor,mount,lookYaw,lookPitch);desiredPos.copy(shot.position);desiredTarget.copy(shot.target);desiredFov=shot.fov;autoCamera=true;}}
  if(!autoCamera&&!frame.paused)controls.update();
  if(autoCamera&&!frame.paused){const blend=frame.reducedMotion||view==='firstperson'?1:1-Math.exp(-dt*3);camera.position.lerp(desiredPos,blend);controls.target.lerp(desiredTarget,blend);camera.fov=T.MathUtils.lerp(camera.fov,desiredFov,blend);camera.updateProjectionMatrix();if(view==='firstperson'){camera.lookAt(desiredTarget);camera.updateMatrixWorld(true);}else controls.update();}
  room.display(frame.queue,frame.line,frame.done,frame.sourceIndex===staging.lock&&clock<blackUntil);
  room.ceilingFixtures.visible=camera.position.y<2.95;renderer.render(scene,camera);
 }
 raf=requestAnimationFrame(tick);
 return {setMovement:(x:number,z:number)=>{touchDirection={x,z};if(x||z){if(view!=='firstperson')applyView('firstperson');marker.visible=false;}},setView,setGesture,zoom,selectPerson,requestInteraction,resetView:()=>{directed=true;applyView(player.exploring?'firstperson':chapterOneShot(frame.sourceIndex??lastSource).view);},update(next:LabFrame){const changed=next.sceneId!==frame.sceneId;if(next.sourceIndex===staging.lock&&frame.sourceIndex!==staging.lock)blackUntil=clock+3;if(loaded&&next.interactive!==frame.interactive){
   player.setExploring(next.interactive,poses());keys.clear();marker.visible=false;
   if(player.returning){directed=true;events.staging(true);}
   if(next.interactive){applyView('firstperson');events.control(player.selected,'Tap the floor to walk · WASD / arrows on keyboard.');}
  }
  if(next.paused){keys.clear();touchDirection={x:0,z:0};}frame=next;if(next.speaker==='jack'||next.speaker==='sarah')webcamSpeaker=next.speaker;if(view==='webcam'&&autoCamera)targetFor(view);room.display(next.queue,next.line,next.done);controls.enabled=!next.paused&&view!=='firstperson';if(changed)directed=true;
  if(!player.active&&next.sourceIndex!==undefined){const shot=chapterOneShot(next.sourceIndex);if(directed&&(changed||shot.start!==lastShot))applyView(shot.view);lastShot=shot.start;}},dispose(){closed=true;abort.abort();clearTimeout(timeout);cancelAnimationFrame(raf);observer.disconnect();controls.dispose();window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',clearKeys);renderer.domElement.removeEventListener('wheel',manualWheel);renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointermove',move);renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('webglcontextlost',contextLost);release(scene);environment.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
