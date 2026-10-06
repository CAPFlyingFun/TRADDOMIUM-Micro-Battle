import {MathUtils} from 'three';
/** Canonical lines 2–6; driven by the unchanged narration playhead. */
export function jackOpening(source:number,elapsed:number,reduced=false){
 const t=Math.max(0,Number.isFinite(elapsed)?elapsed:0);
 const sleep=source>=2&&source<=5?1:source===6?1-MathUtils.smoothstep(t,0,.45):0;
 const jolt=source===6?Math.sin(Math.PI*Math.min(1,t/.55)):0;
 // Stop short of the rear workstation, then draw back to the keyboard.
 const roll=source===6?(reduced?.35:1.35)*MathUtils.smoothstep(t,0,.65)*(1-MathUtils.smoothstep(t,2.5,5)):0;
 return {sleep,jolt:reduced?0:jolt,roll};
}
export const rearWorkstation={x:-.9,z:2.7,width:2.4,depth:.75};
