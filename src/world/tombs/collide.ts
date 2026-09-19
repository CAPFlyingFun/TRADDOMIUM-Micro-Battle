/**
 * WHAT STOPS A BODY IN THE TOMBS LABORATORY — the building's collision
 * and its reach, as core.
 *
 * `plan.ts` decides what the building IS and `src/tombs/` draws it. This
 * file is the third reader of the same plan and the only one a walking
 * controller needs: it says where a body may go, what it is standing on,
 * what is over its head, where a camera ray first meets a wall, and
 * which console it is close enough to touch. No three, no DOM, no
 * storage, no network — so the building's collision runs in plain node,
 * a test can walk a body across a room without a renderer, and an
 * authority could hold the same answers a phone holds.
 *
 * It cashes in RULE 1 of `types.ts`: "EVERYTHING IS AXIS-ALIGNED ... an
 * axis-aligned world makes the player's collision an interval test on
 * three axes instead of a separating-axis routine." And it obeys RULE 3
 * — `Slab.solid` and `Pillar.solid` are the one answer to "does a body
 * stop here". Nothing below carries a private list of what is walkable,
 * nothing is special-cased by id, and nothing re-reads a `Surface` to
 * decide whether a body passes: the glass in the reinforced port stops a
 * body because the plan marked it solid, and the chamber's 60 mm grating
 * does not because the plan marked it not.
 *
 * ─── why there is an index at all ────────────────────────────────────
 *
 * MEASURED on the real plan (`planLab()`, the canonical `LAB_SPEC`): 138
 * slabs of which 92 are solid, and 18 pillars of which 10 are. ONE
 * HUNDRED AND TWO SOLIDS. The laboratory alone holds 25 of them. A step
 * that walked the whole layout would test all 102 for one axis, three times
 * over for three axes, and again for the ground query and again for the
 * camera's ray — several hundred tests to move a body 20 mm.
 *
 * So the solids are prepared once into a flat, struct-of-arrays table and
 * a coarse grid on x and z. MEASURED at a 2 m cell over the building's
 * 26.8 x 26.8 m footprint: 14 x 14 = 196 cells holding 778 entries, a
 * mean of 4.0 solids a cell and a worst cell of 10. A body's move touches
 * one or two cells, so a step tests four to ten solids rather than 102 —
 * and that is with the big floor and ceiling slabs registered in every
 * cell they cross, which is where most of those 778 entries come from.
 * Finer cells do not pay: a 1 m cell costs 729 cells and 2,194 entries to
 * take the worst bucket from 10 to 10.
 *
 * The grid is x/z ONLY. A building is wide and short — 26.8 m across, 7.65
 * m from the foundation to the top of the chamber — so a third axis would
 * cut a bucket that is already four solids deep into buckets of one, at
 * four times the memory. The y interval is one comparison per candidate,
 * which is cheaper than the bookkeeping that would avoid it.
 *
 * ─── the body is a vertical capsule, and the resolve is one axis at a
 *     time ───────────────────────────────────────────────────────────
 *
 * A body is a cylinder: a radius, a height, and FEET at the position — a
 * plan in metres with the floor at y = 0 makes the feet the natural
 * anchor, and every fixture's height in `plan.ts` is quoted off the floor
 * the same way. The eye rides at `EYE_HEIGHT_M` (1.65 m, `tombs/tombsTool
 * .ts`); this file never knows that, because a collision volume is not a
 * camera.
 *
 * `moveBody` resolves x, then z, then y — separately, each against the
 * position the previous one left. That order is not decoration; it is the
 * whole reason the plan is axis-aligned. Resolving all three at once
 * gives a body that STOPS DEAD against a wall it hit at an angle, because
 * the single shortest push-out is the one that cancels the whole move.
 * Resolving one at a time lets the blocked axis stop while the free one
 * runs, which is what a player feels as sliding along a wall — and in a
 * building whose corridors are 2.6 m wide and whose doors are 1.4 to 2.0
 * m, a player who cannot slide cannot walk through a doorway they are not
 * already square to.
 *
 * The cylinder-against-box test is EXACT rather than a square
 * approximation, and it costs one square root. Sliding along x, the
 * distance the centre may approach a box is `r` while the centre's z is
 * within the box's z span (a face contact) and `sqrt(r² - dz²)` once it
 * is past the end of it (a corner contact) — one formula, since `dz` is
 * zero inside the span. A body squared off to a box instead would catch
 * its corner on a door jamb 40 mm before the jamb is there, which on a
 * 1.4 m door a 0.6 m body has to thread is a tenth of the clearance.
 *
 * ─── the step, and the failure it exists to end ──────────────────────
 *
 * `STEP_UP` is 0.25 m and it is NOT a gameplay affordance for climbing
 * onto things. It is there because the floor's own top face is at y =
 * 0.000 and a body's feet are at y = 0.000 — and an integrator that
 * hands back -0.002 after a frame of gravity, or a heightfield that
 * rounds, puts the capsule two millimetres INSIDE the floor slab, whose
 * own footprint is the whole room. Every horizontal move is then blocked
 * by the ground, and the body cannot walk anywhere at all. The same thing
 * happens at a door threshold, which in this plan is the piece of wall
 * below the sill (`wall:laboratory:0-6:2`, y -0.40 to 0.00, under the
 * laboratory's sliding door): a body crossing it is walking at a face
 * that is exactly level with its feet.
 *
 * 0.25 m is MEASURED against the plan rather than picked. Every solid top
 * face in the building, in order: 0.000 (twelve room floors), 0.450 (the
 * entrance bench and the four chair SEATS), 0.600 (the array platform),
 * 0.750 (four desks), 0.900 (two laboratory benches), 0.950 (the four
 * chair BACKS), 1.000 (the two consoles and the wall under the reinforced
 * port), and up from there. There is NOTHING between 0.000 and 0.450, so
 * a 0.25 m step clears the failure it was written for by a wide margin
 * and cannot reach a single thing the plan means a body to be stopped by.
 * It is also about a stair riser — 197 mm is the tallest an IBC stair may
 * have, 220 mm the tallest a private stair may have under Part K — so if
 * a later plan adds a step, a body walks up it.
 *
 * A step RAISES THE FEET; it does not hold them there. `moveBody` lifts
 * the body onto the obstruction and the caller's next downward `delta.y`
 * settles it, exactly as walking off a ledge does. Nothing here applies
 * gravity: a collision module that had its own idea of down would be a
 * second integrator.
 *
 * ─── a body that is already inside something walks out ───────────────
 *
 * Each axis IGNORES a solid it already overlaps at the start of the move.
 * A body pushed into geometry — a bad spawn, a teleport, a plan edited
 * under a standing player — would otherwise be held there by the very
 * solid it is inside, since every direction is "into" it. Ignoring it
 * makes the body free to walk out, which is the only behaviour that
 * recovers. It is deliberately NOT a push-out: shoving a body along the
 * shortest axis is how a body inside a floor gets launched through a
 * ceiling.
 *
 * The vertical axis needs one thing more, and `settleUp` is it. A body
 * two millimetres into the floor is a body the falling solver rightly
 * ignores the floor for — so it falls through the building instead of
 * standing on it. A face no more than `STEP_UP` above the feet that the
 * body is actually inside therefore becomes something to stand up onto,
 * gated on the same headroom check the walking step uses. Up only,
 * bounded by a quarter metre, and no help at all to a body that is
 * genuinely buried: that one walks out on its feet.
 *
 * ─── nothing is allocated in a step ──────────────────────────────────
 *
 * `moveBody` and `rayHit` take a caller-owned `out` and write into it,
 * the way `control/PlayerDemand.ts` and `input/Intent.ts` already do.
 * The index's arrays are built once. The axis solver reports through
 * module-level scratch rather than an object it returns, which is safe
 * for exactly the reason it is worth naming: the values are written and
 * read inside one synchronous call and are never held across one.
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that.
 */
