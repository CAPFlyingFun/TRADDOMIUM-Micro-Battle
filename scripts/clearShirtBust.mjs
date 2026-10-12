/** Extra local ease where lowering the arms presses the tee against the bust. */
import { Matrix4, Vector3 } from 'three';
import { aliasGroups, fittedNormals } from './fitClothToSkin.mjs';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function clearShirtBust(doc,lab,{log=()=>{}}={}){
  const mesh=doc.getRoot().listMeshes()[0],names=mesh.getExtras().targetNames;
  const shirt=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
  if(shirt.getExtras().bustEase)return;
  const skin=doc.getRoot().listSkins()[0],ibm=[];skin.getInverseBindMatrices().getElement(0,ibm);
  const world=new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
  const inverse=world.clone().invert(),p=new Vector3(),n=new Vector3();
  const base=shirt.getAttribute('POSITION').getArray(),normal=shirt.getAttribute('NORMAL').getArray();
  const {aliases,neighbours}=aliasGroups(base,shirt.getIndices().getArray()),offset=new Float32Array(base.length);
  let count=0,maximum=0;
  for(let i=0;i<base.length;i+=3){
    p.fromArray(base,i).applyMatrix4(world);
    const weight=smooth(1.14,1.19,p.y)*smooth(1.36,1.30,p.y)
      *smooth(.055,.09,Math.abs(p.x))*smooth(.23,.18,Math.abs(p.x))*smooth(-.035,.015,p.z);
    if(!weight)continue;
    // A common outward/forward direction preserves the order of overlapping cup and
    // waist surfaces. Their opposing normals would pinch the under-bust fold.
    n.set(Math.sign(p.x)*.8,0,.6);
    p.addScaledVector(n,.008*weight).applyMatrix4(inverse);
    for(let c=0;c<3;c++)offset[i+c]=p.getComponent(c)-base[i+c];
    maximum=Math.max(maximum,.008*weight);count++;
  }
  // UV duplicates share one displacement; fair the offset field itself so
  // additional ease cannot turn small normal discontinuities into ridges.
  for(let pass=0;pass<24;pass++){
    const next=Float32Array.from(offset);
    for(let i=0;i<aliases.length;i++){
      if(aliases[i]!==i || !neighbours[i].size)continue;
      for(let c=0;c<3;c++)next[i*3+c]=.5*offset[i*3+c]+.5*[...neighbours[i]].reduce((sum,j)=>sum+offset[j*3+c],0)/neighbours[i].size;
    }
    for(let i=0;i<aliases.length;i++)if(aliases[i]!==i)next.set(next.subarray(aliases[i]*3,aliases[i]*3+3),i*3);
    offset.set(next);
  }
  const levels=[100,0,25,50,60,75,150,200],changes=[];
  for(const percent of levels){
    const weights={...lab.bellyWeights(percent),...lab.breastWeights(percent),...lab.navelWeights(percent),...lab.bellyMotionWeights(percent,0,lab.restingBellySpring())};
    const positions=Float32Array.from(base);
    for(const [name,w] of Object.entries(weights)){
      if(!w)continue;const a=shirt.listTargets()[names.indexOf(name)]?.getAttribute('POSITION')?.getArray();
      if(a)for(let i=0;i<positions.length;i++)positions[i]+=a[i]*w;
    }
    const before=fittedNormals(shirt,positions,aliases);
    for(let i=0;i<positions.length;i++)positions[i]+=offset[i];
    const after=fittedNormals(shirt,positions,aliases);
    changes.push(Float32Array.from(after,(v,i)=>v-before[i]));
  }
  shirt.getAttribute('POSITION').setArray(Float32Array.from(base,(v,i)=>v+offset[i]));
  shirt.getAttribute('NORMAL').setArray(Float32Array.from(normal,(v,i)=>v+changes[0][i]));
  for(let k=1;k<levels.length;k++){
    const name=levels[k]===0?'belly':`belly${levels[k]}`,target=shirt.listTargets()[names.indexOf(name)].getAttribute('NORMAL');
    target.setArray(Float32Array.from(target.getArray(),(v,i)=>v+changes[k][i]-changes[0][i]));
  }
  shirt.setExtras({...shirt.getExtras(),bustEase:true});
  log(`bust clearance: ${count} points, up to ${(maximum*1000).toFixed(1)} mm of extra ease; belly untouched`);
}
