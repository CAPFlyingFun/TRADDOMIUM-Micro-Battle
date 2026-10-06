import {rearWorkstation} from './jack-opening';
import {roomBounds} from './lab-layout';
/** Ground-plane navigation for the existing procedural room (metres).
 * Furniture footprints include body clearance. No world or model scale changes.
 */
export type FloorPoint={x:number;z:number};
const clearance=.16;
const obstacles=[
 {x0:rearWorkstation.x-rearWorkstation.width/2,x1:rearWorkstation.x+rearWorkstation.width/2,z0:rearWorkstation.z-rearWorkstation.depth/2,z1:rearWorkstation.z+rearWorkstation.depth/2},
 {x0:-2.25,x1:.45,z0:-.9,z1:.2}, // Shared workstation
 {x0:-3.7,x1:.3,z0:-3,z1:-2.2}, // Instrument bench
 {x0:-5.05,x1:-4.25,z0:-2.95,z1:-2.25},
 {x0:.5,x1:1.3,z0:-2.95,z1:-2.25},
 {x0:-5.95,x1:-5.05,z0:-2.65,z1:2.4},
 {x0:5.05,x1:5.95,z0:-2.65,z1:2.4},
 {x0:-5.08,x1:-3.52,z0:1.3,z1:2.1},
 {x0:-4.65,x1:-3.95,z0:2.05,z1:2.7}, // Rack
];
export function walkable(p:FloorPoint){return Number.isFinite(p.x)&&Number.isFinite(p.z)&&p.x>=roomBounds.xMin&&p.x<=roomBounds.xMax&&p.z>=roomBounds.zMin&&p.z<=roomBounds.zMax&&!obstacles.some(b=>p.x>b.x0-clearance&&p.x<b.x1+clearance&&p.z>b.z0-clearance&&p.z<b.z1+clearance);}
function clearSegment(a:FloorPoint,b:FloorPoint){const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.04);for(let i=0;i<=n;i++){const t=n?i/n:0;if(!walkable({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t}))return false;}return true;}
export function moveOnFloor(start:FloorPoint,direction:FloorPoint,distance:number):FloorPoint{
 const length=Math.hypot(direction.x,direction.z);if(!length||!Number.isFinite(distance))return {...start};
 const end={x:start.x+direction.x/length*distance,z:start.z+direction.z/length*distance};
 if(clearSegment(start,end))return end;
 // Sliding along a surface is allowed, tunnelling through it is not.
 const x={x:end.x,z:start.z},z={x:start.x,z:end.z};
 if(clearSegment(start,x))return x;if(clearSegment(start,z))return z;return {...start};
}
export function findLabPath(start:FloorPoint,end:FloorPoint):FloorPoint[]{
 if(!walkable(start)||!walkable(end))return [];
 if(clearSegment(start,end))return [{...end}];
 const cell=.2,key=(p:FloorPoint)=>`${Math.round(p.x/cell)},${Math.round(p.z/cell)}`;
 const nearest=(p:FloorPoint)=>{
  const candidates:FloorPoint[]=[];
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const q={x:(Math.round(p.x/cell)+dx)*cell,z:(Math.round(p.z/cell)+dz)*cell};if(walkable(q)&&clearSegment(p,q))candidates.push(q);}
  return candidates.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
 };
 const first=nearest(start),goal=nearest(end);if(!first||!goal)return [];
 const open=new Map([[key(first),first]]),cost=new Map([[key(first),0]]),parents=new Map<string,string>(),points=new Map([[key(first),first]]),closed=new Set<string>();
 while(open.size){
  const current=[...open.values()].sort((a,b)=>(cost.get(key(a))!+Math.hypot(a.x-goal.x,a.z-goal.z))-(cost.get(key(b))!+Math.hypot(b.x-goal.x,b.z-goal.z)))[0];
  const id=key(current);open.delete(id);if(id===key(goal)){
   const route:FloorPoint[]=[end];let at:string|undefined=id;while(at){route.unshift(points.get(at)!);at=parents.get(at);}return route;
  }
  closed.add(id);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   if(!dx&&!dz)continue;const next={x:current.x+dx*cell,z:current.z+dz*cell},nid=key(next);
   if(closed.has(nid)||!clearSegment(current,next))continue;
   const g=cost.get(id)!+Math.hypot(dx,dz)*cell;if(g>=(cost.get(nid)??Infinity))continue;
   cost.set(nid,g);parents.set(nid,id);points.set(nid,next);open.set(nid,next);
  }
 }
 return [];
}
/** Approach a companion from a reachable side instead of a fixed world offset. */
export function findInteractionPoint(start:FloorPoint,target:FloorPoint):FloorPoint|null{
 const bearing=Math.atan2(start.z-target.z,start.x-target.x);
 for(const offset of [0,1,-1,2,-2,3,-3,4]){
  const angle=bearing+offset*Math.PI/4,point={x:target.x+Math.cos(angle)*.65,z:target.z+Math.sin(angle)*.65};
  if(walkable(point)&&findLabPath(start,point).length)return point;
 }
 return null;
}