import {
  maxOf, minOf,
  type Interaction, type LabLayout, type Vec3,
} from './types';

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/**
 * How high a face may be for a body to rise onto it instead of stopping
 * against it, in metres. See the header: the building's solid tops jump
 * straight from 0.000 to 0.450, so this clears the floor's own face and
 * a door threshold and reaches nothing else.
 */
export const STEP_UP = 0.25;

/**
 * The gap left between a resolved body and the face it stopped against,
 * in metres. A tenth of a millimetre — below the 1 mm lattice
 * `world/SparseSoil.ts` samples on, and far below anything a player could
 * see.
 *
 * Without it a body resolved exactly onto a face is a body whose next
 * frame's overlap test is decided by the last bit of a double: it reads
 * clear on one frame and penetrating on the next, and the penetration
 * branch above then lets it walk into the wall.
 */
const SKIN = 1e-4;

/**
 * How close a solid top must be under the feet for `BodyMove.grounded`,
 * in metres. One millimetre, the same lattice the soil is sampled on, and
 * ten times `SKIN` so a body resting on a face it was just resolved
 * against always reads as standing on it.
 */
const GROUND_GRIP = 1e-3;

/**
 * The broad-phase cell, in metres. Measured in the header: 2 m gives 196
 * cells, 778 entries and a worst bucket of 10 over the real plan, and 1 m
 * triples the memory to improve that worst bucket by nothing.
 */
const CELL = 2.0;

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/**
 * Every solid in a `LabLayout`, prepared for querying.
 *
 * Struct of arrays, not an array of structs: the axis solver reads one
 * field of many solids in a row, and a table of 102 objects would be 102
 * pointer chases to read 102 numbers.
 *
 * A slab is its AABB. A PILLAR IS A CIRCLE, kept as a circle — `types.ts`
 * says a pillar exists partly because "a body stopping against a round
 * thing at its radius is one distance test rather than four faces of a
 * square guess", and squaring the array platform here would put a 1.6 m
 * pillar in a 3.2 m box and stop a player 0.66 m short of it at the
 * diagonal. `x0..z1` still holds its bounding box, because the broad
 * phase and the ray both want one.
 */
