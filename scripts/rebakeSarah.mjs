/** Rebuild Sarah Lab's generated shapes and clothes from its shipped body.
 * npm run bake:sarah-clothes
 * Keeps the original body, UVs, skeleton and Claude's repaired bone weights.
 * Decode the corrective bind transform before using metre measurements.
 * Does not read or change any original master; repeatable on its own output.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, dedup, weld, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { rename, rm } from 'node:fs/promises';
import { build as bundle } from 'esbuild';
import { bellyMorph } from './bellyMorph.mjs';
import { growClothes, jointPositions, partsOf } from './growClothes.mjs';
import { rebuildShirtHem } from './rebuildShirtHem.mjs';
import { shirtFabric } from './shirtFabric.mjs';
import { refineEarlyShirt } from './refineEarlyShirt.mjs';
import { clearShirtBust } from './clearShirtBust.mjs';
import { refineEarlyWaist } from './refineEarlyWaist.mjs';
import { smoothShirtUnderbust } from './smoothShirtUnderbust.mjs';
import { fitClothToSkin } from './fitClothToSkin.mjs';

export async function recoverSarahBody(doc) {
  const root = doc.getRoot(), mesh = root.listMeshes()[0], skin = root.listSkins()[0];
  if (!mesh || !skin) throw new Error('Sarah needs a mesh and a skin');
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  if (!body) throw new Error('Sarah base body Material_0 is missing');
  const ibms = skin.getInverseBindMatrices(), ibm = [];
  ibms.getElement(0, ibm);
  const correction = new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix())
    .multiply(new Matrix4().fromArray(ibm));
  for (let i = 0; i < skin.listJoints().length; i += 1) {
    ibms.getElement(i, ibm);
    const q = new Matrix4().fromArray(skin.listJoints()[i].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
    if (q.elements.some((v, k) => Math.abs(v - correction.elements[k]) > 0.0002)) {
      throw new Error('Bind matrices disagree; refusing an animated or incompatible body');
    }
  }
  await doc.transform(dequantize());
  for (const p of [...mesh.listPrimitives()]) if (p !== body) p.dispose();
  for (const t of [...body.listTargets()]) t.dispose();
  mesh.setWeights([]).setExtras({ ...mesh.getExtras(), targetNames: [] });
  for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setWeights([]);
  const positions = body.getAttribute('POSITION'), point = new Vector3(), v = [];
  for (let i = 0; i < positions.getCount(); i += 1) {
    positions.getElement(i, v); point.fromArray(v).applyMatrix4(correction);
    positions.setElement(i, point.toArray());
  }
  const normals = body.getAttribute('NORMAL');
  for (let i = 0; i < normals.getCount(); i += 1) {
    normals.getElement(i, v); point.fromArray(v).transformDirection(correction);
    normals.setElement(i, point.toArray());
  }
  const undo = correction.clone().invert();
  for (let i = 0; i < ibms.getCount(); i += 1) {
    ibms.getElement(i, ibm);
    ibms.setElement(i, new Matrix4().fromArray(ibm).multiply(undo).elements);
  }
  return body;
}

/** Fair the sternum/under-bust junction once, before generating any morphs.
 * The marker keeps repeated clothing rebuilds from progressively shrinking it.
 * UV copies share positions and shading; the outer rounded caps stay pinned.
 */
