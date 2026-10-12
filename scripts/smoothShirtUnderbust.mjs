/** Bridge small under-bust hollows without pulling cloth into the body. */
import { Matrix4,Vector3 } from 'three';
import { aliasGroups,fittedNormals } from './fitClothToSkin.mjs';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function smoothShirtUnderbust(doc,lab,{log=()=>{}}={}){
 const mesh=doc.getRoot().listMeshes()[0],names=mesh.getExtras().targetNames,p=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
 if(p.getExtras().underbustFair)return;
 const skin=doc.getRoot().listSkins()[0],ibm=[];skin.getInverseBindMatrices().getElement(0,ibm);
 const world=new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm)),inverse=world.clone().invert(),v=new Vector3();
 const base=p.getAttribute('POSITION').getArray(),{aliases,neighbours}=aliasGroups(base,p.getIndices().getArray());
 const adjacent=neighbours.map(s=>[...s]),levels=[100,0,25,30,50,60,75,150,200].filter(n=>n===100||names.includes(n===0?'belly':`belly${n}`)),changes=[];
 for(const pct of levels){
  const weights={...lab.bellyWeights(pct),...lab.breastWeights(pct),...lab.navelWeights(pct),...lab.bellyMotionWeights(pct,0,lab.restingBellySpring())};
  const pos=Float32Array.from(base);
  for(const [name,w] of Object.entries(weights)){if(!w)continue;const a=p.listTargets()[names.indexOf(name)]?.getAttribute('POSITION')?.getArray();if(a)for(let i=0;i<pos.length;i++)pos[i]+=w*a[i];}
  const before=Float32Array.from(pos),points=new Float32Array(pos.length),mask=new Float32Array(aliases.length);
  for(let i=0;i<pos.length;i+=3){v.fromArray(pos,i).applyMatrix4(world).toArray(points,i);mask[i/3]=smooth(1.105,1.16,v.y)*smooth(1.29,1.235,v.y)*smooth(.21,.16,Math.abs(v.x))*smooth(-.01,.035,v.z);}
  const unfaired=Float32Array.from(points);
  // A shirt spans the hollow below each cup instead of tracing that hollow.
  // Sample the front surface at two heights through triangle interiors, then
  // bridge between those anchors. This removes the pinched fold itself.
  const grid=new Map(),cell=.025,indices=p.getIndices().getArray();
  for(let f=0;f<indices.length;f+=3){
   const ids=[indices[f],indices[f+1],indices[f+2]],xs=ids.map(i=>points[i*3]),ys=ids.map(i=>points[i*3+1]);
   if(Math.max(...ys)<1.085||Math.min(...ys)>1.285)continue;
   for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let y=Math.floor(Math.min(...ys)/cell);y<=Math.floor(Math.max(...ys)/cell);y++){const key=`${x}:${y}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(ids);}
  }
  const surface=(x,y)=>{
   let z=-Infinity;
   for(const [a,b,c] of grid.get(`${Math.floor(x/cell)}:${Math.floor(y/cell)}`)||[]){
    const ax=points[a*3],ay=points[a*3+1],bx=points[b*3],by=points[b*3+1],cx=points[c*3],cy=points[c*3+1];
    const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-12)continue;
    const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,w=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,t=1-u-w;
    if(Math.min(u,w,t)<-1e-6)continue;z=Math.max(z,u*points[a*3+2]+w*points[b*3+2]+t*points[c*3+2]);
   }return z;
  };
  const bridged=Float32Array.from(points);
  for(let i=0;i<points.length;i+=3){
   const x=points[i],y=points[i+1],z=points[i+2];if(y<=1.105||y>=1.255||z<=0||Math.abs(x)>.21)continue;
   const lower=surface(x,1.105),upper=surface(x,1.255);if(!Number.isFinite(lower)||!Number.isFinite(upper))continue;
   const t=(y-1.105)/.15,target=lower*(1-t)+upper*t;
   const blend=smooth(1.105,1.14,y)*smooth(1.255,1.225,y)*smooth(.21,.16,Math.abs(x))*smooth(0,.035,z);
   bridged[i+2]+=blend*Math.max(0,target-z);
  }
  points.set(bridged);
  const initial=Float32Array.from(points);
  for(let pass=0;pass<240;pass++){
   const next=Float32Array.from(points);
   for(let i=0;i<aliases.length;i++){
    if(aliases[i]!==i||!mask[i]||!adjacent[i].length)continue;
    const mean=adjacent[i].reduce((s,j)=>s+points[j*3+2],0)/adjacent[i].length;
    next[i*3+2]=Math.min(initial[i*3+2]+.018*mask[i],points[i*3+2]+.65*mask[i]*Math.max(0,mean-points[i*3+2]));
   }
   for(let i=0;i<aliases.length;i++)if(aliases[i]!==i)next[i*3+2]=points[i*3+2]+next[aliases[i]*3+2]-points[aliases[i]*3+2];
   points.set(next);
  }
  let maximum=0;
  for(let i=0;i<pos.length;i+=3){maximum=Math.max(maximum,points[i+2]-unfaired[i+2]);v.fromArray(points,i).applyMatrix4(inverse).toArray(pos,i);}
  const oldNormal=fittedNormals(p,before,aliases),normal=fittedNormals(p,pos,aliases);
  changes.push({position:Float32Array.from(pos,(x,i)=>x-before[i]),normal:Float32Array.from(normal,(x,i)=>x-oldNormal[i])});
  log(`under-bust ${pct}%: maximum hollow fill ${(maximum*1000).toFixed(1)} mm`);
 }
 for(const [semantic,key] of [['POSITION','position'],['NORMAL','normal']]){
  const a=p.getAttribute(semantic);a.setArray(Float32Array.from(a.getArray(),(x,i)=>x+changes[0][key][i]));
  for(let k=1;k<levels.length;k++){const t=p.listTargets()[names.indexOf(levels[k]===0?'belly':`belly${levels[k]}`)].getAttribute(semantic);t.setArray(Float32Array.from(t.getArray(),(x,i)=>x+changes[k][key][i]-changes[0][key][i]));}
 }
 p.setExtras({...p.getExtras(),underbustFair:true});
}
