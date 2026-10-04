'use client';
import { useEffect, useRef } from 'react';
import { scaleItems } from './scale';
type Tool = {name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean};execute:(input:unknown)=>unknown};
type Context = {registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>};
export function useScaleTools(selectedId:string,select:(id:string)=>void){
 const state=useRef({selectedId,select});state.current={selectedId,select};
 const pending=useRef<{id:string;resolve:(v:unknown)=>void}|null>(null);
 useEffect(()=>{if(pending.current?.id===selectedId){const p=pending.current;pending.current=null;p.resolve({selected:scaleItems.find(x=>x.id===selectedId),scale:180,humanMm:10});}},[selectedId]);
 useEffect(()=>{
  const context=(document as unknown as {modelContext?:Context}).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const specs:Tool[]=[
   {name:'read_scale_catalog',title:'Read scale reference',description:'Read all 46 canonical workbook measurements and the selected comparison. Does not change progress.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({scale:180,humanMm:10,selectedId:state.current.selectedId,items:scaleItems.map(i=>({id:i.id,name:i.name,normalMm:i.normalMm,dimension:i.dimension,relativeM:i.relativeM,humanRatio:i.humanRatio}))})},
   {name:'compare_scale_object',title:'Compare a scale object',description:'Select a canonical object in the visible Scale Explorer. Use an exact id returned by read_scale_catalog. Does not alter story progress.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input)=>{
    if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='id'))throw new Error('Expected only an object id.');
    const id=(input as {id:unknown}).id;if(typeof id!=='string'||!scaleItems.some(x=>x.id===id))throw new Error('Unknown canonical object id.');
    if(state.current.selectedId===id)return {selected:scaleItems.find(x=>x.id===id),scale:180,humanMm:10};
    if(pending.current)throw new Error('A comparison is already changing.');
    return new Promise(resolve=>{pending.current={id,resolve};state.current.select(id);});
   }}
  ];
  for(const tool of specs){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional enhancement only. */}}
  return()=>{lifecycle.abort();if(pending.current){pending.current.resolve({error:'Explorer closed.'});pending.current=null;}};
 },[]);
}
