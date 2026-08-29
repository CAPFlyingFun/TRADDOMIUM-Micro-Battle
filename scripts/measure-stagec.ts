/**
 * STAGE C MEASUREMENTS — what the procedural sea actually does.
 *
 * Everything here is CPU-side and runs at a chosen rate, because the
 * questions are wave-rate questions and the headless renderer manages
 * about a frame and a half a second. Frame COST is measured two ways:
 * the CPU query here, and the shader's term count, which is what the
 * 58 000-vertex near sheet pays per frame.
 *
 *   npx vite-node scripts/measure-stagec.ts
 */
import {
  SHOAL_CAP, activeWaves, resetSwell, seaOrbitalAt, seaSwellAt, shoalAt,
  swellAmplitude, swellChunk, swellReach, tickSwell,
} from '../src/world/seaSwell';
import { breaksAt } from '../src/world/surf';
import {
  DEFAULT_MESO_SCALE, liveField, liveRegime, useFixedSea, useProceduralSea,
} from '../src/world/liveSea';

const DEEP = 10_000;
const HZ = 60;
const SECONDS = 300;
const M = 100;                       // units per metre

const f2 = (v: number, n = 2) => v.toFixed(n);
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a: number[]) => Math.max(...a.map(Math.abs));

interface Ride {
  hs: number; yPeak: number; vRms: number; vPeak: number;
  aRms: number; aPeak: number; period: number;
}

/** One float, one spot, hands off — the queen's ride, sampled at 60 Hz. */
function ride(seconds = SECONDS): Ride {
  const n = seconds * HZ;
  const dt = 1 / HZ;
  const y: number[] = [];
  // NO RESET HERE. resetSwell() restores the DEFAULT table, so a reset
  // inside the ride would quietly measure the shipped sea five times
  // over — which is exactly what the first cut of this script did.
  for (let i = 0; i < n; i++) {
    tickSwell(dt);
    y.push(seaSwellAt(1234, -5678, DEEP));
  }
  const v: number[] = [];
  for (let i = 1; i < y.length; i++) v.push((y[i] - y[i - 1]) / dt);
  const a: number[] = [];
  for (let i = 1; i < v.length; i++) a.push((v[i] - v[i - 1]) / dt);
  // Zero up-crossings give the mean period the body actually feels.
  let ups = 0;
  for (let i = 1; i < y.length; i++) if (y[i - 1] <= 0 && y[i] > 0) ups++;
  return {
    hs: 4 * rms(y), yPeak: peak(y),
    vRms: rms(v), vPeak: peak(v),
    aRms: rms(a), aPeak: peak(a),
    period: ups ? seconds / ups : NaN,
  };
}

function orbital(depth: number): { rms: number; peak: number } {
  const mags: number[] = [];
  for (let i = 0; i < 60 * HZ; i++) {
    tickSwell(1 / HZ);
    const o = seaOrbitalAt(1234, -5678, depth);
    mags.push(Math.hypot(o.x, o.z));
  }
  return { rms: rms(mags), peak: peak(mags) };
}

function chunkTerms(): number {
  return (swellChunk().match(/sw \+=/g) ?? []).length;
}

function queryCost(): number {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 200_000; i++) acc += seaSwellAt(i * 13.7, -i * 9.1, DEEP);
  const ms = performance.now() - t0;
  if (!Number.isFinite(acc)) throw new Error('nan');
  return (ms / 200_000) * 1e6;            // nanoseconds per query
}

console.log('='.repeat(72));
console.log('STAGE C — the procedural sea, measured');
console.log('='.repeat(72));

// ---------------------------------------------------------------- 1
useProceduralSea();
const field = liveField()!;
const regime = liveRegime()!;
console.log('\n1. WHAT THE GENERATOR PRODUCED');
console.log(`   regime: Hs ${f2(regime.significantHeightM)} m, dominant`
  + ` ${f2(regime.dominantPeriodS)} s, average ${f2(regime.averagePeriodS)} s,`
  + ` toward ${f2(regime.towardDeg, 0)}deg, fan +-${f2(regime.directionSpreadDeg, 0)}deg,`
  + ` period spread ${f2(regime.periodSpread)}, grouping ${f2(regime.grouping)},`
  + ` source ${regime.source}`);
console.log(`   seed ${field.seed}   generation ${field.generation}   macro budget`
  + ` ${f2(field.macroVarianceM2, 4)} m^2   meso ${f2(field.mesoVarianceM2, 4)} m^2`
  + `   mesoScale ${DEFAULT_MESO_SCALE}`);
console.log('\n   scale  period   wavelength    amp(m)   amp(units)  heading(toward)');
for (const c of field.components) {
  const T = c.periodS;
  const lambda = c.wavelengthM;
  console.log(`   ${c.scale.padEnd(6)} ${f2(T).padStart(6)}s`
    + ` ${f2(lambda).padStart(8)} m`
    + ` ${f2(c.amplitudeM, 3).padStart(9)}`
    + ` ${f2(c.amplitudeM * M, 1).padStart(11)}`
    + ` ${f2(c.towardDeg, 1).padStart(13)}deg`);
}