export function fairSarahChest(body) {
  if (body.getExtras().chestFairing === 1) return;
  const P = body.getAttribute('POSITION'), N = body.getAttribute('NORMAL');
  const pos = new Float32Array(P.getArray()), idx = body.getIndices().getArray();
  const count = P.getCount(), keys = new Map(), rep = new Int32Array(count), nb = new Map();
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t*t*(3-2*t); };
  for (let i = 0; i < count; i++) {
    const key = [0,1,2].map(c => Math.round(pos[i*3+c]*1e5)).join(',');
    if (!keys.has(key)) keys.set(key, i); rep[i] = keys.get(key);
  }
  const link = (a,b) => { if (a === b) return; if (!nb.has(a)) nb.set(a,new Set()); nb.get(a).add(b); };
  for (let f=0; f<idx.length; f+=3) {
    const [a,b,c] = [rep[idx[f]],rep[idx[f+1]],rep[idx[f+2]]];
    link(a,b);link(a,c);link(b,a);link(b,c);link(c,a);link(c,b);
  }
  const weights = new Map();
  for (const r of keys.values()) {
    const x=Math.abs(pos[r*3]), y=pos[r*3+1], z=pos[r*3+2];
    const centre=smooth(.075,.025,x)*smooth(1.15,1.20,y)*smooth(1.42,1.35,y);
    const junction=smooth(.16,.11,x)*smooth(1.08,1.14,y)*smooth(1.225,1.185,y);
    const w=Math.max(centre,junction)*smooth(-.015,.03,z);
    if (w>0) weights.set(r,w);
  }
  let cur=new Float32Array(pos);
  for(let pass=0;pass<120;pass++) {
    const next=new Float32Array(cur);
    for(const [r,w] of weights) {
      const ns=[...(nb.get(r)||[])]; if(!ns.length) continue;
      for(let c=0;c<3;c++) next[r*3+c]+= .45*w*(ns.reduce((s,u)=>s+cur[u*3+c],0)/ns.length-cur[r*3+c]);
    }
    cur=next;
  }
  for(let i=0;i<count;i++) for(let c=0;c<3;c++) cur[i*3+c]=cur[rep[i]*3+c];
  P.setArray(cur);
  const normals=new Float32Array(count*3);
  for(let f=0;f<idx.length;f+=3) {
    const [a,b,c]=[idx[f],idx[f+1],idx[f+2]];
    const u=[0,1,2].map(k=>cur[b*3+k]-cur[a*3+k]),v=[0,1,2].map(k=>cur[c*3+k]-cur[a*3+k]);
    const q=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    for(const r of [rep[a],rep[b],rep[c]]) for(let k=0;k<3;k++) normals[r*3+k]+=q[k];
  }
  const old=N.getArray(),out=new Float32Array(old);
  for(let i=0;i<count;i++) {
    const r=rep[i],w=weights.get(r)||0,l=Math.hypot(...normals.subarray(r*3,r*3+3))||1;
    const sign=normals[r*3]*old[i*3]+normals[r*3+1]*old[i*3+1]+normals[r*3+2]*old[i*3+2]<0?-1:1;
    for(let c=0;c<3;c++) out[i*3+c]=old[i*3+c]*(1-w)+sign*normals[r*3+c]/l*w;
    const len=Math.hypot(...out.subarray(i*3,i*3+3))||1;
    for(let c=0;c<3;c++) out[i*3+c]/=len;
  }
  N.setArray(out); body.setExtras({...body.getExtras(),chestFairing:1});
}

/** Remove the old fine crease relief only in the repaired chest junction. */
export async function softenSarahChestRelief(body) {
  // Keep the source's WebP encoding: writing PNG bytes with a WebP MIME expands
  // the model and leaves the texture metadata inconsistent.
  for(const t of [body.getMaterial()?.getBaseColorTexture(),body.getMaterial()?.getNormalTexture()]) {
    if(t?.getMimeType()==='image/webp' && t.getImage() && (await sharp(t.getImage()).metadata()).format!=='webp') {
      t.setImage(await sharp(t.getImage()).webp({quality:95}).toBuffer());
    }
  }
  const chestDone=body.getExtras().chestReliefSoftened===4;
  const navelDone=body.getExtras().navelReliefSoftened===2;
  if(chestDone && navelDone) return;
  const texture=body.getMaterial()?.getNormalTexture();
  if (!texture?.getImage()) return;
  const {data,info}=await sharp(texture.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info, mask=new Float32Array(width*height);
  const p=body.getAttribute('POSITION').getArray(),uv=body.getAttribute('TEXCOORD_0').getArray(),idx=body.getIndices().getArray();
  const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const weight=i=>Math.max(chestDone?0:smooth(.17,.11,Math.abs(p[i*3]))*smooth(1.09,1.15,p[i*3+1])
    *smooth(1.40,1.32,p[i*3+1])*smooth(-.015,.025,p[i*3+2]),
    navelDone?0:smooth(.025,.010,Math.hypot(p[i*3]-.002,p[i*3+1]-.933))*smooth(.05,.10,p[i*3+2]));
  for(let f=0;f<idx.length;f+=3) {
    const ids=[idx[f],idx[f+1],idx[f+2]],w=ids.map(weight);
    if(!w.some(v=>v>0)) continue;
    const q=ids.map(i=>[uv[i*2]*width,uv[i*2+1]*height]);
    const [[ax,ay],[bx,by],[cx,cy]]=q,den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if(Math.abs(den)<1e-9)continue;
    const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)));
    const y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
      const a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den;
      const b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,c=1-a-b;
      if(Math.min(a,b,c)<0)continue;
      mask[y*width+x]=Math.max(mask[y*width+x],a*w[0]+b*w[1]+c*w[2]);
    }
  }
  for(let i=0;i<mask.length;i++) {
    const w=(chestDone?1:.9)*mask[i];
    for(let c=0;c<3;c++)data[i*channels+c]=Math.round(data[i*channels+c]*(1-w)+[128,128,255][c]*w);
  }
  const normalImage=sharp(data,{raw:{width,height,channels}});
  texture.setImage(await (texture.getMimeType()==='image/webp'?normalImage.webp({quality:95}):normalImage.png()).toBuffer());
  // The original skin colour also contains a fine drawn crease. Soften its
  // high-frequency detail locally; retain broad skin colour and shading.
  const colour=body.getMaterial()?.getBaseColorTexture();
  if (colour?.getImage()) {
    const image=colour.getImage();
    const original=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const {width:cw,height:ch,channels:cc}=original.info;
    const blur=await sharp(image).removeAlpha().blur(chestDone?20:8).raw().toBuffer();
    const mask8=Buffer.from(Uint8Array.from(mask,v=>Math.round(v*255)));
    const cm=await sharp(mask8,{raw:{width,height,channels:1}}).resize(cw,ch).toColourspace('b-w').raw().toBuffer();
    for(let i=0;i<cw*ch;i++)for(let c=0;c<cc;c++) {
      const w=.95*cm[i]/255;
      original.data[i*cc+c]=Math.round(original.data[i*cc+c]*(1-w)+blur[i*cc+c]*w);
    }
    const colourImage=sharp(original.data,{raw:{width:cw,height:ch,channels:cc}});
    colour.setImage(await (colour.getMimeType()==='image/webp'?colourImage.webp({quality:95}):colourImage.png()).toBuffer());
  }
  body.setExtras({...body.getExtras(),chestReliefSoftened:4,navelReliefSoftened:2});
}

