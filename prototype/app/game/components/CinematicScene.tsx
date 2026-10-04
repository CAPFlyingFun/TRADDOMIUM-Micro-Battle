'use client';
import { assets, type SceneLook } from '../data/assets';
import type { CSSProperties } from 'react';
interface Props {look:SceneLook;intensity?:number;reducedMotion:boolean;softEffects:boolean;paused?:boolean;activation?:number;camera?:string;blackout?:boolean;title?:boolean;focus?:string;}
export default function CinematicScene({look,intensity=0,reducedMotion,softEffects,paused,activation=-1,camera='north',blackout,title,focus}:Props) {
  const exterior=['window','cameras','ending'].includes(look);
  return <div aria-hidden="true" className={`cinematic focus-${focus} ${look} ${title?'title-scene':''} ${reducedMotion?'still':''} ${paused?'paused':''} ${softEffects?'soft-effects':''} ${activation>=0?'activating':''} camera-${camera}`} style={{'--intensity':intensity,'--activation':activation} as CSSProperties}>
    <div className="image-plane" style={{backgroundImage:`url(${exterior?assets.exterior:assets.laboratory})`}} />
    <div className="scene-vignette" />
    <div className="light-haze" />
    {!reducedMotion&&<div className="dust-field"><i/><i/><i/><i/><i/><i/><i/><i/></div>}
    {intensity>1&&<div className="alarm-wash" />}
    {look==='array'&&intensity>2&&<div className="array-field"><span/><span/><span/></div>}
    {look==='cameras'&&<div className="scanlines" />}
    {activation>=0&&<div className={`activation-layer phase-${activation}`}><div className="energy-halo"/><div className="whiteout"/><div className="darkness"/></div>}
    {blackout&&<div className="shutdown-blackout" />}
    <div className="film-grain" />
  </div>;
}
