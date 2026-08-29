/**
 * STAGE D — THE DEPTH LIMIT, BEFORE AND AFTER.
 *
 * "Before" needs no second build: the envelope is a scalar multiplier
 * on the whole sea, so the uncapped answer is the capped one divided
 * by the ratio the two shoaling functions differ by. greenShoalAt IS
 * the before, exactly, and every figure here is derived from that
 * identity rather than from a remembered number.
 *
 *   npx vite-node scripts/measure-staged.ts
 */
import {
  BREAKER_AMPLITUDE, KEEL, breakerAmplitudeAt, brokenAt, greenShoalAt,
  resetSwell, seaOrbitalAt, seaSwellAt, shoalAt, swellAmplitude, tickSwell,
} from '../src/world/seaSwell';
import { breaksAt, surfFlowAt } from '../src/world/surf';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

const M = 100;
const HZ = 60;
const f2 = (v: number, n = 2) => v.toFixed(n);
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a: number[]) => Math.max(...a.map(Math.abs));

const SEAS: [string, () => void][] = [
  ['shipped fixed sea', () => useFixedSea()],
  ['procedural sea', () => { useProceduralSea({ worldSeed: 20260829, nowMs: 0 }); }],
];

console.log('='.repeat(74));
console.log('STAGE D — depth-limited breaking, measured before and after');
console.log('='.repeat(74));

// ---------------------------------------------------------------- 1
console.log('\n1. MAX PERMITTED CREST versus DEPTH  (limit = 0.39 x depth)');
for (const [label, install] of SEAS) {
  resetSwell(); install(); tickSwell(0);
  const A0 = swellAmplitude();
  console.log(`\n   ${label}  (peak table amplitude ${f2(A0, 1)} cm)`);
  console.log('   depth     limit    BEFORE    AFTER    kept    broken   breaksAt');
  for (const dM of [0.1, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 26]) {
    const d = dM * M;
    const before = A0 * greenShoalAt(d);
    const after = A0 * shoalAt(d);
    const limit = breakerAmplitudeAt(d);
    console.log(`   ${f2(dM, 2).padStart(5)} m ${f2(limit / M).padStart(7)} m`
      + ` ${f2(before / M).padStart(8)} m ${f2(after / M).padStart(7)} m`
      + ` ${(after / Math.max(before, 1e-9) * 100).toFixed(0).padStart(6)}%`
      + ` ${f2(brokenAt(d)).padStart(8)}`
      + ` ${f2(breaksAt(d) / M).padStart(9)} m`);
  }
  // Where the old sea was impossible, and where it no longer is.
  let worstBefore = 0; let worstAfter = 0;
  for (let d = 1; d <= 3000; d++) {
    worstBefore = Math.max(worstBefore, (A0 * greenShoalAt(d)) / breakerAmplitudeAt(d));
    worstAfter = Math.max(worstAfter, (A0 * shoalAt(d)) / breakerAmplitudeAt(d));
  }
  console.log(`   worst violation of the limit: BEFORE ${f2(worstBefore)}x`
    + `  ->  AFTER ${f2(worstAfter)}x`);
}

// ---------------------------------------------------------------- 2
console.log('\n2. BREAKER DEPTH — where the sea starts losing height to the bed');
for (const [label, install] of SEAS) {
  resetSwell(); install(); tickSwell(0);
  const find = (frac: number) => {
    for (let d = 3000; d > 0; d--) if (brokenAt(d) >= frac) return d;
    return 0;
  };
  console.log(`   ${label.padEnd(20)} 1% broken at ${f2(find(0.01) / M).padStart(5)} m,`
    + ` 10% at ${f2(find(0.10) / M).padStart(5)} m,`
    + ` half at ${f2(find(0.50) / M).padStart(5)} m,`
    + ` 90% at ${f2(find(0.90) / M).padStart(5)} m`);
}

// ---------------------------------------------------------------- 3
console.log('\n3. THE RIDE THROUGH THE SURF ZONE, 60 Hz, 2 min at each depth');
console.log('   sea / depth      BEFORE Hs  AFTER Hs   |a|peak before  after'
  + '    keel hits');
for (const [label, install] of SEAS) {
  for (const dM of [0.3, 0.5, 1, 2, 4]) {
    const d = dM * M;
    resetSwell(); install();
    const y: number[] = [];
    for (let i = 0; i < 120 * HZ; i++) {
      tickSwell(1 / HZ);
      y.push(seaSwellAt(4321, -8765, d));
    }
    const ratio = greenShoalAt(d) > 0 ? shoalAt(d) / greenShoalAt(d) : 1;
    const accel = (series: number[]) => {
      const a: number[] = [];
      for (let i = 2; i < series.length; i++) {
        a.push((series[i] - 2 * series[i - 1] + series[i - 2]) * HZ * HZ);
      }
      return peak(a);
    };
    const floor = -Math.max(0, d - KEEL);
    const hits = y.filter((v) => v <= floor + 1e-6).length;
    console.log(`   ${label.slice(0, 9).padEnd(10)} ${f2(dM, 2)} m`
      + ` ${f2(4 * rms(y) / ratio / M).padStart(9)} m`
      + ` ${f2(4 * rms(y) / M).padStart(8)} m`
      + ` ${f2(accel(y) / ratio, 0).padStart(13)}`
      + ` ${f2(accel(y), 0).padStart(7)}`
      + ` ${String(hits).padStart(10)}`);
  }
}
console.log('   (accel in cm/s^2. BEFORE is the same ride divided by the'
  + ' envelope, which is exact:');
