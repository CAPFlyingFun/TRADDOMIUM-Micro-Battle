'use client';
// Restoration of the TMB-Story cinematic opening (segments 0 and 1).
// Provenance: CAPFlyingFun/TMB-Story @ dfe810e670a42867b014dae4a206df5d80350414,
// chapter-1 opening script: sets.island + events ("Date", "The island from high above",
// "The settlement"). Painter: visual/paint/island.js (see settlement-lights.ts).
// Driven only by narration elapsed/duration; nothing runs on its own clock.
import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../../../lib/asset-url';
import { settlementLights } from './settlement-lights';
import labDialogue from '../data/lab-dialogue.json';
import './story-opening.css';

interface Props {segment:0|1;elapsed:number;duration:number;paused:boolean;reducedMotion:boolean;softEffects:boolean;chapterOffset?:number}

// island.world: 9000x9000, color #040812, backgroundRect (3476,3476,2048,2048)
const SEA = '#040812', BG = {x:3476,y:3476,w:2048,h:2048};
const WORLD = {x:0,y:0,w:9000,h:9000};
// layers: ground p1; clouds-low parallax 1.1 zoomDepth .3; clouds-high parallax 1.3 zoomDepth .6
const LAYER = {ground:{parallax:1,zoomDepth:0},low:{parallax:1.1,zoomDepth:0.3},high:{parallax:1.3,zoomDepth:0.6}};
// shots (focus defaults to rect centre; high focus [4500,4500], settlement [4656,4636])
type Shot = {x:number;y:number;w:number;h:number;fx:number;fy:number};
const SHOT_HI: Shot = {x:2200,y:2200,w:4600,h:4600,fx:4500,fy:4500};
const SHOT_SET: Shot = {x:4396,y:4441,w:520,h:390,fx:4656,fy:4636};
// Objects are centred on x,y (stage.js: left = x - w/2).
const SETTLEMENT = {x:4656,y:4636,w:560,h:400,canvas:[1120,800] as const,seed:7,opacity:0.4};
type Cloud = {id:string;layer:'low'|'high';n:number;x:number;y:number;w:number;h:number;o:number;drift:[number,number]};
const CLOUDS: Cloud[] = [
  {id:'low-w',layer:'low',n:1,x:3800,y:4950,w:1300,h:480,o:0.85,drift:[5,1]},
  {id:'low-e',layer:'low',n:2,x:5450,y:4350,w:1200,h:450,o:0.8,drift:[4,1]},
  {id:'low-s',layer:'low',n:3,x:4900,y:5500,w:1200,h:560,o:0.8,drift:[4,1]},
  {id:'high-a',layer:'high',n:4,x:3950,y:4250,w:1700,h:520,o:0.75,drift:[9,2]},
  {id:'high-b',layer:'high',n:1,x:5350,y:5150,w:1600,h:590,o:0.7,drift:[8,2]},
  {id:'high-c',layer:'high',n:3,x:5250,y:3600,w:1300,h:600,o:0.7,drift:[8,2]},
  {id:'high-d',layer:'high',n:2,x:3550,y:5350,w:1300,h:490,o:0.7,drift:[9,2]},
];

// visual/engine/timeline.js: EASE, norm, phrase anchoring.
const EASE = {linear:(p:number)=>p,in:(p:number)=>p*p,out:(p:number)=>1-(1-p)*(1-p),inOut:(p:number)=>p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2};
const norm = (s:string) => String(s).toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g,' ').trim();
// Exact canonical manuscript of narration segment 1.
const TEXT = norm((labDialogue as unknown as Record<string,{text:string}[]>).wake[1].text);
// timeline.js: phrase time = start + (end-start) * indexOf(norm(phrase)) / norm(text).length
const phraseT = (phrase:string, dur:number) => {
  const i = TEXT.indexOf(norm(phrase));
  if (i < 0) throw new Error(`StoryOpening: "${phrase}" not in segment 1`);
  return dur * i / TEXT.length;
};

