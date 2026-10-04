'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CirclePause, Radio, ScanLine } from 'lucide-react';
import { story, type Interaction } from '../data/story';
import labDialogue from '../data/lab-dialogue.json';
import { dialogue, type Line } from '../data/dialogue';
import { characters } from '../data/characters';
import type { SaveState, Settings } from '../lib/state';
import { freshSave } from '../lib/state';
import { soundscape } from '../lib/audio';
import CinematicScene from './CinematicScene';
import LabStage from './LabStage';
import ConsolePanel from './ConsolePanel';
import VoiceControls from './VoiceControls';
import {useVoicePlayback} from '../lib/useVoicePlayback';
import {lineEffects} from '../data/audio-cues';
import {useChapterOneEffects} from '../lib/useChapterOneEffects';
interface Props {threeD?:boolean;save:SaveState;settings:Settings;paused:boolean;onSave:(s:SaveState)=>void;onSettings:(s:Settings)=>void;onPause:()=>void;onFinish:()=>void;}
export default function StoryPlayer({threeD=false,save,settings,paused:userPaused,onSave,onSettings,onPause,onFinish}:Props) {
 const [stageReady,setStageReady]=useState(false),[arrived,setArrived]=useState(false);
 const paused=userPaused||(threeD&&(!stageReady||(save.sceneId==='sarah'&&!arrived)));
 const index=story.findIndex(s=>s.id===save.sceneId),scene=story[index];
 const lines=(threeD?(labDialogue as Record<string,Line[]>)[save.queue]:undefined)||dialogue[save.queue]||[],line=lines[save.line];
 const [blackout,setBlackout]=useState(false);
 const [activation,setActivation]=useState(0);
 const [activationReady,setActivationReady]=useState(false);
 const activationTime=useRef(0), previousPhase=useRef(-1);
 const isActivation=scene.id==='activation';
 const ready=scene.actions.filter(a=>a.required).every(a=>save.done.includes(a.id));
 const patch=useCallback((p:Partial<SaveState>)=>onSave({...save,...p,updatedAt:new Date().toISOString()}),[save,onSave]);
 const advance=useCallback(()=>{if(!paused&&line)patch({line:save.line+1});},[line,paused,patch,save.line]);
 const lineKey=`${save.queue}:${save.line}`;
 const voice=useVoicePlayback(lineKey,line,lines[save.line+1]?.voiceKey||`${save.queue}:${save.line+1}`,settings,paused,advance);
 useChapterOneEffects(lineKey,scene.chapter===1?line?.sourceIndex:undefined,voice.state,paused);
 const skip=useCallback(()=>{voice.stop();advance();},[voice.stop,advance]);
 const next=()=>{
  if(paused || line || !ready || (isActivation&&!activationReady))return;
  if(threeD&&scene.id==='revoked'){onFinish();}
  else if(index===story.length-1){onSave({...save,completed:true});onFinish();}
  else onSave(freshSave(story[index+1].id));
 };
 const interact=(a:Interaction)=>{
  if(paused||line||(threeD&&a.id==='baby'&&!save.done.includes('logs'))||(a.requires&&!save.done.includes(a.requires)))return;
  if(a.effect){setBlackout(true);window.setTimeout(()=>setBlackout(false),a.effect==='shutdown'?2100:950);}
  patch({queue:a.dialogue,line:0,done:[...new Set([...save.done,a.id])],camera:scene.id==='cameras'?a.id:save.camera});
 };
 useEffect(()=>{
  const h=(e:KeyboardEvent)=>{
   if(e.key==='Escape'&&!userPaused){e.preventDefault();onPause();return;}
   if(paused||['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName))return;
   if((e.target as HTMLElement)?.tagName==='BUTTON'&&(e.code==='Space'||e.key==='Enter'))return;
   if(e.key==='Escape'){e.preventDefault();onPause();}
   else if(line&&(e.code==='Space'||e.key.toLowerCase()==='e'||e.key==='Enter')){e.preventDefault();skip();}
  };window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
 },[skip,line,onPause,paused,userPaused]);
 useEffect(()=>{
  soundscape.setPaused(paused);
  soundscape.scene(scene.id,scene.intensity,scene.id==='boundary'&&save.done.includes('shelter'),blackout,isActivation?activation:-1,scene.chapter===1);
 },[scene.id,scene.intensity,save.done,paused,blackout,isActivation,activation]);
 useEffect(()=>{const effect=scene.chapter===1?undefined:lineEffects[lineKey];if(line&&effect)soundscape.effect(effect);},[lineKey,line,scene.chapter]);
 useEffect(()=>()=>soundscape.clear(),[]);
 useEffect(()=>{
  activationTime.current=0;previousPhase.current=-1;setActivation(0);setActivationReady(false);
 },[isActivation]);
 useEffect(()=>{
  if(!isActivation||paused)return;
  let last=performance.now();
  const tick=window.setInterval(()=>{
   const now=performance.now();activationTime.current+=Math.min(now-last,200);last=now;
   const t=activationTime.current;
   const phase=t<4000?0:t<5700?1:t<7600?2:t<10600?3:4;
   setActivation(phase);
   if(phase!==previousPhase.current){previousPhase.current=phase;if(phase===4)setActivationReady(true);}
  },80);
  return()=>window.clearInterval(tick);
 },[isActivation,paused]);
 useEffect(()=>{if(isActivation&&activation===0)soundscape.effect('sfx_boundary_event_collapse');if(isActivation&&activation===3)soundscape.effect('sfx_boundary_event_return');},[isActivation,activation]);
 const character=line?characters[line.speaker]:null;
 return <main className={`game-screen ${threeD?'lab-game':''} ${settings.largeText?'large-text':''} ${settings.reducedMotion?'reduce-motion':''} ${isActivation?'activation-screen':''}`}>
  {threeD?<LabStage frame={{sceneId:scene.id,queue:save.queue,line:save.line,done:save.done,speaker:line?.speaker||'',sourceIndex:line?.sourceIndex,paused:userPaused,reducedMotion:settings.reducedMotion,interactive:!paused&&!line}} onReady={()=>setStageReady(true)} onArrived={()=>setArrived(true)} onUnavailable={()=>{setStageReady(false);setArrived(false);}} onInteract={target=>{
   if(paused||line)return;
   if(target==='comm'&&scene.id==='alarm'&&ready){next();return;}
   const action=target==='terminal'?scene.actions.find(a=>a.required&&!save.done.includes(a.id)&&(!a.requires||save.done.includes(a.requires))):target==='sarah'?scene.actions.find(a=>a.id==='baby'):undefined;
   if(action)interact(action);
  }}/>:<CinematicScene look={scene.look} intensity={scene.intensity} reducedMotion={settings.reducedMotion} softEffects={settings.softEffects} paused={paused} camera={save.camera} activation={isActivation?activation:-1} blackout={blackout} focus={line?.speaker}/> }
  <header className="game-header"><div className="tombs-wordmark"><span className="tombs-mark">T</span><span>TOMBS<span className="micro-label">RESEARCH DIVISION</span></span></div><div className="chapter-track"><span>0{scene.chapter}</span><i/><span>{['The Alarm','The Boundary','The Activation'][scene.chapter-1]}</span></div><button className="icon-button" onClick={onPause} aria-label="Pause game"><CirclePause size={23}/></button></header>
  <div className="scene-heading"><span className="eyebrow">{scene.location}</span><h1>{scene.title}</h1></div>
  {!threeD&&!isActivation&&scene.id!=='ending'&&<ConsolePanel scene={scene} done={save.done} camera={save.camera} line={save.line}/>}
  {scene.look==='cameras'&&<div className="camera-overlay"><ScanLine size={20}/><span>CAM {({north:'01',west:'02',tree:'03',zoom:'04',water:'05'} as Record<string,string>)[save.camera]}<small>PERIMETER · LIVE</small></span><span className="camera-crosshair">＋</span></div>}
  {isActivation?<div className={`activation-caption phase-${activation}`} role="status">
    <span className="eyebrow">{['Boundary acquired','Scale factor locked','','','TOMBS OFFLINE'][activation]}</span>
    <p>{['The rings accelerate.','“Jack!”','The sound vanishes.','Everything snaps back.','Sound returns.'][activation]}</p>
    {activationReady&&<button className="primary-button" onClick={next}>Find Sarah <ArrowRight size={18}/></button>}
   </div>:threeD&&!stageReady?<section className="interaction-dock lab-wait"><p>Load the laboratory to begin.</p><button className="secondary-button" onClick={onPause}>Menu / Return to title</button></section>:threeD&&scene.id==='sarah'&&!arrived?<section className="interaction-dock lab-wait"><span className="eyebrow">SARAH IS ON HER WAY</span><p>The laboratory door opens.</p></section>:line?<section className={`dialogue-dock ${line.speaker==='narrator'?'narration':''}`} aria-label="Dialogue">
    <div className="dialogue-person">
     {character?.portrait?<span className={`portrait portrait-${line.speaker}`} style={{backgroundImage:`url(${character.portrait})`}}/>:line.speaker==='lena'?<span className="portrait voice"><Radio/></span>:null}
     <div>{character?.name&&<h2 style={{color:character.color}}>{character.name}</h2>}{character?.name&&<span className="speaker-role">{character.role}</span>}</div>
    </div>
    <p key={`${save.queue}-${save.line}`} className="spoken-line" aria-live="polite">{line.text}</p>
    <VoiceControls state={voice.state} hasRecording={voice.hasRecording} voices={settings.voices} auto={settings.autoAdvance} onAuto={()=>onSettings({...settings,autoAdvance:!settings.autoAdvance})} onReplay={voice.replay} onPause={onPause} onSkip={skip}/>
    <span className="key-hint dialogue-key-hint"><kbd>E</kbd> / <kbd>SPACE</kbd> to skip</span>
   </section>:<section className={`interaction-dock ${scene.id==='ending'?'ending-dock':''}`} aria-label="Scene interactions">
    {scene.id==='ending'?<div className="end-mark"><span className="eyebrow">END OF CHAPTER THREE</span><h2>Their town had shrunk.<br/><em>And the island had not.</em></h2></div>:scene.objective&&<p className="objective"><span className="objective-diamond"/>{scene.objective}</p>}
    {scene.actions.length>0&&<div className={`action-list ${scene.actions.length>3?'many-actions':''}`}>{scene.actions.map(a=><button key={a.id} className={`action-button ${save.done.includes(a.id)?'inspected':''}`} disabled={(!!a.requires&&!save.done.includes(a.requires))||(threeD&&a.id==='baby'&&!save.done.includes('logs'))} onClick={()=>interact(a)}><span className="action-icon">{save.done.includes(a.id)?<Check size={18}/>:<span className="interaction-dot"/>}</span><span><strong>{a.label}</strong><small>{a.detail}</small></span>{!a.required&&<em>Optional</em>}</button>)}</div>}
    {ready&&<button className="primary-button scene-exit" onClick={next}>{threeD&&scene.id==='revoked'?'Finish Chapter One':scene.exit}<ArrowRight size={19}/></button>}
    {!ready&&<span className="interaction-help">Select a highlighted control to investigate.</span>}
   </section>}
  <div className="story-progress" aria-label={`Chapter ${scene.chapter} of 3`}><span style={{width:`${(index+1)/story.length*100}%`}}/></div>
 </main>;
}
