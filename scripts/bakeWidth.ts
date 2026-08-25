/**
 * HOW WIDE THE WATER ACTUALLY REACHES, measured on the ground the game
 * draws and written back into the bake.
 *
 * `bakeFlow.py` sizes every station from the TRUE hydraulic channel
 * width — Leopold and Maddock, median 0.60 m across this island — and
 * `slabHalf` turns that into a 5.8 m ribbon. That number is honest
 * about the thread of moving water and wrong about what a player sees.
 * Walk outward from a station on the drawn ground and the surface stays
 * BELOW the water level for a median of about 106 m either side: Kauai
 * has broad valley floors, and we were painting a thread down the
 * middle of one. 92.6% of stations had their wetted reach cut off by
 * the EDGE OF THE SLAB rather than by the terrain, which is the render
 * telling us the number it was handed was not the number it needed.
 * Joshua, who only ever sees the result: the water "is still not wide
 * enough… the width needs to use some code or something to keep looking
 * for no open spaces before stopping".
 *
 * So this looks. It marches outward from every station, on the real
 * ground, until the water has a reason to stop, and stores that
 * distance per side. Nothing here carves, moves, or invents ground —
 * the terrain still clips the last step of shoreline exactly as it does
 * today, and the true `width` is still written untouched for the
 * current profile and the depth law to read. All that changes is how
 * far the slab is drawn before the depth test takes over.
 *
 * WHY A SECOND PASS AND NOT PART OF bakeFlow.py. The hydrology runs on
 * `scripts/.ground.f32` — a 4x4-supersampled cell average of the
 * smooth source, one value every 55 m — and that is the right surface
 * for routing water, which is a question about valleys. A shoreline is
 * not that question. It has to be found on `groundHeight`, the DRAWN
 * triangle with every noise octave on it, at sub-metre spacing, and
 * that surface only exists in TypeScript. So the Python bake writes the
 * hydrology and leaves UNMEASURED in the two new fields, and this pass
 * fills them in from the game's own ground.
 *
 *   npx vite-node scripts/bakeWidth.ts
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import {
  farHeight, groundHeight, setRelief, setSmoothing, useGrid,
} from '../src/world/heightfield';
import {
  decodeFlow, flowBytes, pondLevelAt, slabHalf, UNMEASURED, useFlow, type Flow,
} from '../src/world/flow';
import { cutHalf, trenchDepth, trenchWidth } from '../src/world/carve';
import { DEFAULTS } from '../src/ui/settings';

const GRID = 'public/kauai-1025.bin';
const FLOW = 'public/kauai-flow.bin';

/** `TMBF` and the version this pass reads and writes back. The decoder
 *  checks both, as it does for bakeFlow.py's header; the SIZE is the
 *  subtle part and that has one owner, `flowBytes`. */
const MAGIC = 0x46424d54;
const VERSION = 3;
const HEADER = 32;

/**
 * A stride of the march, in world units — a quarter of a metre.
 *
 * The drawn lattice is 8 units across, so this steps over roughly three
 * triangles at a time. Finer would find the same banks and cost the
 * time again; coarser would start stepping over the low sills that
 * decide where a valley floor ends.
 */
const STRIDE = 25;
/** Three hundred metres, and no further. Reported when it binds. */
const CAP = 30_000;
/**
 * What the terrain is given back at a bank. The march stops on the last
 * sample still under water, and the shoreline belongs to the depth test
 * rather than to the edge of a slab, so the slab is pushed two metres
 * PAST the bank and left to be clipped there.
 */
const MARGIN = 200;
/**
 * HOW FAR BELOW THE LEVEL THE GROUND MAY FALL before the march decides
 * it has left this channel — the channel's OWN DEPTH, not a constant.
 *
 * It was a flat two metres, chosen back when nothing was carved and the
 * question was which drainage basin a piece of flat ground belonged to.
 * It was checked then against an independent HAND calculation (Rennó et
 * al. 2008, Nobre et al. 2011) and the two agreed, and for that question
 * it was right.
 *
 * It is the wrong question now. There is a bed, it is one metre deep,
 * and the march runs along the bottom of it — so two metres of licence
 * let the slab run two metres out over ground that had dropped away
 * from the channel entirely. At a centimetre long that is a sheet of
 * water hanging two hundred body lengths above the ground with daylight
 * under it. Joshua: "placing water too high and floating like
 * highways." Measured before the change, 26% of slab edges on the near
 * mesh hung over air, by 0.48 m on average and up to the full 2 m.
 *
 * Tying it to the trench makes the rule say what it means: inside the
 * bed the ground is never more than one depth under the water, so this
 * cannot fire there; the moment it does fire, the ground has left the
 * channel. Twenty units of slack so the bed's own floor does not trip
 * it on a rounding.
 */
