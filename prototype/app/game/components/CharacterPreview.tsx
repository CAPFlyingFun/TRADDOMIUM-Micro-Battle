'use client';
import {useEffect,useRef,useState} from 'react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import models from '../data/models.json';
import {characters} from '../data/characters';
import type {createCharacterRenderer} from '../lib/character-renderer';
type Quality='auto'|'desktop'|'mobile';
export default function CharacterPreview({onBack}:{onBack:()=>void}){
 const [person,setPerson]=useState<'jack'|'sarah'>('jack'),[quality,setQuality]=useState<Quality>('auto'),[attempt,setAttempt]=useState(0);
 const [resolved,setResolved]=useState<'desktop'|'mobile'>('mobile'),[message,setMessage]=useState('Preparing 3D preview…');
 const host=useRef<HTMLDivElement>(null),viewer=useRef<ReturnType<typeof createCharacterRenderer>|null>(null);
 useEffect(()=>{
  const selected=quality==='auto'?(matchMedia('(pointer: coarse)').matches||innerWidth<768?'mobile':'desktop'):quality;
  setResolved(selected);setMessage('Preparing 3D preview…');let cancelled=false;
  void import('../lib/character-renderer').then(({createCharacterRenderer})=>{
   if(cancelled||!host.current)return;
   try{viewer.current=createCharacterRenderer(host.current,models[person][selected],selected==='mobile',setMessage);}
   catch{setMessage('3D is unavailable in this browser. The cinematic game is still playable.');}
  }).catch(()=>{if(!cancelled)setMessage('Could not open 3D. Try again or return to the game.');});
  return()=>{cancelled=true;viewer.current?.dispose();viewer.current=null;};
 },[person,quality,attempt]);
 const ready=message.startsWith('Ready');
 return <main className="character-preview">
  <header><button className="secondary-button" onClick={onBack}>← Return to title</button><span className="eyebrow">TOMBS / CHARACTER PREVIEW</span></header>
  <section className="character-stage">
   <div className="character-canvas" ref={host}/>
   {!ready&&<div className="character-fallback"><img src={characters[person].portrait} alt={`${characters[person].name} reference portrait`}/></div>}
   <div className="character-caption"><span className="eyebrow">LABORATORY PERSONNEL</span><h1>{characters[person].name}</h1><p>{characters[person].role}</p></div>
  </section>
  <aside className="character-tools">
   <div className="character-pickers"><button className="secondary-button" aria-pressed={person==='jack'} onClick={()=>setPerson('jack')}>Jack</button><button className="secondary-button" aria-pressed={person==='sarah'} onClick={()=>setPerson('sarah')}>Sarah</button></div>
   <label id="model-quality-label">Model quality</label>
   <Select value={quality} onValueChange={value=>setQuality(value as Quality)}><SelectTrigger aria-labelledby="model-quality-label"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="auto">Automatic</SelectItem><SelectItem value="desktop">Original quality</SelectItem><SelectItem value="mobile">Mobile 1K</SelectItem></SelectContent></Select>
   <p>{resolved==='desktop'?'Original textures · Full geometry':'1K textures · Full geometry'}<br/>{(models[person][resolved].bytes/1e6).toFixed(1)} MB · selected character only</p>
   <p role="status" aria-live="polite">{message}</p>
   <div className="character-pickers"><button className="secondary-button" disabled={!ready} onClick={()=>viewer.current?.rotate(-1)} aria-label="Rotate character left">↶</button><button className="secondary-button" disabled={!ready} onClick={()=>viewer.current?.reset()}>Reset view</button><button className="secondary-button" disabled={!ready} onClick={()=>viewer.current?.rotate(1)} aria-label="Rotate character right">↷</button></div>
   {!ready&&!message.includes('Loading')&&!message.includes('Preparing')&&<button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Try again</button>}
   <small>Original rigged models. Animation clips have not been added yet.</small>
  </aside>
 </main>;
}
