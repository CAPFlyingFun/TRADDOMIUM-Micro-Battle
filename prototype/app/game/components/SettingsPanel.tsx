'use client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import type { Settings } from '../lib/state';
import audioManifest from '../data/audio-manifest.json';
export default function SettingsPanel({open,onClose,settings,onChange}:{open:boolean;onClose:()=>void;settings:Settings;onChange:(s:Settings)=>void}){
 const toggle=(key:keyof Settings,value:boolean)=>onChange({...settings,[key]:value});
 return <Dialog open={open} onOpenChange={o=>{if(!o)onClose();}}><DialogContent className="settings-panel"><span className="eyebrow">EXPERIENCE</span><DialogTitle>Settings</DialogTitle><DialogDescription>Make the laboratory feel right for you.</DialogDescription>
  <div className="setting-row"><div><label htmlFor="sound-setting">Sound</label><small>Voices, ambience and sound effects</small></div><Switch id="sound-setting" checked={settings.sound} onCheckedChange={v=>toggle('sound',v)}/></div>
  <div className="volume-row"><label htmlFor="volume-setting">Volume <span>{Math.round(settings.volume*100)}%</span></label><Slider id="volume-setting" aria-label="Volume" value={[settings.volume*100]} onValueChange={v=>onChange({...settings,volume:v[0]/100})} min={0} max={100} step={5}/></div>
  <div className="setting-row"><div><label htmlFor="voice-setting">Recorded voices</label><small>Jack, Sarah, Lena and TOMBS</small></div><Switch id="voice-setting" checked={settings.voices} onCheckedChange={v=>toggle('voices',v)}/></div>
  <div className="setting-row"><div><label htmlFor="auto-setting">Auto advance dialogue</label><small>Continue after each clip; wait at interactions</small></div><Switch id="auto-setting" checked={settings.autoAdvance} onCheckedChange={v=>toggle('autoAdvance',v)}/></div>
  <div className="volume-row"><label htmlFor="effects-setting">Background and effects <span>{Math.round(settings.effectsVolume*100)}%</span></label><Slider id="effects-setting" aria-label="Background and effects volume" value={[settings.effectsVolume*100]} onValueChange={v=>onChange({...settings,effectsVolume:v[0]/100})} min={0} max={100} step={5}/></div>
  <div className="setting-row"><div><label htmlFor="motion-setting">Reduced motion</label><small>Stop camera drift, particles and shaking</small></div><Switch id="motion-setting" checked={settings.reducedMotion} onCheckedChange={v=>toggle('reducedMotion',v)}/></div>
  <div className="setting-row"><div><label htmlFor="soft-setting">Gentle lighting effects</label><small>Soften alarm pulses and the activation flash</small></div><Switch id="soft-setting" checked={settings.softEffects} onCheckedChange={v=>toggle('softEffects',v)}/></div>
  <div className="setting-row"><div><label htmlFor="text-setting">Larger dialogue</label><small>Increase subtitle size</small></div><Switch id="text-setting" checked={settings.largeText} onCheckedChange={v=>toggle('largeText',v)}/></div>
  <p className="settings-note">Subtitles remain visible. Progress and preferences are saved on this device. Continue replays your current line.</p>
  <details className="audio-credits"><summary>Audio credits</summary><p>Voiceovers and generated effects from the TMB audiobook, made with ElevenLabs.</p>{Object.entries(audioManifest.effects).filter(([,asset])=>'credit' in asset).map(([id,asset])=>{if(!('credit' in asset))return null;const credit=asset.credit;return <p key={id}>{credit.title} by <a href={credit.authorUrl} target="_blank" rel="noreferrer">{credit.author}</a> · <a href={credit.licenseUrl} target="_blank" rel="noreferrer">{credit.license}</a></p>;})}</details>
  <button className="primary-button" onClick={onClose}>Done</button>
 </DialogContent></Dialog>;
}