function dropFor(trueWidth: number): number {
  return trenchDepth(trenchWidth(trueWidth)) + 20;
}
/**
 * HOW MANY TRUE CHANNEL WIDTHS THE WATER MAY SPREAD ACROSS, or ZERO for
 * no bound at all. It is ZERO, and that is Joshua's call.
 *
 * The march answers "where does the GROUND stop the water", and on a
 * broad flat valley floor the answer is: a long way out. Bounding that
 * by the size of the stream is defensible hydrology — a river should
 * get a floodplain and a five-litre-a-second trickle should not — and
 * at a bound of 32 it put 8.92% of the island under fresh water against
 * 20.86% unbounded.
 *
 * IT ALSO CUT MORE THAN HALF THE SHORELINE OFF THE TERRAIN. At 32 the
 * bound was the thing that stopped the march on 83,696 of 149,924
 * sides, 55.8% of them. Every one of those is a slab that ends in a
 * STRAIGHT LINE across water the ground was still willing to hold,
 * rather than at a bank rising through the surface. The whole point of
 * this pass is that the terrain owns the water's edge; a bound that
 * owns it more often than the terrain does has taken the feature back.
 * Unbounded, the only thing that ends a march early is the 300 m cap,
 * which fires on 0.6% of sides.
 *
 * So the island is wetter than Kauai really is, deliberately, and the
 * reason is that a shoreline the ground drew beats a shoreline a
 * constant drew. For the record, unbounded:
 *
 *     wet 20.86% of land, 317 km2, of which 17.73% of the island is
 *     over 30 cm deep and 10.48% over a metre
 *     median drawn width 53.5 m, p95 189.5 m
 *
 * and the alternatives, measured by scripts/measureSpread.ts:
 *
 *     k     wet % of land    median width    p95 width
 *     0          3.86%           5.8 m         23.7 m   <- before this pass
 *     8          4.57%           5.8 m         36.3 m
 *     16         6.32%           9.6 m         50.1 m
 *     32         8.92%          19.2 m         64.1 m
 *     64        12.18%          34.9 m         79.5 m
 *     none      20.86%          53.5 m        189.5 m   <- here
 *
 * THIS IS A DIAL AND IT IS JOSHUA'S TO TURN. The hydrology above it is
 * measured; this number is a judgement about how much of the island
 * should be water, and it has been made in favour of not putting a
 * straight edge through the middle of a lake.
 */
const SPREAD = 0;
/**
 * HOW FAR BELOW THE ORIGINAL GROUND THE WATER SURFACE STANDS — ten
 * centimetres, which is ten of her body lengths.
 *
 * The trench is cut one depth below this level, so the freeboard is
 * what keeps the water inside it: at the lip the untouched ground
 * stands FREEBOARD above the surface, and there is no path out. Set it
 * to zero and the water is flush with the surrounding ground, where any
 * dip in the noise becomes a leak and the sheet spreads again — which
 * is precisely the failure the bed was cut to end.
 */
const FREEBOARD = 10;
/**
 * Stations between progress lines. The whole march is 19.2 million
 * ground samples and takes about 25 seconds, which is long enough that
 * a silent terminal looks like a hang and short enough that a line
 * every four thousand stations is plenty.
 */
const REPORT_EVERY = 4096;

