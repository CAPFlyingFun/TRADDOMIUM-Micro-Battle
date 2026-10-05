export interface VoiceClip { duration: number; buffer?: AudioBuffer }
export interface VoiceBackend {
  load(src: string): Promise<VoiceClip>;
  start(clip: VoiceClip, offset: number, ended: () => void): { stop(): void };
  now(): number;
  isReady(): boolean;
}
export type VoiceStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'blocked' | 'error';
export interface VoiceState { key: string; status: VoiceStatus; duration: number; elapsed: number }

// A line owns a generation; a running source owns a second token. Late network
// responses and stopped AudioBufferSource callbacks cannot advance another line.
export class VoiceTransport {
  private backend: VoiceBackend;
  private changed: (state: VoiceState) => void;
  private completed: (key: string) => void;
  private generation = 0;
  private run = 0;
  private key = '';
  private source: { stop(): void } | null = null;
  private clip: VoiceClip | null = null;
  private offset = 0;
  private started = 0;
  private paused = false;
  private finished = false;
  private status: VoiceStatus = 'idle';
  constructor(backend: VoiceBackend, changed: (state: VoiceState) => void, completed: (key: string) => void) {
    this.backend=backend; this.changed=changed; this.completed=completed;
  }
  snapshot(): VoiceState {
    return {key:this.key,status:this.status,duration:this.clip?.duration||0,elapsed:Math.min(this.clip?.duration||0,this.offset+(this.source?this.backend.now()-this.started:0))};
  }
  private emit(status: VoiceStatus) { this.status=status; this.changed(this.snapshot()); }
  private halt() {
    ++this.run;
    if(this.source){this.offset=Math.min(this.clip?.duration||0,this.offset+Math.max(0,this.backend.now()-this.started));this.source.stop();this.source=null;}
  }
  select(key: string, src: string) {
    this.halt(); const generation=++this.generation;
    this.key=key;this.clip=null;this.offset=0;this.finished=false;this.emit('loading');
    this.backend.load(src).then(clip=>{
      if(generation!==this.generation)return;
      this.clip=clip;
      if(this.paused)this.emit('paused');else this.play();
    }).catch(()=>{if(generation===this.generation)this.emit('error');});
  }
  private play() {
    if(!this.clip||this.source||this.finished||this.paused)return;
    if(!this.backend.isReady()){this.emit('blocked');return;}
    const generation=this.generation,run=++this.run;
    try {
      this.started=this.backend.now();
      this.source=this.backend.start(this.clip,this.offset,()=>{
        if(generation!==this.generation||run!==this.run||this.finished||this.paused)return;
        this.source=null;this.offset=this.clip?.duration||0;this.finished=true;
        this.emit('finished');this.completed(this.key);
      });
      this.emit('playing');
    }catch{this.source=null;this.emit('error');}
  }
  setPaused(paused: boolean) {
    if(this.paused===paused)return;
    this.paused=paused;
    if(paused){this.halt();if(this.clip&&!this.finished)this.emit('paused');}
    else this.play();
  }
  resume() { this.paused=false;this.play(); }
  stop() {
    ++this.generation;this.halt();this.clip=null;this.offset=0;this.key='';this.finished=false;this.emit('idle');
  }
}