const clamp = (v:number,lo=0,hi=1) => Math.max(lo,Math.min(hi,v));
// timeline.js Cont keyframe: from the value at the keyframe's start, to `to`, over dur with ease.
const kf = (t:number,start:number,dur:number,from:number,to:number,e:(p:number)=>number) => {
  if (t < start) return from;
  const p = dur > 0 ? Math.min(1,(t-start)/dur) : 1;
  return from + (to-from)*e(p);
};
// timeline.js zoomLerp: constant-rate zoom, one fixed point.
function zoomLerp(a:Shot,b:Shot,e:number):Shot {
  const axis = (p0:number,s0:number,f0:number,p1:number,s1:number,f1:number) => {
    const r = s1/s0, k = Math.pow(r,e), c0 = p0+s0/2, c1 = p1+s1/2;
    const at = (a0:number,b0:number) => {
      if (Math.abs(1-r) < 1e-6) return a0 + (b0-a0)*e;
      const F = (b0 - a0*r)/(1-r);
      return F + (a0-F)*k;
    };
    const size = s0*k;
    return {pos:at(c0,c1)-size/2,size,focus:at(f0,f1)};
  };
  const X = axis(a.x,a.w,a.fx,b.x,b.w,b.fx), Y = axis(a.y,a.h,a.fy,b.y,b.h,b.fy);
  return {x:X.pos,y:Y.pos,w:X.size,h:Y.size,fx:X.focus,fy:Y.focus};
}
// visual/engine/camera.js frameShot (safe insets 0, unbounded world) and layerTransform.
const cl = (v:number,lo:number,hi:number) => lo > hi ? (lo+hi)/2 : Math.min(Math.max(v,lo),hi);
function frameShot(shot:Shot,vw:number,vh:number) {
  const cover = Math.max(vw/WORLD.w, vh/WORLD.h);
  const zoom = Math.min(vw/shot.w, vh/shot.h); // bounded === false
  const visW = vw/zoom, visH = vh/zoom;
  let cx = shot.x+shot.w/2, cy = shot.y+shot.h/2;
  if (shot.w > visW) cx = cl(shot.fx, shot.x+visW/2, shot.x+shot.w-visW/2);
  if (shot.h > visH) cy = cl(shot.fy, shot.y+visH/2, shot.y+shot.h-visH/2);
  return {zoom,cx,cy,bcx:vw/2,bcy:vh/2,cover};
}
function layerTransform(cam:ReturnType<typeof frameShot>,p:number,zoomDepth:number) {
  if (p === 1 && !zoomDepth) return {zoom:cam.zoom,tx:cam.bcx-cam.cx*cam.zoom,ty:cam.bcy-cam.cy*cam.zoom};
  const zoom = cam.zoom*Math.pow(cam.zoom/cam.cover,zoomDepth);
  const mx = WORLD.x+WORLD.w/2, my = WORLD.y+WORLD.h/2;
  const cx = mx+(cam.cx-mx)*p, cy = my+(cam.cy-my)*p;
  return {zoom,tx:cam.bcx-cx*zoom,ty:cam.bcy-cy*zoom};
}

