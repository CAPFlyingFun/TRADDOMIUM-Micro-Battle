/**
 * STAND BESIDE A STREAM AND LOOK AT IT.
 *
 * Two frames at a station the bake picked out, once at eye level and
 * once from above, each rendered twice — with the water layer on and
 * off — so the difference says which pixels the water actually painted
 * rather than leaving it to be eyeballed. That toggle is what proved
 * the pale wedges in an earlier pass were TERRAIN and not ribbon, after
 * a pixel diff had suggested the opposite.
 *
 *   npm run probe:flow
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';
const OUT='/tmp/claude-0/-home-user/032a90d7-d065-5368-92aa-ede9a9abc594/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:932,height:430}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await p.route('**://api.open-meteo.com/**',r=>r.abort());
await p.goto('http://localhost:4173/?scene=island',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>Boolean(window.__island),null,{timeout:240000});
const settle=async s=>{const f=await p.evaluate(()=>window.__island.simTime());
  await p.waitForFunction(m=>window.__island.simTime()>m,f+s,{timeout:300000,polling:250});};
await settle(1);
async function look(wx,wz,upM,pitch,tag){
  await p.evaluate(([x,z])=>window.__island.putAt(x,z,0),[wx,wz]);
  await settle(2);
  const f=(await p.evaluate(()=>window.__island.fix())).trim().split(/\s+/);
  await p.evaluate(t=>window.__island.goTo(t),
    `${f[0]} ${f[1]} ${(parseFloat(f[2])+upM).toFixed(2)}m 0.0° ${pitch}° ×1.00`);
  await settle(3);
  const on=`${OUT}/nc-${tag}.png`, off=`${OUT}/nc-${tag}-off.png`;
  await p.screenshot({path:on});
  await p.evaluate(()=>window.__island.showWater(false)); await settle(1);
  await p.screenshot({path:off});
  await p.evaluate(()=>window.__island.showWater(true)); await settle(1);
  const A=readPng(on),B2=readPng(off); let d=0;
  for(let i=0;i<A.width*A.height;i++)
    if(Math.abs(A.data[i*4]-B2.data[i*4])>6||Math.abs(A.data[i*4+1]-B2.data[i*4+1])>6
     ||Math.abs(A.data[i*4+2]-B2.data[i*4+2])>6) d++;
  const info=await p.evaluate(()=>({fix:window.__island.fix(),r:window.__island.riversDrawn()}));
  console.log(`${tag}: reaches ${info.r}  water ${(100*d/(A.width*A.height)).toFixed(2)}%`);
  console.log(`   ${info.fix}`);
}
await look(1039062, 371875, 8, -18, 'eye');      // standing beside it
await look(1039062, 371875, 60, -55, 'above');   // looking down on it
console.log(errs.length?'ERR '+errs[0]:'no page errors');
await b.close();