// ---------------------------------------------------------------- 2
console.log('\n2. REACH — how far the surface can stand from sea level');
const measured = (() => {
  let hi = 0;
  const ys: number[] = [];
  resetSwell(); useProceduralSea();
  for (let i = 0; i < 600 * HZ; i++) {
    tickSwell(1 / HZ);
    const y = seaSwellAt(i * 137.3, -i * 91.7, DEEP);
    ys.push(y); hi = Math.max(hi, Math.abs(y));
  }
  return { hi, hs: 4 * rms(ys) };
})();
console.log(`   sum of peak amplitudes:  ${f2(swellAmplitude(), 1)} units`
  + ` (${f2(swellAmplitude() / M)} m)`);
console.log(`   reach (that x ${SHOAL_CAP} shoaling cap): ${f2(swellReach(), 1)} units`
  + ` (${f2(swellReach() / M)} m)`);
console.log(`   measured deep-water excursion over 10 min: ${f2(measured.hi, 1)} units`
  + ` (${f2(measured.hi / M)} m)`);
console.log(`   measured deep-water Hs = 4*rms: ${f2(measured.hs / M)} m`
  + `   (regime asked for ${f2(regime.significantHeightM)} m)`);
useFixedSea(); resetSwell(); tickSwell(0);
console.log(`   the shipped sea for comparison: amplitude ${f2(swellAmplitude(), 1)} units,`
  + ` reach ${f2(swellReach(), 1)} units (${f2(swellReach() / M)} m)`);

// ---------------------------------------------------------------- 3
console.log('\n3. THE RIDE — vertical motion of a floating queen, 60 Hz, 5 min');
console.log('   sea                       Hs      peak    |v|rms   |v|peak'
  + '   |a|rms   |a|peak    period');
const rides: [string, Ride][] = [];
const named: [string, () => void][] = [
  ['OLD fixed 2-wave', () => { useFixedSea(); }],
  ['procedural (0.35)', () => { useProceduralSea(); }],
  ['macro only', () => { useProceduralSea({ meso: false }); }],
  ['meso only', () => { useProceduralSea({ macro: false }); }],
  ['procedural meso=1.0', () => { useProceduralSea({ mesoScale: 1 }); }],
];
for (const [label, install] of named) {
  resetSwell(); install();
  const r = ride();
  rides.push([label, r]);
  console.log(`   ${label.padEnd(22)}`
    + ` ${f2(r.hs / M).padStart(6)}m ${f2(r.yPeak / M).padStart(7)}m`
    + ` ${f2(r.vRms).padStart(8)} ${f2(r.vPeak).padStart(9)}`
    + ` ${f2(r.aRms, 0).padStart(8)} ${f2(r.aPeak, 0).padStart(8)}`
    + ` ${f2(r.period).padStart(8)}s`);
}
console.log('   (v in cm/s, a in cm/s^2 — 981 cm/s^2 is one g)');
for (const [label, r] of rides) {
  console.log(`   ${label.padEnd(22)} peak vertical accel = ${f2(r.aPeak / 981, 3)} g`);
}

// ---------------------------------------------------------------- 4
console.log('\n4. ORBITAL CURRENT — what carries her');
for (const [label, install] of named.slice(0, 3)) {
  resetSwell(); install();
  const deep = orbital(DEEP);
  resetSwell(); install();
  const shelf = orbital(200);
  console.log(`   ${label.padEnd(22)} deep rms ${f2(deep.rms).padStart(6)} peak`
    + ` ${f2(deep.peak).padStart(6)} cm/s   |   at 2 m depth rms`
    + ` ${f2(shelf.rms).padStart(6)} peak ${f2(shelf.peak).padStart(6)} cm/s`);
}

// ---------------------------------------------------------------- 5
console.log('\n5. COST versus the old two-wave sea');
resetSwell(); useFixedSea();
const fixedTerms = chunkTerms();
const fixedNs = Math.min(queryCost(), queryCost());
resetSwell(); useProceduralSea();
const procTerms = chunkTerms();
const procNs = Math.min(queryCost(), queryCost());
console.log(`   shader swell terms per vertex: fixed ${fixedTerms} -> procedural ${procTerms}`
  + `  (${f2(procTerms / fixedTerms)}x)`);
console.log(`   CPU height query: fixed ${f2(fixedNs, 0)} ns -> procedural ${f2(procNs, 0)} ns`
  + `  (${f2(procNs / fixedNs)}x)`);
console.log('   near sheet is 241x241 = 58 081 vertices; each swell term is'
  + ' one sin + one cos.');
console.log(`   per frame that is ${(58081 * fixedTerms).toLocaleString()} ->`
  + ` ${(58081 * procTerms).toLocaleString()} sin/cos pairs in the vertex shader.`);

