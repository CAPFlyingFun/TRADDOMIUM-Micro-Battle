'use client';
import { useEffect,useRef,useState } from 'react';
import { PersonStanding } from 'lucide-react';
import { assets } from '../data/assets';
import atlas from '../data/sprite-rects.json';
import { metric, type ScaleItem } from '../lib/scale';
// Bounding ratios only control illustrative silhouettes. Measurement bars remain exact.
export default function ScaledComparison({item,view,zoom}:{item:ScaleItem;view:'fit'|'human';zoom:number}){
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(600);
 useEffect(()=>{if(!ref.current)return;const o=new ResizeObserver(e=>setWidth(e[0].contentRect.width));o.observe(ref.current);return()=>o.disconnect();},[]);
 const horizontal=['body length','length','diameter'].includes(item.dimension);
 const maxObjectWidth=Math.max(120,width-100);
 const unit=view==='human'?16*zoom:Math.min(18,horizontal?maxObjectWidth/item.normalMm:190/Math.max(10,item.normalMm));
 const personHeight=10*unit;
 const measured=item.normalMm*unit;
 const rect=item.atlas!==null&&item.dimension!=='depth'?atlas.rects[item.atlas]:null;
 const factor=rect?measured/(horizontal?rect.width:rect.height):1;
 const artWidth=rect?rect.width*factor:horizontal?measured:Math.min(100,measured);
 const artHeight=rect?rect.height*factor:horizontal?Math.min(100,measured):measured;
 const clipped=horizontal?measured>maxObjectWidth:measured>210;
 const tooSmall=personHeight<14;
 const showArt=!!rect&&!clipped;
 const displayWidth=clipped?(horizontal?maxObjectWidth:Math.max(110,width-150)):artWidth;
 const displayHeight=clipped?(horizontal?90:230):artHeight;
 return <div className={`scaled-visual ${horizontal?'horizontal-span':'vertical-span'}`} ref={ref}>
  <div className="scale-floor"/>
  <div className="scaled-person" style={{height:personHeight,width:Math.max(1,personHeight*.4)}}><PersonStanding viewBox="4 2 16 21" preserveAspectRatio="none" strokeWidth={1.5}/>{!tooSmall&&<span>YOU</span>}</div>
  <div className={`scaled-object ${!showArt?'measured-extent':''} ${clipped?'clipped-extent':''}`} style={{width:displayWidth,height:displayHeight,left:Math.min(width*.27,120)}}>
   {showArt?<div className="scaled-art" style={{backgroundImage:`url(${assets.specimens})`,backgroundSize:`${atlas.size*factor}px ${atlas.size*factor}px`,backgroundPosition:`${-rect!.x*factor}px ${-rect!.y*factor}px`}}/>:<div className="extent-block"><span>{clipped?`${item.dimension} continues`:item.dimension}</span></div>}
   <span className="object-dimension">{metric(item.normalMm)}</span>
  </div>
  {tooSmall&&<div className="reference-inset"><PersonStanding size={42}/><span>10 mm person<br/><small>enlarged reference</small></span></div>}
  {clipped&&<span className="offscreen-label">{horizontal?'Measured span continues →':'↑ Measured height continues'}</span>}
  <span className="visual-scale-note">{view==='human'?'HUMAN VIEW':'FULL SPAN'} · {metric(10)} human reference</span>
 </div>;
}