console.log('    the cap is one scalar on the whole sum. keel hits = frames the'
  + ' trough was');
console.log('    clamped off the bed — the old failure mode, and it should now'
  + ' be nought.)');

// ---------------------------------------------------------------- 4
console.log('\n4. WHAT CARRIES HER — orbital current, and the surge that'
  + ' replaces it');
for (const [label, install] of SEAS) {
  console.log(`\n   ${label}`);
  console.log('   depth    orbital BEFORE   AFTER    broken   bore share');
  for (const dM of [0.3, 0.5, 1, 2, 4, 8]) {
    const d = dM * M;
    resetSwell(); install();
    const mags: number[] = [];
    for (let i = 0; i < 60 * HZ; i++) {
      tickSwell(1 / HZ);
      const o = seaOrbitalAt(4321, -8765, d);
      mags.push(Math.hypot(o.x, o.z));
    }
    const ratio = greenShoalAt(d) > 0 ? shoalAt(d) / greenShoalAt(d) : 1;
    console.log(`   ${f2(dM, 2).padStart(5)} m ${f2(peak(mags) / ratio).padStart(10)}`
      + ` ${f2(peak(mags)).padStart(9)} cm/s ${f2(brokenAt(d)).padStart(8)}`
      + ` ${(brokenAt(d) * 100).toFixed(0).padStart(9)}%`);
  }
}
console.log('\n   (the height the envelope takes is not lost — `broken` is what'
  + ' surf.ts');
console.log('    spends as a shoreward bore, so the surge grows exactly where'
  + ' the');
console.log('    orbital flow is being held down.)');

// ---------------------------------------------------------------- 5
console.log('\n5. IS THERE A WALL? — the crest profile across the shore');
console.log('   Worst change in crest height per centimetre of depth, and the'
  + ' sharpest');
console.log('   BEND in that profile. A hard clamp is the thing to beat.');
for (const [label, install] of SEAS) {
  resetSwell(); install(); tickSwell(0);
  const A0 = swellAmplitude();
  const step = 0.5;
  const stats = (f: (d: number) => number) => {
    let slope = 0; let bend = 0;
    for (let d = 1; d < 600; d += step) {
      slope = Math.max(slope, Math.abs(f(d + step) - f(d)) / step);
      bend = Math.max(bend,
        Math.abs(f(d + step) - 2 * f(d) + f(d - step)) / (step * step));
    }
    return { slope, bend };
  };
  const before = stats((d) => A0 * greenShoalAt(d));
  const after = stats((d) => A0 * shoalAt(d));
  const clamp = stats((d) => Math.min(A0 * greenShoalAt(d), breakerAmplitudeAt(d)));
  console.log(`   ${label}`);
  console.log(`     BEFORE (no cap)  slope ${f2(before.slope, 3)}  bend ${f2(before.bend, 3)}`);
  console.log(`     AFTER  (soft)    slope ${f2(after.slope, 3)}  bend ${f2(after.bend, 3)}`);
  console.log(`     a hard min would slope ${f2(clamp.slope, 3)}  bend ${f2(clamp.bend, 3)}`);
}

// ---------------------------------------------------------------- 6
console.log('\n6. STEEPNESS AT THE SHORE — the face angle she actually sees');
for (const [label, install] of SEAS) {
  resetSwell(); install(); tickSwell(0);
  const row: string[] = [];
  for (const dM of [0.5, 1, 2, 4, 8]) {
    const d = dM * M;
    const k = 2 * Math.PI / 5480;      // the dominant macro wave, cm
    const face = (shoal: number) =>
      (Math.atan(swellAmplitude() * shoal * k) * 180) / Math.PI;
    row.push(`${dM}m ${f2(face(greenShoalAt(d)), 1)}->${f2(face(shoalAt(d)), 1)}deg`);
  }
  console.log(`   ${label.padEnd(20)} ${row.join('  ')}`);
}
console.log('   (one wavelength, 54.8 m, held fixed so only the height differs.)');

// ---------------------------------------------------------------- 7
console.log('\n7. THE ENVELOPE CANNOT BREATHE');
for (const [label, install] of SEAS) {
  resetSwell(); install();
  const first = [30, 60, 120, 300].map(shoalAt);
  for (let i = 0; i < 2000; i++) tickSwell(0.31);
  const later = [30, 60, 120, 300].map(shoalAt);
  console.log(`   ${label.padEnd(20)} identical after 620 s of sea:`
    + ` ${String(first.every((v, i) => v === later[i]))}`);
}
console.log(`   BREAKER_AMPLITUDE ${BREAKER_AMPLITUDE} (index 0.78), and`
  + ' surfFlowAt still answers:');
resetSwell(); useFixedSea(); tickSwell(1.3);
const flow = surfFlowAt(4321, -8765, 60, 12);
console.log(`   surfFlowAt at 0.6 m -> ${f2(Math.hypot(flow.x, flow.z), 1)} cm/s`);

console.log('\nDONE.');
