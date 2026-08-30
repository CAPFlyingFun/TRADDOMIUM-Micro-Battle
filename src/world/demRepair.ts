/**
 * SANITISING THE ELEVATION DATA, ONCE, AS IT LOADS.
 *
 * CLAUDE.md's standing rule is that no system may modify terrain
 * height, and that rule stands: gameplay, hydrology, water placement,
 * AI and the renderer may not push the ground around to make their own
 * problem easier. This module is the one sanctioned exception Joshua
 * wrote (2026-08-30), and it is narrow — a sample that is DEMONSTRABLY
 * INVALID is not the island, and repairing it is data repair rather
 * than terrain modification. It happens before the heightfield enters
 * the world, it is driven only by the data, and it never asks what any
 * other system would prefer to see.
 *
 * WHAT WENT WRONG. The DEM carries scattered samples hundreds of
 * metres below sea level sitting inside dry land. At the beach in
 * Joshua's screenshots — HD tile E2, sample 310,230 — a 2×2 block
 * reading −68.5 m and −210.8 m sits in sand at +2.7 to +6.5 m. The
 * mesh interpolates between samples 13.67 m apart, so each becomes a
 * square funnel with sloping walls and a flat floor: a 27 m wide,
 * 200 m deep shaft in a beach. 772 NODATA samples do the same thing by
 * another route, because a void mapped to the seabed constant, −600 m.
 *
 * It was lethal rather than merely ugly, for a reason that has nothing
 * to do with the water system: the pit floor is below y = 0, and the
 * water query classifies ground below zero as THE SEA. So a hole in a
 * beach was filled to sea level and handed the Pacific's depth. The
 * HUD read SALTWATER on dry land, correctly — it had been told the
 * beach was ocean.
 *
 * WHAT MAKES A SAMPLE PROVABLY WRONG. Hawaiʻi has no dry land below
 * sea level. So a below-sea-level sample the open ocean cannot reach
 * is not a place on Kauaʻi — it is a defect, whatever its value. That
 * is the whole test, and it is a fact about the island rather than a
 * tuning constant.
 *
 * REACHING IT IS CONNECTIVITY, NOT A THRESHOLD. "Negative" alone would
 * condemn the real sea; "far from the coast" would spare the beach pit
 * that started this, which is metres from the water. What separates
 * them is whether the ocean can actually flow there.
 *
 * This module knows nothing about either grid's constants on purpose —
 * both callers hand it their own geometry — so it cannot form an
 * import cycle with the modules it repairs, and it can be tested with
 * a hand-written eight-by-eight island.
 */

/** The DEM's own no-data marker. Treated as unknown, never as ground. */
export const NODATA = -32768;

/**
 * How many times the fill is relaxed after the first pass.
 *
 * The fill solves Laplace's equation on the hole: the rim is held
 * fixed and the inside settles to the smoothest surface those edges
 * allow. That is what stops a repair reading as a repair — no flat
 * plug, no spike, no cliff at the join, because the boundary values
 * are the rim's own and the interior has no freedom to do anything but
 * interpolate between them.
 *
 * Sixty is far more than the one- and two-sample pits need (those are
 * finished by the seeding pass alone) and enough that the largest void
 * in this dataset is smooth rather than merely filled.
 */
const RELAX = 60;

/** True where the sample is water or unknown — never dry ground. */
export function wet(v: number): boolean {
  return v === NODATA || v < 0;
}

/**
 * Flood from a seed set through water; report what it cannot reach.
 * Those are the enclosed below-sea-level regions.
 *
 * Four-connected on purpose: eight-connected water leaks diagonally
 * between two touching land samples, through a gap no sea could use.
 */
