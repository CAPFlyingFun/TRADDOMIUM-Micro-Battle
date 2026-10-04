'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import chapterOne from '../data/chapter1-audio.json';
import type {Line} from '../data/dialogue';
import type {Settings} from './state';
import {soundscape} from './audio';
import {VoiceTransport,type VoiceState} from './voice-transport';
const recordings:Record<string,{src:string}>=chapterOne.lines;
const idle:VoiceState={key:'',status:'idle',duration:0,elapsed:0};
export function useVoicePlayback(key:string,line:Line|undefined,nextKey:string,settings:Settings,paused:boolean,onAdvance:()=>void){
  const [state,setState]=useState<VoiceState>(idle);
  const live=useRef(true),advance=useRef(onAdvance);advance.current=onAdvance;
  const transport=useRef<VoiceTransport|null>(null);
  if(!transport.current)transport.current=new VoiceTransport(soundscape,s=>{if(live.current)setState(s);},()=>{});
  const recording=line?recordings[line.voiceKey||key]:undefined;
  useEffect(()=>{live.current=true;return()=>{live.current=false;transport.current?.stop();soundscape.setSpeaking(false);};},[]);
  useEffect(()=>{
    if(recording&&settings.voices)transport.current!.select(key,recording.src);else transport.current!.stop();
    return()=>transport.current!.stop();
  },[key,recording,settings.voices]);
  useEffect(()=>{transport.current!.setPaused(paused);},[paused]);
  useEffect(()=>{
    soundscape.setSpeaking(state.key===key&&state.status==='playing'&&!paused);
    if(state.status!=='playing')return;
    const timer=window.setInterval(()=>setState(transport.current!.snapshot()),200);
    return()=>window.clearInterval(timer);
  },[state.status,state.key,key,paused]);
  useEffect(()=>{
    if(!line||paused||!settings.autoAdvance)return;
    const textOnly=!recording||!settings.voices;
    if(!textOnly&&(state.key!==key||state.status!=='finished'))return;
    const delay=textOnly?Math.max(2600,line.text.split(/\s+/).length*340):420;
    const timer=window.setTimeout(()=>advance.current(),delay);
    return()=>window.clearTimeout(timer);
  },[key,line,paused,settings.autoAdvance,settings.voices,recording,state.key,state.status]);
  useEffect(()=>{const next=recordings[nextKey];if(next&&settings.voices)soundscape.preload(next.src);},[nextKey,settings.voices]);
  const replay=useCallback(async()=>{
    if(!recording)return;
    await soundscape.unlock();transport.current!.select(key,recording.src);transport.current!.setPaused(paused);
  },[key,recording,paused]);
  const stop=useCallback(()=>transport.current?.stop(),[]);
  return {state:state.key===key?state:idle,hasRecording:!!recording,replay,stop};
}