export interface LabSolids {
  /** The layout this was built from. `nearestInteraction` and the floor fallback read it. */
  readonly layout: LabLayout;
  /** How many solids are indexed: every solid slab and every solid pillar, and nothing else. */
  readonly count: number;
  /** Each solid's id, in index order. What `BodyMove` and `RayHit` report. */
  readonly ids: readonly string[];
  /** 1 where the solid is a pillar (a vertical cylinder), 0 where it is a slab (a box). */
  readonly round: Uint8Array;
  /** Per solid: its axis-aligned bounds. A pillar's is the box around its circle. */
  readonly x0: Float64Array;
  readonly x1: Float64Array;
  readonly y0: Float64Array;
  readonly y1: Float64Array;
  readonly z0: Float64Array;
  readonly z1: Float64Array;
  /** Per solid: a pillar's centre and radius. Zero on a slab, which never reads them. */
  readonly cx: Float64Array;
  readonly cz: Float64Array;
  readonly cr: Float64Array;
  /** The grid's origin (its cell 0,0 corner) and shape. */
  readonly gridX: number;
  readonly gridZ: number;
  readonly cols: number;
  readonly rows: number;
  /** Compressed rows: cell `i * rows + j` owns `bucketOf[bucketAt[c] .. bucketAt[c + 1])`. */
  readonly bucketAt: Int32Array;
  readonly bucketOf: Int32Array;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : (v > hi ? hi : v));

/**
 * Prepare a layout's solids once.
 *
 * Deterministic and order-preserving: solid slabs in the layout's own
 * order, then solid pillars. Two calls on one layout give two identical
 * indexes, which is what lets a test compare them and what would let an
 * authority and a phone agree on which solid stopped a body.
 */
export function indexLab(layout: LabLayout): LabSolids {
  const ids: string[] = [];
  let n = 0;
  for (const s of layout.slabs) if (s.solid) n += 1;
  for (const p of layout.pillars) if (p.solid) n += 1;

  const round = new Uint8Array(n);
  const x0 = new Float64Array(n);
  const x1 = new Float64Array(n);
  const y0 = new Float64Array(n);
  const y1 = new Float64Array(n);
  const z0 = new Float64Array(n);
  const z1 = new Float64Array(n);
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const cr = new Float64Array(n);

  let at = 0;
  for (const s of layout.slabs) {
    if (!s.solid) continue;
    const lo = minOf(s.box);
    const hi = maxOf(s.box);
    x0[at] = lo.x; y0[at] = lo.y; z0[at] = lo.z;
    x1[at] = hi.x; y1[at] = hi.y; z1[at] = hi.z;
    ids.push(s.id);
    at += 1;
  }
  for (const p of layout.pillars) {
    if (!p.solid) continue;
    round[at] = 1;
    // `Pillar.at` is the centre of its BASE, not of its volume (types.ts).
    x0[at] = p.at.x - p.radius; x1[at] = p.at.x + p.radius;
    z0[at] = p.at.z - p.radius; z1[at] = p.at.z + p.radius;
    y0[at] = p.at.y; y1[at] = p.at.y + p.height;
    cx[at] = p.at.x; cz[at] = p.at.z; cr[at] = p.radius;
    ids.push(p.id);
    at += 1;
  }

  // The grid spans the layout's own bounds, which `planLab` builds as the
  // union of every slab and pillar box — so no solid can fall outside it,
  // and a query outside it has no candidates at all rather than a clamped
  // wrong answer.
  const lo = minOf(layout.bounds);
  const hi = maxOf(layout.bounds);
  const cols = Math.max(1, Math.ceil((hi.x - lo.x) / CELL));
  const rows = Math.max(1, Math.ceil((hi.z - lo.z) / CELL));

  // Two passes and a prefix sum: count what each cell owns, then fill.
  // One pass into arrays-of-arrays would allocate 196 arrays to hold 774
  // numbers, and this table outlives every frame of a session.
  const bucketAt = new Int32Array(cols * rows + 1);
  const span = (v: number, origin: number, limit: number): number => clamp(Math.floor((v - origin) / CELL), 0, limit - 1);
  for (let s = 0; s < n; s += 1) {
    const i0 = span(x0[s], lo.x, cols);
    const i1 = span(x1[s], lo.x, cols);
    const j0 = span(z0[s], lo.z, rows);
    const j1 = span(z1[s], lo.z, rows);
    for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) bucketAt[i * rows + j + 1] += 1;
  }
  for (let c = 0; c < cols * rows; c += 1) bucketAt[c + 1] += bucketAt[c];
  const bucketOf = new Int32Array(bucketAt[cols * rows]);
  const cursor = new Int32Array(cols * rows);
  for (let s = 0; s < n; s += 1) {
    const i0 = span(x0[s], lo.x, cols);
    const i1 = span(x1[s], lo.x, cols);
    const j0 = span(z0[s], lo.z, rows);
    const j1 = span(z1[s], lo.z, rows);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const c = i * rows + j;
        bucketOf[bucketAt[c] + cursor[c]] = s;
        cursor[c] += 1;
      }
    }
  }

  return {
    layout,
    count: n,
    ids,
    round,
    x0, x1, y0, y1, z0, z1,
    cx, cz, cr,
    gridX: lo.x,
    gridZ: lo.z,
    cols,
    rows,
    bucketAt,
    bucketOf,
  };
}

