import type {Person} from '../three/lab-player';
type Props={selected:Person;sarahAvailable:boolean;paused:boolean;message:string;onSelect:(person:Person)=>void;onMovement:(x:number,z:number)=>void};
export default function LabPlayerControls({selected,sarahAvailable,paused,message,onSelect,onMovement}:Props){
 return <>
  <div className="lab-player-controls">
   <div role="group" aria-label="Controlled character">{(['jack','sarah'] as const).map(person=><button key={person} aria-pressed={selected===person} disabled={paused||(person==='sarah'&&!sarahAvailable)} onClick={()=>onSelect(person)}>{person==='jack'?'Jack':'Sarah'}</button>)}</div>
   <p role="status">{message}</p>
  </div>
  <div className="lab-movement-pad" role="group" aria-label="Movement controls">{[{name:'Forward',symbol:'↑',x:0,z:1},{name:'Left',symbol:'←',x:-1,z:0},{name:'Right',symbol:'→',x:1,z:0},{name:'Back',symbol:'↓',x:0,z:-1}].map(d=><button key={d.name} className={`move-${d.name.toLowerCase()}`} disabled={paused} aria-label={`Walk ${d.name.toLowerCase()}`} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onMovement(d.x,d.z);}} onPointerUp={()=>onMovement(0,0)} onPointerCancel={()=>onMovement(0,0)} onLostPointerCapture={()=>onMovement(0,0)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter')onMovement(d.x,d.z);}} onKeyUp={()=>onMovement(0,0)} onBlur={()=>onMovement(0,0)}>{d.symbol}</button>)}</div>
 </>;
}
