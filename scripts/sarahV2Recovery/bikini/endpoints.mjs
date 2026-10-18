// Small, bounded garment-only contact corrections at actual belly size keys.
// Preserve approved100 positions and every native point-to-skin correspondence;
// extreme body controls remain native skin bindings rather than contact solves.
import {apply}from'../../sarahV2ProcBikini/skin.mjs';
import {labWeights,defaults,evaluate,lowerBodyCollider}from'./morphs.mjs';
export async function fitSizeEndpoints(s){
 const lab=await labWeights(),report=[];
 for(const [size,name]of [[0,'belly'],[25,'belly25'],[30,'belly30'],[50,'belly50'],[60,'belly60'],[75,'belly75'],[150,'belly150'],[200,'belly200']]){
  const w=defaults(lab,size),collider=lowerBodyCollider(evaluate(s,s.body,w),s.I),parts=[];
  for(const p of s.mesh.listPrimitives()){
   const original=evaluate(s,p,w),a=Float64Array.from(original),index=p.getIndices().getArray(),trim=p.getExtras().part==='rounded-binding',n=a.length/3,groups=trim?n/9-1:n,group=i=>trim?Math.floor(i/9)%groups:i,target=trim?.025:.075;let iterations=0,active=null;
   for(;iterations<24;iterations++){
    const sum=new Float64Array(groups*3),count=new Uint32Array(groups);let constraints=0;
    const correct=(q,vs)=>{const h=collider.closest(q),gap=target-h.signedDistance;if(gap<=.0001)return;constraints++;for(const g of new Set(vs.map(group))){count[g]++;for(let d=0;d<3;d++)sum[g*3+d]+=h.projectionDirection[d]*(gap+.001);}};
    for(let i=0;i<n;i++)if(!active||active[group(i)])correct(Array.from(a.slice(i*3,i*3+3)),[i]);
    for(let i=0;i<index.length;i+=3){const vs=Array.from(index.slice(i,i+3));if(active&&!vs.some(v=>active[group(v)]))continue;correct([0,1,2].map(d=>vs.reduce((v,k)=>v+a[k*3+d],0)/3),vs);}
    if(!constraints)break;active=count;for(let i=0;i<n;i++){const g=group(i);if(count[g])for(let d=0;d<3;d++)a[i*3+d]+=sum[g*3+d]/count[g];}
   }
   const delta=p.listTargets()[s.names.indexOf(name)].getAttribute('POSITION').getArray();let maxMoveCm=0;
   for(let i=0;i<n;i++){const move=[0,1,2].map(d=>a[i*3+d]-original[i*3+d]);maxMoveCm=Math.max(maxMoveCm,Math.hypot(...move));const local=apply(s.Ti,move.map(x=>x/100),0);for(let d=0;d<3;d++)delta[i*3+d]+=local[d];}
   if(maxMoveCm>.35)throw Error('Size-key correction exceeded 3.5mm bound');parts.push({part:p.getExtras().part,opening:p.getExtras().opening,iterations,maxMoveCm});
  }
  report.push({size,target:name,parts});console.log('bound size endpoint',size,Math.max(...parts.map(p=>p.maxMoveCm)));
 }
 return report;
}