/**
 * The cell range a world rectangle covers, clamped to the grid.
 *
 * Reported through four module-level numbers rather than an object,
 * because every query in this file asks for one and a frame allocates
 * nothing. `cellsEmpty` is true when the rectangle misses the grid
 * entirely — a body outside the building, which is a real case the moment
 * the player walks out of the outer door.
 */
let cellI0 = 0;
let cellI1 = -1;
let cellJ0 = 0;
let cellJ1 = -1;
let cellsEmpty = true;

function cellsOver(ix: LabSolids, ax0: number, az0: number, ax1: number, az1: number): void {
  const i0 = Math.floor((ax0 - ix.gridX) / CELL);
  const i1 = Math.floor((ax1 - ix.gridX) / CELL);
  const j0 = Math.floor((az0 - ix.gridZ) / CELL);
  const j1 = Math.floor((az1 - ix.gridZ) / CELL);
  cellsEmpty = i1 < 0 || j1 < 0 || i0 > ix.cols - 1 || j0 > ix.rows - 1;
  cellI0 = clamp(i0, 0, ix.cols - 1);
  cellI1 = clamp(i1, 0, ix.cols - 1);
  cellJ0 = clamp(j0, 0, ix.rows - 1);
  cellJ1 = clamp(j1, 0, ix.rows - 1);
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

/**
 * Does the capsule at `x, y, z` (feet at y) share volume with solid `s`?
 *
 * Touching faces do NOT overlap, matching `types.ts`'s `overlaps`. That
 * is what lets a body stand with its feet at y = 0.000 on a floor whose
 * top is y = 0.000 without being inside it.
 */
function capsuleHits(ix: LabSolids, s: number, x: number, y: number, z: number, radius: number, height: number): boolean {
  if (y + height <= ix.y0[s] || y >= ix.y1[s]) return false;
  if (ix.round[s] === 1) {
    const dx = x - ix.cx[s];
    const dz = z - ix.cz[s];
    const reach = radius + ix.cr[s];
    return dx * dx + dz * dz < reach * reach;
  }
  const dx = x - clamp(x, ix.x0[s], ix.x1[s]);
  const dz = z - clamp(z, ix.z0[s], ix.z1[s]);
  return dx * dx + dz * dz < radius * radius;
}

/** Is the capsule free of every solid where it stands? The step-up's headroom check. */
function capsuleClear(ix: LabSolids, x: number, y: number, z: number, radius: number, height: number): boolean {
  cellsOver(ix, x - radius, z - radius, x + radius, z + radius);
  if (cellsEmpty) return true;
  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        if (capsuleHits(ix, ix.bucketOf[k], x, y, z, radius, height)) return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// One axis at a time
// ---------------------------------------------------------------------------

/**
 * The axis solver's report. Module-level scratch, written and read inside
 * one synchronous call and never held across one — see the header.
 */
let slidTo = 0;
let slidBy = -1;
let slidTop = 0;

/**
 * Slide the capsule along ONE horizontal axis and stop it against the
 * first solid in the way.
 *
 * `alongX` picks the axis; the other horizontal axis is the one the
 * corner test reads. The forbidden interval a solid casts on the moving
 * axis runs from `lo - w` to `hi + w`, where `w` is the exact distance
 * the centre may approach it given how far off the end of it the body
 * stands: `r` while the body is level with the face, tapering to zero at
 * the corner. Writes `slidTo` (the resolved coordinate), `slidBy` (the
 * solid that limited it, or -1) and `slidTop` (that solid's top face,
 * which is what the step-up needs).
 */
function slideAxis(
  ix: LabSolids, alongX: boolean,
  x: number, y: number, z: number, radius: number, height: number, delta: number,
): void {
  const from = alongX ? x : z;
  const side = alongX ? z : x;
  slidTo = from + delta;
  slidBy = -1;
  slidTop = 0;
  if (delta === 0 || !Number.isFinite(delta)) {
    slidTo = from;
    return;
  }
  // The swept rectangle, widened by the radius on both axes.
  const sweepLo = Math.min(from, slidTo) - radius;
  const sweepHi = Math.max(from, slidTo) + radius;
  cellsOver(
    ix,
    alongX ? sweepLo : side - radius,
    alongX ? side - radius : sweepLo,
    alongX ? sweepHi : side + radius,
    alongX ? side + radius : sweepHi,
  );
  if (cellsEmpty) return;

  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        const s = ix.bucketOf[k];
        if (y + height <= ix.y0[s] || y >= ix.y1[s]) continue;

        // How far the centre may approach on the moving axis, and between
        // which two coordinates that approach is forbidden.
        let lo: number;
        let hi: number;
        let reach: number;
        if (ix.round[s] === 1) {
          const off = side - (alongX ? ix.cz[s] : ix.cx[s]);
          reach = radius + ix.cr[s];
          const room = reach * reach - off * off;
          if (room <= 0) continue;
          const w = Math.sqrt(room);
          lo = (alongX ? ix.cx[s] : ix.cz[s]) - w;
          hi = (alongX ? ix.cx[s] : ix.cz[s]) + w;
        } else {
          const sideLo = alongX ? ix.z0[s] : ix.x0[s];
          const sideHi = alongX ? ix.z1[s] : ix.x1[s];
          const off = side - clamp(side, sideLo, sideHi);
          const room = radius * radius - off * off;
          if (room <= 0) continue;
          const w = Math.sqrt(room);
          lo = (alongX ? ix.x0[s] : ix.z0[s]) - w;
          hi = (alongX ? ix.x1[s] : ix.z1[s]) + w;
        }

        // ONLY WHAT IS AHEAD. A solid behind the body cannot stop it, and a
        // solid the body is already inside the interval of is one it is
        // free to walk out of — `lo < from` is both of those at once, which
        // is why there is one test and not two.
        //
        // The limit is then CLAMPED TO THE START rather than dropped when
        // the skin would put it a hair behind. A body resolved flush
        // against a face on one frame is exactly `SKIN` clear of it on the
        // next, so a rule that dropped a limit behind the start would
        // ignore the very wall the body is leaning on — and a tenth of a
        // millimetre a frame is a body through a wall in half a minute.
        if (delta > 0) {
          if (lo < from) continue;
          const limit = lo - SKIN < from ? from : lo - SKIN;
          if (limit < slidTo) { slidTo = limit; slidBy = s; slidTop = ix.y1[s]; }
        } else {
          if (hi > from) continue;
          const limit = hi + SKIN > from ? from : hi + SKIN;
          if (limit > slidTo) { slidTo = limit; slidBy = s; slidTop = ix.y1[s]; }
        }
      }
    }
  }
}

