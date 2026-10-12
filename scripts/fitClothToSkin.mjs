/** Keep the complete body beneath cloth, without using skin cutout masks. */
import { Triangle, Vector3 } from 'three';

export function aliasGroups(positions,indices){
  const count=positions.length/3,aliases=new Int32Array(count),buckets=new Map(),neighbours=Array.from({length:count},()=>new Set()),cellSize=.0001,radius2=cellSize*cellSize;
  for(let i=0;i<count;i++){
    const cell=[0,1,2].map(c=>Math.floor(positions[i*3+c]/cellSize));let best=-1,bestD=radius2;
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of buckets.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[]){
      const d=(positions[i*3]-positions[j*3])**2+(positions[i*3+1]-positions[j*3+1])**2+(positions[i*3+2]-positions[j*3+2])**2;if(d<=bestD){best=aliases[j];bestD=d;}
    }
    aliases[i]=best<0?i:best;const k=cell.join(',');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);
  }
  for(let f=0;f<indices.length;f+=3)for(let e=0;e<3;e++){
    const a=aliases[indices[f+e]],b=aliases[indices[f+(e+1)%3]];if(a!==b){neighbours[a].add(b);neighbours[b].add(a);}
  }
  for(let i=0;i<count;i++)if(aliases[i]!==i)neighbours[i]=neighbours[aliases[i]];
  return {aliases,neighbours};
}

/** Area-weighted final surface normals, shared by coincident UV vertices. */
export function fittedNormals(primitive, positions, aliases) {
  const indices=primitive.getIndices()?.getArray(), original=primitive.getAttribute('NORMAL')?.getArray();
  if(!indices || !original)return null;
  const sums=new Float32Array(positions.length), out=new Float32Array(positions.length);
  const a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(let f=0;f<indices.length;f+=3){
    const ids=[indices[f],indices[f+1],indices[f+2]];
    a.fromArray(positions,ids[0]*3);b.fromArray(positions,ids[1]*3).sub(a);c.fromArray(positions,ids[2]*3).sub(a);b.cross(c);
    for(const i of ids){const r=aliases[i];sums[r*3]+=b.x;sums[r*3+1]+=b.y;sums[r*3+2]+=b.z;}
  }
  for(let i=0;i<aliases.length;i++){
    a.fromArray(sums,aliases[i]*3);
    if(a.lengthSq()<1e-16)a.fromArray(original,i*3);
    a.normalize().toArray(out,i*3);
  }
  return out;
}

