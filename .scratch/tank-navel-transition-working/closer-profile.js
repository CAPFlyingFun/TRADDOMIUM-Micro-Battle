const smoothstep=(v,a,b)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function hermite(y0,y1,m0,m1,t,length){return (2*t*t*t-3*t*t+1)*y0+(t*t*t-2*t*t+t)*length*m0+(-2*t*t*t+3*t*t)*y1+(t*t*t-t*t)*length*m1;}
export function constrainedProfile(reference,{bump=100}={}){
 const qyy=reference.baselineCoefficients[5],scale=bump===100?1:Math.max(.1,reference.anchorReliefCm/1.05347),nodes=[{r:0,h:reference.anchorReliefCm+.12},{r:1,h:.75*scale-qyy},{r:2,h:.3*scale-4*qyy},{r:6.5,h:0}],d0=nodes[1].h-nodes[0].h,d1=nodes[2].h-nodes[1].h;
 if(!(d0<0&&d1<0&&nodes[2].h>0))throw Error('Requested closer profile is not monotone for this body reference');
 const slopes=[0,2*d0*d1/(d0+d1),-Math.min(Math.abs(d1),2*nodes[2].h/4.5),0],sample=r=>{r=Math.abs(r);if(r>=6.5)return 0;let j=r<1?0:r<2?1:2;const width=nodes[j+1].r-nodes[j].r,t=(r-nodes[j].r)/width;return hermite(nodes[j].h,nodes[j+1].h,slopes[j],slopes[j+1],t,width);};
 return {nodes,slopes,scale,referenceH100Cm:1.05347,sample};
}
export function closerPatchWeight(radius,frontCos,absoluteY){return (1-smoothstep(radius,12,14))*smoothstep(frontCos,.65,.8)*(1-smoothstep(absoluteY,114,116));}
export function closerBackground(actualSkinZ,oldClothZ){return actualSkinZ+.5*(oldClothZ-actualSkinZ);}
export function closerRequestedSurface(x,y,reference,profile,skinZ,oldClothZ){const [cx,cy]=reference.center,r=Math.hypot(x-cx,y-cy),central=reference.surface(x,y)+profile.sample(r),background=closerBackground(skinZ,oldClothZ),blend=smoothstep(r,2,12);return central*(1-blend)+background*blend;}
