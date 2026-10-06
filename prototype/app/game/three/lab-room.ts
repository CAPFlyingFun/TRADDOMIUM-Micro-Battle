import * as T from 'three';
import {assetUrl} from '../../../lib/asset-url';
import {spareChairHome} from './lab-layout';
import {rearWorkstation} from './jack-opening';

export function buildLab(scene:T.Scene,mobile:boolean){
 // Atlas colour tiles with separate physical material settings; no baked gloss.
 const textures=new T.TextureLoader(),size=mobile?256:512;
 function surface(name:string,color:number,roughness:number,metalness=0){const map=textures.load(assetUrl(`/assets/lab-materials/${name}.${size}.webp`));map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=mobile?2:4;return new T.MeshStandardMaterial({color,map,roughness,metalness});}
 const shell=surface('wall',0xd5e0e4,.72),dark=surface('chair',0x9ba7af,.86),steel=surface('steel',0xc0d0db,.32,.65),top=surface('worktop',0xd1d9dd,.38);
 const floor=surface('floor',0xadb8bc,.3,.12);floor.map!.repeat.set(6,3.5);
 const teal=new T.MeshStandardMaterial({color:0x64c6cb,emissive:0x2e99a4,emissiveIntensity:1.4});
 const warm=new T.MeshStandardMaterial({color:0xf1edda,emissive:0xdadaca,emissiveIntensity:2});
 function box(w:number,h:number,d:number,x:number,y:number,z:number,material:T.Material=dark){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=!mobile;m.receiveShadow=true;scene.add(m);return m;}
 box(12,.16,7,0,-.1,0,floor);
 for(let x=-6;x<=6;x+=1)box(.014,.005,7,x,-.015,0,steel);
 for(let z=-3.5;z<=3.5;z+=1)box(12,.005,.014,0,-.015,z,steel);
 // Rear wall has a real doorway, so Sarah enters through an opening.
 box(7.9,3.3,.18,-2.05,1.65,-3.2,shell);box(2.55,3.3,.18,4.73,1.65,-3.2,shell);box(1.5,.8,.18,2.65,2.9,-3.2,shell);
 box(.18,3.3,6.4,-6,1.65,0,shell);
 for(let x=-5.5;x<1.9;x+=1.05){box(.018,2.8,.05,x,1.6,-3.08,steel);box(.72,.42,.07,x+.4,.4,-3.05,dark);}
 for(const x of [1.9,3.4])box(.07,2.5,.2,x,1.25,-3.08,teal);
 const door=box(1.37,2.45,.10,2.65,1.23,-3.2,dark);
 box(1.05,.08,.12,2.65,2.58,-3.02,teal);
 // Ceiling strips and suspended fixtures frame the cutaway room.
 const ceilingFixtures=new T.Group();scene.add(ceilingFixtures);
 for(const x of [-3.8,0,3.8]){for(const fixture of [box(.35,.10,2.2,x,3.04,-.7,steel),box(.28,.025,2.05,x,2.976,-.7,warm)])ceilingFixtures.attach(fixture);}
 box(2.7,.10,1.1,-.9,.77,-.35,top);
 for(const x of [-2.05,.25])box(.12,.72,.75,x,.36,-.35,steel);
 box(.42,.6,.6,-1.85,.34,-.4,dark);
 box(.08,.34,.08,-.9,1,-.6,steel);box(.43,.04,.26,-.9,.84,-.6,steel);
 box(1.11,.65,.08,-.9,1.3,-.6,dark);
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=576;
 const context=canvas.getContext('2d')!;const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const screen=new T.Mesh(new T.PlaneGeometry(1.03,.57),new T.MeshBasicMaterial({map:texture}));screen.position.set(-.9,1.3,-.552);screen.userData.target='terminal';scene.add(screen);
 const keys=box(.6,.026,.22,-.9,.84,.04,dark);keys.userData.target='terminal';
 for(let row=0;row<4;row++)for(let col=0;col<12;col++)box(.035,.012,.033,-1.15+col*.046,.863,-.035+row*.044,steel);
 const comm=box(.2,.04,.24,.16,.85,.04,teal);comm.userData.target='comm';
 // Rear island is about 3 metres behind Jack's desk. His startled caster
 // roll stops just short of its front edge, exactly as the manuscript describes.
 const rear=rearWorkstation;
 box(rear.width,.08,rear.depth,rear.x,.8,rear.z,top);
 for(const x of [rear.x-.9,rear.x+.9])box(.12,.75,.6,x,.38,rear.z,steel);
 box(.7,.46,.08,rear.x,1.1,rear.z+.08,dark);box(.06,.27,.06,rear.x,.94,rear.z+.08,steel);
 box(.56,.026,.21,rear.x,.855,rear.z-.18,dark);
 // Sarah works at the adjacent console while Jack keeps his own screen.
 box(.06,.31,.06,-1.85,.98,-.58,steel);box(.76,.48,.08,-1.85,1.21,-.58,dark);
 const sarahScreen=new T.Mesh(new T.PlaneGeometry(.69,.41),new T.MeshBasicMaterial({map:texture}));sarahScreen.position.set(-1.85,1.21,-.533);sarahScreen.userData.target='terminal';scene.add(sarahScreen);
 const sarahKeys=box(.55,.026,.22,-1.8,.84,.04,dark);sarahKeys.userData.target='terminal';
 for(let row=0;row<4;row++)for(let col=0;col<11;col++)box(.032,.012,.033,-2.02+col*.044,.863,-.035+row*.044,steel);
 // Two caster chairs: the whole assembly can roll; the upholstered seat swivels.
 function chair(x:number,z:number){
  const root=new T.Group(),seat=new T.Group();scene.add(root);root.position.set(x,0,z);root.add(seat);
  const part=(w:number,h:number,d:number,px:number,py:number,pz:number,mat:T.Material,parent:T.Object3D)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(px,py,pz);parent.add(m);return m;};
  part(.48,.09,.45,0,.48,0,dark,seat);part(.48,.48,.075,0,.79,.24,dark,seat);
  for(const side of [-1,1]){part(.045,.19,.045,side*.28,.57,.08,steel,seat);part(.065,.045,.33,side*.28,.69,.02,dark,seat);}
  const stem=new T.Mesh(new T.CylinderGeometry(.032,.04,.34,16),steel);stem.position.y=.27;root.add(stem);
  const wheels:T.Mesh[]=[];
  for(let i=0;i<5;i++){const angle=i*Math.PI*2/5,leg=new T.Group();leg.rotation.y=angle;root.add(leg);part(.04,.045,.32,0,.11,.16,steel,leg);
   const wheel=new T.Mesh(new T.CylinderGeometry(.048,.048,.05,16),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(0,.048,.33);leg.add(wheel);wheels.push(wheel);}
  return {root,seat,wheels};
 }
 const jackChair=chair(-.9,.51),sarahChair=chair(spareChairHome.x,spareChairHome.z);
 const tablet=box(.25,.018,.34,-.38,.845,-.1,dark);tablet.visible=false;
 // Layout D: central paired cinematic station, perimeter equipment and an
 // auxiliary desk at front left; the right-hand aisle stays open for play.
 box(3.8,.82,.66,-1.7,.41,-2.6,shell);box(3.95,.07,.8,-1.7,.86,-2.6,top);
 for(const x of [-3.1,-2.3,-1.5,-.7]){box(.02,.65,.04,x,.4,-2.25,steel);box(.28,.025,.045,x+.3,.67,-2.24,steel);}
 for(const x of [-5.5,5.5]){
  box(.75,.8,4.8,x,.4,-.15,shell);box(.85,.07,4.9,x,.84,-.15,top);
  box(.75,.05,4.8,x,1.7,-.15,steel);
  for(let i=0;i<5;i++){const z=-2+i*.86;box(.42,.28,.4,x,1.88,z,dark);box(.028,.12,.22,x+(x<0?.22:-.22),1.9,z,teal);}
 }
 box(1.55,.08,.78,-4.3,.8,1.7,top);for(const x of [-4.9,-3.7])box(.11,.75,.65,x,.38,1.7,steel);
 box(.62,.42,.08,-4.3,1.1,1.48,dark);box(.5,.025,.2,-4.3,.86,1.88,steel);chair(-4.3,2.35);
 for(const x of [-4.65,.9]){
  box(.65,2.1,.58,x,1.05,-2.6,dark);
  for(let i=0;i<7;i++){box(.57,.15,.04,x,.26+i*.26,-2.29,steel);box(.025,.025,.02,x+.22,.26+i*.26,-2.26,teal);}
 }
 // Low-poly foliage needs neither extra models nor transparent full-screen layers.
 const leafShape=new T.Shape();leafShape.moveTo(0,0);leafShape.bezierCurveTo(-.18,.18,-.13,.38,0,.55);leafShape.bezierCurveTo(.13,.38,.18,.18,0,0);const leafGeometry=new T.ShapeGeometry(leafShape,4);
 const leaf=new T.MeshStandardMaterial({color:0x487c51,roughness:.9,side:T.DoubleSide});
 for(const [x,z] of [[-5.5,2.4],[5.5,2.4],[-3.9,-2.55],[1.5,-2.6]]){
  const pot=new T.Mesh(new T.CylinderGeometry(.18,.13,.28,10),top);pot.position.set(x,.14,z);scene.add(pot);
  for(let i=0;i<8;i++){const a=i*Math.PI/4,m=new T.Mesh(leafGeometry,leaf);m.position.set(x+Math.sin(a)*.13,.34,z+Math.cos(a)*.13);m.rotation.set(-.45,a,.25);scene.add(m);}
 }
 for(const x of [-3.8,-.2,1.3]){box(.85,.045,.08,x,2.45,-3.06,warm);const lamp=new T.PointLight(0xffd9a5,2.2,4,2);lamp.position.set(x,2.3,-2.8);scene.add(lamp);}
 const sign=document.createElement('canvas');sign.width=1024;sign.height=256;const c=sign.getContext('2d')!;
 c.fillStyle='#263b47';c.fillRect(0,0,1024,256);c.fillStyle='#bad6da';c.font='bold 92px Arial';c.fillText('TOMBS',45,125);c.font='24px monospace';c.fillText('DIAGNOSTIC LABORATORY  /  01',49,185);
 const signTex=new T.CanvasTexture(sign);signTex.colorSpace=T.SRGBColorSpace;const label=new T.Mesh(new T.PlaneGeometry(2.25,.56),new T.MeshBasicMaterial({map:signTex}));label.position.set(-1.4,2.27,-3.08);scene.add(label);
 let last='';
 function display(queue:string,line:number,done:string[],blackout=false){
  const key=queue+':'+line+':'+done.join()+':'+blackout;if(key===last)return;last=key;
  context.fillStyle=blackout?'#010405':'#06151e';context.fillRect(0,0,1024,576);if(blackout){texture.needsUpdate=true;return;}context.fillStyle='#69c6ce';context.font='24px monospace';context.fillText('TOMBS / SECURE TERMINAL',48,58);
  context.fillStyle='#314b55';context.fillRect(48,86,928,2);
  const logs=['arrive','logs','baby'].includes(queue),locked=queue==='lock';
  context.fillStyle=logs?'#c0e4de':'#e7b375';context.font='bold 39px monospace';context.fillText(queue==='credentials'?'ACCESS REVOKED':queue==='reject'?'REQUEST DENIED':queue==='request'?'REMOTE INITIALIZATION':logs?'ACCESS HISTORY':locked?'DIRECTORY REOPENED':'UNAUTHORIZED ACCESS',48,158);
  context.font='23px monospace';context.fillStyle='#a9c2cc';
  const rows=['request','reject','credentials'].includes(queue)?['TOMBS ARRAY / REMOTE REQUEST',queue==='credentials'?'Administrator credentials revoked.':queue==='reject'?'Cancellation request denied.':'Initialization request received.','Awaiting authorized control.']:logs?['AUTHENTICATION LOG  //  CLEAN','No failed sign-in attempts.','No changes recorded.','No trace of an external connection.']:queue==='call'?['LOCAL COMMUNICATIONS','SARAH BENNETT','Channel open.']:['SECURITY PROTOCOL VIOLATION','Unknown connection detected.','Diagnostic directory active.',done.includes('trace')?'Connection trace lost.':'Trace connection to investigate.'];
  rows.forEach((s,i)=>context.fillText(s,48,236+i*57));
  context.fillStyle='#63d2c5';context.font='18px monospace';context.fillText('BENNETT, J.  /  PROJECT ADMINISTRATOR',48,535);texture.needsUpdate=true;
 }
 return {screen,comm,door,display,jackChair,sarahChair,tablet,ceilingFixtures};
}
