/** Front-view waist silhouette: inward at zero, halfway at 30, original at 60. */
import { Matrix4,Vector3 } from 'three';
import { aliasGroups,fittedNormals } from './fitClothToSkin.mjs';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function refineEarlyWaist(doc,lab,{log=()=>{}}={}){
  const mesh=doc.getRoot().listMeshes()[0],shirt=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
  if(shirt.getExtras().earlyWaist)return;
  const names=[...mesh.getExtras().targetNames],i25=names.indexOf('belly25'),i50=names.indexOf('belly50');
  if(i25<0||i50<0||!names.includes('belly60'))throw Error('Waist refinement requires fitted 25/50/60 anchors');
  // Preserve the old 30% depth and height, then edit its width explicitly.
  for(const p of mesh.listPrimitives()){
    const t=doc.createPrimitiveTarget('belly30');
    for(const semantic of p.listTargets()[i25].listSemantics()){
      const a=p.listTargets()[i25].getAttribute(semantic),b=p.listTargets()[i50].getAttribute(semantic);
      t.setAttribute(semantic,doc.createAccessor('waist-30-'+semantic).setBuffer(a.getBuffer()).setType(a.getType())
        .setArray(Float32Array.from(a.getArray(),(v,i)=>.8*v+.2*b.getArray()[i])));
    }
    p.addTarget(t);
  }
  names.push('belly30');mesh.setExtras({...mesh.getExtras(),targetNames:names});mesh.setWeights([...mesh.getWeights(),0]);
  for(const node of doc.getRoot().listNodes())if(node.getMesh()===mesh&&node.getWeights().length)node.setWeights([...node.getWeights(),0]);
  const skin=doc.getRoot().listSkins()[0],ibm=[];skin.getInverseBindMatrices().getElement(0,ibm);
  const world=new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm)),inverse=world.clone().invert(),v=new Vector3();
  const weights=p=>({...lab.bellyWeights(p),...lab.breastWeights(p),...lab.navelWeights(p),...lab.bellyMotionWeights(p,0,lab.restingBellySpring())});
  const sample=(p,pct)=>{
    const base=p.getAttribute('POSITION').getArray(),sum=new Float64Array(base.length);
    for(const [name,w] of Object.entries(weights(pct))){if(!w)continue;const a=p.listTargets()[names.indexOf(name)]?.getAttribute('POSITION')?.getArray();if(a)for(let i=0;i<sum.length;i++)sum[i]+=a[i]*w;}
    return Float32Array.from(base,(x,i)=>x+sum[i]);
  };
  const metres=a=>{const out=new Float32Array(a.length);for(let i=0;i<a.length;i+=3)v.fromArray(a,i).applyMatrix4(world).toArray(out,i);return out;};
  for(const p of mesh.listPrimitives()){
    const base=p.getAttribute('POSITION').getArray(),{aliases}=aliasGroups(base,p.getIndices().getArray());
    const original=new Map([0,25,30,50,60].map(pct=>[pct,sample(p,pct)]));
    const zero=metres(original.get(0)),sixty=metres(original.get(60));
    for(const pct of [0,25,30,50]){
      const before=original.get(pct),after=Float32Array.from(before),points=metres(before);let count=0,maximum=0;
      for(let i=0;i<after.length;i+=3){
        const x0=zero[i],y0=zero[i+1],ax=Math.abs(x0);
        // Torso only: hold bust, hips, limbs and central depth profile.
        const band=smooth(.84,.975,y0)*smooth(1.14,1.015,y0)
          *smooth(.025,.085,ax)*smooth(.30,.23,ax);
        if(!band)continue;
        const t=pct/60,target=x0*(1-t)+sixty[i]*t;
        const change=band*(target-points[i]-.18*x0*(1-t));
        if(Math.abs(change)<1e-7)continue;
        v.set(points[i]+change,points[i+1],points[i+2]).applyMatrix4(inverse).toArray(after,i);
        maximum=Math.max(maximum,Math.abs(change));count++;
      }
      const target=p.listTargets()[names.indexOf(pct===0?'belly':`belly${pct}`)];
      const delta=target.getAttribute('POSITION').getArray();
      target.getAttribute('POSITION').setArray(Float32Array.from(delta,(x,i)=>x+after[i]-before[i]));
      const oldNormal=fittedNormals(p,before,aliases),newNormal=fittedNormals(p,after,aliases),normal=target.getAttribute('NORMAL').getArray();
      target.getAttribute('NORMAL').setArray(Float32Array.from(normal,(x,i)=>x+newNormal[i]-oldNormal[i]));
      log(`${p.getMaterial()?.getName()} ${pct}%: ${count} waist points, ${(maximum*1000).toFixed(1)} mm maximum width correction`);
    }
  }
  shirt.setExtras({...shirt.getExtras(),earlyWaist:true});
}
