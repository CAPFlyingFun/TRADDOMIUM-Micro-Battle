import chapterOne from '../data/chapter1-audio.json';
import { assetUrl } from '../../../lib/asset-url';
import type { Settings } from './state';
import type { VoiceBackend, VoiceClip } from './voice-transport';
type Effect = {src:string;gain:number;duck:number;loop:boolean};
const effects: Record<string,Effect> = chapterOne.effects;
type Bed = {source:AudioBufferSourceNode;gain:GainNode};

// One gesture-unlocked context serves recordings and effects. GainNode mixing
// also works on mobile browsers that ignore HTMLMediaElement.volume.
class Soundscape implements VoiceBackend {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: GainNode | null = null;
  private fx: GainNode | null = null;
  private cache = new Map<string,Promise<VoiceClip>>();
  private beds = new Map<string,Bed>();
  private wanted = new Set<string>();
  private shots = new Map<AudioBufferSourceNode,GainNode>();
  private shotGeneration = 0;
  private paused = false;
  private silent = false;
  private speaking = false;
  private enabled = true;
  private volume = .45;
  private effectsVolume = 1;
  private voicesEnabled = true;
  async unlock() {
    // Safari defaults Web Audio to ambient, which follows the iPhone silent
    // switch. Request media playback before creating/resuming the shared context,
    // synchronously within the player's gesture, for both voices and effects.
    // https://bugs.webkit.org/show_bug.cgi?id=237322#c6
    try {
      const session=(navigator as Navigator & {audioSession?:{type:string}}).audioSession;
      if(session)session.type='playback';
    }catch{
      // Audio Session is optional; an unavailable/rejected setting must not
      // prevent the existing gesture-unlocked player from working.
    }
    try {
      if(!this.context){
        const ctor=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
        if(!ctor)return false;
        this.context=new ctor();this.master=this.context.createGain();this.master.gain.value=0;this.master.connect(this.context.destination);
        this.voice=this.context.createGain();this.voice.connect(this.master);
        this.fx=this.context.createGain();this.fx.connect(this.master);
      }
      await this.context.resume();this.updateMix();return this.isReady();
    }catch{return false;}
  }
  isReady(){return this.context?.state==='running';}
  now(){return this.context?.currentTime||0;}
  configure(settings:Settings){
    this.enabled=settings.sound;this.volume=settings.volume;this.effectsVolume=settings.effectsVolume;this.voicesEnabled=settings.voices;
    this.updateMix();
  }
  private updateMix(){
    if(!this.context)return;
    const t=this.context.currentTime;
    this.master?.gain.setTargetAtTime(this.enabled&&!this.paused&&!this.silent?this.volume:0,t,.025);
    this.voice?.gain.setTargetAtTime(this.voicesEnabled?1:0,t,.025);
    this.fx?.gain.setTargetAtTime(this.effectsVolume,t,.06);
    for(const [id,bed] of this.beds){const a=effects[id];bed.gain.gain.setTargetAtTime(a.gain*(this.speaking?a.duck:1),t,.15);}
  }
  setSpeaking(speaking:boolean){this.speaking=speaking;this.updateMix();}
  setPaused(paused:boolean){this.paused=paused;if(paused)this.stopShots();this.updateMix();}
  private stopShots(){++this.shotGeneration;for(const [shot,gain] of this.shots){shot.onended=null;try{shot.stop();}catch{}shot.disconnect();gain.disconnect();}this.shots.clear();}
  async load(src:string):Promise<VoiceClip>{
    const cached=this.cache.get(src);if(cached){this.cache.delete(src);this.cache.set(src,cached);return cached;}
    const pending=(async()=>{
      if(!this.context)throw new Error('Audio needs a player gesture');
      const response=await fetch(assetUrl(src),{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Recording unavailable');
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      return {buffer,duration:buffer.duration};
    })();
    this.cache.set(src,pending);
    while(this.cache.size>32)this.cache.delete(this.cache.keys().next().value!);
    pending.catch(()=>{if(this.cache.get(src)===pending)this.cache.delete(src);});return pending;
  }
  preload(src:string){void this.load(src).catch(()=>{});}
  start(clip:VoiceClip,offset:number,ended:()=>void){
    if(!this.context||!this.voice||!clip.buffer)throw new Error('Audio unavailable');
    const source=this.context.createBufferSource();source.buffer=clip.buffer;source.connect(this.voice);
    source.onended=()=>{source.disconnect();ended();};source.start(0,Math.min(offset,clip.duration));
    return {stop:()=>{source.onended=null;try{source.stop();}catch{}source.disconnect();}};
  }
  cancelEffects(){this.stopShots();}
  effect(id:string,cueGain?:number){
    const asset=effects[id],generation=this.shotGeneration;
    if(!asset||!this.enabled||this.paused||this.silent)return;
    void this.load(asset.src).then(clip=>{
      if(!this.context||!this.fx||generation!==this.shotGeneration||this.paused||this.silent||!this.enabled)return;
      const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=clip.buffer!;
      gain.gain.value=(cueGain??asset.gain)*(this.speaking?asset.duck:1);source.connect(gain);gain.connect(this.fx);
      this.shots.set(source,gain);source.onended=()=>{this.shots.delete(source);source.disconnect();gain.disconnect();};source.start();
    }).catch(()=>{});
  }
  scene(sceneId:string,intensity:number,sheltered:boolean,blackout:boolean,phase:number,chapterOne=false){
    const activation=sceneId==='activation';
    this.silent=activation&&(phase===1||phase===2);
    if(this.silent)this.stopShots();
    const wanted=new Set<string>();
    if(!blackout&&!this.silent){
      if(sceneId==='island')wanted.add('amb_night_outside');
      else if(sceneId!=='date')wanted.add('amb_computer_lab');
      if(sceneId==='alarm'||(intensity>=2&&!activation)||sceneId==='recovery'||(activation&&phase>=3))wanted.add('amb_console_alarm_bed');
      if(['revoked','corridor','power','array','boundary','acquired','locked'].includes(sceneId)||(activation&&phase===0))wanted.add('amb_tombs_array_power_rise');
      if(['array','boundary','acquired','locked'].includes(sceneId)||(activation&&phase===0))wanted.add('sfx_array_rings_move');
      if(sheltered||['acquired','locked','recovery'].includes(sceneId)||(activation&&(phase===0||phase>=3)))wanted.add('amb_settlement_sirens');
      if(['intercom','power','comms'].includes(sceneId))wanted.add('amb_intercom_channel_open');
      if(['outside','cameras','event','ending'].includes(sceneId))wanted.add('amb_night_outside');
    }
    if(chapterOne)for(const id of [...wanted]){
      wanted.delete(id);
      if(effects['chapter1:'+id])wanted.add('chapter1:'+id);
    }
    this.wanted=wanted;
    for(const [id,bed] of this.beds)if(!wanted.has(id)){bed.source.stop();bed.source.disconnect();bed.gain.disconnect();this.beds.delete(id);}
    for(const id of wanted){
      if(this.beds.has(id))continue;
      const asset=effects[id];if(!asset)continue;
      void this.load(asset.src).then(clip=>{
        if(!this.context||!this.fx||!this.wanted.has(id)||this.beds.has(id))return;
        const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=clip.buffer!;source.loop=true;
        gain.gain.value=0;source.connect(gain);gain.connect(this.fx);source.start();this.beds.set(id,{source,gain});this.updateMix();
      }).catch(()=>{});
    }
    this.updateMix();
  }
  clear(){
    this.wanted.clear();for(const bed of this.beds.values()){bed.source.stop();bed.source.disconnect();bed.gain.disconnect();}this.beds.clear();
    this.stopShots();this.silent=false;this.speaking=false;this.updateMix();
  }
}
export const soundscape = new Soundscape();