export default function StoryOpening({segment,elapsed,duration,paused,reducedMotion,chapterOffset=0}:Props) {
  const [imageError,setImageError]=useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgs = useRef<{bg?:HTMLImageElement;clouds:Record<number,HTMLImageElement>;lights?:HTMLCanvasElement}>({clouds:{}});
  const state = useRef({segment,elapsed,duration,reducedMotion,paused,chapterOffset,stamp:performance.now()});
  const stamp=state.current.elapsed!==elapsed||state.current.segment!==segment||state.current.paused!==paused?performance.now():state.current.stamp;
  state.current = {segment,elapsed,duration,reducedMotion,paused,chapterOffset,stamp};
  const drawRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const c = canvasRef.current; if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = c.clientWidth, vh = c.clientHeight;
    if (!vw || !vh) return;
    if (c.width !== Math.round(vw*dpr) || c.height !== Math.round(vh*dpr)) { c.width = Math.round(vw*dpr); c.height = Math.round(vh*dpr); }
    const g = c.getContext('2d'); if (!g) return;
    const s = state.current;
    g.setTransform(dpr,0,0,dpr,0,0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0,0,vw,vh);
    if (s.segment !== 1) return;
    // t is seconds from the start of narration segment 1 (canonical anchors are relative to it).
    // Interpolate only between transport snapshots; the audio clock remains authoritative.
    const dur = Math.max(s.duration, 1), t = Math.min(dur,s.elapsed+(s.paused?0:Math.min(.25,(performance.now()-s.stamp)/1000)));
    const tNear = phraseT('Near its center', dur), tMed = phraseT('medical facilities', dur);
    // camera event: at seg1 -0.3, until line end, ease linear, path zoom
    const t0 = -0.3, camDur = dur - t0;
    const e = s.reducedMotion ? 1 : EASE.linear(clamp((t - t0)/camDur));
    const cam = frameShot(zoomLerp(SHOT_HI, SHOT_SET, e), vw, vh);
    // fade: initial black (fadeFromBlack); to 0 at seg1-0.3 over 3.5 (out); to 1 at end-1 over 1 (in)
    const fadeA = (tt:number) => kf(tt, t0, 3.5, 1, 0, EASE.out);
    const black = t >= dur - 1 ? kf(t, dur - 1, 1, fadeA(dur - 1), 1, EASE.in) : fadeA(t);
    const apply = (m:{zoom:number;tx:number;ty:number}) => g.setTransform(dpr*m.zoom,0,0,dpr*m.zoom,dpr*m.tx,dpr*m.ty);
    g.fillStyle = SEA; g.fillRect(0,0,vw,vh);
    apply(layerTransform(cam, LAYER.ground.parallax, LAYER.ground.zoomDepth));
    if (imgs.current.bg) g.drawImage(imgs.current.bg, BG.x, BG.y, BG.w, BG.h);
    if (imgs.current.lights) {
      g.globalAlpha = kf(t, tNear - 0.4, 2.6, SETTLEMENT.opacity, 1, EASE.inOut);
      g.drawImage(imgs.current.lights, SETTLEMENT.x - SETTLEMENT.w/2, SETTLEMENT.y - SETTLEMENT.h/2, SETTLEMENT.w, SETTLEMENT.h);
      g.globalAlpha = 1;
    }
    for (const layer of ['low','high'] as const) {
      apply(layerTransform(cam, LAYER[layer].parallax, LAYER[layer].zoomDepth));
      for (const q of CLOUDS) {
        if (q.layer !== layer) continue;
        const im = imgs.current.clouds[q.n]; if (!im) continue;
        const o = layer === 'high' ? kf(t, tNear + 1, 4, q.o, 0, EASE.inOut) : kf(t, tMed, 3, q.o, 0, EASE.inOut);
        const v = Math.round(clamp(o)*1000)/1000;
        if (v <= 0) continue;
        const dt = s.reducedMotion ? 0 : t+s.chapterOffset; // canonical drift uses chapter time
        g.globalAlpha = v;
        g.drawImage(im, q.x - q.w/2 + q.drift[0]*dt, q.y - q.h/2 + q.drift[1]*dt, q.w, q.h);
      }
    }
    g.setTransform(dpr,0,0,dpr,0,0);
    g.globalAlpha = clamp(black); g.fillStyle = '#000'; g.fillRect(0,0,vw,vh);
    g.globalAlpha = 1;
  };

  useEffect(() => {
    let dead = false;
    const redraw = () => { if (!dead) drawRef.current(); };
    const load = (src:string, cb:(i:HTMLImageElement)=>void) => { const i = new Image(); i.onload = () => { if(!dead){cb(i);redraw();} }; i.onerror = () => {if(!dead)setImageError('The opening artwork could not be displayed. Use Menu to return to title and try again.');}; i.src = assetUrl(src); };
    load('/assets/intro/island-night.jpg', i => { imgs.current.bg = i; });
    [1,2,3,4].forEach(n => load(`/assets/intro/clouds/wisp-${n}.png`, i => { imgs.current.clouds[n] = i; }));
    const lc = document.createElement('canvas'); lc.width = SETTLEMENT.canvas[0]; lc.height = SETTLEMENT.canvas[1];
    settlementLights(lc, {w:SETTLEMENT.w, seed:SETTLEMENT.seed}); imgs.current.lights = lc;
    const ro = new ResizeObserver(redraw); if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener('orientationchange', redraw);
    redraw();
    return () => { dead = true; ro.disconnect(); window.removeEventListener('orientationchange', redraw); };
  }, []);

  useEffect(() => { drawRef.current(); });
  useEffect(()=>{
    let frame=0;
    const tick=()=>{drawRef.current();if(!state.current.paused)frame=requestAnimationFrame(tick);};
    tick();return()=>cancelAnimationFrame(frame);
  },[paused,segment]);

  // Segment 0: title card (timeline.js: min(1,(t-c.t)/fadeIn,(c.t+dur-t)/fadeOut)); at 0.25, dur 4.6, fadeIn 1.0, fadeOut 1.3
  let titleOpacity = 0;
  if (segment === 0) titleOpacity = clamp(Math.min(1,(elapsed-0.25)/1.0,(0.25+4.6-elapsed)/1.3));
  return <div className="story-opening" aria-hidden="true" data-segment={segment}>
    <canvas ref={canvasRef}/>
    {segment === 0 && <h2 className="story-opening-title" style={{opacity:titleOpacity}}>March 5, 2110</h2>}
    {imageError&&<p className="story-opening-error" role="alert">{imageError}</p>}
  </div>;
}
