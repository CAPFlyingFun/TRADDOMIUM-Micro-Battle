/** Offline clearance probes using the Lab's actual native weight functions. */
import fs from 'node:fs/promises';
import {createHash}from'node:crypto';
import {loadSkin}from'../../sarahV2ProcBikini/skin.mjs';
import {SkinCollider}from'./collider.mjs';
import {labWeights,defaults,evaluate,lowerBodyCollider}from'./morphs.mjs';
const source=process.argv[2]??'assets-archive/models/sarah-v2-body.glb',out=process.argv[3]??'public/models/sarah-v2-bottom.glb';
const lab=await labWeights(),s=await loadSkin(source),doc=await s.io.read(out),prims=doc.getRoot().listMeshes()[0].listPrimitives();
const cases=[0,25,50,75,100,150,200].map(p=>({name:'belly'+p,w:defaults(lab,p)}));
for(const tilt of [0,10])cases.push({name:'belly200-tilt'+tilt,w:{...defaults(lab,200),...lab.bellyMotionWeights(200,0,lab.restingBellySpring(),tilt)}});
const zero=Object.fromEntries(['bellyTilt','bellyHeight','bellyWidth','bellyDepth','bellyUpper','bellyLower','breastSize','breastSpacing','breastWidth','breastHeight','breastDepth','breastPosition','breastDroop','breastUpper','breastLower'].map(k=>[k,0]));
for(const p of [100,200])for(const [key,extreme]of [['bellyHeight',2],['bellyWidth',15],['bellyDepth',15],['bellyUpper',20],['bellyLower',20]])for(const sign of [-1,1])cases.push({name:'belly'+p+'-'+key+'-'+sign*extreme,w:{...defaults(lab,p),...lab.bodyShapeFieldWeights({...zero,[key]:sign*extreme},p)}});
const report=[];
for(const c of cases){const bp=evaluate(s,s.body,c.w),collider=lowerBodyCollider(bp,s.I),parts=[];
 for(const p of prims){const a=evaluate(s,p,c.w),index=p.getIndices().getArray();let min=Infinity,penetrating=0,minFace=Infinity,facePenetrating=0;for(let i=0;i<a.length;i+=3){const d=collider.closest(Array.from(a.slice(i,i+3))).signedDistance;min=Math.min(min,d);if(d<-.001)penetrating++;}for(let i=0;i<index.length;i+=3){const q=[0,1,2].map(d=>(a[index[i]*3+d]+a[index[i+1]*3+d]+a[index[i+2]*3+d])/3),v=collider.closest(q).signedDistance;minFace=Math.min(minFace,v);if(v<-.001)facePenetrating++;}parts.push({part:p.getExtras().part,opening:p.getExtras().opening,minVertexCm:min,penetratingVertices:penetrating,minCentroidCm:minFace,penetratingCentroids:facePenetrating});}
 report.push({name:c.name,parts});console.log(c.name,JSON.stringify(parts));
}
await fs.writeFile(new URL('./verification-report.json',import.meta.url),JSON.stringify({outputSha256:createHash('sha256').update(await fs.readFile(out)).digest('hex'),cases:report,limitations:report.filter(c=>c.parts.some(p=>p.penetratingVertices||p.penetratingCentroids)).map(c=>({name:c.name,parts:c.parts.filter(p=>p.penetratingVertices||p.penetratingCentroids)}))},null,2)+'\n');
