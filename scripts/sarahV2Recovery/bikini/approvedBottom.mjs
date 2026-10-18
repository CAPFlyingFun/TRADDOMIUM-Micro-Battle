// Additive, static review garment. All units are cm; the body collider is read-only.
const TAU=2*Math.PI,N=192,K=36,COLS=2*K,ROWS=26;
const mix=(a,b,t)=>a+(b-a)*t;
export function waistHeight(a){return 87.5+16.5*(1-Math.cos(a))/2+5.25*Math.sin(a)**2;}
export function createBottom({enabled=false,collider}={}){
 if(!enabled)return null;if(!collider)throw Error('A posed skin collider is required');
 const p=[],uv=[],ix=[],parts={},put=(q,u=0,v=0)=>{const id=p.length/3;p.push(...q);uv.push(u,v);return id;},point=i=>p.slice(3*i,3*i+3),mod=i=>(i+N)%N;
 const pushOut=(q,clearance=.16)=>{for(let pass=0;pass<8;pass++){const h=collider.closest(q);if(h.signedDistance>=clearance-1e-5)break;const step=clearance-h.signedDistance+.001;for(let k=0;k<3;k++)q[k]+=h.projectionDirection[k]*step;}return q;};
 const radial=(a,y)=>{const d=[Math.sin(a),0,Math.cos(a)],h=collider.rayExit([-60*d[0],y,-6-60*d[2]],d,{maxDistanceCm:120});if(!h)throw Error('No waist contact at '+a);return pushOut([h.point[0]+.16*d[0],y,h.point[2]+.16*d[2]]);};
 // Continuous curved waist; front is low, upper hips/back provide the support.
 const band=[];for(let r=0;r<3;r++){band[r]=[];for(let j=0;j<N;j++){const a=TAU*j/N,width=1.15+.35*Math.sin(a)**2;band[r][j]=put(radial(a,waistHeight(a)-width*r/2),j/N,r/2);}}
 const quad=(a,b,c,d,reverse=false)=>{if(reverse)ix.push(a,c,b,b,c,d);else ix.push(a,b,c,b,d,c);};
 for(let r=0;r<2;r++)for(let j=0;j<N;j++)quad(band[r][j],band[r+1][j],band[r][mod(j+1)],band[r+1][mod(j+1)]);
 const panelSurface=(x,y,front)=>{const dir=front?1:-1,samples=[];for(const sx of [x,x-2.5,x+2.5]){const h=collider.rayExit([sx,y,-60*dir],[0,0,dir],{maxDistanceCm:120});if(h)samples.push(h.point[2]);}let z;
  if(front){const direct=collider.rayExit([x,y,-60],[0,0,1],{maxDistanceCm:120});z=direct?.point[2]??(samples.length?Math.max(...samples):1.3);}
  else z=samples.length?Math.min(...samples):-13.5; // fabric spans the cleft instead of copying it
  return pushOut([x,y,z+.16*dir]);};
 const panel=(front)=>{const grid=[[]];for(let j=0;j<=COLS;j++){const k=front?mod(j-K):mod(N/2+K-j);grid[0].push(band[2][k]);}
  for(let r=1;r<=ROWS;r++){grid[r]=[];const t=r/ROWS;for(let j=0;j<=COLS;j++){const u=2*j/COLS-1,top=point(grid[0][j]),f=(1-t)**(front?1.1:.72),x=mix(3*u,top[0],f),y=mix(top[1],83.1,t);grid[r].push(put(panelSurface(x,y,front),j/COLS,t));}}
  for(let r=0;r<ROWS;r++)for(let j=0;j<COLS;j++)quad(grid[r][j],grid[r+1][j],grid[r][j+1],grid[r+1][j+1],!front);
  return grid;
 };
 const front=panel(true),back=panel(false),crotch=[front[ROWS]];
 for(let r=1;r<20;r++){const t=r/20,c=Math.sin(Math.PI*t)**2;crotch[r]=[];for(let j=0;j<=COLS;j++){const a=point(front[ROWS][j]),b=point(back[ROWS][j]),q=[mix(a[0],b[0],t)*(1-.67*c),mix(a[1],b[1],t)-1.15*c,mix(a[2],b[2],t)];crotch[r].push(put(pushOut(q),j/COLS,t));}}
 crotch.push(back[ROWS]);for(let r=0;r<20;r++)for(let j=0;j<COLS;j++)quad(crotch[r][j],crotch[r+1][j],crotch[r][j+1],crotch[r+1][j+1]);
 // True shared seam vertices. There are only three physical open edges.
 const neighbours=Array.from({length:p.length/3},()=>new Set()),edges=new Map();for(let k=0;k<ix.length;k+=3)for(let j=0;j<3;j++){const a=ix[k+j],b=ix[k+(j+1)%3];neighbours[a].add(b);neighbours[b].add(a);const key=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(key,(edges.get(key)??0)+1);}
 const boundary=new Map();for(const [key,count]of edges)if(count===1){const [a,b]=key.split(':').map(Number);for(const [x,y]of [[a,b],[b,a]]){if(!boundary.has(x))boundary.set(x,[]);boundary.get(x).push(y);}}
 const waist=new Set(band[0]);for(let pass=0;pass<16;pass++){const old=p.slice();for(let i=0;i<p.length/3;i++){if(waist.has(i))continue;const ns=[...neighbours[i]],weight=boundary.has(i)?.18:.38,q=[0,1,2].map(d=>mix(old[i*3+d],ns.reduce((s,j)=>s+old[j*3+d],0)/ns.length,weight));pushOut(q);for(let d=0;d<3;d++)p[i*3+d]=q[d];}}
 const boundaries=[],seen=new Set();for(const a of boundary.keys()){if(seen.has(a))continue;let current=a,previous=-1;const loop=[];do{seen.add(current);loop.push(current);const next=boundary.get(current).find(x=>x!==previous);previous=current;current=next;}while(current!==a&&loop.length<=p.length/3);if(current!==a)throw Error('Open garment edge');boundaries.push(loop);}
 const stats={vertices:p.length/3,triangles:ix.length/3,minClearanceCm:Infinity,penetrating:0};for(let i=0;i<p.length;i+=3){const d=collider.closest(p.slice(i,i+3)).signedDistance;stats.minClearanceCm=Math.min(stats.minClearanceCm,d);if(d<0)stats.penetrating++;}
 parts.front=front;parts.back=back;parts.crotch=crotch;parts.band=band;
 return {positions:p,indices:ix,uv,boundaries,stats,parts};
}
