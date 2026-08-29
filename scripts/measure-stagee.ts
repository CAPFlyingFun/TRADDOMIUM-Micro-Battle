/**
 * STAGE E — WHAT THE CAMERA DOES ON EACH SEA, at 60 Hz.
 *
 * The camera is driven exactly as the game drives it: a real
 * FollowCamera, the real water query, and the real seaSwell tables
 * behind it. The only synthetic part is the bed, which is flat and
 * deep so the shore is not in the way of the question.
 *
 *   npx vite-node scripts/measure-stagee.ts
 */
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery } from '../src/world/waterQuery';
import {
  CAMERA_FOLLOW, heaveGain, resetSwell, seaChopAt, seaHeaveAt, seaHoldAt,
  seaSwellAt, swellPeriod, swellReach, activeWaves, tickSwell,
} from '../src/world/seaSwell';
import { SETTLE_BEATS, SPLASH_BEATS, settleSeconds, splashSeconds }
  from '../src/world/Underwater';
import { useFixedSea, useProceduralSea, liveField } from '../src/world/liveSea';

const HZ = 60;
const DT = 1 / HZ;
const BED = 800;                 // 8 m of water: deep, flat, unshoaled
const DRAUGHT = 0.15;
const REST = { yaw: 0, pitch: 0, active: false };
const f2 = (v: number, n = 2) => v.toFixed(n);
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a: number[]) => Math.max(...a.map(Math.abs));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const swing = (a: number[]) => Math.max(...a) - Math.min(...a);

const GENERATION = { worldSeed: 20260829, nowMs: 0 } as const;
const SEAS: [string, () => void][] = [
  ['shipped fixed sea', () => useFixedSea()],
  ['procedural sea', () => { useProceduralSea(GENERATION); }],
];

interface Run {
  her: number[]; cam: number[]; heave: number[]; chop: number[];
  under: number[]; lift: number[];
}

/** Float her for `seconds`, hands off, and record everything. */
function ride(seconds: number, dive = 0, warm = 12): Run {
  const ant = new THREE.Object3D();
  const follow = new FollowCamera(2);
  let surface = 0;
  useWaterQuery((wx, wz) => ({
    depth: BED + seaSwellAt(wx, wz, BED),
    flowX: 0, flowZ: 0, salt: true,
    hold: seaHoldAt(wx, wz, BED),
  }));
  ant.position.set(0, BED, 0);
  follow.snapTo(ant);
  const out: Run = { her: [], cam: [], heave: [], chop: [], under: [], lift: [] };
  for (let t = -warm; t < seconds; t += DT) {
    tickSwell(DT);
    surface = seaSwellAt(ant.position.x, ant.position.z, BED);
    ant.position.y = BED + surface - DRAUGHT * (1 - dive) - dive * 60;
    follow.update(ant, REST, DT, true, dive);
    if (t < 0) continue;
    out.her.push(ant.position.y);
    out.cam.push(follow.camera.position.y);
    out.heave.push(seaHeaveAt(0, 0, BED));
    out.chop.push(seaChopAt(0, 0, BED));
    out.under.push(BED + surface - follow.camera.position.y);
    out.lift.push(follow.liftHeld());
  }
  useWaterQuery(null);
  return out;
}

/**
 * How much of `a` and `b` the camera's motion is made of — least
 * squares, both at once, because heave and chop are not perfectly
 * orthogonal over a finite window and fitting them separately would
 * credit each with a slice of the other.
 */
function shares(cam: number[], a: number[], b: number[]): [number, number] {
  const c0 = mean(cam); const a0 = mean(a); const b0 = mean(b);
  let aa = 0; let ab = 0; let bb = 0; let ca = 0; let cb = 0;
  for (let i = 0; i < cam.length; i++) {
    const x = a[i] - a0; const y = b[i] - b0; const z = cam[i] - c0;
    aa += x * x; ab += x * y; bb += y * y; ca += z * x; cb += z * y;
  }
  const det = aa * bb - ab * ab;
  if (Math.abs(det) < 1e-12) return [ca / (aa || 1), cb / (bb || 1)];
  return [(ca * bb - cb * ab) / det, (cb * aa - ca * ab) / det];
}

