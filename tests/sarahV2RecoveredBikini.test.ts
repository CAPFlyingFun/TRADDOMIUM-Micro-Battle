import { beforeAll, describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const original='public/models/sarah-v2-body.glb';
let source: any, bottom: any, primitives: any[], names: string[];
beforeAll(async()=>{
  await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  [source,bottom]=await Promise.all([io.read(original),io.read('public/models/sarah-v2-bottom.glb')]);
  const mesh=bottom.getRoot().listMeshes()[0];primitives=mesh.listPrimitives();names=mesh.getExtras().targetNames;
},30000);
function boundaryLoops(indices:ArrayLike<number>) {
  const edges=new Map<string,number>();for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
    const a=indices[i+k],b=indices[i+(k+1)%3];expect(a).not.toBe(b);const key=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(key,(edges.get(key)??0)+1);
  }
  const all=new Map<number,number[]>();for(const key of edges.keys()){const [a,b]=key.split(':').map(Number);all.set(a,[...(all.get(a)??[]),b]);all.set(b,[...(all.get(b)??[]),a]);}
  const connected=new Set<number>(),pending=[all.keys().next().value!];while(pending.length){const v=pending.pop()!;if(connected.has(v))continue;connected.add(v);pending.push(...all.get(v)!);}expect(connected.size).toBe(all.size);
  const adjacency=new Map<number,number[]>();for(const [key,n]of edges){expect(n).toBeLessThanOrEqual(2);if(n!==1)continue;const [a,b]=key.split(':').map(Number);adjacency.set(a,[...(adjacency.get(a)??[]),b]);adjacency.set(b,[...(adjacency.get(b)??[]),a]);}
  for(const ns of adjacency.values())expect(ns.length).toBe(2);
  let loops=0;const seen=new Set<number>();for(const a of adjacency.keys()){if(seen.has(a))continue;loops++;const stack=[a];while(stack.length){const v=stack.pop()!;if(seen.has(v))continue;seen.add(v);stack.push(...adjacency.get(v)!);}}
  return loops;
}
describe('recovered approved continuous bikini bottom',()=>{
  it('leaves the exact protected source body/top asset unchanged',()=>{
    expect(createHash('sha256').update(readFileSync(original)).digest('hex')).toBe('47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42');
  });
  it('contains only continuous three-opening cloth and its three rounded bindings',()=>{
    expect(primitives).toHaveLength(4);expect(bottom.getRoot().listMeshes()[0].getExtras().recoveredBikiniBottom).toBe(true);
    expect(boundaryLoops(primitives[0].getIndices().getArray())).toBe(3);
    expect(primitives.map(p=>p.getExtras().part)).toEqual(['continuous-cloth','rounded-binding','rounded-binding','rounded-binding']);
    expect(primitives.every(p=>p.getMaterial().getName()==='bikini')).toBe(true);
  });
  it('shares all 43 native target names, original bones and inverse bind matrices',()=>{
    expect(names).toEqual(source.getRoot().listMeshes()[0].getExtras().targetNames);expect(names).toHaveLength(43);
    const a=source.getRoot().listSkins()[0],b=bottom.getRoot().listSkins()[0];
    expect(b.listJoints().map((j:any)=>j.getName())).toEqual(a.listJoints().map((j:any)=>j.getName()));
    expect(Array.from(b.getInverseBindMatrices().getArray())).toEqual(Array.from(a.getInverseBindMatrices().getArray()));
    for(const p of primitives){expect(p.listTargets()).toHaveLength(43);const n=p.getAttribute('POSITION').getCount();for(const t of p.listTargets()){const a=t.getAttribute('POSITION');expect(a.getCount()).toBe(n);expect(Array.from(a.getArray()).every(Number.isFinite)).toBe(true);}}
  });
  it('gives every vertex normalized live skeleton weights and carries all lower-body shapes',()=>{
    const response=new Map(names.map(n=>[n,0]));const usedJoints=new Set<number>();
    for(const p of primitives){const a=p.getAttribute('WEIGHTS_0').getArray(),j=p.getAttribute('JOINTS_0').getArray();for(let i=0;i<a.length;i+=4){expect(a[i]+a[i+1]+a[i+2]+a[i+3]).toBeCloseTo(1,5);for(let k=0;k<4;k++){expect(a[i+k]).toBeGreaterThanOrEqual(0);if(a[i+k]>0)usedJoints.add(j[i+k]);}}
      p.listTargets().forEach((t:any,k:number)=>{const a=t.getAttribute('POSITION').getArray();response.set(names[k],Math.max(response.get(names[k])!,...Array.from(a,(v:any)=>Math.abs(v))));});
    }
    expect(usedJoints.size).toBeGreaterThan(3);
    for(const n of ['belly','belly25','belly50','belly75','belly150','belly200','bellyTilt','bellyBob','bellySway','bellySeatV2','shape:bellyHeightUp','shape:bellyHeightDown','shape:bellyWidth','shape:bellyDepth','shape:bellyLower'])expect(response.get(n),n).toBeGreaterThan(0);
  });
  it('has independent clearance probes for all size keys, tilt and actual belly-slider extremes',()=>{
    const report=JSON.parse(readFileSync('scripts/sarahV2Recovery/bikini/verification-report.json','utf8'));
    expect(report.outputSha256).toBe(createHash('sha256').update(readFileSync('public/models/sarah-v2-bottom.glb')).digest('hex'));
    expect(report.cases).toHaveLength(29);
    for(const c of report.cases.filter((c:any)=>/^belly(0|25|50|75|100|150|200)$/.test(c.name)))for(const p of c.parts){expect(p.penetratingVertices,c.name).toBe(0);expect(p.penetratingCentroids,c.name).toBe(0);expect(p.minVertexCm,c.name).toBeGreaterThanOrEqual(-.001);expect(p.minCentroidCm,c.name).toBeGreaterThanOrEqual(-.001);}
  });
  it('keeps rounded binding cross sections and closed UV seams together through every native shape',()=>{
    for(const p of primitives.slice(1)){
      for(const a of [p.getAttribute('POSITION'),...p.listTargets().map((t:any)=>t.getAttribute('POSITION'))]){
        const data=a.getArray(),n=a.getCount();for(let i=0;i<n;i+=9)for(let d=0;d<3;d++)expect(data[i*3+d]).toBeCloseTo(data[(i+8)*3+d],6);
        // Closed longitudinal seam duplicates the first ring.
        for(let i=0;i<27;i++)expect(data[i]).toBeCloseTo(data[data.length-27+i],6);
      }
    }
  });
});