/**
 * Slide along the vertical axis. The footprint does not change as a body
 * rises or falls, so this is a footprint test and then an interval test,
 * with no corner case to solve — which is the one place the capsule is
 * genuinely cheaper than a box.
 */
function slideY(
  ix: LabSolids,
  x: number, y: number, z: number, radius: number, height: number, delta: number,
): void {
  slidTo = y + delta;
  slidBy = -1;
  slidTop = 0;
  if (delta === 0 || !Number.isFinite(delta)) {
    slidTo = y;
    return;
  }
  cellsOver(ix, x - radius, z - radius, x + radius, z + radius);
  if (cellsEmpty) return;

  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        const s = ix.bucketOf[k];
        if (ix.round[s] === 1) {
          const dx = x - ix.cx[s];
          const dz = z - ix.cz[s];
          const reach = radius + ix.cr[s];
          if (dx * dx + dz * dz >= reach * reach) continue;
        } else {
          const dx = x - clamp(x, ix.x0[s], ix.x1[s]);
          const dz = z - clamp(z, ix.z0[s], ix.z1[s]);
          if (dx * dx + dz * dz >= radius * radius) continue;
        }
        // ONLY WHAT IS IN THE WAY, exactly as the horizontal solver does
        // it: rising, that is what is entirely over the body's head;
        // falling, what is entirely under its feet. Anything else is
        // beside the body or already shared with it, and a body already
        // inside a solid is let out rather than held or thrown.
        //
        // Clamped to the start for the horizontal solver's reason as well:
        // a body standing at y = 0.0000 on a floor whose top is y = 0.0000
        // must be STOPPED by that floor when gravity pulls, and a skinned
        // limit of 0.0001 is above its own feet.
        if (delta > 0) {
          if (ix.y0[s] < y + height) continue;
          const raw = ix.y0[s] - height - SKIN;
          const limit = raw < y ? y : raw;
          if (limit < slidTo) { slidTo = limit; slidBy = s; slidTop = ix.y1[s]; }
        } else {
          if (ix.y1[s] > y) continue;
          const raw = ix.y1[s] + SKIN;
          const limit = raw > y ? y : raw;
          if (limit > slidTo) { slidTo = limit; slidBy = s; slidTop = ix.y1[s]; }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// moveBody
// ---------------------------------------------------------------------------

/** Where a body ended up, and what it met on the way. A caller owns one and reuses it. */
export interface BodyMove {
  /** The resolved position of the FEET, in local metres. */
  x: number;
  y: number;
  z: number;
  /** The id of the solid that limited the x move, or null if nothing did. */
  hitX: string | null;
  /** The id of the solid that limited the y move: what the body landed on, or hit its head on. */
  hitY: string | null;
  /** The id of the solid that limited the z move, or null. */
  hitZ: string | null;
  /** How far the feet rose onto a step, in metres. 0 when nothing was stepped onto. */
  stepped: number;
  /** Is there a solid top within a millimetre under the feet once the move is resolved? */
  grounded: boolean;
}

/** A fresh `BodyMove` for a caller to own and reuse. Nothing here allocates one per frame. */
export function newBodyMove(): BodyMove {
  return { x: 0, y: 0, z: 0, hitX: null, hitY: null, hitZ: null, stepped: 0, grounded: false };
}

/**
 * Try one horizontal axis, and step up onto whatever blocked it if that
 * is a low enough face to walk onto.
 *
 * Returns the resolved coordinate and leaves the raised feet in
 * `steppedY` (unchanged when nothing was stepped onto). A step is taken
 * ONLY when the raised body is clear where it currently stands — a
 * corridor with a 2.45 m cable tray in its ceiling is exactly the sort of
 * place where 0.25 m of headroom is not free — and only when the raised
 * attempt actually gets further than the flat one, so a body never ends
 * up lifted for nothing.
 */
let steppedY = 0;
let axisBlocker = -1;

function axisWithStep(
  ix: LabSolids, alongX: boolean,
  x: number, y: number, z: number, radius: number, height: number, delta: number,
): number {
  steppedY = y;
  slideAxis(ix, alongX, x, y, z, radius, height, delta);
  const flat = slidTo;
  const blocker = slidBy;
  const top = slidTop;
  axisBlocker = blocker;
  if (blocker < 0) return flat;
  if (top <= y || top > y + STEP_UP) return flat;

  const raised = top + SKIN;
  if (!capsuleClear(ix, x, raised, z, radius, height)) return flat;
  slideAxis(ix, alongX, x, raised, z, radius, height, delta);
  const from = alongX ? x : z;
  if (Math.abs(slidTo - from) <= Math.abs(flat - from)) return flat;
  // The step earned its place: the raised body got further than the flat
  // one did. Whatever stopped the RAISED body is what the caller is told
  // about, because the thing that was stepped onto is no longer in the way.
  steppedY = raised;
  axisBlocker = slidBy;
  return slidTo;
}

/**
 * Stand a body that is barely inside a face back up on top of it.
 *
 * Answers the raised feet, or `y` when there is nothing to stand up onto.
 *
 * THE ONE RECOVERY FROM PENETRATION IN THIS FILE, and it is deliberately
 * tiny. Every axis lets a body walk out of a solid it is inside rather
 * than holding it there — which is right for the horizontal axes, where a
 * body that is 20 mm into a wall walks out of it in a frame. On the
 * VERTICAL axis it is not enough on its own: a body 2 mm into the floor
 * is a body the falling solver correctly ignores the floor for, and it
 * falls through the building.
 *
 * So a body overlapping a face no more than `STEP_UP` above its feet
 * stands up onto it, gated on the raised capsule being clear. That is the
 * same quarter metre and the same headroom test the walking step uses,
 * for the same reason — and it is UP ONLY and BOUNDED, which is what
 * keeps it from becoming the push-out the header argues against: the
 * worst it can do is stand a body on the thing it was 2 mm inside. A body
 * deeper in than a step is left where it is and walks out on its feet.
 */
function settleUp(ix: LabSolids, x: number, y: number, z: number, radius: number, height: number): number {
  let top = y;
  cellsOver(ix, x - radius, z - radius, x + radius, z + radius);
  if (cellsEmpty) return y;
  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        const s = ix.bucketOf[k];
        const face = ix.y1[s];
        if (face <= top || face > y + STEP_UP) continue;
        if (!capsuleHits(ix, s, x, y, z, radius, height)) continue;
        top = face;
      }
    }
  }
  if (top === y) return y;
  const raised = top + SKIN;
  return capsuleClear(ix, x, raised, z, radius, height) ? raised : y;
}