/** Longest unbroken stretch the value stayed positive, seconds. */
function longest(series: number[]): number {
  let run = 0; let best = 0;
  for (const v of series) {
    run = v > 0 ? run + DT : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Underwater's own engagement curve, so the two cannot drift. */
function engagement(wetFor: number): number {
  const lo = splashSeconds();
  const hi = settleSeconds();
  const t = Math.min(1, Math.max(0, (wetFor - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

console.log('='.repeat(74));
console.log('STAGE E — the camera on each sea, 60 Hz, flat 8 m bed');
console.log('='.repeat(74));

for (const [label, install] of SEAS) {
  resetSwell(); install();
  const field = liveField();
  console.log(`\n${'-'.repeat(74)}\n${label.toUpperCase()}`);
  console.log(`   sea period ${f2(swellPeriod())} s (energy weighted),`
    + ` reach ${f2(swellReach(), 1)} units`);
  console.log('   component gains — what the camera follows of each:');
  for (let i = 0; i < activeWaves().length; i++) {
    const w = activeWaves()[i];
    const T = (2 * Math.PI) / w.omega;
    const scale = field?.components[i]?.scale ?? 'fixed';
    console.log(`     ${scale.padEnd(6)} T ${f2(T).padStart(5)}s`
      + ` A ${f2(w.amp, 1).padStart(5)} cm ->`
      + ` camera rides ${(CAMERA_FOLLOW * heaveGain(w.omega) * 100)
        .toFixed(1).padStart(5)}%`
      + `   holds ${((1 - CAMERA_FOLLOW * heaveGain(w.omega)) * 100)
        .toFixed(1).padStart(5)}%`);
  }

  resetSwell(); install();
  const r = ride(120);
  const [macroShare, mesoShare] = shares(r.cam, r.heave, r.chop);
  const accel = (a: number[]) => {
    const out: number[] = [];
    for (let i = 2; i < a.length; i++) out.push((a[i] - 2 * a[i - 1] + a[i - 2]) * HZ * HZ);
    return out;
  };
  const speed = (a: number[]) => {
    const out: number[] = [];
    for (let i = 1; i < a.length; i++) out.push((a[i] - a[i - 1]) * HZ);
    return out;
  };
  console.log('\n   HER MOTION versus THE CAMERA (2 minutes afloat, hands off)');
  console.log(`     her swing   ${f2(swing(r.her), 1).padStart(7)} units`
    + `   |v| ${f2(rms(speed(r.her)), 1).padStart(6)} rms`
    + `   |a| ${f2(peak(accel(r.her)), 0).padStart(6)} peak`);
  console.log(`     lens swing  ${f2(swing(r.cam), 1).padStart(7)} units`
    + `   |v| ${f2(rms(speed(r.cam)), 1).padStart(6)} rms`
    + `   |a| ${f2(peak(accel(r.cam)), 0).padStart(6)} peak`);
  console.log(`     the lens passes ${(swing(r.cam) / swing(r.her) * 100).toFixed(1)}%`
    + ' of her swing');
  console.log(`     peak vertical accel: hers ${f2(peak(accel(r.her)) / 981, 3)} g,`
    + ` the lens ${f2(peak(accel(r.cam)) / 981, 3)} g`);
  // What the PLAYER sees as instability is the lens moving against the
  // world, not with it: riding a 6 s swell is a boat, jittering is not.
  const bare = r.cam.map((v, i) => v - r.lift[i]);
  console.log(`     with the envelope's lift removed, the lens peaks at`
    + ` ${f2(peak(accel(bare)) / 981, 3)} g — the rest is the envelope`);
  console.log(`     lens against HER: swing`
    + ` ${f2(swing(r.cam.map((v, i) => v - r.her[i])), 1)} units`);

  console.log('\n   WHAT THE LENS IS MADE OF (least squares against the split)');
  console.log(`     MACRO-FOLLOW    ${(macroShare * 100).toFixed(1).padStart(6)}%`
    + '   (the slow heave it is meant to ride)');
  console.log(`     meso followed   ${(mesoShare * 100).toFixed(1).padStart(6)}%`);
  console.log(`     MESO-REJECTION  ${((1 - mesoShare) * 100).toFixed(1).padStart(6)}%`);

  console.log('\n   THE WET LENS');
  const wet = r.under.filter((v) => v > 0);
  console.log(`     wet ${(wet.length / r.under.length * 100).toFixed(1)}% of frames,`
    + ` deepest ${f2(peak(r.under.map((v) => Math.max(0, v))), 1)} units,`
    + ` longest wash ${f2(longest(r.under))} s`);
  console.log(`     splash ${f2(splashSeconds())} s / settle ${f2(settleSeconds())} s`
    + ` (${SPLASH_BEATS} and ${SETTLE_BEATS} beats of a ${f2(swellPeriod())} s sea)`);
  console.log(`     TINT the longest wash could raise:`
    + ` ${(engagement(longest(r.under)) * 100).toFixed(2)}%`
    + `   (genuinely under, past settle: ${
      r.under.filter((v) => v > 0).length && longest(r.under) > settleSeconds()
        ? 'YES' : 'no'})`);
  console.log(`     envelope lift held: rms ${f2(rms(r.lift), 1)},`
    + ` peak ${f2(peak(r.lift), 1)} units`);

  console.log('\n   PUMPING / HORIZON');
  const camSpeed = speed(r.cam);
  console.log(`     lens vertical speed rms ${f2(rms(camSpeed), 1)} cm/s,`
    + ` peak ${f2(peak(camSpeed), 1)} cm/s`);
  console.log(`     hers                rms ${f2(rms(speed(r.her)), 1)} cm/s,`
    + ` peak ${f2(peak(speed(r.her)), 1)} cm/s`);
  console.log(`     the lens carries ${(rms(camSpeed) / rms(speed(r.her)) * 100)
    .toFixed(1)}% of her vertical rate`);

  console.log('\n   GENUINELY UNDER versus WASHED OVER');
  {
    // Hold the surface high over a lens that starts below it: not a
    // crest passing, just water. This is the case the tint is FOR.
    resetSwell(); install();
    const ant = new THREE.Object3D();
    const follow = new FollowCamera(2);
    useWaterQuery(() => ({ depth: BED + 200, flowX: 0, flowZ: 0, salt: true }));
    ant.position.set(0, BED, 0);
    follow.snapTo(ant);
    let wetFor = 0;
    let firstTint = -1;
    for (let i = 0; i < 30 * HZ; i++) {
      tickSwell(DT);
      follow.update(ant, REST, DT, true, 0);
      const u = BED + 200 - follow.camera.position.y;
      wetFor = u > 0 ? wetFor + DT : 0;
      if (firstTint < 0 && engagement(wetFor) > 0.5) firstTint = wetFor;
    }
    useWaterQuery(null);
    console.log(`     held under 2 m of water: tint reaches half at`
      + ` ${firstTint < 0 ? 'never' : f2(firstTint) + ' s'}`
      + `   (a wash lasts ${f2(longest(r.under))} s, so it cannot)`);
    console.log(`     the envelope lifted the lens to`
      + ` ${f2(follow.liftHeld(), 0)} units — out of a 200 unit column`);
  }

  console.log('\n   DIVING (the lever down, held)');
  resetSwell(); install();
  const d = ride(20, 1, 6);
  console.log(`     she went to ${f2(d.her[d.her.length - 1] - BED, 0)} units below`
    + ` sea level; the lens went to ${f2(d.cam[d.cam.length - 1] - BED, 0)}`);
  console.log(`     lens still above the surface at the end:`
    + ` ${d.under[d.under.length - 1] < 0}`
    + `   (it must NOT be — a dive hands the water back)`);
}

console.log('\n' + '='.repeat(74));
console.log('THE SPLIT IS LOSSLESS — heave + chop must BE the sea');
for (const [label, install] of SEAS) {
  resetSwell(); install();
  let worst = 0;
  for (let i = 0; i < 600; i++) {
    tickSwell(0.11);
    for (const x of [0, 1234, -5678]) {
      const full = seaSwellAt(x, -x * 0.7, BED);
      const sum = seaHeaveAt(x, -x * 0.7, BED) + seaChopAt(x, -x * 0.7, BED);
      worst = Math.max(worst, Math.abs(full - sum));
    }
  }
  console.log(`   ${label.padEnd(20)} worst disagreement ${worst.toExponential(2)} units`);
}
console.log('\nDONE.');
