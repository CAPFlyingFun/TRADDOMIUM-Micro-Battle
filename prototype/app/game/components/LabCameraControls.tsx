'use client';
import {useState} from 'react';
import {SlidersHorizontal,Minus,Plus,RotateCcw} from 'lucide-react';
import type {LabView,CameraGesture} from '../three/lab-camera';
type Props={view:LabView;together:boolean;disabled:boolean;onView:(view:LabView)=>void;onGesture:(gesture:CameraGesture)=>void;onZoom:(factor:number)=>void;onReset:()=>void};
export default function LabCameraControls({view,together,disabled,onView,onGesture,onZoom,onReset}:Props){
 const [open,setOpen]=useState(false),[gesture,setGesture]=useState<CameraGesture>('orbit');
 return <div className="lab-camera-controls">
  {open&&<div id="lab-camera-adjustments" className="lab-camera-panel" role="group" aria-label="Camera adjustments">
   <div className="lab-camera-row">{(['orbit','pan'] as const).map(mode=><button key={mode} disabled={disabled} aria-pressed={gesture===mode} onClick={()=>{setGesture(mode);onGesture(mode);}}>{mode==='orbit'?'Orbit':'Pan'}</button>)}<button disabled={disabled} onClick={onReset} title="Resume cinematic camera"><RotateCcw size={15}/>Auto shot</button></div>
   <div className="lab-camera-row"><span>Zoom</span><button disabled={disabled} aria-label="Zoom out" onClick={()=>onZoom(1.18)}><Minus size={18}/></button><button disabled={disabled} aria-label="Zoom in" onClick={()=>onZoom(1/1.18)}><Plus size={18}/></button></div>
   <p>Drag to {gesture}. Pinch or scroll to zoom.</p>
  </div>}
  <div className="lab-camera-tools" aria-label="Camera views">{(['room','terminal','conversation','webcam'] as const).map(v=><button key={v} disabled={disabled||(v==='conversation'&&!together)} aria-pressed={view===v} onClick={()=>onView(v)}>{({room:'Lab',terminal:'Terminal',conversation:'Together',webcam:'Webcam'})[v]}</button>)}<button className="lab-camera-adjust" aria-label="Adjust camera" aria-expanded={open} aria-controls="lab-camera-adjustments" onClick={()=>setOpen(x=>!x)}><SlidersHorizontal size={18}/></button></div>
 </div>;
}
