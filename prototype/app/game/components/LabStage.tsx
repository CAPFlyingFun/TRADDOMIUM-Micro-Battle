'use client';
import {useEffect,useRef,useState} from 'react';
import LabCameraControls from './LabCameraControls';
import type {createLabRenderer,LabFrame,LabView} from '../three/lab-renderer';
type Props={frame:LabFrame;onReady:()=>void;onArrived:()=>void;onInteract:(target:string)=>void;onUnavailable:()=>void};
export default function LabStage(props:Props){
 const host=useRef<HTMLDivElement>(null),viewer=useRef<ReturnType<typeof createLabRenderer>|null>(null),live=useRef(props);live.current=props;
 const [message,setMessage]=useState('Preparing the laboratory…'),[failed,setFailed]=useState(false),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0),[view,setView]=useState<LabView>('room');
 useEffect(()=>{
  let cancelled=false;setFailed(false);setReady(false);setMessage('Preparing the laboratory…');
  void import('../three/lab-renderer').then(({createLabRenderer})=>{
   if(cancelled||!host.current)return;
   const failure=()=>{if(!cancelled){setFailed(true);setReady(false);live.current.onUnavailable();}};
   try{viewer.current=createLabRenderer(host.current,matchMedia('(pointer:coarse)').matches||innerWidth<768,{
    status:m=>{if(!cancelled)setMessage(m);},ready:()=>{if(!cancelled){setReady(true);live.current.onReady();}},arrived:()=>{if(!cancelled)live.current.onArrived();},interact:t=>live.current.onInteract(t),failed:failure,
   });viewer.current.update(live.current.frame);}
    catch{setMessage('This browser could not start 3D. Retry, or use Menu to return to the title.');failure();}
  }).catch(()=>{if(!cancelled){setMessage('The 3D preview could not open.');setFailed(true);live.current.onUnavailable();}});
  return()=>{cancelled=true;viewer.current?.dispose();viewer.current=null;};
 },[attempt]);
 useEffect(()=>{viewer.current?.update(props.frame);},[props.frame]);
 useEffect(()=>{setView(['sarah','revoked'].includes(props.frame.sceneId)?'conversation':'room');},[props.frame.sceneId]);
 return <div className="lab-stage">
  <div ref={host} className="lab-canvas"/>
   {!ready&&<div className="lab-load"><span className="eyebrow">CHAPTER ONE / 3D PREVIEW</span><h2>{failed?'The lab is unavailable.':'Entering the laboratory.'}</h2><p role="status">{message}</p><small>Both characters · 5.7 MB combined</small>{failed&&<button className="primary-button" onClick={()=>setAttempt(x=>x+1)}>Retry 3D</button>}</div>}
  {ready&&<LabCameraControls view={view} together={['sarah','revoked'].includes(props.frame.sceneId)} disabled={props.frame.paused} onView={v=>{setView(v);viewer.current?.setView(v);}} onGesture={g=>viewer.current?.setGesture(g)} onZoom={f=>viewer.current?.zoom(f)} onReset={()=>viewer.current?.resetView()}/>}

  {ready&&['sarah','revoked'].includes(props.frame.sceneId)&&<span className="lab-scene-tag">DIAGNOSTIC LAB / JACK & SARAH</span>}
 </div>;
}
