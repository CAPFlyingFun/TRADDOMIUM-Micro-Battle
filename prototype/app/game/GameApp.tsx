'use client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRight, Play, Settings2, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { defaults, readSettings, persistSettings, type Settings } from './lib/state';
import { soundscape } from './lib/audio';
import CinematicScene from './components/CinematicScene';
import SettingsPanel from './components/SettingsPanel';
const LabPrototype=lazy(()=>import('./components/LabPrototype'));
export default function GameApp(){
 const [view,setView]=useState<'title'|'lab3d'>('title');
 const [settings,setSettings]=useState<Settings>(defaults);
 const [ready,setReady]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[storageWarning,setStorageWarning]=useState(false);
 useEffect(()=>{setSettings(readSettings());setReady(true);},[]);
 useEffect(()=>{soundscape.configure(settings);if(ready&&!persistSettings(settings))setStorageWarning(true);},[settings,ready]);
 useEffect(()=>{if(view!=='lab3d')soundscape.clear();},[view]);
 const start=()=>{soundscape.unlock().then(()=>soundscape.configure(settings));setView('lab3d');};
 const back=()=>{setView('title');soundscape.clear();};
 const soundToggle=()=>{soundscape.unlock();setSettings(s=>({...s,sound:!s.sound}));};
 return <div className={`tmb-app ${settings.reducedMotion?'reduce-motion':''}`}>
  {view==='title'&&<main className="title-screen">
   <CinematicScene look="laboratory" title reducedMotion={settings.reducedMotion} softEffects={settings.softEffects}/>
   <div className="title-shade"/>
   <header className="title-header"><div className="edition-mark"><span className="tiny-ring"/>AN INTERACTIVE STORY</div><button className="sound-toggle" onClick={soundToggle} aria-label={settings.sound?'Mute sound':'Enable sound'}>{settings.sound?<Volume2 size={17}/>:<VolumeX size={17}/>}<span>SOUND {settings.sound?'ON':'OFF'}</span></button></header>
   <section className="title-content"><div className="title-kicker"><span/>THE TOMBS INCIDENT</div><h1>TRADDOMIUM<span>MICRO BATTLE</span></h1><div className="title-divider"/>
    <nav className="title-menu" aria-label="Main menu">
     <button className="menu-primary" disabled={!ready} onClick={start}><span className="menu-index">01</span><Play size={18}/><span>New Game<small>Chapter I · The Laboratory</small></span><ArrowRight size={21}/></button>
     <button disabled><span className="menu-index">02</span><RotateCcw size={18}/><span>Continue<small>Laboratory sessions are not saved</small></span><ArrowRight size={18}/></button>
     <button onClick={()=>setSettingsOpen(true)}><span className="menu-index">03</span><Settings2 size={19}/><span>Settings</span><ArrowRight size={18}/></button>
    </nav>
    <p className="title-note">Chapter I <span>·</span> Playable 3D prologue</p>
   </section>
   <aside className="title-location"><span className="location-line"/><span>ATLANTIC RESEARCH SETTLEMENT<strong>MARCH 05, 2110</strong><small>Almost eleven at night.</small></span></aside>
   <footer className="title-footer"><span>PRIVATE PROTOTYPE <b>0.2</b></span><span className="footer-center">TEMPORAL OBJECT MANIPULATION & BOUNDARY SYSTEM</span><span>10 MM HUMAN <i/> 1:180</span></footer>
  </main>}
  {view==='lab3d'&&<Suspense fallback={<div className="character-loading"><p>Preparing the laboratory…</p><button onClick={back}>Return to title</button></div>}><LabPrototype settings={settings} onSettings={setSettings} onBack={back}/></Suspense>}
  <SettingsPanel open={settingsOpen} onClose={()=>setSettingsOpen(false)} settings={settings} onChange={s=>{soundscape.unlock();setSettings(s);}}/>
  {storageWarning&&<div className="storage-warning" role="status">Device storage is unavailable. Keep this tab open to retain this session.</div>}
 </div>;
}