// ---------------------------------------------------------------- 6
console.log('\n6. THE RIM — near sheet flattens 60 m to 78 m (sheet-local radius)');
resetSwell(); useProceduralSea();
for (const c of field.components) {
  const lambda = (2 * Math.PI) / c.k;
  console.log(`   ${c.scale.padEnd(6)} lambda ${f2(lambda).padStart(7)} m:`
    + ` moving zone (0-60 m) holds ${f2(60 / lambda)} wavelengths,`
    + ` the 18 m taper is ${f2(18 / lambda)} of one`);
}
resetSwell(); useFixedSea();
for (const w of activeWaves()) {
  const lambda = (2 * Math.PI) / w.k / M;
  console.log(`   fixed  lambda ${f2(lambda).padStart(7)} m:`
    + ` moving zone (0-60 m) holds ${f2(60 / lambda)} wavelengths,`
    + ` the 18 m taper is ${f2(18 / lambda)} of one`);
}

// ---------------------------------------------------------------- 7
console.log('\n7. FAR-SHEET HANDOFF — far sheet is FLAT (no swell), 32 m vertices');
console.log('   near alpha fades out 68 m to 82 m onto that flat sheet.');
resetSwell(); useProceduralSea();
const longest = Math.max(...field.components.map((c) => (2 * Math.PI) / c.k));
console.log(`   longest generated wave ${f2(longest)} m: the flat sheet begins`
  + ` ${f2(78 / longest)} wavelengths out, and the handover band spans`
  + ` ${f2(14 / longest)} of a wavelength.`);
console.log('   (fixed sea longest 3.60 m: flat begins 21.7 wavelengths out.)');

// ---------------------------------------------------------------- 8
console.log('\n8. SHORE — shoaling against the breaker limit (A <= 0.39 d)');
console.log('   depth   shoal   crest amp   breaker limit   over?');
for (const dM of [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]) {
  const d = dM * M;
  const rows: string[] = [];
  for (const [label, install] of [named[0], named[1]] as typeof named) {
    resetSwell(); install(); tickSwell(0);
    const amp = swellAmplitude() * shoalAt(d);
    const limit = 0.39 * d;
    rows.push(`${label.startsWith('OLD') ? 'fixed' : 'proc '}`
      + ` ${f2(shoalAt(d)).padStart(5)} ${f2(amp / M, 2).padStart(7)} m`
      + ` ${f2(limit / M, 2).padStart(9)} m ${amp > limit ? ' OVER' : '  ok '}`);
  }
  console.log(`   ${f2(dM, 1).padStart(5)} m  ${rows.join('   |   ')}`);
}
for (const [label, install] of [named[0], named[1]] as typeof named) {
  resetSwell(); install(); tickSwell(0);
  let breakDepth = 0;
  for (let d = 2000; d > 0; d -= 1) {
    if (swellAmplitude() * shoalAt(d) > 0.39 * d) { breakDepth = d; break; }
  }
  console.log(`   ${label}: first exceeds the breaker limit at`
    + ` ${f2(breakDepth / M)} m of water; surf.breaksAt(200) =`
    + ` ${f2(breaksAt(200), 1)}`);
}

// ---------------------------------------------------------------- 9
console.log('\n9. STEEPNESS — why the two seas do not LOOK alike');
console.log('   A wave reads by its FACE ANGLE, atan(A k), not by its height.');
console.log('   sea                    component faces (deg)');
for (const [label, install] of named) {
  resetSwell(); install(); tickSwell(0);
  const faces = activeWaves()
    .map((w) => ((Math.atan(w.amp * w.k) * 180) / Math.PI).toFixed(1));
  console.log(`   ${label.padEnd(22)} ${faces.join('  ')}`);
}
console.log('\n   the mesoScale dial — chop against comfort');
console.log('   scale   meso amps (cm)     steepest face   Hs      |a|peak    g');
for (const ms of [0, 0.35, 0.5, 0.75, 1, 1.5, 2, 3]) {
  resetSwell();
  const built = useProceduralSea({ mesoScale: ms });
  tickSwell(0);
  const table = activeWaves();
  const mesoAmps = table
    .filter((_, i) => built.components[i].scale === 'meso')
    .map((w) => f2(w.amp, 1));
  const face = Math.max(...table.map((w) => (Math.atan(w.amp * w.k) * 180) / Math.PI));
  resetSwell(); useProceduralSea({ mesoScale: ms });
  const r = ride(120);
  console.log(`   ${f2(ms).padStart(5)}   ${(mesoAmps.join(' ') || '-').padEnd(16)}`
    + ` ${f2(face).padStart(9)}deg ${f2(r.hs / M).padStart(6)}m`
    + ` ${f2(r.aPeak, 0).padStart(8)}  ${f2(r.aPeak / 981, 3).padStart(6)}`);
}
resetSwell(); useFixedSea(); tickSwell(0);
const shippedFace = Math.max(...activeWaves()
  .map((w) => (Math.atan(w.amp * w.k) * 180) / Math.PI));
const shippedRide = ride(120);
console.log(`   SHIPPED  16.0 6.0          ${f2(shippedFace).padStart(9)}deg`
  + ` ${f2(shippedRide.hs / M).padStart(6)}m ${f2(shippedRide.aPeak, 0).padStart(8)}`
  + `  ${f2(shippedRide.aPeak / 981, 3).padStart(6)}`);

console.log('\nDONE.');
