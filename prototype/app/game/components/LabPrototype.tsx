'use client';
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import StoryPlayer from './StoryPlayer';
import {freshSave,type Settings} from '../lib/state';
import {soundscape} from '../lib/audio';
export default function LabPrototype({settings,onSettings,onBack}:{settings:Settings;onSettings:(s:Settings)=>void;onBack:()=>void}){
 const [save,setSave]=useState(()=>freshSave()),[paused,setPaused]=useState(false),[finished,setFinished]=useState(false);
 useEffect(()=>{const hide=()=>{if(document.hidden)setPaused(true);};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);soundscape.clear();};},[]);
 if(finished)return <main className="lab-complete"><span className="eyebrow">END OF CHAPTER ONE</span><h1>“I didn’t.”</h1><p>Jack’s administrator credentials have been revoked.<br/>Chapter One is the only chapter available in this prototype.</p><button className="primary-button" onClick={()=>{setSave(freshSave());setFinished(false);soundscape.unlock();}}>Replay Chapter One</button><button className="secondary-button" onClick={onBack}>Return to title</button><small>This laboratory session is not saved.</small></main>;
 return <><StoryPlayer threeD save={save} settings={settings} paused={paused} onSave={setSave} onSettings={onSettings} onPause={()=>setPaused(true)} onFinish={()=>{soundscape.clear();setFinished(true);}}/>
  <button className="lab-leave" onClick={()=>setPaused(true)}>Menu</button>
  <Dialog open={paused} onOpenChange={v=>{if(!v)void soundscape.unlock().then(()=>setPaused(false));}}><DialogContent className="pause-panel"><DialogTitle>Laboratory paused</DialogTitle><DialogDescription>Chapter One laboratory session. Progress in this session is not saved.</DialogDescription><button className="primary-button" onClick={()=>void soundscape.unlock().then(()=>setPaused(false))}>Resume</button><button className="secondary-button" onClick={onBack}>Return to title</button></DialogContent></Dialog>
 </>;
}
