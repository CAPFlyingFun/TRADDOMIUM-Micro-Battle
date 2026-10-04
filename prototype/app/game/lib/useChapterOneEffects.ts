import {useEffect,useRef} from 'react';
import cues from '../data/chapter1-cues.json';
import {soundscape} from './audio';
import type {VoiceState} from './voice-transport';

// Drive foley from the current recording's elapsed time, not wall-clock timers.
// Pause, replay and skip therefore cannot leave delayed cues on the next line.
export function useChapterOneEffects(key:string,sourceIndex:number|undefined,state:VoiceState,paused:boolean){
 const fired=useRef(new Set<string>()),previous=useRef(0);
 useEffect(()=>{if(sourceIndex===undefined)return;fired.current.clear();previous.current=0;return()=>soundscape.cancelEffects();},[key,sourceIndex]);
 useEffect(()=>{
  if(paused||sourceIndex===undefined||!['playing','finished'].includes(state.status))return;
  if(state.elapsed<previous.current-.1)fired.current.clear();
  previous.current=state.elapsed;
  for(const cue of cues.events){
   if(cue.sourceIndex!==sourceIndex||fired.current.has(cue.id))continue;
   const due=cue.timing==='after'?state.status==='finished':state.elapsed*1000>=(cue.timing==='during'?cue.offsetMs:0);
   if(due){fired.current.add(cue.id);soundscape.effect(cue.asset,cue.gain);}
  }
 },[sourceIndex,state.status,state.elapsed,paused,key]);
}
