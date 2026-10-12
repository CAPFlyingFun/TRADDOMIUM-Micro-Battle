/** Replace the tee's skin-derived hip panels with one closed fabric tube.
 * The torso, neckline and sleeves keep their existing geometry. The new lower
 * section samples the body and all its morphs, spans the seat, and shares the
 * exact clipped waist boundary, so no overlapping panels remain at the hips.
 */
import sharp from 'sharp';
import { HEM_FRONT, HEM_BACK, GARMENTS, jointPositions, partsOf } from './growClothes.mjs';

export async function rebuildShirtHem(doc, {log=()=>{}}={}) {
  const mesh=doc.getRoot().listMeshes()[0], skin=doc.getRoot().listSkins()[0];
  const shirt=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
  const body=mesh.listPrimitives().find(p=>p.getMaterial()?.getName()==='Material_0');
  const {part,pelvis,hipY}=partsOf(skin,jointPositions(skin));
  const cutY=hipY+.20, rows=24, tau=2*Math.PI;
  const frontArc=theta=>{const f=Math.max(0,Math.cos(theta));return f*f*(3-2*f);};
  const P=shirt.getAttribute('POSITION'),idx=shirt.getIndices().getArray();
  const arrays=new Map(shirt.listSemantics().map(name=>[name,shirt.getAttribute(name)]));
  const mixes=[],cache=new Map(),faces=[],v=[];
  const vertex=(a,b=a,t=0)=>{
    if(t<1e-7){b=a;t=0;}else if(t>1-1e-7){a=b;t=0;}
    const key=a===b?`${a}`:[a,b].sort((a,b)=>a-b).join(':');
    if(!cache.has(key)){cache.set(key,mixes.length);mixes.push(a===b?[[a,1]]:[[a,1-t],[b,t]]);}
    return cache.get(key);
  };
  // Accessors return the supplied array; use explicit reads for all versions.
  const ys=Array.from({length:P.getCount()},(_,i)=>{P.getElement(i,v);return v[1];});
  const cross=(a,b)=>vertex(a,b,(cutY-ys[a])/(ys[b]-ys[a]));
  for(let f=0;f<idx.length;f+=3) {
    const tri=[idx[f],idx[f+1],idx[f+2]],inside=tri.map(i=>ys[i]>=cutY),n=inside.filter(Boolean).length;
    if(!n)continue;
    if(n===3){faces.push(...tri.map(i=>vertex(i)));continue;}
    let r=0;while(n===1?!inside[r]:inside[r])r++;
    const a=tri[r],b=tri[(r+1)%3],c=tri[(r+2)%3];
    if(n===1)faces.push(vertex(a),cross(a,b),cross(a,c));
    else{const ab=cross(b,a),ac=cross(c,a);faces.push(vertex(b),vertex(c),ac,vertex(b),ac,ab);}
  }
  const upperCount=mixes.length;
  const interpolate=(attr,mix)=>{
    const out=new Array(attr.getElementSize()).fill(0),q=[];
    for(const[i,w]of mix){attr.getElement(i,q);for(let c=0;c<out.length;c++)out[c]+=q[c]*w;}return out;
  };
  const rest=mixes.map(m=>interpolate(P,m)),boundary=new Map();
  rest.forEach((p,i)=>{if(Math.abs(p[1]-cutY)<1e-5){const key=p.map(v=>Math.round(v*1e5)).join(',');if(!boundary.has(key))boundary.set(key,[]);boundary.get(key).push(i);}});
  const loop=[...boundary.values()].map(ids=>ids[0]).sort((a,b)=>Math.atan2(rest[a][0],rest[a][2])-Math.atan2(rest[b][0],rest[b][2]));
  if(loop.length<32)throw new Error('Shirt waist boundary is missing');
  // Match the old artwork at the UV seam, then fade to plain lower fabric.
  // A constant colour below a shaded atlas otherwise draws a false waist cut.
  const artwork=await sharp(shirt.getMaterial().getBaseColorTexture().getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  const edgeColours=loop.map(i=>{
    const uv=interpolate(shirt.getAttribute('TEXCOORD_0'),mixes[i]);
    const x=Math.max(0,Math.min(artwork.info.width-1,Math.floor(uv[0]*artwork.info.width)));
    const y=Math.max(0,Math.min(artwork.info.height-1,Math.floor(uv[1]*artwork.info.height)));
    const offset=(y*artwork.info.width+x)*artwork.info.channels;
    return GARMENTS.shirt.colour.map((c,k)=>linear(artwork.data[offset+k]/255)/c);
  });
  const aliases=new Map();for(const ids of boundary.values())for(const i of ids)aliases.set(i,ids[0]);
  const BP=body.getAttribute('POSITION'),BI=body.getIndices().getArray(),BJ=body.getAttribute('JOINTS_0'),BW=body.getAttribute('WEIGHTS_0');
  const points=Array.from({length:BP.getCount()},(_,i)=>{BP.getElement(i,v);return [...v];});
  const allowed=points.map((_,i)=>{const j=[],w=[];BJ.getElement(i,j);BW.getElement(i,w);return j.reduce((s,k,c)=>s+(part[k]==='torso'||part[k]==='legs'?w[c]:0),0)>.8;});
  const bins=new Map(),bin=.005;
  for(let f=0;f<BI.length;f+=3){const t=[BI[f],BI[f+1],BI[f+2]];if(!t.every(i=>allowed[i]))continue;
    const low=Math.floor(Math.min(...t.map(i=>points[i][1]))/bin),high=Math.floor(Math.max(...t.map(i=>points[i][1]))/bin);
    for(let k=low;k<=high;k++){if(!bins.has(k))bins.set(k,[]);bins.get(k).push(t);}}
  const hit=(theta,height)=>{
    const dx=Math.sin(theta),dz=Math.cos(theta);let best=null,max=0;
    for(const tri of bins.get(Math.floor(height/bin))||[]) {
      const crossings=[];
      for(let e=0;e<3;e++){const a=tri[e],b=tri[(e+1)%3],pa=points[a],pb=points[b];if((pa[1]<=height&&pb[1]>height)||(pb[1]<=height&&pa[1]>height)){
        const t=(height-pa[1])/(pb[1]-pa[1]);crossings.push({x:pa[0]*(1-t)+pb[0]*t,z:pa[2]*(1-t)+pb[2]*t,m:[[a,1-t],[b,t]]});}}
      if(crossings.length!==2)continue;
      const[a,b]=crossings,ex=b.x-a.x,ez=b.z-a.z,den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;
      const radius=(a.x*ez-a.z*ex)/den,t=(a.x*dz-a.z*dx)/den;
      if(radius<=max||t<0||t>1)continue;
      const m=new Map();for(const[i,w]of a.m)m.set(i,(m.get(i)||0)+w*(1-t));for(const[i,w]of b.m)m.set(i,(m.get(i)||0)+w*t);
      best=[...m];max=radius;
    }
    if(!best)throw new Error(`No skin under shirt hem at ${height.toFixed(3)}, angle ${theta.toFixed(3)}`);
    return best;
  };
  const topMixes=loop.map(i=>hit(Math.atan2(rest[i][0],rest[i][2]),cutY));
  const lower=[];
  for(let row=0;row<=rows;row++)for(let col=0;col<loop.length;col++) {
    const u=row/rows,originalTheta=Math.atan2(rest[loop[col]][0],rest[loop[col]][2]);
    const phase=Math.min(1,u/.35),blend=phase*phase*(3-2*phase);
    const uniformTheta=-Math.PI+tau*col/loop.length;
    const theta=originalTheta*(1-blend)+uniformTheta*blend;
    const hemY=hipY-HEM_BACK-(HEM_FRONT-HEM_BACK)*frontArc(theta);
    const height=cutY*(1-u)+hemY*u;
    lower.push({col,row,u,theta,height,mix:hit(theta,height)});
  }
  const total=upperCount+lower.length;
  for(let row=1;row<=rows;row++)for(let col=0;col<loop.length;col++) {
    const next=(col+1)%loop.length,a=upperCount+(row-1)*loop.length+col,b=upperCount+(row-1)*loop.length+next;
    const c=upperCount+row*loop.length+col,d=upperCount+row*loop.length+next;
    faces.push(a,c,b,b,c,d);
  }
  // Weld only for fairing: retain UV duplicates but give them one surface.
  const canonical=Array.from({length:total},(_,i)=>i),welded=new Map();
  rest.forEach((p,i)=>{const key=p.map(v=>Math.round(v*1e5)).join(',');if(!welded.has(key))welded.set(key,i);canonical[i]=welded.get(key);});
  loop.forEach((anchor,col)=>{canonical[upperCount+col]=canonical[anchor];});
  const neighbours=Array.from({length:total},()=>new Set());
  for(let f=0;f<faces.length;f+=3)for(let e=0;e<3;e++){
    const a=canonical[faces[f+e]],b=canonical[faces[f+(e+1)%3]];if(a!==b){neighbours[a].add(b);neighbours[b].add(a);}
  }
  const upperShapes=[null,...shirt.listTargets()];
  const bodyShapes=[null,...body.listTargets()];
  const shapePositions=upperShapes.map((target,shape)=>{
    const upperDelta=target?.getAttribute('POSITION'),bodyDelta=bodyShapes[shape]?.getAttribute('POSITION');
    const out=new Float32Array(total*3),q=[];
    mixes.forEach((m,i)=>{const p=[...rest[i]];if(upperDelta){const d=interpolate(upperDelta,m);for(let c=0;c<3;c++)p[c]+=d[c];}out.set(p,i*3);});
    lower.forEach((entry,k)=>{
      if(entry.row===0){out.set(out.subarray(loop[entry.col]*3,loop[entry.col]*3+3),(upperCount+k)*3);return;}
      const p=[0,0,0];for(const[i,w]of entry.mix){if(bodyDelta)bodyDelta.getElement(i,q);for(let c=0;c<3;c++)p[c]+=(points[i][c]+(bodyDelta?q[c]:0))*w;}
      const radius=Math.hypot(p[0],p[2])||1;
      const edgeDistance=(1-entry.u)*(cutY-(hipY-HEM_BACK-(HEM_FRONT-HEM_BACK)*frontArc(entry.theta)));
      const roll=.0015*Math.max(0,1-edgeDistance/.014);
      const edgeT=Math.max(0,(entry.u-.65)/.35),edgeFade=edgeT*edgeT*(3-2*edgeT);
      const offset=.006+roll+.004*edgeFade;
      p[1]-=.008*edgeFade;
      p[0]+=p[0]/radius*offset;p[2]+=p[2]/radius*offset;
      // Join exactly to the existing torso and fade the matching correction out.
      const anchor=loop[entry.col],baseTop=topMixes[entry.col],top=[0,0,0];
      for(const[i,w]of baseTop){if(bodyDelta)bodyDelta.getElement(i,q);for(let c=0;c<3;c++)top[c]+=(points[i][c]+(bodyDelta?q[c]:0))*w;}
      const topR=Math.hypot(top[0],top[2])||1;top[0]+=top[0]/topR*.006;top[2]+=top[2]/topR*.006;
      const t=Math.min(1,entry.u/.35),fade=1-t*t*(3-2*t);
      for(let c=0;c<3;c++)p[c]+=(out[anchor*3+c]-top[c])*fade;
      out.set(p,(upperCount+k)*3);
    });
    // Resample each fabric column at monotonic heights and span concavities.
    // This removes skin folds and the navel impression from the shirt, while
    // preserving the rounded silhouette and the exact upper and lower edges.
    const hull=values=>{
      const h=[];for(const p of [...values].sort((a,b)=>a[0]-b[0])){
        while(h.length>1){const a=h[h.length-2],b=h[h.length-1];
          if((b[0]-a[0])*(p[1]-b[1])-(b[1]-a[1])*(p[0]-b[0])<0)break;h.pop();}h.push(p);
      }return h;
    };
    const at=(h,y)=>{for(let i=1;i<h.length;i++)if(y<=h[i][0]){
      const a=h[i-1],b=h[i],t=Math.max(0,Math.min(1,(y-a[0])/(b[0]-a[0]||1)));return a[1]*(1-t)+b[1]*t;
    }return h[h.length-1][1];};
    const original=new Float32Array(out);
    for(let col=0;col<loop.length;col++) {
      const profile=Array.from({length:rows+1},(_,row)=>Array.from(original.subarray((upperCount+row*loop.length+col)*3,(upperCount+row*loop.length+col)*3+3))).sort((a,b)=>a[1]-b[1]);
      const front=hull(profile.map(p=>[p[1],p[2]])),back=hull(profile.map(p=>[p[1],-p[2]]));
      const top=original[(upperCount+col)*3+1],bottom=original[(upperCount+rows*loop.length+col)*3+1];
      for(let row=1;row<rows;row++) {
        const i=upperCount+row*loop.length+col,y=top*(1-row/rows)+bottom*row/rows;
        let j=1;while(j<profile.length-1&&profile[j][1]<y)j++;
        const a=profile[j-1],b=profile[j],t=Math.max(0,Math.min(1,(y-a[1])/(b[1]-a[1]||1)));
        out[i*3]=a[0]*(1-t)+b[0]*t;out[i*3+1]=y;out[i*3+2]=a[2]*(1-t)+b[2]*t;
        if(out[i*3+2]>0)out[i*3+2]=Math.max(out[i*3+2],at(front,y));
        else out[i*3+2]=Math.min(out[i*3+2],-at(back,y));
      }
    }
    for(let row=1;row<=rows;row++) {
      const start=upperCount+row*loop.length;
      let back=0;for(let col=0;col<loop.length;col++){const i=start+col;if(Math.abs(out[i*3])<.16)back=Math.min(back,out[i*3+2]);}
      for(let col=0;col<loop.length;col++){const i=start+col,px=out[i*3],pz=out[i*3+2];if(pz>=-.025||Math.abs(px)>.16)continue;
        const t=Math.max(0,Math.min(1,(.16-Math.abs(px))/.08)),weight=t*t*(3-2*t);out[i*3+2]+=(back-pz)*weight;
      }
    }
    // Fair the closed hem itself: body sampling must not leave hip notches.
    // Blend that correction into the final few rings rather than moving only
    // the boundary, which would introduce another shading crease.
    const hemStart=upperCount+rows*loop.length;
    const hemOriginal=out.slice(hemStart*3),hem=new Float32Array(hemOriginal);
    for(let pass=0;pass<48;pass++){
      const next=new Float32Array(hem);
      for(let col=0;col<loop.length;col++)for(let c=0;c<3;c++)next[col*3+c]=.5*hem[col*3+c]+.25*(hem[((col+1)%loop.length)*3+c]+hem[((col+loop.length-1)%loop.length)*3+c]);
      hem.set(next);
    }
    for(let row=1;row<=rows;row++){
      const t=Math.max(0,(row/rows-.65)/.35),fade=t*t*(3-2*t);
      for(let col=0;col<loop.length;col++)for(let c=0;c<3;c++)out[(upperCount+row*loop.length+col)*3+c]+=(hem[col*3+c]-hemOriginal[col*3+c])*fade;
    }
    // Round the fabric envelope without moving its neckline attachment or hem.
    // The topology is a single sheet, so fairing cannot expose crossed panels.
    for(let pass=0;pass<24;pass++) {
      const next=new Float32Array(out);
      for(let row=1;row<rows;row++)for(let col=0;col<loop.length;col++) {
        const i=upperCount+row*loop.length+col,neighbours=[i-loop.length,i+loop.length,upperCount+row*loop.length+(col+1)%loop.length,upperCount+row*loop.length+(col+loop.length-1)%loop.length];
        for(const c of [0,2])next[i*3+c]=.7*out[i*3+c]+.3*neighbours.reduce((s,j)=>s+out[j*3+c],0)/4;
      }out.set(next);
    }
    // Fair both sides of the waist attachment, not only the lower patch.
    // The old waist silhouette otherwise leaves a ledge at the new tube.
    for(let pass=0;pass<36;pass++){
      const next=new Float32Array(out);
      for(let i=0;i<total;i++){
        if(canonical[i]!==i||!neighbours[i].size)continue;
        const y=i<upperCount?rest[i][1]:lower[i-upperCount].height;
        const t=Math.max(0,1-Math.abs(y-cutY)/.07),weight=.3*t*t*(3-2*t);
        if(!weight)continue;
        for(let c=0;c<3;c++)next[i*3+c]=out[i*3+c]*(1-weight)+weight*[...neighbours[i]].reduce((s,j)=>s+out[j*3+c],0)/neighbours[i].size;
      }
      for(let i=0;i<total;i++)if(canonical[i]!==i)next.set(next.subarray(canonical[i]*3,canonical[i]*3+3),i*3);
      out.set(next);
    }
    return out;
  });
  // Check winding of the new tube independently of the source mesh.
  const pos=shapePositions[0],upperFaceCount=faces.length-rows*loop.length*6;
  for(let f=upperFaceCount;f<faces.length;f+=3){const[a,b,c]=faces.slice(f,f+3),u=[0,1,2].map(k=>pos[b*3+k]-pos[a*3+k]),v=[0,1,2].map(k=>pos[c*3+k]-pos[a*3+k]);const nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];if(nx*pos[a*3]+nz*pos[a*3+2]<0)[faces[f+1],faces[f+2]]=[faces[f+2],faces[f+1]];}
  const normals=shapePositions.map((p,shape)=>{
    const out=new Float32Array(total*3),target=upperShapes[shape]?.getAttribute('NORMAL'),base=shirt.getAttribute('NORMAL');
    mixes.forEach((m,i)=>{const n=interpolate(base,m),d=target?interpolate(target,m):[0,0,0];out.set(n.map((v,c)=>v+d[c]),i*3);});
    const acc=new Float32Array(total*3);
    for(let f=0;f<faces.length;f+=3){const[a,b,c]=faces.slice(f,f+3),u=[0,1,2].map(k=>p[b*3+k]-p[a*3+k]),v=[0,1,2].map(k=>p[c*3+k]-p[a*3+k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const i of[a,b,c])for(let k=0;k<3;k++)acc[canonical[i]*3+k]+=n[k];}
    for(let i=0;i<total;i++){
      const r=canonical[i],l=Math.hypot(...acc.subarray(r*3,r*3+3))||1;
      const t=i>=upperCount?1:Math.max(0,1-Math.abs(rest[i][1]-cutY)/.09),weight=t*t*(3-2*t);
      for(let c=0;c<3;c++)out[i*3+c]=out[i*3+c]*(1-weight)+acc[r*3+c]/l*weight;
      const length=Math.hypot(...out.subarray(i*3,i*3+3))||1;for(let c=0;c<3;c++)out[i*3+c]/=length;
    }
    // Even shading over the new sheet, including its sewn upper join.
    for(let pass=0;pass<12;pass++) {
      const next=new Float32Array(out);
      for(let row=0;row<=rows;row++)for(let col=0;col<loop.length;col++) {
        const i=upperCount+row*loop.length+col,neighbours=[upperCount+row*loop.length+(col+1)%loop.length,upperCount+row*loop.length+(col+loop.length-1)%loop.length];
        if(row>0)neighbours.push(i-loop.length);if(row<rows)neighbours.push(i+loop.length);
        for(let c=0;c<3;c++)next[i*3+c]=.6*out[i*3+c]+.4*neighbours.reduce((s,j)=>s+out[j*3+c],0)/neighbours.length;
        const l=Math.hypot(...next.subarray(i*3,i*3+3))||1;for(let c=0;c<3;c++)next[i*3+c]/=l;
      }out.set(next);
    }
    for(const[i,r]of aliases){const col=loop.indexOf(r);out.set(out.subarray((upperCount+col)*3,(upperCount+col)*3+3),i*3);}
    return out;
  });
  const buffer=P.getBuffer(),accessor=(name,type,data)=>doc.createAccessor(name).setBuffer(buffer).setType(type).setArray(data);
  for(const[name,attr]of arrays) {
    if(name==='POSITION'||name==='NORMAL')continue;
    const size=attr.getElementSize(),data=new Float32Array(total*size);
    if(name==='JOINTS_0'||name==='WEIGHTS_0')continue;
    mixes.forEach((m,i)=>{const q=interpolate(attr,m);if(name==='TEXCOORD_0')q[1]*=.5;data.set(q,i*size);});
    lower.forEach((entry,k)=>{
      if(name==='COLOR_0'){const distance=(1-entry.u)*(cutY-(hipY-HEM_BACK-(HEM_FRONT-HEM_BACK)*frontArc(entry.theta))),band=Math.max(0,1-distance/.014),tint=1-.16*band;const t=Math.min(1,entry.u/.35),fade=1-t*t*(3-2*t);data.set(Array.from({length:size},(_,c)=>tint*(c<3?1+(edgeColours[entry.col][c]-1)*fade:1)),(upperCount+k)*size);}
      if(name==='TEXCOORD_0')data.set([entry.col/loop.length,.501+entry.u*.498],(upperCount+k)*size);
    });
    shirt.setAttribute(name,accessor(`shirt-continuous-${name}`,attr.getType(),data));
  }
  const joints=new Uint16Array(total*4),weights=new Float32Array(total*4),J=shirt.getAttribute('JOINTS_0'),W=shirt.getAttribute('WEIGHTS_0');
  mixes.forEach((mix,i)=>{
    const skinMix=new Map();for(const[k,t]of mix){const j=[],w=[];J.getElement(k,j);W.getElement(k,w);for(let c=0;c<4;c++)skinMix.set(j[c],(skinMix.get(j[c])||0)+w[c]*t);}
    const top=[...skinMix].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,p)=>s+p[1],0);top.forEach(([j,w],c)=>{joints[i*4+c]=j;weights[i*4+c]=w/sum;});
  });
  for(const[i,r]of aliases)if(i!==r){joints.set(joints.subarray(r*4,r*4+4),i*4);weights.set(weights.subarray(r*4,r*4+4),i*4);}
  lower.forEach((entry,k)=>{const i=upperCount+k,anchor=loop[entry.col],t=Math.min(1,entry.u/.35),fade=1-t*t*(3-2*t),m=new Map([[pelvis,1-fade]]);for(let c=0;c<4;c++)m.set(joints[anchor*4+c],(m.get(joints[anchor*4+c])||0)+weights[anchor*4+c]*fade);const top=[...m].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,p)=>s+p[1],0);top.forEach(([j,w],c)=>{joints[i*4+c]=j;weights[i*4+c]=w/sum;});});
  shirt.setAttribute('JOINTS_0',accessor('shirt-continuous-joints','VEC4',joints)).setAttribute('WEIGHTS_0',accessor('shirt-continuous-weights','VEC4',weights));
  shirt.setAttribute('POSITION',accessor('shirt-continuous-position','VEC3',pos)).setAttribute('NORMAL',accessor('shirt-continuous-normal','VEC3',normals[0]));
  shirt.setIndices(accessor('shirt-continuous-index','SCALAR',new Uint32Array(faces)));
  shirt.listTargets().forEach((target,t)=>{for(const name of['POSITION','NORMAL']){const values=shapePositions[t+1],baseValues=shapePositions[0],current=name==='POSITION'?values:normals[t+1],base=name==='POSITION'?baseValues:normals[0];target.setAttribute(name,accessor(`shirt-continuous-${t}-${name}`,'VEC3',Float32Array.from(current,(v,i)=>v-base[i])));}});
  // Separate UV islands at the sewn join. Rescale the original shirt artwork
  // into the atlas's upper half; the lower half is clean fabric, not stretched
  // samples of the old hip panels. Both sides share positions and skin weights.
  const material=shirt.getMaterial();
  const toS=c=>Math.round(255*(c<=.0031308?c*12.92:1.055*c**(1/2.4)-.055));
  for(const [texture,colour] of [[material.getBaseColorTexture(),GARMENTS.shirt.colour.map(toS)],[material.getNormalTexture(),[128,128,255]]]) {
    if(!texture?.getImage())continue;
    const source=await sharp(texture.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const width=source.info.width,height=source.info.height,half=Math.floor(height/2);
    const upper=texture===material.getNormalTexture()
      ? Buffer.from(Array.from({length:width*half*3},(_,i)=>colour[i%3]))
      : await sharp(texture.getImage()).removeAlpha().resize(width,half).raw().toBuffer();
    const data=Buffer.alloc(width*height*3);data.set(upper);
    for(let i=width*half;i<width*height;i++)data.set(colour,i*3);
    texture.setImage(await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()).setMimeType('image/png');
  }
  log(`shirt: replaced hip panels with ${rows} continuous fabric rings (${loop.length} columns)`);
}
