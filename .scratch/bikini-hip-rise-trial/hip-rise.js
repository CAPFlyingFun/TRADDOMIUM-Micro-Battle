const ease=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return Math.max(0,Math.min(1,t*t*t*(10+t*(-15+6*t))));};
export function hipRiseCm([x,y,z],backRiseCm=8){const r=Math.hypot(x,z+6);if(r<1e-8)return 0;const u=(1-(z+6)/r)/2;return backRiseCm*ease(u,0,.8)*ease(y,72,84)*(1-ease(y,102,106));}
export function relocateBottom(input,{enabled=false,collider,backRiseCm=8}={}){
 const positions=input.slice(),stats={enabled,movedVertices:0,unresolved:0,minClearanceCm:Infinity,maxActualRiseCm:0,frontCenterErrors:0};
 if(!enabled)return {positions,stats};
 for(let i=0;i<input.length;i+=3){const p=Array.from(input.slice(i,i+3)),rise=hipRiseCm(p,backRiseCm);if(rise<1e-8)continue;const y=p[1]+rise,hit=collider.closest([p[0],y,p[2]]),old=collider.closest(p),offset=Math.max(.06,Math.min(3,old.signedDistance)),blend=ease(rise,0,.75),surface=hit.point.map((x,k)=>x+hit.normal[k]*offset),q=p.map((x,k)=>x+blend*(surface[k]-x));
  for(let pass=0;pass<4&&blend>.99;pass++){const contact=collider.closest(q),delta=.03-contact.signedDistance;if(delta<=1e-5)break;for(let k=0;k<3;k++)q[k]+=contact.projectionDirection[k]*(delta+.001);}
  const clearance=collider.closest(q).signedDistance;stats.minClearanceCm=Math.min(stats.minClearanceCm,clearance);if(blend>.99&&clearance<.025)stats.unresolved++;positions.set(q,i);stats.movedVertices++;stats.maxActualRiseCm=Math.max(stats.maxActualRiseCm,q[1]-p[1]);
 }
 for(let i=0;i<input.length;i+=3)if(input[i]===0&&input[i+2]>-6)for(let k=0;k<3;k++)if(input[i+k]!==positions[i+k])stats.frontCenterErrors++;
 stats.success=stats.unresolved===0&&stats.frontCenterErrors===0;return {positions,stats};
}