/**
 * Move a vertical capsule and resolve it against the building.
 *
 * `from` is the FEET. `delta` is the whole requested move for this step,
 * including whatever the caller's gravity or jump put on y — this file
 * has no opinion about down. Resolution is x, then z, then y, each
 * against what the one before it left; see the header for why that order
 * is the point of an axis-aligned plan.
 *
 * Writes `out` and returns it. Allocates nothing.
 */
export function moveBody(
  ix: LabSolids, from: Vec3, radius: number, height: number, delta: Vec3, out: BodyMove,
): BodyMove {
  let x = from.x;
  let y = from.y;
  let z = from.z;
  let rose = 0;

  x = axisWithStep(ix, true, x, y, z, radius, height, delta.x);
  out.hitX = axisBlocker >= 0 ? ix.ids[axisBlocker] : null;
  rose += steppedY - y;
  y = steppedY;

  z = axisWithStep(ix, false, x, y, z, radius, height, delta.z);
  out.hitZ = axisBlocker >= 0 ? ix.ids[axisBlocker] : null;
  rose += steppedY - y;
  y = steppedY;

  slideY(ix, x, y, z, radius, height, delta.y);
  y = slidTo;
  out.hitY = slidBy >= 0 ? ix.ids[slidBy] : null;

  const settled = settleUp(ix, x, y, z, radius, height);
  rose += settled - y;
  y = settled;

  out.x = x;
  out.y = y;
  out.z = z;
  out.stepped = rose;
  out.grounded = y - groundUnder(ix, x, z, y + SKIN) <= GROUND_GRIP;
  return out;
}

