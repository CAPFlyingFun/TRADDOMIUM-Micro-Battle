/** Visual cues share the original audio playhead; they never seek or split audio. */
export type CaptionSegment={text:string;start:number;end:number};
const normalize=(text:string)=>text.trim().replace(/\s+/g,' ');
export function captionSegments(text:string,duration:number,cues?:CaptionSegment[]):CaptionSegment[]{
 const transcript=normalize(text);if(!transcript)return [];
 const total=Number.isFinite(duration)&&duration>0?duration:Math.max(2.6,transcript.split(' ').length*.34);
 // Optional hand-aligned cues must cover this exact transcript and clip.
 if(cues?.length&&normalize(cues.map(c=>c.text).join(' '))===transcript&&cues[0].start===0&&Math.abs(cues.at(-1)!.end-total)<.05&&cues.every((c,i)=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&(!i||c.start===cues[i-1].end)))return cues;
 const chunks:string[]=[];let chunk='';
 for(const word of transcript.split(' ')){
  if(chunk&&(chunk.length+word.length+1>100||(/[.!?][”"']?$/.test(chunk)&&chunk.length>=55))){chunks.push(chunk);chunk='';}
  chunk+=(chunk?' ':'')+word;
 }
 if(chunk)chunks.push(chunk);
 // Word-weighted timing is an estimate until editorial cue times are supplied.
 const weights=chunks.map(c=>c.split(' ').length+((c.match(/[.!?;,]/g)||[]).length*.35));
 const sum=weights.reduce((a,b)=>a+b,0);let end=0;
 return chunks.map((text,i)=>{const start=end;end=i===chunks.length-1?total:end+total*weights[i]/sum;return {text,start,end};});
}
export function captionAt(segments:CaptionSegment[],elapsed:number):CaptionSegment|undefined{
 const time=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
 return segments.find(c=>time<c.end)||segments.at(-1);
}
