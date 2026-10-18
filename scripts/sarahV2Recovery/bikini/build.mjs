/** Rebuild the approved continuous bottom, in isolation, from the immutable body GLB.
 * node scripts/sarahV2Recovery/bikini/build.mjs <posed-body.json> [body.glb] [bottom.glb]
 * The JSON is the approved belly100/reset/TPOSE export in world centimetres. It is
 * used for collision AND triangle correspondence, never as a replacement body.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { prune } from '@gltf-transform/functions';
import { loadSkin, apply } from '../../sarahV2ProcBikini/skin.mjs';
import { addPiece } from '../../sarahV2ProcBikini/bind.mjs';
import { closestBary, vertexNormals } from '../../fitMeshyBikini.mjs';
import { createBottom } from './approvedBottom.mjs';
import { SkinCollider } from './collider.mjs';
import { fitSizeEndpoints } from './endpoints.mjs';
export const sha256 = a => crypto.createHash('sha256').update(a).digest('hex');
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
export function bindApprovedPoints(skin, reference, collider, points, anchors=points) {
  const count=points.length, pos=new Float32Array(count*3),J=new Uint16Array(count*4),W=new Float32Array(count*4),T=skin.tgtLocal.map(()=>new Float32Array(count*3));
  let maxDistanceCm=0,maxReferenceAnchorErrorCm=0;
  const baseline={bellyUpper:1,navelOut:100/140,breastGrow:(Math.cbrt(1.3)-1)/(Math.cbrt(1.55)-1)};
  points.forEach((p,i)=>{
    const hit=collider.closest(anchors[i]),ti=hit.triangle*3,tri=Array.from(reference.indices.slice(ti,ti+3));
    const rp=tri.map(v=>reference.positions.slice(v*3,v*3+3)),bc=closestBary(anchors[i],...rp);
    const q=[0,1,2].map(d=>tri.reduce((s,v,k)=>s+bc[k]*reference.positions[v*3+d],0));
    const raw=skin.body.getAttribute('POSITION'),v=[],base=[0,0,0];
    for(let k=0;k<3;k++){raw.getElement(tri[k],v);for(let d=0;d<3;d++)base[d]+=bc[k]*v[d];}
    // Offsets are vectors: remove the ACTUAL posed reference anchor before inverse
    // transforming. Subtracting guessed belly weights would bake its default tilt
    // a second time. At the approved pose this reconstructs the exact source cloth.
    const predicted=base.slice();for(const [name,w]of Object.entries(baseline)){const t=skin.names.indexOf(name);if(t<0)continue;for(let d=0;d<3;d++)predicted[d]+=w*tri.reduce((s,v,k)=>s+bc[k]*skin.tgtLocal[t][v*3+d],0);}
    maxReferenceAnchorErrorCm=Math.max(maxReferenceAnchorErrorCm,Math.hypot(...sub(apply(skin.T,predicted,1).map(x=>x*100),q)));
    const off=apply(skin.Ti,sub(p,q).map(x=>x/100),0);
    pos.set(base.map((x,d)=>x+off[d]),i*3);
    maxDistanceCm=Math.max(maxDistanceCm,Math.hypot(...sub(p,q)));
    const weights=new Map();for(let k=0;k<3;k++)for(let c=0;c<4;c++){
      const j=skin.BJ[tri[k]*4+c],w=bc[k]*skin.BW[tri[k]*4+c];if(w>0)weights.set(j,(weights.get(j)??0)+w);
    }
    const top=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,a)=>s+a[1],0);
    if(!(sum>0))throw Error('Unweighted recovered vertex');
    top.forEach(([j,w],c)=>{J[i*4+c]=j;W[i*4+c]=w/sum;});
    const normal=[],normalAttribute=skin.body.getAttribute('NORMAL');for(let k=0;k<3;k++){normalAttribute.getElement(tri[k],v);for(let d=0;d<3;d++)normal[d]=(normal[d]??0)+bc[k]*v[d];}
    const nl=Math.hypot(...normal)||1,normalOffset=Math.max(0,off.reduce((s,x,d)=>s+x*normal[d]/nl,0)),carry=Math.min(normalOffset,.006/skin.tS);
    for(let t=0;t<T.length;t++){
      const dn=skin.nrmLocal[t],shift=[0,1,2].map(d=>dn?carry*tri.reduce((s,v,k)=>s+bc[k]*dn[v*3+d],0):0),sl=Math.hypot(...shift),limit=.004/skin.tS;
      for(let d=0;d<3;d++){
        const value=shift[d]*(sl>limit?limit/sl:1);T[t][i*3+d]=tri.reduce((s,v,k)=>s+bc[k]*skin.tgtLocal[t][v*3+d],0)+value;
        pos[i*3+d]-=(baseline[skin.names[t]]??0)*value;
      }
    }
  });
  return {pos,J,W,T,maxDistanceCm,maxReferenceAnchorErrorCm};
}
export async function build(referenceFile,source='public/models/sarah-v2-body.glb',out='public/models/sarah-v2-bottom.glb') {
  const before=await fs.readFile(source),reference=JSON.parse(await fs.readFile(referenceFile,'utf8')),skin=await loadSkin(source);
  if(reference.positions.length!==skin.P.length||reference.indices.length!==skin.I.length||reference.indices.some((v,i)=>v!==skin.I[i]))throw Error('Reference must preserve original body vertex/triangle identity');
  const collider=new SkinCollider(reference.positions,reference.indices),cloth=createBottom({enabled:true,collider});
  if(cloth.boundaries.length!==3||cloth.stats.penetrating)throw Error('Invalid approved topology or clearance');
  // Retain the original skeleton, skin matrices and mesh node; remove all source
  // primitives. The source file itself is never written.
  for(const p of skin.mesh.listPrimitives())skin.mesh.removePrimitive(p);
  skin.mesh.setName('SarahV2RecoveredBikiniBottom').setExtras({...skin.mesh.getExtras(),recoveredBikiniBottom:true,openings:3});
  const material=skin.doc.createMaterial('bikini').setBaseColorFactor([0.06662594,0.12477182,0.04666509,1]).setRoughnessFactor(.87).setMetallicFactor(0).setDoubleSided(true);
  const points=Array.from({length:cloth.positions.length/3},(_,i)=>cloth.positions.slice(i*3,i*3+3));
  const bound=bindApprovedPoints(skin,reference,collider,points);
  addPiece(skin,bound,cloth.indices,material,vertexNormals(bound.pos,cloth.indices)).setExtras({recoveredBikiniBottom:true,part:'continuous-cloth',openings:3});
  const report={sourceSha256:sha256(before),referenceSha256:sha256(await fs.readFile(referenceFile)),source:'approved bottom.js (continuous raised hips/back, low front)',cloth:cloth.stats,openings:3,targets:skin.names,joints:skin.doc.getRoot().listSkins()[0].listJoints().length,parts:[],maxAnchorDistanceCm:bound.maxDistanceCm,maxReferenceAnchorErrorCm:bound.maxReferenceAnchorErrorCm};
  report.parts.push({part:'continuous-cloth',vertices:bound.pos.length/3,triangles:cloth.indices.length/3});
  for(let li=0;li<cloth.boundaries.length;li++){
    const loop=cloth.boundaries[li],ps=loop.filter((_,i)=>i%3===0).map(i=>new Vector3().fromArray(cloth.positions,i*3)),curve=new CatmullRomCurve3(ps,true,'centripetal');
    const segments=Math.max(192,ps.length*3),tube=new TubeGeometry(curve,segments,.065,8,true),a=tube.attributes.position.array,points=Array.from({length:a.length/3},(_,i)=>Array.from(a.slice(i*3,i*3+3)));
    // One shared anchor per cross-section keeps the round binding round and its
    // duplicate UV seam vertices coincident for every shape and skeletal pose.
    const anchors=points.map((_,i)=>curve.getPointAt(Math.floor(i/9)/segments).toArray()),b=bindApprovedPoints(skin,reference,collider,points,anchors);
    addPiece(skin,b,tube.index.array,material,vertexNormals(b.pos,tube.index.array)).setExtras({recoveredBikiniBottom:true,part:'rounded-binding',opening:li,radiusCm:.065});
    report.parts.push({part:'rounded-binding',opening:li,vertices:b.pos.length/3,triangles:tube.index.count/3});tube.dispose();
  }
  report.sizeEndpoints=await fitSizeEndpoints(skin);
  for(const p of skin.mesh.listPrimitives())p.listTargets().forEach((t,k)=>t.setName(skin.names[k]));
  await skin.doc.transform(prune());await skin.io.write(out,skin.doc);
  const after=await fs.readFile(source);if(!before.equals(after))throw Error('Protected source body changed');
  report.outputSha256=sha256(await fs.readFile(out));
  await fs.writeFile(new URL('./build-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));return report;
}
if(process.argv[1]===new URL(import.meta.url).pathname){if(!process.argv[2])throw Error('Pass approved posed body JSON');await build(process.argv[2],process.argv[3],process.argv[4]);}