// ---------------------------------------------------------------------------
// What is under a body, and what is over it
// ---------------------------------------------------------------------------

/**
 * The highest solid top face at or below `fromY` under the point `x, z`.
 *
 * A POINT, not the body's circle: this answers "what is under this spot",
 * which is what a body standing on a desk edge and a footfall sound both
 * want. `moveBody` resolves the body's own volume separately.
 *
 * THE ROOM'S FLOOR IS THE FALLBACK, and it is not redundant with the
 * floor slabs even though `plan.ts` emits one per room. A `Room.inside`
 * is the air in the room and its floor is `inside.at.y - inside.size.y /
 * 2` (`types.ts`), so a plan that ever changed how a floor is built still
 * gives a body something to stand on and to fall to. Returns
 * `-Infinity` where there is neither, which is honestly "nothing" rather
 * than a zero a caller would mistake for the ground floor.
 */
export function groundUnder(ix: LabSolids, x: number, z: number, fromY: number): number {
  let best = -Infinity;
  cellsOver(ix, x, z, x, z);
  if (!cellsEmpty) {
    for (let i = cellI0; i <= cellI1; i += 1) {
      for (let j = cellJ0; j <= cellJ1; j += 1) {
        const c = i * ix.rows + j;
        for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
          const s = ix.bucketOf[k];
          const top = ix.y1[s];
          if (top > fromY || top <= best) continue;
          if (ix.round[s] === 1) {
            const dx = x - ix.cx[s];
            const dz = z - ix.cz[s];
            if (dx * dx + dz * dz > ix.cr[s] * ix.cr[s]) continue;
          } else if (x < ix.x0[s] || x > ix.x1[s] || z < ix.z0[s] || z > ix.z1[s]) {
            continue;
          }
          best = top;
        }
      }
    }
  }
  if (best > -Infinity) return best;
  for (const room of ix.layout.rooms) {
    const lo = minOf(room.inside);
    const hi = maxOf(room.inside);
    if (x < lo.x || x > hi.x || z < lo.z || z > hi.z) continue;
    if (lo.y <= fromY && lo.y > best) best = lo.y;
  }
  return best;
}

/**
 * The lowest solid bottom face at or above `fromY` over the point `x, z`,
 * or `+Infinity` where a body could rise for ever.
 *
 * The symmetric query, and the reason a body cannot jump through a slab:
 * the control room's ceiling is at 3.20 m with its slab 0.25 m thick, and
 * the utility bay's conduit runs at 3.55 m. Neither is a room boundary a
 * caller could have derived; both are solids, and both answer here.
 */
