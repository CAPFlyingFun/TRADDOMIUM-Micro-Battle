/** Layout D preserves story console/door coordinates while widening the room. */
export const spareChairHome={x:-1.75,z:1.85};
export const roomBounds={xMin:-5.75,xMax:5.75,zMin:-2.95,zMax:3.2};
// Fetch the spare via the front aisle, clear of Sarah and her new seat.
export function chairRetrievalPosition(progress:number){
 const points=[{x:-.9,z:.45},{x:-.9,z:1.5},{x:spareChairHome.x,z:1.5},{x:spareChairHome.x,z:spareChairHome.z+.12}];
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.z-points[i].z));
 let distance=Math.min(1,Math.max(0,progress))*lengths.reduce((a,b)=>a+b,0);
 for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]||i===lengths.length-1){const t=distance/lengths[i],a=points[i],b=points[i+1];return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(b.x-a.x,b.z-a.z)};}distance-=lengths[i];}
 return {...points[0],yaw:0};
}
