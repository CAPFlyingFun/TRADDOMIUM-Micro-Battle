/** Read-only evaluation of the exact Lab native morph weights and body surface. */
import fs from 'node:fs/promises';
import ts from 'typescript';
import {apply,read}from'../../sarahV2ProcBikini/skin.mjs';
import {SkinCollider}from'./collider.mjs';
export async function labWeights(){const text=await fs.readFile('src/sarahlab/sarahLabTool.ts','utf8'),js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));}
export function defaults(lab,p){return {...lab.bellyWeights(p),...lab.breastWeightsFor(p,true),bellyUpper:lab.bellyUpperWeight(p),...lab.navelWeights(p),navelFlat:lab.navelFlatWeight(p),...lab.bellyMotionWeights(p,0,lab.restingBellySpring(),20)};}
export function evaluate(s,p,w){const a=read(p.getAttribute('POSITION'));p.listTargets().forEach((t,k)=>{const weight=w[s.names[k]]??0;if(!weight)return;const d=read(t.getAttribute('POSITION'));for(let i=0;i<a.length;i++)a[i]+=d[i]*weight;});for(let i=0;i<a.length;i+=3)a.set(apply(s.T,Array.from(a.slice(i,i+3)),1).map(x=>x*100),i);return a;}
// Keep exact source triangles near the garment, including a generous margin.
// The local signed-distance collider needs no closed volume; distant head/feet
// triangles cannot be nearest to fabric whose height is 80–105 cm.
export function lowerBodyCollider(P,I){const index=[];for(let i=0;i<I.length;i+=3)if([I[i],I[i+1],I[i+2]].some(v=>P[v*3+1]>65&&P[v*3+1]<120&&Math.abs(P[v*3])<40))index.push(I[i],I[i+1],I[i+2]);return new SkinCollider(P,index);}