export function fitClothToSkin(doc,{log=()=>{},sliderSamples=null,hipY=null}={}){
  const mesh=doc.getRoot().listMeshes()[0],body=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='Material_0');
  const cloth=mesh.listPrimitives().filter(p=>['shirt','leggings'].includes(p.getMaterial()?.getName()));
  const bodyJ=body.getAttribute('JOINTS_0'),bodyW=body.getAttribute('WEIGHTS_0');
  const base=body.getAttribute('POSITION'),normal=body.getAttribute('NORMAL'),indices=body.getIndices().getArray(),step=.04,reach=.025;
  const sources=cloth.map(p=>{
    const positions=Float32Array.from(p.getAttribute('POSITION').getArray()),count=positions.length/3,aliases=new Int32Array(count),welded=new Map(),neighbours=Array.from({length:count},()=>new Set());
    const weldCell=.0001,weldRadius2=weldCell*weldCell;
    for(let i=0;i<count;i++){
      const cell=[0,1,2].map(c=>Math.floor(positions[i*3+c]/weldCell));let best=-1,bestD=weldRadius2;
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of welded.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[]){
        const d=(positions[i*3]-positions[j*3])**2+(positions[i*3+1]-positions[j*3+1])**2+(positions[i*3+2]-positions[j*3+2])**2;if(d<=bestD){best=j;bestD=d;}
      }
      aliases[i]=best<0?i:aliases[best];const k=cell.join(',');if(!welded.has(k))welded.set(k,[]);welded.get(k).push(i);
    }
    const ids=p.getIndices()?.getArray(),edgeCounts=new Map();if(ids)for(let f=0;f<ids.length;f+=3)for(let e=0;e<3;e++){
      const a=aliases[ids[f+e]],b=aliases[ids[f+(e+1)%3]];if(a!==b){neighbours[a].add(b);neighbours[b].add(a);const key=a<b?`${a}:${b}`:`${b}:${a}`,entry=edgeCounts.get(key)||{a:Math.min(a,b),b:Math.max(a,b),count:0};entry.count++;edgeCounts.set(key,entry);}
    }
    for(let i=0;i<count;i++)if(aliases[i]!==i)neighbours[i]=neighbours[aliases[i]];
    let hemLoop=[];
    if(p.getMaterial()?.getName()==='shirt'&&hipY!==null){
      const boundary=Array.from({length:count},()=>new Set());
      for(const edge of edgeCounts.values())if(edge.count===1&&positions[edge.a*3+1]<hipY+.12&&positions[edge.b*3+1]<hipY+.12){boundary[edge.a].add(edge.b);boundary[edge.b].add(edge.a);}
      const remaining=new Set(boundary.flatMap((adjacent,i)=>adjacent.size?[i]:[]));
      while(remaining.size){const start=remaining.values().next().value,stack=[start],component=[];remaining.delete(start);while(stack.length){const i=stack.pop();component.push(i);for(const j of boundary[i])if(remaining.delete(j))stack.push(j);}if(component.length>hemLoop.length)hemLoop=component;}
      hemLoop.sort((a,b)=>Math.atan2(positions[a*3],positions[a*3+2])-Math.atan2(positions[b*3],positions[b*3+2]));
    }
    return {p,base:positions,shapes:p.listTargets().map(t=>Float32Array.from(t.getAttribute('POSITION').getArray())),out:[],aliases,neighbours,hemLoop,skinJ:p.getAttribute('JOINTS_0')?Uint16Array.from(p.getAttribute('JOINTS_0').getArray()):null,skinW:p.getAttribute('WEIGHTS_0')?Float32Array.from(p.getAttribute('WEIGHTS_0').getArray()):null};
  });
  const q=[],delta=[],point=new Vector3(),closest=new Vector3(),bestPoint=new Vector3(),bestNormal=new Vector3(),bestBary=new Vector3(),bary=new Vector3(),direction=new Vector3();
  const key=(x,y,z)=>`${x},${y},${z}`;
  const names=mesh.getExtras().targetNames||[];
  const samples=sliderSamples||[{},...body.listTargets().map((_,i)=>({[names[i]]:1}))];
  for(let shape=0;shape<samples.length;shape++){
    const weights=sliderSamples?samples[shape].weights:samples[shape];
    const active=Object.entries(weights).filter(([,w])=>w!==0).map(([name,w])=>({index:names.indexOf(name),w})).filter(t=>t.index>=0);
    const mix=(attrName,index,baseValues)=>{
      const values=[...baseValues];for(const t of active){const attr=body.listTargets()[t.index].getAttribute(attrName);if(!attr)continue;attr.getElement(index,delta);for(let c=0;c<3;c++)values[c]+=delta[c]*t.w;}return values;
    };
    const points=[],normals=[];
    for(let i=0;i<base.getCount();i++){
      base.getElement(i,q);points.push(new Vector3(...mix('POSITION',i,q)));
      normal.getElement(i,q);normals.push(new Vector3(...mix('NORMAL',i,q)).normalize());
    }
    const faces=[],grid=new Map();
    for(let f=0;f<indices.length;f+=3){
      const ids=[indices[f],indices[f+1],indices[f+2]],tri=new Triangle(...ids.map(i=>points[i]));
      const min=[0,1,2].map(c=>Math.floor(Math.min(...ids.map(i=>points[i].getComponent(c)))/step)),max=[0,1,2].map(c=>Math.floor(Math.max(...ids.map(i=>points[i].getComponent(c)))/step));
      const index=faces.length;faces.push({tri,ids});
      for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
        const k=key(x,y,z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(index);
      }
    }
    for(const source of sources){
      const positions=Float32Array.from(source.base,(v,i)=>v+active.reduce((s,t)=>s+source.shapes[t.index][i]*t.w,0)),unfitted=Float32Array.from(positions),constraints=[];let changed=0;
      for(let i=0;i<positions.length/3;i++){
        point.fromArray(positions,i*3);let best=reach*reach,found=false,bestFace=null;const seen=new Set();
        const min=[point.x,point.y,point.z].map(v=>Math.floor((v-reach)/step)),max=[point.x,point.y,point.z].map(v=>Math.floor((v+reach)/step));
        for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++)for(const f of grid.get(key(x,y,z))||[]){
          if(seen.has(f))continue;seen.add(f);const face=faces[f];face.tri.closestPointToPoint(point,closest);const distance=closest.distanceToSquared(point);
          if(distance>=best)continue;
          face.tri.getBarycoord(closest,bary);if(!Number.isFinite(bary.x))continue;
          best=distance;found=true;bestFace=face;bestBary.copy(bary);bestPoint.copy(closest);bestNormal.copy(normals[face.ids[0]]).multiplyScalar(bary.x).addScaledVector(normals[face.ids[1]],bary.y).addScaledVector(normals[face.ids[2]],bary.z).normalize();
        }
        if(found && bestFace && sliderSamples?.[shape].percent===100 && bodyJ && bodyW && source.skinJ && source.skinW){
          const weights=new Map(),j=[],w=[];
          for(let corner=0;corner<3;corner++){bodyJ.getElement(bestFace.ids[corner],j);bodyW.getElement(bestFace.ids[corner],w);for(let k=0;k<4;k++)weights.set(j[k],(weights.get(j[k])||0)+w[k]*bestBary.getComponent(corner));}
          const top=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,p)=>s+p[1],0);
          source.skinJ.fill(0,i*4,i*4+4);source.skinW.fill(0,i*4,i*4+4);
          top.forEach(([j,w],k)=>{source.skinJ[i*4+k]=j;source.skinW[i*4+k]=w/sum;});
        }
        if(found){
          const signed=direction.copy(point).sub(bestPoint).dot(bestNormal),isShirt=source.p.getMaterial().getName()==='shirt';
          const ease=isShirt&&hipY!==null?Math.max(0,Math.min(1,(hipY+.16-bestPoint.y)/.08)):0;
          const clearance=isShirt?.006+.006*ease*ease*(3-2*ease):.004;
          constraints[i]={point:bestPoint.toArray(),normal:bestNormal.toArray(),clearance};
          if(signed<clearance){point.copy(bestPoint).addScaledVector(bestNormal,clearance);point.toArray(positions,i*3);changed++;}
        }
      }
      // Smooth the small skin-clearance corrections across connected fabric.
      // Nearest-triangle snapping is intentionally local, but doing it one
      // vertex at a time can leave little kinks along a sewn edge.
      const correction=Float32Array.from(positions,(v,i)=>v-unfitted[i]);
      for(let pass=0;pass<12;pass++){
        const next=new Float32Array(correction);
        for(let i=0;i<correction.length/3;i++){
          if(source.aliases[i]!==i)continue;const adjacent=[...source.neighbours[i]];if(!adjacent.length)continue;
          for(let c=0;c<3;c++)next[i*3+c]=correction[i*3+c]*.58+.42*adjacent.reduce((sum,j)=>sum+correction[j*3+c],0)/adjacent.length;
        }
        for(let i=0;i<source.aliases.length;i++)if(source.aliases[i]!==i)next.set(next.subarray(source.aliases[i]*3,source.aliases[i]*3+3),i*3);
        correction.set(next);
      }
      for(let i=0;i<positions.length/3;i++){
        for(let c=0;c<3;c++)positions[i*3+c]=unfitted[i*3+c]+correction[i*3+c];
        const constraint=constraints[i];if(!constraint)continue;
        const fitted=point.fromArray(positions,i*3),surface=closest.fromArray(constraint.point),n=direction.fromArray(constraint.normal),distance=fitted.sub(surface).dot(n);
        // Keep a small guaranteed air gap, but do not snap every vertex back
        // to its individual clearance target: that last pointwise correction
        // is what turns a faired seam into a sawtooth again.
        const minimumGap=Math.min(constraint.clearance,.004);
        if(distance<minimumGap){point.copy(surface).addScaledVector(n,minimumGap).toArray(positions,i*3);}
      }
      // Fair the final shirt surface, rather than only its clearance offsets.
      // The lower panel join and the protected cup boundary otherwise survive
      // as hard contour lines. Use shared UV vertices and retain skin clearance.
      if(source.p.getMaterial().getName()==='shirt' && hipY!==null){
        const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
        const weights=new Float32Array(source.aliases.length);
        const hem=new Set(source.hemLoop);
        for(let i=0;i<weights.length;i++){
          const x=Math.abs(source.base[i*3]),y=source.base[i*3+1],z=source.base[i*3+2];
          const abdomen=smooth(hipY+.015,hipY+.10,y)*smooth(1.22,1.13,y);
          const underBust=smooth(1.08,1.17,y)*smooth(1.30,1.235,y);
          weights[i]=hem.has(source.aliases[i])?0:.45*Math.max(abdomen,underBust)*smooth(-.06,.025,z)*smooth(.25,.19,x);
        }
        for(let pass=0;pass<150;pass++){
          const next=new Float32Array(positions);
          for(let i=0;i<weights.length;i++){
            if(source.aliases[i]!==i || !weights[i])continue;
            const ns=[...source.neighbours[i]];if(!ns.length)continue;
            for(let c=0;c<3;c++)next[i*3+c]+=weights[i]*(ns.reduce((v,j)=>v+positions[j*3+c],0)/ns.length-positions[i*3+c]);
            const constraint=constraints[i];
            if(constraint){
              point.fromArray(next,i*3);closest.fromArray(constraint.point);direction.fromArray(constraint.normal);
              const gap=point.clone().sub(closest).dot(direction);
              if(gap<.004)point.addScaledVector(direction,.004-gap).toArray(next,i*3);
            }
          }
          for(let i=0;i<weights.length;i++)if(source.aliases[i]!==i)next.set(next.subarray(source.aliases[i]*3,source.aliases[i]*3+3),i*3);
          positions.set(next);
        }
      }
      // Fair the actual open hem loop after skin fitting. Its analytic source
      // curve is smooth, but triangle-by-triangle skin projection can add
      // small notches back at the boundary. Carry most of that fairing into
      // the first interior ring so the cloth remains a continuous sheet.
      if(source.hemLoop.length>32){
        const seam=new Set(source.hemLoop),original=new Float32Array(positions),ring=Float32Array.from(source.hemLoop.flatMap(i=>Array.from(positions.subarray(i*3,i*3+3))));
        for(let pass=0;pass<20;pass++){
          const next=new Float32Array(ring);
          for(let k=0;k<source.hemLoop.length;k++)for(let c=0;c<3;c++)next[k*3+c]=ring[k*3+c]*.5+(ring[((k+source.hemLoop.length-1)%source.hemLoop.length)*3+c]+ring[((k+1)%source.hemLoop.length)*3+c])*.25;
          ring.set(next);
        }
        const delta=new Map(),ringIndex=new Map();source.hemLoop.forEach((i,k)=>{delta.set(i,Array.from(ring.subarray(k*3,k*3+3),(v,c)=>v-original[i*3+c]));ringIndex.set(i,k);});
        for(const i of source.hemLoop)for(let c=0;c<3;c++)positions[i*3+c]=ring[ringIndex.get(i)*3+c];
        const inner=new Map();for(const i of source.hemLoop)for(const j of source.neighbours[i])if(!seam.has(j)){const slot=inner.get(j)||[0,0,0,0];for(let c=0;c<3;c++)slot[c]+=delta.get(i)[c];slot[3]++;inner.set(j,slot);}
        for(const[j,slot]of inner)for(let c=0;c<3;c++)positions[j*3+c]+=slot[c]/slot[3]*.65;
        for(let i=0;i<positions.length/3;i++)if(source.aliases[i]!==i)positions.set(positions.subarray(source.aliases[i]*3,source.aliases[i]*3+3),i*3);
        // A small safety gap remains under the faired hem.
        for(const i of source.hemLoop){const constraint=constraints[i];if(!constraint)continue;point.fromArray(positions,i*3);closest.fromArray(constraint.point);direction.fromArray(constraint.normal);if(point.sub(closest).dot(direction)<.004)point.copy(closest).addScaledVector(direction,.004).toArray(positions,i*3);}
      }
      source.out.push(positions);
      if(shape===0)log(`fit: ${source.p.getMaterial().getName()}, ${changed} points fitted just outside retained skin${source.hemLoop.length?`, faired ${source.hemLoop.length}-vertex hem`:''}`);
    }
  }
  if(sliderSamples){
    const baseSample=sliderSamples.findIndex(s=>s.percent===100);
    for(const source of sources){
      const weights=sliderSamples[baseSample].weights;
      const fittedBase=Float32Array.from(source.out[baseSample],(v,i)=>v-Object.entries(weights).reduce((sum,[name,w])=>{const index=names.indexOf(name);return sum+(index>=0?source.shapes[index][i]*w:0);},0));
      const topology=aliasGroups(fittedBase,source.p.getIndices().getArray());source.aliases=topology.aliases;source.neighbours=topology.neighbours;
    }
    for(const source of sources)if(source.skinJ&&source.skinW){
      // The nearest body's weights can change abruptly across adjacent body
      // triangles. Fair those weights over a few cloth edges so the garment
      // deforms as one sewn surface, including vertices duplicated for UVs.
      const jointFields=Array.from({length:source.skinJ.length/4},(_,i)=>{
        const values=new Map();for(let k=0;k<4;k++){const joint=source.skinJ[i*4+k];values.set(joint,(values.get(joint)||0)+source.skinW[i*4+k]);}return values;
      });
      let fields=jointFields;
      for(let pass=0;pass<16;pass++){
        const next=fields.map((values,i)=>{
          if(source.aliases[i]!==i)return new Map(fields[source.aliases[i]]);
          const adjacent=[...source.neighbours[i]],result=new Map();
          for(const[joint,weight]of values)result.set(joint,(result.get(joint)||0)+weight*.58);
          if(adjacent.length)for(const j of adjacent)for(const[joint,weight]of fields[j])result.set(joint,(result.get(joint)||0)+weight*.42/adjacent.length);
          else for(const[joint,weight]of values)result.set(joint,weight);
          return result;
        });fields=next;
      }
      fields.forEach((values,i)=>{
        const top=[...values].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,entry)=>s+entry[1],0);
        source.skinJ.fill(0,i*4,i*4+4);source.skinW.fill(0,i*4,i*4+4);
        top.forEach(([joint,weight],k)=>{source.skinJ[i*4+k]=joint;source.skinW[i*4+k]=weight/sum;});
      });
      source.p.getAttribute('JOINTS_0').setArray(source.skinJ);source.p.getAttribute('WEIGHTS_0').setArray(source.skinW);
    }
    for(const source of sources){
      const corrections=source.out.map((p,k)=>Float32Array.from(p,(v,i)=>v-source.base[i]-Object.entries(sliderSamples[k].weights).reduce((s,[name,w])=>s+(names.indexOf(name)>=0?source.shapes[names.indexOf(name)][i]*w:0),0)));
      const baseCorrection=corrections[baseSample];
      source.p.getAttribute('POSITION').setArray(Float32Array.from(source.base,(v,i)=>v+baseCorrection[i]));
      sliderSamples.forEach((sample,k)=>{if(!sample.bellyTarget)return;const index=names.indexOf(sample.bellyTarget);
        source.p.listTargets()[index].getAttribute('POSITION').setArray(Float32Array.from(source.shapes[index],(v,i)=>v+corrections[k][i]-baseCorrection[i]));
      });
    }
    // Encode lighting at the SAME combined slider keys as the fitted surface.
    // Keeping pre-fit normals draws the old belly and under-bust creases over
    // the corrected cloth, especially at the smaller belly settings.
    for(const source of sources){
      const samples=source.out.map(p=>fittedNormals(source.p,p,source.aliases));
      if(!samples[0])continue;
      const old=source.p.listTargets().map(t=>t.getAttribute('NORMAL')?.getArray());
      const contribution=(sample,i,except=null)=>Object.entries(sample.weights).reduce((sum,[name,w])=>{
        const k=names.indexOf(name);return sum+(name!==except&&k>=0&&old[k]?old[k][i]*w:0);
      },0);
      const baseNormals=Float32Array.from(samples[baseSample],(v,i)=>v-contribution(sliderSamples[baseSample],i));
      // Capture all contributions before replacing any target arrays.
      const targets=sliderSamples.map((sample,k)=>sample.bellyTarget?Float32Array.from(samples[k],(v,i)=>v-baseNormals[i]-contribution(sample,i,sample.bellyTarget)):null);
      source.p.getAttribute('NORMAL').setArray(baseNormals);
      sliderSamples.forEach((sample,k)=>{if(targets[k])source.p.listTargets()[names.indexOf(sample.bellyTarget)].getAttribute('NORMAL').setArray(targets[k]);});
    }
    return;
  }
  for(const source of sources){
    const normals=source.out.map(p=>fittedNormals(source.p,p,source.aliases));
    if(normals[0]){
      source.p.getAttribute('NORMAL').setArray(normals[0]);
      source.p.listTargets().forEach((t,k)=>{if(t.getAttribute('NORMAL'))t.getAttribute('NORMAL').setArray(Float32Array.from(normals[k+1],(v,i)=>v-normals[0][i]));});
    }
    source.p.getAttribute('POSITION').setArray(source.out[0]);
    source.p.listTargets().forEach((t,shape)=>t.getAttribute('POSITION').setArray(Float32Array.from(source.out[shape+1],(v,i)=>v-source.out[0][i])));
  }
}
