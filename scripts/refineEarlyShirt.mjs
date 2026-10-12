/** Early shirt: tuck the upper band and fair the front shoulders; pin 60%+. */
import { Matrix4, Vector3 } from 'three';
import { fittedNormals, aliasGroups } from './fitClothToSkin.mjs';
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
/** Continuous front-depth guide; back-only rows must not dent the front panel. */
export function shirtFrontDepthGuide(positions){
  const rowStep=.008,rowFront=new Map();
  for(let i=0;i<positions.length;i+=3){
    if(Math.abs(positions[i])>.025 || positions[i+2]<=0)continue;
    const row=Math.round(positions[i+1]/rowStep);
    rowFront.set(row,Math.max(rowFront.get(row)??-Infinity,positions[i+2]));
  }
  const rows=[...rowFront.keys()].sort((a,b)=>a-b);
  if(!rows.length)throw Error('Shirt front-depth guide has no front samples');
  return y=>{
    const row=y/rowStep,upper=rows.findIndex(r=>r>=row);
    if(upper<0)return rowFront.get(rows.at(-1));
    if(upper===0)return rowFront.get(rows[0]);
    const lo=rows[upper-1],hi=rows[upper],t=(row-lo)/(hi-lo);
    return rowFront.get(lo)*(1-t)+rowFront.get(hi)*t;
  };
}
export function refineEarlyShirt(doc,lab,{log=()=>{}}={}){
  const mesh=doc.getRoot().listMeshes()[0],names=[...mesh.getExtras().targetNames];
  if(names.includes('belly60'))return; // The postprocess is applied once per fresh bake.
  const i50=names.indexOf('belly50'),i75=names.indexOf('belly75');
  if(i50<0||i75<0)throw Error('Early-shirt refinement requires 50 and 75 percent keys');
  // This anchor is the old interpolation, for EVERY primitive and attribute.
  for(const p of mesh.listPrimitives()){
    const target=doc.createPrimitiveTarget('belly60');
    for(const semantic of p.listTargets()[i50].listSemantics()){
      const a=p.listTargets()[i50].getAttribute(semantic),b=p.listTargets()[i75].getAttribute(semantic);
      target.setAttribute(semantic,doc.createAccessor('accepted-60-'+semantic).setBuffer(a.getBuffer()).setType(a.getType())
        .setArray(Float32Array.from(a.getArray(),(v,i)=>.6*v+.4*b.getArray()[i])));
    }
    p.addTarget(target);
  }
  names.push('belly60');mesh.setExtras({...mesh.getExtras(),targetNames:names});
  mesh.setWeights([...mesh.getWeights(),0]);
  for(const n of doc.getRoot().listNodes())if(n.getMesh()===mesh && n.getWeights().length)n.setWeights([...n.getWeights(),0]);
  const body=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='Material_0');
  const shirt=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
  const skin=doc.getRoot().listSkins()[0],ibm=[];skin.getInverseBindMatrices().getElement(0,ibm);
  const toMetres=new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
  const toLocal=toMetres.clone().invert(),v=new Vector3();
  const indices=body.getIndices().getArray();
  const mix=(p,weights,semantic='POSITION')=>Float32Array.from(p.getAttribute(semantic).getArray(),(x,i)=>x+Object.entries(weights).reduce((s,[name,w])=>{
    const t=p.listTargets()[names.indexOf(name)]?.getAttribute(semantic);return s+(t?w*t.getArray()[i]:0);
  },0));
  const metres=array=>{const out=new Float32Array(array.length);for(let i=0;i<array.length;i+=3)v.fromArray(array,i).applyMatrix4(toMetres).toArray(out,i);return out;};
  const base=shirt.getAttribute('POSITION').getArray();
  const {aliases}=aliasGroups(base,shirt.getIndices().getArray());
  for(const percent of [0,25,50]){
    const weights={...lab.bellyWeights(percent),...lab.breastWeights(percent),...lab.navelWeights(percent),...lab.bellyMotionWeights(percent,0,lab.restingBellySpring())};
    const b=metres(mix(body,weights)),local=mix(shirt,weights),cloth=metres(local);
    const grid=new Map(),cell=.025;
    for(let f=0;f<indices.length;f+=3){
      const ids=[indices[f],indices[f+1],indices[f+2]];
      const loX=Math.min(...ids.map(i=>b[i*3])),hiX=Math.max(...ids.map(i=>b[i*3]));
      const loY=Math.min(...ids.map(i=>b[i*3+1])),hiY=Math.max(...ids.map(i=>b[i*3+1]));
      if(hiY<1.02||loY>1.23||hiX<-.24||loX>.24)continue;
      for(let x=Math.floor(loX/cell);x<=Math.floor(hiX/cell);x++)for(let y=Math.floor(loY/cell);y<=Math.floor(hiY/cell);y++){
        const k=`${x}:${y}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(ids);
      }
    }
    let count=0,maximum=0;
    const lightingWeight=new Float32Array(cloth.length/3);
    for(let i=0;i<cloth.length/3;i++){
      const x=cloth[i*3],y=cloth[i*3+1],z=cloth[i*3+2];
      // Lower third below .94 m stays as-is; mid fades toward the upper third
      // at 1.08 m. Fade out again before the bust so its approved contour holds.
      const band=smooth(1.025,1.105,y)*smooth(1.20,1.16,y)*smooth(.14,.09,Math.abs(x))*smooth(-.025,.025,z);
      if(!band)continue;
      let surface=-Infinity;
      for(const [a,c,d] of grid.get(`${Math.floor(x/cell)}:${Math.floor(y/cell)}`)||[]){
        const ax=b[a*3],ay=b[a*3+1],cx=b[c*3],cy=b[c*3+1],dx=b[d*3],dy=b[d*3+1];
        const den=(cy-dy)*(ax-dx)+(dx-cx)*(ay-dy);if(Math.abs(den)<1e-12)continue;
        const u=((cy-dy)*(x-dx)+(dx-cx)*(y-dy))/den,w=((dy-ay)*(x-dx)+(ax-dx)*(y-dy))/den,t=1-u-w;
        if(Math.min(u,w,t)<-1e-6)continue;
        surface=Math.max(surface,u*b[a*3+2]+w*b[c*3+2]+t*b[d*3+2]);
      }
      if(!Number.isFinite(surface))continue;
      const inward=Math.min(.022,Math.max(0,z-surface-.009))*band*(percent===50?.38:.9);
      if(inward<1e-6)continue;
      lightingWeight[i]=Math.min(1,inward/.003);
      v.set(x,y,z-inward).applyMatrix4(toLocal).toArray(local,i*3);maximum=Math.max(maximum,inward);count++;
    }
    // The early abdomen kept the full-belly shoulder across its width even
    // after its centre moved back. Fill that shallow shoulder outward into a
    // flatter fabric panel. X/Y and the centre profile remain fixed; moving
    // forward from the fitted surface also preserves skin clearance.
    const tucked=metres(local),frontAt=shirtFrontDepthGuide(tucked);
    let filled=0,frontMaximum=0;
    for(let i=0;i<tucked.length/3;i++){
      const x=tucked[i*3],y=tucked[i*3+1],z=tucked[i*3+2],ax=Math.abs(x);
      const band=smooth(.83,.91,y)*smooth(1.16,1.08,y)
        *smooth(.02,.075,ax)*smooth(.18,.135,ax)*smooth(0,.025,z);
      if(!band)continue;
      const centre=frontAt(y);
      const desired=centre-1.2*x*x;
      const forward=Math.min(.012,Math.max(0,desired-z))*band*(percent===0?1:percent===25?.75:.25);
      if(forward<1e-6)continue;
      v.set(x,y,z+forward).applyMatrix4(toLocal).toArray(local,i*3);
      lightingWeight[i]=Math.max(lightingWeight[i],band);
      filled++;frontMaximum=Math.max(frontMaximum,forward);
    }
    log(`early front ${percent}%: ${filled} shoulder points, maximum fill ${(frontMaximum*1000).toFixed(1)} mm; centre profile and width held`);
    const name=percent===0?'belly':`belly${percent}`,target=shirt.listTargets()[names.indexOf(name)];
    const before=mix(shirt,weights);
    const delta=target.getAttribute('POSITION').getArray();
    target.getAttribute('POSITION').setArray(Float32Array.from(delta,(x,i)=>x+local[i]-before[i]));
    const normal=fittedNormals(shirt,local,aliases),old=mix(shirt,weights,'NORMAL');
    const nd=target.getAttribute('NORMAL').getArray();
    target.getAttribute('NORMAL').setArray(Float32Array.from(nd,(x,i)=>x+(normal[i]-old[i])*lightingWeight[Math.floor(i/3)]));
    log(`early shirt ${percent}%: ${count} upper/mid points, maximum tuck ${(maximum*1000).toFixed(1)} mm; lower band held`);
  }
}