export function ceilingOver(ix: LabSolids, x: number, z: number, fromY: number): number {
  let best = Infinity;
  cellsOver(ix, x, z, x, z);
  if (cellsEmpty) return best;
  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        const s = ix.bucketOf[k];
        const under = ix.y0[s];
        if (under < fromY || under >= best) continue;
        if (ix.round[s] === 1) {
          const dx = x - ix.cx[s];
          const dz = z - ix.cz[s];
          if (dx * dx + dz * dz > ix.cr[s] * ix.cr[s]) continue;
        } else if (x < ix.x0[s] || x > ix.x1[s] || z < ix.z0[s] || z > ix.z1[s]) {
          continue;
        }
        best = under;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The ray
// ---------------------------------------------------------------------------

/** Where a ray first entered a solid. A caller owns one and reuses it. */
export interface RayHit {
  /** Metres along the direction, from the origin. 0 when the origin is already inside a solid. */
  distance: number;
  /** The solid the ray entered. */
  id: string;
  /** True where that solid is a pillar (a cylinder), false where it is a slab (a box). */
  round: boolean;
}

/** A fresh `RayHit` for a caller to own and reuse. */
export function newRayHit(): RayHit {
  return { distance: 0, id: '', round: false };
}

/**
 * The nearest solid entry along a ray, or `null` within `maxDistance`.
 *
 * WHAT IT IS FOR: pulling a third-person camera in so it never sits
 * inside a wall. The scene casts from the body's head to where the camera
 * wants to be and moves the camera to the first thing in the way — which
 * is why the answer is a DISTANCE and not a point, and why the origin
 * being inside a solid answers 0 rather than nothing.
 *
 * `direction` need not be a unit vector; it is normalised here, and the
 * distance is in metres whatever its length. A zero or non-finite
 * direction is no ray and answers `null`.
 *
 * The broad phase is the ray's bounding rectangle rather than a walk down
 * the cells it actually crosses. A camera arm is two to four metres, so
 * that rectangle is four to nine of the 196 cells; a DDA would save a
 * handful of box tests on a query made once or twice a frame and cost a
 * traversal nobody could read.
 */
export function rayHit(
  ix: LabSolids, origin: Vec3, direction: Vec3, maxDistance: number, out: RayHit,
): RayHit | null {
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(len) || len <= 0 || !(maxDistance > 0)) return null;
  const dx = direction.x / len;
  const dy = direction.y / len;
  const dz = direction.z / len;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const ex = ox + dx * maxDistance;
  const ez = oz + dz * maxDistance;

  cellsOver(ix, Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
  if (cellsEmpty) return null;

  let nearest = maxDistance;
  let found = -1;
  for (let i = cellI0; i <= cellI1; i += 1) {
    for (let j = cellJ0; j <= cellJ1; j += 1) {
      const c = i * ix.rows + j;
      for (let k = ix.bucketAt[c]; k < ix.bucketAt[c + 1]; k += 1) {
        const s = ix.bucketOf[k];
        // The y slab is shared by both shapes: a pillar is a circle in x/z
        // and an interval in y exactly as a box is.
        let enter = 0;
        let leave = nearest;
        if (dy !== 0) {
          const t0 = (ix.y0[s] - oy) / dy;
          const t1 = (ix.y1[s] - oy) / dy;
          const lo = t0 < t1 ? t0 : t1;
          const hi = t0 < t1 ? t1 : t0;
          if (lo > enter) enter = lo;
          if (hi < leave) leave = hi;
        } else if (oy < ix.y0[s] || oy > ix.y1[s]) {
          continue;
        }
        if (enter > leave) continue;

        if (ix.round[s] === 1) {
          // The infinite cylinder, as a quadratic in the x/z plane.
          const px = ox - ix.cx[s];
          const pz = oz - ix.cz[s];
          const a = dx * dx + dz * dz;
          const b = 2 * (px * dx + pz * dz);
          const cq = px * px + pz * pz - ix.cr[s] * ix.cr[s];
          if (a === 0) {
            // Straight up or down the cylinder's own axis: inside it or never in it.
            if (cq > 0) continue;
          } else {
            const disc = b * b - 4 * a * cq;
            if (disc < 0) continue;
            const root = Math.sqrt(disc);
            const t0 = (-b - root) / (2 * a);
            const t1 = (-b + root) / (2 * a);
            if (t0 > enter) enter = t0;
            if (t1 < leave) leave = t1;
            if (enter > leave) continue;
          }
        } else {
          if (dx !== 0) {
            const t0 = (ix.x0[s] - ox) / dx;
            const t1 = (ix.x1[s] - ox) / dx;
            const lo = t0 < t1 ? t0 : t1;
            const hi = t0 < t1 ? t1 : t0;
            if (lo > enter) enter = lo;
            if (hi < leave) leave = hi;
          } else if (ox < ix.x0[s] || ox > ix.x1[s]) {
            continue;
          }
          if (dz !== 0) {
            const t0 = (ix.z0[s] - oz) / dz;
            const t1 = (ix.z1[s] - oz) / dz;
            const lo = t0 < t1 ? t0 : t1;
            const hi = t0 < t1 ? t1 : t0;
            if (lo > enter) enter = lo;
            if (hi < leave) leave = hi;
          } else if (oz < ix.z0[s] || oz > ix.z1[s]) {
            continue;
          }
          if (enter > leave) continue;
        }

        if (leave < 0) continue;
        const hit = enter < 0 ? 0 : enter;
        if (hit <= nearest) { nearest = hit; found = s; }
      }
    }
  }
  if (found < 0) return null;
  out.distance = nearest;
  out.id = ix.ids[found];
  out.round = ix.round[found] === 1;
  return out;
}

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

/**
 * The closest interaction whose own `reach` contains `at`, or `null`.
 *
 * CLOSEST BY DISTANCE, not by the biggest margin. The reaches in the plan
 * differ on purpose — 0.9 m for a wall intercom and a lever you have to
 * be at, 1.2 m for a desk, 1.4 m for a console you stand back from, 1.5 m
 * for the mapping display and the array — and ranking by margin would let
 * the mapping display 1.4 m away beat a console 1.3 m away for no reason
 * a player could see. The thing nearest the body wins, and the reaches
 * decide only what is a candidate at all.
 *
 * It takes the LAYOUT rather than the index: an interaction is not a
 * solid, it is a point with a radius, and there are twelve of them in the
 * whole building — the laboratory's three are Jack's workstation (1.2 m),
 * Sarah's (1.2 m) and the intercom (0.9 m). Twelve distance tests is
 * cheaper than any index over them, and an index would need rebuilding
 * the day the plan grew one.
 *
 * `at` is the point the player reaches FROM, and it is the caller's
 * choice — the eye, the chest, the feet. It matters: the geometric centre
 * of Jack's laboratory is 1.12 m from Sarah's workstation point measured
 * at chest height and 1.56 m measured at the feet, which is inside her
 * 1.2 m reach on one reading and outside it on the other.
 */
export function nearestInteraction(layout: LabLayout, at: Vec3): Interaction | null {
  let best: Interaction | null = null;
  let bestAway = Infinity;
  for (const use of layout.interactions) {
    const dx = at.x - use.at.x;
    const dy = at.y - use.at.y;
    const dz = at.z - use.at.z;
    const away = dx * dx + dy * dy + dz * dz;
    if (away > use.reach * use.reach) continue;
    if (away < bestAway) { bestAway = away; best = use; }
  }
  return best;
}