export function enclosedWater(
  a: Int16Array, n: number, seed: (index: number) => boolean,
): Uint8Array {
  const seen = new Uint8Array(n * n);
  const stack: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (wet(a[i]) && seed(i)) { seen[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % n;
    const r = (i / n) | 0;
    if (c > 0 && wet(a[i - 1]) && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
    if (c < n - 1 && wet(a[i + 1]) && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    if (r > 0 && wet(a[i - n]) && !seen[i - n]) { seen[i - n] = 1; stack.push(i - n); }
    if (r < n - 1 && wet(a[i + n]) && !seen[i + n]) { seen[i + n] = 1; stack.push(i + n); }
  }
  const bad = new Uint8Array(n * n);
  for (let i = 0; i < a.length; i++) if (wet(a[i]) && !seen[i]) bad[i] = 1;
  return bad;
}

/** What a repair did, for the tests and for the report. */
export interface Repair {
  /** How many samples were replaced. */
  readonly repaired: number;
  /** The lowest real value present before and after. */
  readonly wasLowest: number;
  readonly nowLowest: number;
  /** How many NODATA markers were among the replaced samples. */
  readonly voids: number;
}

/**
 * Fill the marked samples from the ground around them, in place.
 *
 * `pinned` may supply an authoritative value for a sample — the coarse
 * grid's own repaired answer, where the two grids share a sample — and
 * those become fixed boundary values rather than unknowns. That is
 * what keeps the two datasets agreeing after repair exactly as the
 * bake asserts they agree before it.
 */
function inpaint(
  a: Int16Array, n: number, bad: Uint8Array, landOnly: Uint8Array,
  pinned?: (index: number) => number | null,
): number {
  const open: number[] = [];
  let replaced = 0;
  for (let i = 0; i < bad.length; i++) {
    if (!bad[i]) continue;
    replaced++;
    const fixed = pinned?.(i) ?? null;
    // A pinned sample is answered by the island grid's own repaired
    // value and becomes a FIXED boundary for the rest — it still
    // counts as replaced, because it was. Pinned WHATEVER that value
    // is, water included: the island grid has already been repaired,
    // so it is authoritative, and the two must hold the same number at
    // every sample they share. Skipping the wet ones left two samples
    // in 1,065,024 disagreeing — which is two too many for an
    // invariant the bake asserts absolutely.
    if (fixed !== null && fixed !== NODATA) { a[i] = fixed; bad[i] = 0; } else open.push(i);
  }
  if (!open.length) return replaced;
  // THE RIM IS LAND, NEVER THE SEA BESIDE IT. A defect at the coast
  // has real ocean on one side and real ground on the other, and
  // averaging both together fills the hole with something below sea
  // level — which is the very thing it was condemned for. Measured on
  // E7 392,370: a sample at −15.8 m came out of a naive fill at
  // −127.5 m, because sixty relaxation passes dragged it down into the
  // −45 m water next door. So valid SEA is not a boundary value here;
  // only dry ground and what has already been filled from it. The
  // coastline is left exactly where the real sea says it is, and the
  // hole becomes the land it should have been.
  //
  // SEED FROM THE RIM INWARD. Each pass fills only what currently
  // touches good ground, and what it fills becomes good ground for the
  // next — so a hole closes over from its edges rather than taking one
  // average of a rim it cannot all see.
  let left = open;
  while (left.length) {
    const fills: number[] = [];
    const values: number[] = [];
    const next: number[] = [];
    for (const i of left) {
      const c = i % n;
      const r = (i / n) | 0;
      let sum = 0;
      let seen = 0;
      // A condemned sample fills from dry ground only; a void offshore
      // fills from whatever valid data surrounds it, which out there is
      // the seabed. Same door, two kinds of neighbour.
      const dryRim = landOnly[i] === 1;
      const ok = (j: number): boolean => !bad[j] && (!dryRim || !wet(a[j]));
      if (c > 0 && ok(i - 1)) { sum += a[i - 1]; seen++; }
      if (c < n - 1 && ok(i + 1)) { sum += a[i + 1]; seen++; }
      if (r > 0 && ok(i - n)) { sum += a[i - n]; seen++; }
      if (r < n - 1 && ok(i + n)) { sum += a[i + n]; seen++; }
      if (seen === 0) { next.push(i); continue; }
      fills.push(i);
      values.push(Math.round(sum / seen));
    }
    // A hole touching nothing valid at all has no rim to close from.
    // Sea level is the honest answer; in this dataset it never happens.
    if (!fills.length) { for (const i of next) { a[i] = 0; bad[i] = 0; } break; }
    for (let k = 0; k < fills.length; k++) { a[fills[k]] = values[k]; bad[fills[k]] = 0; }
    left = next;
  }
  // RELAX. The seeding pass is a fill; this makes it a surface. Only
  // the samples that were replaced move — the rim is never written —
  // so the join carries no step and the inside carries no plateau.
  for (let pass = 0; pass < RELAX; pass++) {
    for (const i of open) {
      const c = i % n;
      const r = (i / n) | 0;
      let sum = 0;
      let seen = 0;
      const dryRim = landOnly[i] === 1;
      const ok = (j: number): boolean => !dryRim || !wet(a[j]);
      if (c > 0 && ok(i - 1)) { sum += a[i - 1]; seen++; }
      if (c < n - 1 && ok(i + 1)) { sum += a[i + 1]; seen++; }
      if (r > 0 && ok(i - n)) { sum += a[i - n]; seen++; }
      if (r < n - 1 && ok(i + n)) { sum += a[i + n]; seen++; }
      if (seen) a[i] = Math.round(sum / seen);
    }
  }
  return replaced;
}

/** Count and floor, before a repair writes over the evidence. */
function survey(a: Int16Array): { lowest: number; voids: number } {
  let lowest = 32767;
  let voids = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === NODATA) { voids++; continue; }
    if (a[i] < lowest) lowest = a[i];
  }
  return { lowest, voids };
}

/**
 * WHERE THE OCEAN ACTUALLY IS, at the coarse grid's resolution.
 *
 * Built from the coarse grid, which is the only elevation the game
 * holds WHOLE: one file, the entire island, and — measured — a border
 * of 4,100 samples without one above water. So a flood from its edge
 * is world-level connectivity with no tiles in it and no boundary that
 * can lie.
 *
 * This is what the HD tiles are judged against, and it answers the
 * question a per-tile flood cannot: a pit straddling a tile boundary
 * touches the edge of both tiles it lies in, and is still inland.
 */
let oceanMask: Uint8Array | null = null;
let maskSide = 0;
/** The repaired grid itself, kept beside the mask it produced. */
let island: Int16Array | null = null;

/** Forget the world — for tests, and for leaving the island. */
export function forgetOceanMask(): void {
  oceanMask = null;
  maskSide = 0;
  island = null;
}

/** Whether the world's ocean has been established yet. */
export function hasOceanMask(): boolean {
  return oceanMask !== null;
}

/**
 * Repair the whole-island grid in place, and remember where its ocean
 * is so the tiles can be judged against the world rather than against
 * themselves.
 *
 * Seeded from the border, which THIS dataset makes safe: every one of
 * its edge samples is below water, so the seed set is the open ocean
 * and no tile enters into it. The caller supplies the side length.
 */
export function repairCoarse(grid: Int16Array, n: number): Repair {
  const before = survey(grid);
  const border = (i: number): boolean => {
    const c = i % n;
    const r = (i / n) | 0;
    return c === 0 || r === 0 || c === n - 1 || r === n - 1;
  };
  const bad = enclosedWater(grid, n, border);
  // EVERY VOID GOES THROUGH THIS DOOR, not only the enclosed ones. A
  // NODATA marker offshore is still missing data, and left alone it
  // becomes the seabed constant — a −600 m spike in open water. It is
  // not condemned as land, though, so it fills from the seabed around
  // it rather than from dry ground.
  const landOnly = new Uint8Array(bad);
  let voids = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== NODATA) continue;
    voids++;
    bad[i] = 1;
  }
  const repaired = inpaint(grid, n, bad, landOnly);
  // Taken AFTER the repair, so the defects it just closed cannot be
  // mistaken for sea by anything reading the mask afterwards.
  oceanMask = new Uint8Array(n * n);
  maskSide = n;
  island = grid;
  for (let i = 0; i < grid.length; i++) oceanMask[i] = wet(grid[i]) ? 1 : 0;
  const after = survey(grid);
  return {
    repaired, voids, wasLowest: before.lowest, nowLowest: after.lowest,
  };
}

