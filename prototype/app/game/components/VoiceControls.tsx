'use client';
import {Pause,Play,RotateCcw,SkipForward,Volume2} from 'lucide-react';
import type {VoiceState} from '../lib/voice-transport';
interface Props {state:VoiceState;hasRecording:boolean;voices:boolean;auto:boolean;onAuto:()=>void;onReplay:()=>void;onPause:()=>void;onSkip:()=>void;}
const time=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
export default function VoiceControls({state,hasRecording,voices,auto,onAuto,onReplay,onPause,onSkip}:Props){
 const recorded=hasRecording&&voices;
 const needsPlay=recorded&&['blocked','error'].includes(state.status);
 const status=!recorded?'Subtitles':({idle:'Preparing voice',loading:'Loading voice',playing:'Voice playing',paused:'Paused',finished:'Line complete',blocked:'Tap to play voice',error:'Voice unavailable'}[state.status]);
 return <div className="voice-controls">
  <div className="voice-status"><Volume2 size={15}/><span role="status">{status}</span>{recorded&&state.duration>0&&<span className="voice-time">{time(state.status==='finished'?Math.ceil(state.duration):state.elapsed)} / {time(Math.ceil(state.duration))}</span>}</div>
  <div className="voice-progress" role="progressbar" aria-label="Voice playback" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.duration?Math.min(100,Math.round(state.elapsed/state.duration*100)):0}><span style={{width:`${state.duration?Math.min(100,state.elapsed/state.duration*100):0}%`}}/></div>
  <div className="voice-buttons">
   <button className="auto-button" aria-pressed={auto} onClick={onAuto} aria-label="Automatic dialogue"><span className={auto?'auto-indicator active':'auto-indicator'}/>Auto {auto?'on':'off'}</button>
   <div className="voice-actions">
    {recorded&&<button className={needsPlay?'text-button voice-retry':'voice-icon'} onClick={onReplay} aria-label={needsPlay?'Play voice':'Replay line'} title={needsPlay?'Play voice':'Replay line'}>{needsPlay?<><Play size={17}/><span>Play</span></>:<RotateCcw size={17}/>}</button>}
    <button className="voice-icon" onClick={onPause} aria-label="Pause dialogue" title="Pause dialogue"><Pause size={18}/></button>
    <button className="text-button skip-line" onClick={onSkip} aria-label="Skip to next line">Skip <SkipForward size={19}/></button>
   </div>
  </div>
 </div>;
}
