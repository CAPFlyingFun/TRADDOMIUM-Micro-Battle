import {findLabPath,moveOnFloor,type FloorPoint} from './lab-navigation';
export type Person='jack'|'sarah';
export type ActorPose=FloorPoint&{yaw:number;seat:number;visible:boolean};
export type PlayerPoses=Record<Person,ActorPose>;
/** A single movement authority shared by touch, keyboard and cinematic return.
 * Script anchors are captured once per exploration interval, never on resize.
 */
export function createLabPlayer(){
 let exploring=false,returning=false,selected:Person='jack',pending:string|null=null,completed:string|null=null;
 let anchors:PlayerPoses,poses:PlayerPoses;
 const routes:Record<Person,FloorPoint[]>={jack:[],sarah:[]};
 const walking:Record<Person,boolean>={jack:false,sarah:false};
 const clone=(p:PlayerPoses):PlayerPoses=>({jack:{...p.jack},sarah:{...p.sarah}});
 const turn=(from:number,to:number,t:number)=>from+Math.atan2(Math.sin(to-from),Math.cos(to-from))*t;
 function goTo(point:FloorPoint,interaction?:string){
  if(!exploring||!poses[selected].visible)return false;
  const path=findLabPath(poses[selected],point);if(!path.length)return false;
  routes[selected]=path;pending=interaction??null;completed=null;return true;
 }
 return {
  get active(){return exploring||returning;},get returning(){return returning;},get exploring(){return exploring;},get selected(){return selected;},walking,
  snapshot:()=>clone(poses),
  setExploring(enabled:boolean,current:PlayerPoses){
   if(enabled===exploring)return;
   if(enabled){anchors=clone(current);poses=clone(current);exploring=true;returning=false;}
   else {exploring=false;pending=completed=null;if(!poses)return;
    for(const person of ['jack','sarah'] as const)routes[person]=poses[person].visible?findLabPath(poses[person],anchors[person]):[];
    returning=true;
   }
  },
  select(person:Person){if(!exploring||!poses[person].visible)return false;selected=person;pending=completed=null;return true;},
  goTo,
  direct(direction:FloorPoint,dt:number){
   if(!exploring||!Math.hypot(direction.x,direction.z))return;
   const actor=poses[selected];routes[selected]=[];pending=completed=null;
   actor.seat=Math.max(0,actor.seat-dt*2);if(actor.seat>0)return;
   const next=moveOnFloor(actor,direction,Math.min(dt,.07)*1.2);
   walking[selected]=Math.hypot(next.x-actor.x,next.z-actor.z)>.001;
   actor.x=next.x;actor.z=next.z;actor.yaw=turn(actor.yaw,Math.atan2(direction.x,direction.z),1-Math.exp(-dt*10));
  },
  tick(dt:number,paused:boolean){
   if(!poses||paused)return;dt=Math.min(dt,.07);
   for(const person of ['jack','sarah'] as const){
    const actor=poses[person],route=routes[person];walking[person]=false;
    while(route.length&&Math.hypot(route[0].x-actor.x,route[0].z-actor.z)<.015)route.shift();
    if(route.length){actor.seat=Math.max(0,actor.seat-dt*2);if(actor.seat>0)continue;
     const goal=route[0],dx=goal.x-actor.x,dz=goal.z-actor.z,d=Math.hypot(dx,dz),step=Math.min(dt*1.2,d);
     actor.x+=dx/d*step;actor.z+=dz/d*step;actor.yaw=turn(actor.yaw,Math.atan2(dx,dz),1-Math.exp(-dt*10));walking[person]=true;
    }else if(returning){
     actor.seat+=Math.sign(anchors[person].seat-actor.seat)*Math.min(Math.abs(anchors[person].seat-actor.seat),dt*1.5);
     actor.yaw=turn(actor.yaw,anchors[person].yaw,1-Math.exp(-dt*8));
    }
   }
   if(returning&&(['jack','sarah'] as const).every(p=>!routes[p].length&&Math.abs(poses[p].seat-anchors[p].seat)<.001&&Math.abs(Math.atan2(Math.sin(poses[p].yaw-anchors[p].yaw),Math.cos(poses[p].yaw-anchors[p].yaw)))<.015)){
    poses=clone(anchors);returning=false;
   }
   if(exploring&&pending&&!routes[selected].length)poses[selected].seat=Math.max(0,poses[selected].seat-dt*2);
   if(exploring&&pending&&!routes[selected].length&&poses[selected].seat===0){completed=pending;pending=null;}
  },
  takeInteraction(){const result=completed;completed=null;return result;},
  cancel(){pending=completed=null;routes.jack=[];routes.sarah=[];},
 };
}