const grid = readFileSync(GRID);
useGrid(decodeGrid(grid.buffer.slice(grid.byteOffset, grid.byteOffset + grid.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing);
// RELIEF 1, DELIBERATELY, AND NOT THE DIAL. Levels are STORED at relief
// 1 and the renderer scales them itself at draw time, so a width
// measured against a flattened island would be a width for a frame the
// file is not written in. Measure in the frame the numbers live in.
setRelief(1);

const bin = readFileSync(FLOW);
const flow: Flow = decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
// Needed for `pondLevelAt` during the march: a pond is a per-cell fact
// and the index is the only thing that can answer it.
useFlow(flow);

const nPts = flow.x.length;
const nPond = flow.pondX.length;

// A FRESH BAKE, OR NOTHING. This pass is NOT idempotent and must not
// pretend to be: the level touch-up below reads the level already in
// the file and lifts it toward the drawn ground, so a station that hit
// LIFT_CAP the first time gets another metre the second, and another
// the third. Run twice by hand, the water climbs out of its own valley
// a metre at a time and nothing complains.
//
// The bake:flow chain always feeds this the Python output, where every
// half-width is UNMEASURED, so the correct input is exactly the input
// that has not been through here yet. Check for it and say so, rather
// than leaving a foot-gun for whoever re-runs one step of a pipeline
// because the last one was slow.
{
  let measured = 0;
  for (let p = 0; p < nPts; p++) {
    if (flow.left[p] !== UNMEASURED || flow.right[p] !== UNMEASURED) measured++;
  }
  if (measured > 0) {
    console.error(
      `${FLOW} already carries measured widths at ${measured.toLocaleString()}`
      + ` of ${nPts.toLocaleString()} stations.\n`
      + 'This pass lifts levels off the level already in the file, so running'
      + ' it again would lift them twice.\n'
      + 'Run `python3 scripts/bakeFlow.py` first (or `npm run bake:flow` for'
      + ' the whole chain), which rewrites them UNMEASURED.');
    process.exit(1);
  }
}

/**
 * A ponded station, which is the bake's tuck: `level` two units UNDER
 * `bed` says the pond sheet owns this water, not the reach. Nothing
 * here may touch one — the tuck is what keeps a raised band from
 * crossing every lake.
 */
const ponded = new Uint8Array(nPts);
for (let p = 0; p < nPts; p++) ponded[p] = flow.level[p] < flow.bed[p] ? 1 : 0;

// ---------------------------------------------------------------------
// WHERE THE WATER SURFACE STANDS, now that there is a bed for it.
//
// It used to be the bake's bed plus a channel depth, then lifted a
// little to clear the noise on the drawn ground. That was the right
// answer while nothing was cut: the water had to find its own height
// over an uncarved surface. It is the wrong answer now. `carve.ts` cuts
// a trench one depth below THIS level, so the level is no longer a
// consequence of the ground — it is the thing the ground is cut to fit.
//
// So it is set from the UNCARVED surface, a freeboard below it. The
// water then stands just under the lip of its own trench: contained by
// construction, with nothing left for a spread rule to decide. That is
// the whole reason the trench exists.
//
// farHeight(x, z) with no slack is baseLand and nothing else, which is
// exactly the surface before any cut — asking groundHeight here would
// ask the carved ground how deep to carve it.
// ---------------------------------------------------------------------
const level = Int32Array.from(flow.level);
const drops: number[] = [];
let fresh = 0;
for (const reach of flow.reaches) {
  for (let i = 0; i < reach.count; i++) {
    const p = reach.first + i;
    if (ponded[p]) continue;
    // THE LOWER OF ITS OWN TWO BANKS, and this is what containment
    // actually requires. Setting the level from the ground AT THE
    // STATION contains the water only if the station is the lowest
    // point across the channel, and on any cross-slope it is not — the
    // downhill lip sits below a level taken from the middle, so the
    // sheet runs out over it and ends in mid-air. Measured that way,
    // 26% of slab edges on the near mesh hung over ground, by up to
    // 1.2 m. At a centimetre long that is Joshua's floating highway.
    //
    // Taking the LOWER lip puts the water under both of them by
    // construction, so the march finds a bank on either side and the
    // sheet has somewhere to stop.
    const back = reach.first + Math.max(0, i - 1);
    const fore = reach.first + Math.min(reach.count - 1, i + 1);
    let ndx = flow.x[fore] - flow.x[back];
    let ndz = flow.z[fore] - flow.z[back];
    const nrun = Math.hypot(ndx, ndz);
    if (nrun < 1e-6) { ndx = 1; ndz = 0; } else { ndx /= nrun; ndz /= nrun; }
    const lip = cutHalf(flow.width[p]);
    const land = Math.min(
      farHeight(flow.x[p], flow.z[p]),
      farHeight(flow.x[p] + -ndz * lip, flow.z[p] + ndx * lip),
      farHeight(flow.x[p] - -ndz * lip, flow.z[p] - ndx * lip),
    );
    // INTEGERS FROM HERE ON. The invariant below has to hold in the
    // numbers the decoder will actually see rather than in the floats
    // they came from — bakeFlow.py's write() learnt that one first.
    const set = Math.round(land - FREEBOARD);
    drops.push(flow.level[p] - set);
    level[p] = set;
    fresh++;
  }
}

// NON-INCREASING DOWNSTREAM, RESTORED BY RAISING UPSTREAM. Water does
// not step uphill along a reach, and baseLand is not monotonic the way
// the priority-flood surface it replaced was: it carries the noise
// octaves, so a station can sit a few centimetres above the one behind
// it. Raising is the safe direction — LOWERING would hand one station's
// undershoot to everything below it, which is a bug this project has
// already had once. Ponded stations stay out of it on both sides of the
// comparison; the tuck neither moves nor pushes.
let repaired = 0;
for (const reach of flow.reaches) {
  for (let i = reach.count - 2; i >= 0; i--) {
    const p = reach.first + i;
    if (ponded[p] || ponded[p + 1]) continue;
    if (level[p] < level[p + 1]) { level[p] = level[p + 1]; repaired++; }
  }
}

// AND THE BED FOLLOWS THE LEVEL DOWN, because after `carve.ts` the bed
// is not the priority-flood surface any more — it is the bottom of the
// trench, one depth under the water.
//
// This is not bookkeeping. `level < bed` is the flag that says A POND
// OWNS THIS WATER, read by FlowWater to collapse the slab and by
// terrainHeight to leave a lake floor uncut, and re-seating levels on
// the uncarved ground without moving the bed made ordinary stations
// satisfy it by accident. Their water would have stopped being drawn
// and their trench would have stopped being cut, which is a silent
// failure wearing the costume of a deliberate one. Writing the real bed
// keeps the flag meaning exactly what it says, and makes level - bed
// the true depth of the water rather than a number left over from an
// earlier model.
const bed = Int32Array.from(flow.bed);
for (const reach of flow.reaches) {
  for (let i = 0; i < reach.count; i++) {
    const p = reach.first + i;
    if (ponded[p]) continue;                  // the tuck stays as it is
    bed[p] = level[p] - Math.round(trenchDepth(trenchWidth(flow.width[p])));
  }
}

// RE-INDEX BEFORE MARCHING, and this is load-bearing rather than
// housekeeping. `terrainHeight` cuts its trench from what `flowAt`
// answers, and `flowAt` answers from the index built at the top of this
// file — which still holds the OLD levels. March now and every stride
// would be taken over ground carved to fit a water surface that no
// longer exists. Hand the index the levels just decided, and the ground
// the march walks is the ground the game will draw.
// BOTH ARRAYS, and the second one is not a detail. `terrainHeight`
// skips the carve where `level < bed`, which is how a pond says it owns
// its own floor — and the levels just written sit on the UNCARVED
// ground, routinely below the priority-flood surface the old bed held.
// Re-index with the new level and the old bed and every station on the
// island looks pond-owned, the trench is never cut, and the march finds
// a bank at the first stride. Measured that way it did: a median
// half-width of exactly MARGIN, and 3,331 stations drawing nothing.
useFlow({ ...flow, level, bed });

// ---------------------------------------------------------------------
// THE MARCH.
// ---------------------------------------------------------------------
const BANK = 0, CLIFF = 1, POND = 2, CAPPED = 3;
type Stop = typeof BANK | typeof CLIFF | typeof POND | typeof CAPPED;

let samples = 0;

/**
 * How far the water reaches from (x, z) along the unit vector (nx, nz),
 * and what stopped it. The distance returned is the last sample still
 * under water, as `measureWet.ts` reports it; the caller decides
 * whether that distance has earned a margin.
 *
 * Four ways to stop, and the reason matters as much as the distance:
 *
 *   BANK   the ground rises to or above the level. A shoreline, and the
 *          only case that gets MARGIN, because the terrain should own
 *          the last step rather than the edge of the slab.
 *   CLIFF  the ground has fallen more than DROP below the level. This
 *          is a hillside draining somewhere else and overshooting it
 *          paints water onto another basin's ground, so it gets nothing.
 *   POND   the sample lands in a ponded cell. The pond sheet owns that
 *          water; the reach stops at its shore and adds nothing.
 *   CAPPED three hundred metres. Reported, never silent.
 */
function reachOut(
  x: number, z: number, nx: number, nz: number, water: number, drop: number,
): { far: number; why: Stop } {
  for (let d = STRIDE; d <= CAP; d += STRIDE) {
    const sx = x + nx * d;
    const sz = z + nz * d;
    if (pondLevelAt(sx, sz) !== null) return { far: d - STRIDE, why: POND };
    samples++;
    const ground = groundHeight(sx, sz);
    if (ground >= water) return { far: d - STRIDE, why: BANK };
    if (ground < water - drop) return { far: d - STRIDE, why: CLIFF };
  }
  return { far: CAP, why: CAPPED };
}

const left = new Uint16Array(nPts);
const right = new Uint16Array(nPts);
const totals: number[] = [];
const slabTotals: number[] = [];
const halves: number[] = [];
let flooredSides = 0;
let heldStations = 0;
let cappedSides = 0;
let boundSides = 0;
let empty = 0;

const started = Date.now();
let done = 0;
for (const reach of flow.reaches) {
  for (let i = 0; i < reach.count; i++) {
    const p = reach.first + i;
    // The reach's own direction of travel, from the neighbours either
    // side, exactly as FlowWater.ts builds its strip: side +1 offsets
    // by (-dz, dx), so +n is RIGHT and -n is LEFT.
    const back = reach.first + Math.max(0, i - 1);
    const fore = reach.first + Math.min(reach.count - 1, i + 1);
    let dx = flow.x[fore] - flow.x[back];
    let dz = flow.z[fore] - flow.z[back];
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) { dx = 1; dz = 0; } else { dx /= run; dz /= run; }
    const nx = -dz;
    const nz = dx;

    const x = flow.x[p];
    const z = flow.z[p];
    const water = level[p];
    // THE FLOOR IS TODAY'S SLAB, which makes this strictly a widening:
    // no station can come out narrower than it is drawn now, whatever
    // the ground says. A ponded station finds its own cell on the first
    // stride and falls back here on its own, which is the answer we
    // want anyway — the sheet owns it, and the reach should claim no
    // more than it did before.
    // THE TRENCH IS THE BOUND NOW, and it is a hard one.
    //
    // The march asks where the GROUND stops the water, and a horizontal
    // surface on sloping ground is not stopped by anything downhill:
    // measured on the first trenched bake, a median station cut a clean
    // 4.8 m channel and still reported wet for thirty metres down the
    // slope beside it, over ground nothing had touched. Drawn width and
    // claimed width both have to end at the bank of the bed, or she
    // walks into water that was never drawn — which is the whole of
    // "some spots look like land, but suddenly turn into water".
    //
    // No slabHalf floor either. That floor made version 3 strictly a
    // widening, which was right when the water had no bed and every
    // extra metre was a metre the terrain would clip anyway. With a bed
    // it is the wrong direction: it would push the claim back out past
    // the bank the trench just established.
    const bound = cutHalf(flow.width[p]) + MARGIN;

    let total = 0;
    let held = 0;
    for (const side of [-1, 1] as const) {
      const found = reachOut(x, z, nx * side, nz * side, water, dropFor(flow.width[p]));
      const wet = found.why === BANK ? found.far + MARGIN : found.far;
      // Clamped to the cap, which is 30,000 — comfortably under the
      // 0xFFFF the Python bake leaves in these fields, so a measurement
      // can never be mistaken for UNMEASURED.
      const half = Math.min(CAP, wet, bound);
      const drawn = Math.max(0, Math.min(CAP, Math.round(half)));
      if (side < 0) left[p] = drawn; else right[p] = drawn;
      if (found.why === CAPPED) cappedSides++;
      if (wet > bound) boundSides++;
      // A side the TRENCH stopped rather than the ground: the bed ran
      // out before the bank did, which is the normal case on open
      // valley floor and the whole reason the bound exists.
      if (wet >= bound) { flooredSides++; held++; }
      halves.push(drawn);
      total += drawn;
    }
    totals.push(total);
    slabTotals.push(slabHalf(flow.width[p]) * 2);
    if (held === 2) heldStations++;
    if (total === 0) empty++;

    done++;
    if (done % REPORT_EVERY === 0) {
      const secs = (Date.now() - started) / 1000;
      process.stderr.write(
        `  station ${done.toLocaleString()}/${nPts.toLocaleString()}`
        + `  ${secs.toFixed(0)}s\r`,
      );
    }
  }
}
const marched = (Date.now() - started) / 1000;

// ---------------------------------------------------------------------
// WRITE IT BACK, as a complete version 3: the same reaches, positions,
// beds, widths and ponds, with the touched-up levels and the two
// measured half-widths.
// ---------------------------------------------------------------------
const bytes = flowBytes(flow.reaches.length, nPts, nPond);
const out = new ArrayBuffer(bytes);
const head = new DataView(out);
head.setUint32(0, MAGIC, true);
head.setUint16(4, VERSION, true);
head.setUint32(8, flow.reaches.length, true);
head.setUint32(12, nPts, true);
head.setUint32(16, nPond, true);
head.setFloat32(20, flow.threshold, true);
// The three pads are zero already: a fresh ArrayBuffer is zeroed, which
// is also what makes the alignment pad after the widths free.
let at = HEADER;
for (const reach of flow.reaches) {
  head.setUint32(at, reach.first, true);
  head.setUint32(at + 4, reach.count, true);
  at += 8;
}
const i32 = (n: number) => { const v = new Int32Array(out, at, n); at += n * 4; return v; };
const u16 = (n: number) => { const v = new Uint16Array(out, at, n); at += n * 2; return v; };
i32(nPts).set(flow.x);
i32(nPts).set(flow.z);
i32(nPts).set(level);
i32(nPts).set(bed);
u16(nPts).set(flow.width);
u16(nPts).set(left);
u16(nPts).set(right);
at = (at + 3) & ~3;
i32(nPond).set(flow.pondX);
i32(nPond).set(flow.pondZ);
i32(nPond).set(flow.pondLevel);
u16(nPond).set(flow.pondDepth);
if (at !== bytes) throw new Error(`packed ${at} bytes into ${bytes}`);
// Decode what is about to be written with the game's own decoder. It is
// the same length check the game runs at boot, and it is cheaper to
// fail here than on a device.
decodeFlow(out);
writeFileSync(FLOW, Buffer.from(out));

// ---------------------------------------------------------------------
// THE REPORT.
// ---------------------------------------------------------------------
const m = (u: number) => (u / 100).toFixed(2) + ' m';
const pc = (n: number, of: number) => `${(100 * n / of).toFixed(1)}%`;
/**
 * p05, median, p95 and max of a column, sorted once. The max comes off
 * the end of the sort rather than out of `Math.max(...xs)` — that is
 * one argument per station, and V8 gives out long before 75,000 of them.
 */
function col(name: string, xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return `${name.padEnd(13)} p05 ${m(q(.05)).padStart(9)}`
    + `  median ${m(q(.5)).padStart(9)}  p95 ${m(q(.95)).padStart(9)}`
    + `  max ${m(s[s.length - 1]).padStart(9)}`;
}

console.log(`\n${nPts.toLocaleString()} stations, both sides,`
  + ` ${samples.toLocaleString()} ground samples in ${marched.toFixed(0)}s`);
console.log(`  smoothing ${DEFAULTS.terrainSmoothing}  relief 1, the frame levels are stored in\n`);
console.log(col('old slab', slabTotals));
console.log(col('DRAWN now', totals));
console.log(col('one side', halves));
console.log(`\nheld at today's width  ${heldStations.toLocaleString()} of ${nPts.toLocaleString()}`
  + ` stations  (${pc(heldStations, nPts)})  — steep gorges and pond shores`);
console.log(`sides floored          ${flooredSides.toLocaleString()} of ${(2 * nPts).toLocaleString()}`
  + `  (${pc(flooredSides, 2 * nPts)})`);
console.log(`sides at the ${CAP / 100} m cap  ${cappedSides.toLocaleString()}`
  + `  (${pc(cappedSides, 2 * nPts)})`);
console.log(`sides held by SPREAD  ${SPREAD === 0 ? 'none — unbounded' : boundSides.toLocaleString()}`
  + `${SPREAD === 0 ? '' : '  (' + pc(boundSides, 2 * nPts) + ')  — the bound, not the bank, drew that shore'}`);
console.log(`drawing nothing        ${empty.toLocaleString()}`
  + '  — pond-owned stations, whose first stride lands in the sheet that owns them');
const sortedDrop = [...drops].sort((a, b) => a - b);
console.log(`\nlevel re-seated on the uncarved ground, ${FREEBOARD} units under it,`
  + ` at ${fresh.toLocaleString()} unponded stations`);
console.log(`  moved from the old level by  median ${m(sortedDrop[Math.floor(fresh / 2)])},`
  + ` p05 ${m(sortedDrop[Math.floor(fresh * 0.05)])},`
  + ` p95 ${m(sortedDrop[Math.floor(fresh * 0.95)])}`);
console.log(`  ${repaired.toLocaleString()} raised again for the downstream invariant`);
console.log(`\nwrote ${FLOW}  ${(statSync(FLOW).size / 1e6).toFixed(2)} MB  version ${VERSION}`);
