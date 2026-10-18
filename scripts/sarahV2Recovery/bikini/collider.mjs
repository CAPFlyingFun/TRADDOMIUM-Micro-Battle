
/** Static posed-skin triangle BVH. Coordinates and distances are world centimetres.
 * Triangle winding MUST point out of skin. closest accepts [x,y,z] or Vector3.
 * Distance is Euclidean; its sign uses an outward nearest-feature pseudonormal.
 * This local sign assumes a consistently wound surface, not a watertight volume test.
 */
export class SkinCollider {
  constructor(positions, indices) {
    if (positions.length % 3 || indices.length % 3) throw Error('Flat XYZ positions and triangle indices required');
    this.triangles = [];
    for(let k=0;k<indices.length;k+=3) {
      const a=indices[k]*3,b=indices[k+1]*3,c=indices[k+2]*3;
      const v=[positions[a],positions[a+1],positions[a+2],positions[b],positions[b+1],positions[b+2],positions[c],positions[c+1],positions[c+2]];
      if(!v.every(Number.isFinite)) continue;
      const ux=v[3]-v[0],uy=v[4]-v[1],uz=v[5]-v[2],vx=v[6]-v[0],vy=v[7]-v[1],vz=v[8]-v[2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
      if(len<1e-14) continue;
      const bounds=[Math.min(v[0],v[3],v[6]),Math.min(v[1],v[4],v[7]),Math.min(v[2],v[5],v[8]),Math.max(v[0],v[3],v[6]),Math.max(v[1],v[4],v[7]),Math.max(v[2],v[5],v[8])];
      this.triangles.push({v,n:[nx/len,ny/len,nz/len],bounds,id:k/3});
    }
    if(!this.triangles.length) throw Error('SkinCollider requires non-degenerate finite triangles');
    buildFeatureNormals(this.triangles);
    this.root=buildNode(this.triangles.slice());
  }
  /** Closest eligible actual triangle. Predicate receives triangle {id,n,v,bounds}. */
  closestWhere(point,predicate,out={}){return this.closest(point,out,predicate);}
  /** Nearest outward-going triangle hit; bounded, winding-sensitive ray query. */
  rayExit(point,direction,{maxDistanceCm=10}={}){
    const p=[point.x??point[0],point.y??point[1],point.z??point[2]],l=Math.hypot(...direction);if(!(l>0))return null;
    const d=direction.map(x=>x/l),stack=[this.root];let best=maxDistanceCm,result=null;
    while(stack.length){const node=stack.pop();if(!rayBox(node.bounds,p,d,best))continue;if(node.items){for(const tri of node.items){if(tri.n[0]*d[0]+tri.n[1]*d[1]+tri.n[2]*d[2]<=1e-8)continue;const t=rayTriangle(tri.v,p,d);if(t!==null&&t>=-1e-8&&t<=best){best=Math.max(0,t);result={point:p.map((x,i)=>x+d[i]*best),normal:tri.n.slice(),distance:best,triangle:tri.id};}}}else stack.push(node.left,node.right);}
    return result;
  }
  closest(point,out={},predicate) {
    const x=point.x??point[0],y=point.y??point[1],z=point.z??point[2];
    if(![x,y,z].every(Number.isFinite)) throw Error('Finite query point required');
    let best=Infinity,tri=null,bx=0,by=0,bz=0,bu=0,bw=0;
    const stack=[this.root],q=[0,0,0];
    while(stack.length) {
      const node=stack.pop();if(boxDistance2(node.bounds,x,y,z)>best)continue;
      if(node.items) {
        for(const t of node.items){if(predicate&&!predicate(t))continue;closestTriangle(t.v,x,y,z,q);const dx=x-q[0],dy=y-q[1],dz=z-q[2],d=dx*dx+dy*dy+dz*dz;if(d<best){best=d;tri=t;bx=q[0];by=q[1];bz=q[2];bu=q[3];bw=q[4];}}
      } else {
        const dl=boxDistance2(node.left.bounds,x,y,z),dr=boxDistance2(node.right.bounds,x,y,z);
        if(dl<dr){if(dr<=best)stack.push(node.right);if(dl<=best)stack.push(node.left);}else{if(dl<=best)stack.push(node.left);if(dr<=best)stack.push(node.right);}
      }
    }
    if(!tri)return null;
    out.point??=[0,0,0];out.normal??=[0,0,0];out.point[0]=bx;out.point[1]=by;out.point[2]=bz;
    const ba=1-bu-bw,za=ba<1e-9,zb=bu<1e-9,zc=bw<1e-9,zeros=Number(za)+Number(zb)+Number(zc);
    let normal=tri.n;
    if(zeros>=2)normal=tri.vertexNormals[ba>=bu&&ba>=bw?0:bu>=bw?1:2];
    else if(zeros===1)normal=tri.edgeNormals[za?1:zb?2:0];
    out.normal[0]=normal[0];out.normal[1]=normal[1];out.normal[2]=normal[2];
    out.distance=Math.sqrt(best);const dot=(x-bx)*normal[0]+(y-by)*normal[1]+(z-bz)*normal[2],sign=dot<0?-1:1;
    out.signedDistance=sign*out.distance;out.planeDistance=dot;out.triangle=tri.id;out.geometricNormal??=[0,0,0];for(let d=0;d<3;d++)out.geometricNormal[d]=tri.n[d];
    out.projectionDirection??=[0,0,0];
    const factor=out.distance>1e-12?sign/out.distance:0;
    out.projectionDirection[0]=factor?(x-bx)*factor:normal[0];out.projectionDirection[1]=factor?(y-by)*factor:normal[1];out.projectionDirection[2]=factor?(z-bz)*factor:normal[2];
    return out;
  }
}
function rayBox(b,p,d,max){let lo=0,hi=max;for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-14){if(p[i]<b[i]||p[i]>b[i+3])return false;}else{let a=(b[i]-p[i])/d[i],c=(b[i+3]-p[i])/d[i];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return false;}}return true;}
function rayTriangle(v,p,d){const e1=[v[3]-v[0],v[4]-v[1],v[5]-v[2]],e2=[v[6]-v[0],v[7]-v[1],v[8]-v[2]],h=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];if(Math.abs(det)<1e-12)return null;const f=1/det,t=[p[0]-v[0],p[1]-v[1],p[2]-v[2]],u=f*(t[0]*h[0]+t[1]*h[1]+t[2]*h[2]);if(u<-1e-8||u>1+1e-8)return null;const q=[t[1]*e1[2]-t[2]*e1[1],t[2]*e1[0]-t[0]*e1[2],t[0]*e1[1]-t[1]*e1[0]],w=f*(d[0]*q[0]+d[1]*q[1]+d[2]*q[2]);if(w<-1e-8||u+w>1+1e-8)return null;return f*(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2]);}
function buildFeatureNormals(triangles){
  const vertices=new Map(),edges=new Map();
  const unit=(v,fallback)=>{const l=Math.hypot(...v);return l>1e-12?v.map(x=>x/l):fallback;};
  for(const t of triangles){
    t.keys=[0,1,2].map(i=>t.v.slice(i*3,i*3+3).map(x=>Math.round(x*1e6)).join(','));
    for(let i=0;i<3;i++){
      const a=(i+1)%3,b=(i+2)%3,u=[0,1,2].map(d=>t.v[a*3+d]-t.v[i*3+d]),v=[0,1,2].map(d=>t.v[b*3+d]-t.v[i*3+d]);
      const angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/(Math.hypot(...u)*Math.hypot(...v)))));
      let n=vertices.get(t.keys[i]);if(!n)vertices.set(t.keys[i],n=[0,0,0]);for(let d=0;d<3;d++)n[d]+=angle*t.n[d];
    }
    t.edgeKeys=[[0,1],[1,2],[2,0]].map(([a,b])=>[t.keys[a],t.keys[b]].sort().join('|'));
    for(const key of t.edgeKeys){let n=edges.get(key);if(!n)edges.set(key,n=[0,0,0]);for(let d=0;d<3;d++)n[d]+=t.n[d];}
  }
  for(const t of triangles){t.vertexNormals=t.keys.map(k=>unit(vertices.get(k),t.n));t.edgeNormals=t.edgeKeys.map(k=>unit(edges.get(k),t.n));delete t.keys;delete t.edgeKeys;}
}
function buildNode(items) {
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const t of items)for(let d=0;d<3;d++){b[d]=Math.min(b[d],t.bounds[d]);b[d+3]=Math.max(b[d+3],t.bounds[d+3]);}
  if(items.length<=8)return {bounds:b,items};
  let axis=0;if(b[4]-b[1]>b[3]-b[0])axis=1;if(b[5]-b[2]>b[axis+3]-b[axis])axis=2;
  items.sort((a,c)=>(a.bounds[axis]+a.bounds[axis+3])-(c.bounds[axis]+c.bounds[axis+3]));const m=items.length>>1;
  return {bounds:b,left:buildNode(items.slice(0,m)),right:buildNode(items.slice(m))};
}
function boxDistance2(b,x,y,z){const dx=Math.max(b[0]-x,0,x-b[3]),dy=Math.max(b[1]-y,0,y-b[4]),dz=Math.max(b[2]-z,0,z-b[5]);return dx*dx+dy*dy+dz*dz;}
// Ericson's closest point regions, with a final face barycentric interpolation.
function closestTriangle(v,x,y,z,o){
  const ax=v[0],ay=v[1],az=v[2],abx=v[3]-ax,aby=v[4]-ay,abz=v[5]-az,acx=v[6]-ax,acy=v[7]-ay,acz=v[8]-az;
  const apx=x-ax,apy=y-ay,apz=z-az,d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  let u=0,w=0;
  if(d1<=0&&d2<=0){}else{
    const bpx=x-v[3],bpy=y-v[4],bpz=z-v[5],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3)u=1;else{
      const vc=d1*d4-d3*d2;
      if(vc<=0&&d1>=0&&d3<=0)u=d1/(d1-d3);else{
        const cpx=x-v[6],cpy=y-v[7],cpz=z-v[8],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
        if(d6>=0&&d5<=d6)w=1;else{
          const vb=d5*d2-d1*d6;
          if(vb<=0&&d2>=0&&d6<=0)w=d2/(d2-d6);else{
            const va=d3*d6-d5*d4;
            if(va<=0&&d4-d3>=0&&d5-d6>=0){w=(d4-d3)/((d4-d3)+(d5-d6));u=1-w;}else{const den=1/(va+vb+vc);u=vb*den;w=vc*den;}
          }
        }
      }
    }
  }
  o[0]=ax+abx*u+acx*w;o[1]=ay+aby*u+acy*w;o[2]=az+abz*u+acz*w;o[3]=u;o[4]=w;
}
