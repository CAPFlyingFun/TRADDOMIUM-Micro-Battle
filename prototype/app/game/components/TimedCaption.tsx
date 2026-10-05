import {useEffect,useMemo,useState} from 'react';
import {captionAt,captionSegments,type CaptionSegment} from '../lib/captions';
interface Props {text:string;elapsed:number;duration:number;cues?:CaptionSegment[];lineKey:string;narration:boolean;audioUnavailable?:boolean;}
export default function TimedCaption({text,elapsed,duration,cues,lineKey,narration,audioUnavailable=false}:Props){
 const [portrait,setPortrait]=useState(()=>window.matchMedia('(orientation: portrait) and (max-width: 760px)').matches);
 useEffect(()=>{const query=window.matchMedia('(orientation: portrait) and (max-width: 760px)');const update=()=>setPortrait(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 const segments=useMemo(()=>captionSegments(text,duration,cues),[text,duration,cues]);
 const segment=captionAt(segments,elapsed),segmented=portrait&&narration&&!audioUnavailable;
 return <p className={`spoken-line ${segmented?'timed-caption':''}`} aria-live="off"><span key={segmented?`${lineKey}:${segment?.start}`:lineKey} className="caption-text">{segmented?segment?.text:text}</span></p>;
}
