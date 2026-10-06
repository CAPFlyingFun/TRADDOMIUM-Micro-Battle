import {useMemo} from 'react';
import {captionAt,captionSegments,type CaptionSegment} from '../lib/captions';
interface Props {text:string;elapsed:number;duration:number;cues?:CaptionSegment[];lineKey:string;narration:boolean;audioUnavailable?:boolean;}
export default function TimedCaption({text,elapsed,duration,cues,lineKey,audioUnavailable=false}:Props){
 const segments=useMemo(()=>captionSegments(text,duration,cues),[text,duration,cues]);
 const segment=captionAt(segments,elapsed),segmented=!audioUnavailable;
 return <p className={`spoken-line ${segmented?'timed-caption':''}`} aria-live="off"><span key={segmented?`${lineKey}:${segment?.start}`:lineKey} className="caption-text">{segmented?segment?.text:text}</span></p>;
}
