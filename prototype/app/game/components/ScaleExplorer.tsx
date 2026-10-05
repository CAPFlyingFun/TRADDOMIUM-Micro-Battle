'use client';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Maximize2, PersonStanding, ZoomIn, Ruler, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ScaledComparison from './ScaledComparison';
import { useScaleTools } from '../lib/useScaleTools';
import { categories, scaleItems, number, metric, relativeMetres, humanHeights } from '../lib/scale';
export default function ScaleExplorer({onBack}:{onBack:()=>void}) {
 const [category,setCategory]=useState('All'),[id,setId]=useState('row-8'),[view,setView]=useState<'fit'|'human'>('fit'),[zoom,setZoom]=useState(1);
 const filtered=useMemo(()=>scaleItems.filter(i=>category==='All'||i.category===category||(category==='Animals'&&['Insects','Spiders'].includes(i.category))),[category]);
 const item=filtered.find(i=>i.id===id)||filtered[0];
 const current=filtered.findIndex(i=>i.id===item.id);
 useScaleTools(item.id,next=>{setCategory('All');setId(next);setZoom(1);});
 const ratio=humanHeights(item.normalMm),relative=relativeMetres(item.normalMm);
 const chartMax=view==='fit'?Math.max(10,item.normalMm)*1.14:22/zoom;
 const specimenPercent=Math.min(100,item.normalMm/chartMax*100),humanPercent=10/chartMax*100;
 const overflow=item.normalMm>chartMax;
 function selectItem(next:string){setId(next);setZoom(1);}
 function selectCategory(next:string){setCategory(next);setZoom(1);}
 return <main className="explorer-screen">
  <header className="explorer-header"><button className="text-button" onClick={onBack}><ArrowLeft size={18}/><span>Title screen</span></button><div className="mini-logo">TMB<span>FIELD REFERENCE</span></div><span className="scale-lock">1 : 180 <small>CANONICAL SCALE</small></span></header>
  <div className="explorer-intro"><div><span className="eyebrow">SAME WORLD. A DIFFERENT PERSPECTIVE.</span><h1>Scale Explorer<span>.</span></h1></div><p>You are <strong>10 mm</strong> tall.<br/>{' '}Everything else stays the same.</p></div>
  <Tabs className="category-tabs" value={category} onValueChange={selectCategory}><TabsList aria-label="Scale categories">{categories.map(c=><TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}</TabsList></Tabs>
  <div className="explorer-workspace">
   <aside className="specimen-list" aria-label="Specimen list"><div className="list-heading"><span>{category==='All'?'REFERENCE INDEX':category.toUpperCase()}</span><small>{filtered.length} entries</small></div>{filtered.map((entry,i)=><button key={entry.id} className={`specimen-row ${entry.id===item.id?'selected':''}`} onClick={()=>selectItem(entry.id)}><span className="specimen-number">{String(i+1).padStart(2,'0')}</span><span>{entry.name}<small>{metric(entry.normalMm)} · {entry.dimension}</small></span><ChevronRight size={16}/></button>)}</aside>
   <div className="comparison-main">
    <div className="mobile-picker"><Select value={item.id} onValueChange={selectItem}><SelectTrigger aria-label="Choose an object"><SelectValue/></SelectTrigger><SelectContent>{filtered.map(e=><SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></div>
    <div className="specimen-heading"><div><span className="eyebrow">{item.category} / {item.dimension}</span><h2>{item.name}</h2></div><div className="specimen-nav"><button aria-label="Previous object" className="icon-button" disabled={current===0} onClick={()=>selectItem(filtered[current-1].id)}><ChevronLeft size={19}/></button><button aria-label="Next object" className="icon-button" disabled={current===filtered.length-1} onClick={()=>selectItem(filtered[current+1].id)}><ChevronRight size={19}/></button></div></div>
    <div className="comparison-stage">
     <div className="stage-label"><span>01 / MEASURED SPAN</span><span>{view==='fit'?'FIT TO OBJECT':'HUMAN VIEW'} · LINEAR SCALE</span></div>
     <ScaledComparison item={item} view={view} zoom={zoom}/>
     <div className="metric-comparison" role="img" aria-label={`Exact linear comparison: human height 10 millimeters; ${item.name} ${item.dimension} ${item.normalMm} millimeters, ${number(ratio,3)} times human height.`}>
      <div className="measure-row"><span>10 mm person</span><div className="measure-track"><div className="measure-bar human-bar" style={{width:`${humanPercent}%`}}/></div></div>
      <div className="measure-row"><span>{item.dimension}</span><div className="measure-track"><div className="measure-bar object-bar" style={{width:`${specimenPercent}%`}}/>{overflow&&<span className="beyond-frame">continues beyond view →</span>}</div></div>
      <div className="axis"><span>0</span><span>{metric(chartMax/2)}</span><span>{metric(chartMax)}</span></div>
     </div>
     {view==='fit'&&ratio>35&&<p className="zoom-note">The human marker is tiny at this scale. Switch to Human view for a readable comparison.</p>}
     <div className="view-toolbar"><Tabs value={view} onValueChange={v=>{setView(v as 'fit'|'human');setZoom(1);}}><TabsList aria-label="Comparison view"><TabsTrigger value="fit"><Maximize2 size={14}/>Fit object</TabsTrigger><TabsTrigger value="human"><PersonStanding size={16}/>Human view</TabsTrigger></TabsList></Tabs>{view==='human'&&<div className="zoom-control"><ZoomIn size={16}/><Slider aria-label="Comparison zoom" value={[zoom]} min={.5} max={3} step={.1} onValueChange={v=>setZoom(v[0])}/><span>{number(zoom)}×</span></div>}</div>
     <p className="illustration-note">Reference artwork is illustrative. The measurement bars share one exact scale.</p>
    </div>
    <div className="scale-stats"><div><span>NORMAL WORLD</span><strong>{metric(item.normalMm)}</strong><small>{item.normalLabel}</small></div><div><span>TMB-RELATIVE EXPERIENCE</span><strong>{relative>=1000?`${number(relative/1000)} km`:`${number(relative,3)} m`}</strong><small>{number(relative*3.280839895)} ft · apparent {item.dimension}</small></div><div><span>TO A 10 MM PERSON</span><strong>{number(ratio,3)}<em>×</em></strong><small>human heights in {item.dimension}</small></div></div>
    <div className="scale-context"><p>{item.dimension==='body length'?`This is body length, not standing height or leg span. The ${metric(item.normalMm)} body measures ${number(ratio,3)} human heights from end to end.`:item.dimension==='depth'?`This measures depth. At ${metric(item.normalMm)} deep, the water or depression is ${number(ratio,3)} times the height of a 10 mm person.`:item.note}</p><div className="source-note"><Ruler size={14}/><span>Scale Comparison · row {item.sourceRow} · {item.source==='Design ref'?'design reference':item.source==='—'?'story reference':item.source}</span>{item.sourceInfo&&<a href={item.sourceInfo.url} target="_blank" rel="noreferrer">Workbook source <ArrowUpRight size={13}/></a>}</div></div>
   </div>
  </div>
  <footer className="explorer-footer"><span>Normal size × 180 = TMB-relative experience</span><span>Normal size ÷ 10 mm = human-height comparison</span></footer>
 </main>;
}
