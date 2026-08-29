/**
 * THE CAMERA ON A SEA, at 60 Hz — v0.0.108's contract.
 *
 * The camera is driven exactly as the game drives it: a real
 * FollowCamera, the real water query, the real seaSwell tables. Only
 * the bed is synthetic — flat and deep, so the shore is not in the way
 * of the question.
 *
 * WHAT IS MEASURED IS THE VIEW, not just the lens. Three versions held
 * the camera's HEIGHT steadier and the phone still called it a washing
 * machine, because the aim chased her and pitch is what sweeps a
 * horizon across a screen.
 *
 *   npx vite-node scripts/measure-stagee.ts
 */
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery } from '../src/world/waterQuery';
import {
  resetSwell, seaHoldAt, seaSwellAt, swellAmplitude, swellPeriod, tickSwell,
} from '../src/world/seaSwell';
import { settleSeconds, splashSeconds } from '../src/world/Underwater';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

const HZ = 60;
const DT = 1 / HZ;
const BED = 800;
const REST = { yaw: 0, pitch: 0, active: false };
const GENERATION = { worldSeed: 20260829, nowMs: 0 } as const;
const f2 = (v: number, n = 2) => v.toFixed(n);
const span = (a: number[]) => Math.max(...a) - Math.min(...a);

const SEAS: [string, () => void][] = [
  ['shipped fixed sea', () => useFixedSea()],
  ['procedural sea', () => { useProceduralSea(GENERATION); }],
];

function float(seconds: number, dive = 0) {
  const ant = new THREE.Object3D();
  const follow = new FollowCamera(2);
  useWaterQuery((wx, wz) => ({
    depth: BED + seaSwellAt(wx, wz, BED), flowX: 0, flowZ: 0, salt: true,
    hold: seaHoldAt(wx, wz, BED),
  }));
  ant.position.set(0, BED, 0);
  follow.snapTo(ant);
  const dir = new THREE.Vector3();
  const her: number[] = []; const lens: number[] = []; const pitch: number[] = [];
  const chased: number[] = []; const gap: number[] = [];
  let washes = 0; let wet = false; let ups = 0; let last = 0;
  let deepest = 0; let streak = 0; let longest = 0;
  const reference = follow.seaLensHeight();
  for (let t = -14; t < seconds; t += DT) {
    tickSwell(DT);
    const swell = seaSwellAt(0, 0, BED);
    ant.position.y = BED + swell - 0.15 - dive * 60;
    follow.update(ant, REST, DT, true, dive);
    if (t < 0) { last = swell; continue; }
    follow.camera.getWorldDirection(dir);
    pitch.push((Math.asin(dir.y) * 180) / Math.PI);
    chased.push((Math.atan2(
      ant.position.y + 0.6 - follow.camera.position.y,
      Math.hypot(follow.camera.position.x - ant.position.x,
        follow.camera.position.z - ant.position.z),
    ) * 180) / Math.PI);
    her.push(ant.position.y);
    lens.push(follow.camera.position.y - BED);
    gap.push(ant.position.y - (follow.camera.position.y - 3.42));
    const under = BED + swell - follow.camera.position.y;
    if (under > 0 && !wet) { washes++; wet = true; } else if (under <= 0) wet = false;
    if (under > 0) { deepest = Math.max(deepest, under); streak += DT; } else streak = 0;
    longest = Math.max(longest, streak);
    if (last <= 0 && swell > 0) ups++;
    last = swell;
  }
  useWaterQuery(null);
  return {
    herSwing: span(her), lensSwing: span(lens), pitch: span(pitch),
    chased: span(chased), reference,
    lensMean: lens.reduce((s2, v) => s2 + v, 0) / lens.length,
    gap: span(gap), washes, waves: ups, deepest, longest,
    endHer: her[her.length - 1] - BED, endLens: lens[lens.length - 1],
  };
}

console.log('='.repeat(72));
console.log('THE CAMERA ON A SEA — v0.0.108, datum-locked position AND aim');
console.log('='.repeat(72));

for (const [label, install] of SEAS) {
  resetSwell(); install();
  const r = float(240);
  console.log(`\n${'-'.repeat(72)}\n${label.toUpperCase()}`
    + `   period ${f2(swellPeriod())} s, advertised crest`
    + ` ${f2(swellAmplitude(), 1)} units`);
  console.log('\n  THE VIEW — what actually moves the horizon');
  console.log(`    pitch swing over 4 minutes   ${f2(r.pitch, 2).padStart(8)} deg`);
  console.log(`    ...if the aim still chased her ${f2(r.chased, 1).padStart(6)} deg`
    + '   <- the fault, on the same float');
  console.log('\n  THE LENS');
  console.log(`    floats ${f2(r.reference, 1)} units over still water`
    + ` (crest ${f2(swellAmplitude(), 1)} less an 8 unit margin)`);
  console.log(`    measured mean height ${f2(r.lensMean, 1)} units, swing`
    + ` ${f2(r.lensSwing, 1)} units`);
  console.log(`    she swings ${f2(r.herSwing, 1)} units — a ratio of`
    + ` ${(r.lensSwing / r.herSwing * 100).toFixed(1)}%`);
  console.log('\n  THE WASH');
  console.log(`    ${r.washes} crests reached the lens in ${r.waves} waves`
    + ` (${(r.washes / r.waves * 100).toFixed(0)}%)`);
  console.log(`    deepest ${f2(r.deepest, 1)} units, longest ${f2(r.longest)} s`
    + `   (the tint ignores anything under ${f2(splashSeconds())} s)`);
  console.log('\n  FRAMING — the consequence to look at on the phone');
  console.log(`    she moves ${f2(r.gap, 0)} units against the aim point;`
    + ' the frame accepts 10.9');
  console.log(`    so she is inside it for about`
    + ` ${(Math.min(1, 10.9 / r.gap) * 100).toFixed(0)}% of a wave`);

  resetSwell(); install();
  const d = float(20, 1, );
  console.log('\n  DIVING (lever held down)');
  console.log(`    she went to ${f2(d.endHer, 0)} units below sea level,`
    + ` the lens to ${f2(d.endLens, 0)} — the lock is released`);
}
console.log('\nDONE.');