/** How a fine tile relates to the whole-island grid it must agree with. */
export interface CoarseLink {
  /** The repaired whole-island grid. */
  readonly grid: Int16Array;
  /** Its side length in samples. */
  readonly side: number;
  /** Fine samples per coarse sample along one axis. */
  readonly step: number;
}

/**
 * The repaired island grid and its geometry, for a fine tile to be
 * judged against — or null before the island has loaded.
 *
 * Held here rather than fetched from the heightfield because this
 * module is the one that established it, and because reaching back
 * into the heightfield would close an import cycle: the heightfield
 * already reads the fine tiles.
 *
 * @param step fine samples per coarse sample along one axis.
 */
export function islandLink(step: number): CoarseLink | null {
  return island ? { grid: island, side: maskSide, step } : null;
}

/**
 * Repair one fine tile in place, judged against the WORLD's ocean.
 *
 * THE TILE'S OWN BORDER IS NOT EVIDENCE. A corrupted pit can straddle
 * a tile boundary and so touch the edge of both tiles it lies in;
 * flooding from that edge calls it connected and lets it through,
 * which is the hole in the obvious approach. So the seed set is not
 * the border — it is every sample of this tile that the whole-island
 * flood already established is open ocean. A pit inland gets no seed
 * however many edges it touches, and the real sea gets one wherever
 * it is.
 *
 * WHAT THAT GUARANTEES, plainly: the bake asserts the two grids hold
 * the same value at every sample they share, and they share one in
 * `step` along each axis. So any genuine body of water as much as one
 * coarse sample across contains a shared sample, the whole-island grid
 * sees it, and the flood seeds it. Nothing real above that size can be
 * repaired away; below it is detail the two datasets are not even
 * required to agree about.
 *
 * @param link the repaired whole-island grid and its geometry. The
 *   samples the two share are PINNED to its values rather than
 *   inpainted, so the grids still agree afterwards.
 */