export function alignCoincidentClothWeights(doc) {
  for(const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    if(!['shirt','leggings'].includes(primitive.getMaterial()?.getName())) continue;
    const position=primitive.getAttribute('POSITION'),joints=primitive.getAttribute('JOINTS_0'),weights=primitive.getAttribute('WEIGHTS_0');
    if(!position||!joints||!weights)continue;
    const groups=new Map(),p=[];
    for(let i=0;i<position.getCount();i++){
      position.getElement(i,p);const key=p.map(v=>v.toFixed(7)).join(',');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
    }
    const j=joints.getArray(),w=weights.getArray();
    for(const ids of groups.values())if(ids.length>1){
      const first=ids[0];for(const i of ids.slice(1)){
        j.set(j.subarray(first*4,first*4+4),i*4);w.set(w.subarray(first*4,first*4+4),i*4);
      }
    }
  }
}

async function main() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const file = 'public/models/sarah-base.glb', temp = 'public/models/sarah-base.rebake.glb';
  const doc = await io.read(file);
  const body = await recoverSarahBody(doc);
  fairSarahChest(body);
  await softenSarahChestRelief(body);
  const log = (s) => console.log(`[bake:sarah-clothes] ${s}`);
  bellyMorph(doc, { log });
  await growClothes(doc, { log });
  await rebuildShirtHem(doc, { log });
  // Fit the combinations rendered by the slider, not isolated morph targets.
  const runtimeBundle=await bundle({entryPoints:['src/sarahlab/sarahLabTool.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const lab=await import('data:text/javascript;base64,'+Buffer.from(runtimeBundle.outputFiles[0].text).toString('base64'));
  const sliderSamples=[0,25,50,75,100,150,200].map(percent=>({percent,
    bellyTarget:lab.BELLY_KEYS.find(([value])=>value*100===percent)?.[1],
    weights:{...lab.bellyWeights(percent),...lab.breastWeights(percent),...lab.navelWeights(percent),...lab.bellyMotionWeights(percent,0,lab.restingBellySpring())}
  }));
  const skin=doc.getRoot().listSkins()[0],{hipY}=partsOf(skin,jointPositions(skin));
  fitClothToSkin(doc, { log, sliderSamples, hipY });
  await shirtFabric(doc, { log });
  refineEarlyShirt(doc, lab, { log });
  clearShirtBust(doc, lab, { log });
  refineEarlyWaist(doc, lab, { log });
  smoothShirtUnderbust(doc, lab, { log });
  await doc.transform(dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
  alignCoincidentClothWeights(doc);
  try { await io.write(temp, doc); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
  log('rebuilt Sarah Lab; body and final repaired weights retained');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
