// All dimensions in centimetres. A narrow outward smoothing envelope preserves skin peaks.
const smoothstep=(v,a,b)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function patchWeight(radius,frontCos,limit=6.5){return (1-smoothstep(radius,4.5,limit))*smoothstep(frontCos,.65,.8);}
export function hybridTarget(actualSkinZ,clearanceCm,slopeScale=1){return actualSkinZ+clearanceCm*slopeScale;}
export function smoothSkinEnvelope(raster,{radiusCm=.1}={}){if(radiusCm>.1+1e-10)throw Error('Hybrid smoothing must stay within1mm');const {n,z,spacing,loX,loY}=raster,out=z.slice(),steps=Math.floor(radiusCm/spacing+1e-8);for(let row=0;row<n;row++)for(let col=0;col<n;col++){const k=row*n+col;if(!Number.isFinite(z[k]))continue;let sum=0,weight=0;for(let dy=-steps;dy<=steps;dy++)for(let dx=-steps;dx<=steps;dx++){const r=Math.hypot(dx,dy)*spacing;if(r>radiusCm+1e-9||row+dy<0||row+dy>=n||col+dx<0||col+dx>=n)continue;const v=z[(row+dy)*n+col+dx];if(!Number.isFinite(v))continue;const w=Math.exp(-r*r/(2*(radiusCm*.5)**2));sum+=w*v;weight+=w;}out[k]=Math.max(z[k],sum/weight);}
 const sample=(x,y)=>{const u=(x-loX)/spacing,v=(y-loY)/spacing,a=Math.floor(u),b=Math.floor(v);if(a<0||b<0||a>=n-1||b>=n-1)return NaN;const q=[out[b*n+a],out[b*n+a+1],out[(b+1)*n+a],out[(b+1)*n+a+1]];if(!q.every(Number.isFinite))return NaN;return (q[0]*(1-(u-a))+q[1]*(u-a))*(1-(v-b))+(q[2]*(1-(u-a))+q[3]*(u-a))*(v-b);};return {sample,z:out,n,spacing,loX,loY,radiusCm};}

// Compact cubic smooth max: exact max outside the0.5mm transition, C1 inside.
export function smoothMaximum(a,b,widthCm=.05){const d=Math.abs(a-b);return Math.max(a,b)+(d<widthCm?widthCm/6*(1-d/widthCm)**3:0);}
export function hybridOuterTarget(actualSkinZ,clearanceOffsetCm,clothFloorZ){return smoothMaximum(clothFloorZ,actualSkinZ+clearanceOffsetCm,.05);}