export function repairFineTile(
  tile: Int16Array, n: number, col: number, row: number,
  link: CoarseLink | null,
): Repair {
  const before = survey(tile);
  const span = n - 1;
  const mask = oceanMask;
  /** The coarse sample this fine sample shares, or null where none. */
  const shared = (c: number, r: number): number | null => {
    if (!link) return null;
    const { side, step } = link;
    if (c % step !== 0 || r % step !== 0) return null;
    const cx = (col * span + c) / step;
    const cz = (row * span + r) / step;
    if (cx > side - 1 || cz > side - 1) return null;
    return cz * side + cx;
  };
  const seed = (i: number): boolean => {
    const c = i % n;
    const r = (i / n) | 0;
    if (!mask || !link || link.side !== maskSide) {
      // No island grid yet. The game cannot reach here — a tile is
      // only fetched once the island exists — so this is tests reading
      // a tile on its own, where its own border is the best evidence
      // there is.
      return c === 0 || r === 0 || c === n - 1 || r === n - 1;
    }
    // The nearest coarse sample, rounded rather than floored so a
    // shoreline sample asks about the one it actually sits closest to.
    const { side, step } = link;
    const cx = Math.min(side - 1, Math.round((col * span + c) / step));
    const cz = Math.min(side - 1, Math.round((row * span + r) / step));
    return mask[cz * side + cx] === 1;
  };
  const bad = enclosedWater(tile, n, seed);
  // AND THE TWO GRIDS MUST AGREE ABOUT LAND AND SEA.
  //
  // Connectivity alone cannot catch every defect near a coast: a chain
  // of corrupt samples that happens to touch the real shallows is
  // indistinguishable from a cove by connectivity, and the shipped
  // data has exactly that — E2 141,243 reads −456 m where the island
  // grid reads +7.3 m, joined to the sea through its own neighbours.
  //
  // So the second test is disagreement. The bake asserts the two grids
  // hold the same value at every sample they share; where the fine one
  // says ocean and the whole island says LAND, one of them is wrong,
  // and it is not the smoothed product that agrees with its neighbours.
  //
  // Guarded by requiring ALL FOUR surrounding coarse samples to be dry
  // land, which is what keeps the real waterline safe: a genuine
  // shoreline sample always has at least one coarse neighbour in the
  // water, so it can never be condemned by this test. Only a fine
  // sample sitting well inside coarse land can be.
  if (link && mask) {
    const { grid, side, step } = link;
    const dry = (cx: number, cz: number): boolean => {
      if (cx < 0 || cz < 0 || cx > side - 1 || cz > side - 1) return false;
      return grid[cz * side + cx] > 0;
    };
    for (let i = 0; i < tile.length; i++) {
      if (bad[i] || !wet(tile[i])) continue;
      const gx = (col * span + (i % n)) / step;
      const gz = (row * span + (((i / n) | 0))) / step;
      const cx = Math.floor(gx);
      const cz = Math.floor(gz);
      if (dry(cx, cz) && dry(cx + 1, cz) && dry(cx, cz + 1) && dry(cx + 1, cz + 1)) {
        bad[i] = 1;
      }
    }
  }
  // Every void, enclosed or not — see repairCoarse. Condemned samples
  // fill from dry ground; a void in open water fills from the seabed.
  const landOnly = new Uint8Array(bad);
  let voids = 0;
  for (let i = 0; i < tile.length; i++) {
    if (tile[i] !== NODATA) continue;
    voids++;
    bad[i] = 1;
  }
  const pinned = link
    ? (i: number): number | null => {
      const at = shared(i % n, (i / n) | 0);
      return at === null ? null : link.grid[at];
    }
    : undefined;
  const repaired = inpaint(tile, n, bad, landOnly, pinned);
  const after = survey(tile);
  return {
    repaired, voids, wasLowest: before.lowest, nowLowest: after.lowest,
  };
}
