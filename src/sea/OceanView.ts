/**
 * THE SEA'S SURFACE — two sheets wearing one look.
 *
 * The FAR sheet is the horizon's: flat at y = 0, reaching 8.2 km out. At
 * those distances the swell subtends nothing and the distance smear
 * already owns the look.
 *
 * The NEAR sheet is hers: a window that re-anchors as she moves,
 * displaced every frame by the SWELL — the same table the gameplay query
 * sums, baked into the vertex shader by the module that owns it. Its
 * swell flattens and its alpha hands over to the far sheet across one
 * band — the same band the far sheet's HOLE opens across, measured from
 * the same point — so the seam is flat-meets-flat, there is no ring of
 * glass between them, and nobody double-draws the water.
 *
 * Sea LEVEL is exactly 0; the swell is an excursion ABOUT zero that the
 * shore fades away, so the feathered waterline keeps the beach it fought
 * for. The lattice carries DEPTH per vertex — zero minus the drawn
 * ground, SIGNED — because everything the look does is driven by the
 * column under it, and because clamping land vertices to zero moved the
 * interpolated zero-crossing a whole cell inland of the true waterline.
 *
 * The sheets SINK in the depth buffer (positive polygon offset) so
 * near-coplanar shore terrain wins the tie, and the FAR sheet sinks
 * further still: two transparent sheets sharing one offset fought for
 * the depth buffer across the whole crossfade band (Joshua: "I did see
 * some Z-Fighting as well").
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT THE QUALITY TIER ACTUALLY MOVES HERE
 *
 * v0 drew 257² + 241² = 124,130 vertices, every frame, at every setting,
 * with `frustumCulled = false`. The culling flag is right and stays —
 * both sheets are centred on the camera, so their bounding spheres
 * always contain it and a frustum test could never reject them; turning
 * it on would buy a test and cull nothing. What was wrong is that the
 * COUNT was not a choice.
 *
 * The two sheets scale differently, because they are for different
 * things:
 *
 *   FAR   keeps its 8.2 km SPAN and grows its cell. The span is the
 *         horizon and the horizon is not negotiable; the cell only has
 *         to resolve a bathymetry colour ramp at kilometres of distance.
 *   NEAR  keeps its 70-unit CELL and shrinks its span. The cell is what
 *         resolves the swell — six samples to a 4.2 m wavelength — and
 *         coarsening it would alias the waves themselves, which is a
 *         change to the accepted look rather than a quality tier. What
 *         gives instead is HOW FAR the moving water reaches before it
 *         hands over to the flat sheet.
 *
 * The handover radii are therefore FRACTIONS of the near sheet's own
 * reach rather than the absolute numbers v0 used, so the crossfade keeps
 * its shape at every size — and they are measured from the CAMERA, not
 * from the sheet, so the wave zone follows her instead of jumping a
 * recentre step behind. See FADE_LO_OF_REACH.
 * ─────────────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { samePoint, snapTo, translate, world, type WorldPoint } from '../world/coords';
import type { Heightfield } from '../world/heightfield';
import { toLocal } from '../world/origin';
import type { SeaSwell } from '../world/sea/swell';
import type { SeaTextures } from './SeaTextures';
import { makeWaterLook, type WaterLook } from './waterLook';
import { DETAIL_TIERS, waveRadius, type DetailTier } from '../assets/detailQuality';

/**
 * The far sheet's SMALLEST span, world units across — v0's exact 8.2 km,
 * and the floor.
 *
 * IT IS A FLOOR AND NOT THE SIZE, and that is the one thing v0's ocean
 * could not have known it needed. v0's player was an ant on a beach, so a
 * sheet 4.1 km in every direction WAS the horizon. This build's camera
 * starts 1.5 km above the middle of Kauaʻi, twenty kilometres from the
 * nearest coast, and both sheets — which follow the camera — were
 * therefore buried inside the island, drawing nothing while costing three
 * times the frame. The probe caught it exactly: switching the ocean layer
 * off changed the HUD and not one pixel of the world, because the water
 * on screen was the terrain colouring its own seabed.
 *
 * So the span rides the camera's view distance, which the scene already
 * computes for the far plane (`adaptDepth`). Same idea, same input, and
 * at ant height it lands on v0's number.
 */
const FAR_SPAN_MIN = 822_400;

/**
 * How far the span may be doubled past that floor.
 *
 * Six doublings is 64x — 52,633,600 units, nine times the island — which
 * covers the horizon from any altitude this camera reaches. The cap
 * exists because a sheet has to end somewhere and a runaway `reach` (a
 * NaN altitude, a far plane nobody clamped) must not ask for a lattice
 * the size of the solar system.
 */
const FAR_SPAN_DOUBLINGS = 6;

/**
 * The far sheet's cell for a given view distance: the smallest step on a
 * power-of-two ladder whose sheet covers twice the reach.
 *
 * A LADDER, so the sheet is rebuilt rarely and by whole factors. Riding
 * the reach continuously would rewrite 37,249 positions and refill as
 * many depths on any frame the altitude twitched; a doubling ladder
 * changes only when the camera has genuinely changed scale, and each
 * change is unambiguous.
 */
export function farCellFor(n: number, reach: number): number {
  const base = FAR_SPAN_MIN / n;
  const want = Number.isFinite(reach) ? Math.max(0, reach) * 2 : 0;
  let cell = base;
  for (let step = 0; step < FAR_SPAN_DOUBLINGS && n * cell < want; step += 1) cell *= 2;
  return cell;
}

/**
 * The near sheet's vertex spacing. 70 units, so the 4.2 m swell gets six
 * of them to a wavelength and arrives as a WAVE rather than as the
 * aliased suggestion of one. NOT a tier's to change: see the header.
 */
const NEAR_CELL = 70;

/**
 * THE HANDOVER, as fractions of the near sheet's REACH — the largest
 * circle the fade can fill measured FROM THE CAMERA, which `OceanView`
 * works out below.
 *
 * ONE RAMP, RUN FROM THE PLAYER. The swell flattens and the sheet fades
 * out over the same band, and both are measured from where she is rather
 * than from the middle of a lattice that only moves in steps.
 *
 * ─── how this got here ───────────────────────────────────────────────
 *
 * v0 wrote four absolute distances — rim 6,000..7,800, handover
 * 6,800..8,200 — over a near sheet whose half-span was 8,435, and its own
 * comment read "inside the sheet's 8 435 half-span, so the fade finishes
 * before the edge."
 *
 * v1 turned them into fractions, correctly (the sheet's size now rides
 * the detail rung), and multiplied them by the sheet's FULL SPAN. Every
 * band came out at twice its radius, all four landed outside the sheet,
 * and neither fade ever ran: the near sheet carried full swell to its
 * square edge and stopped dead while the far sheet's hole kept the far
 * sheet from drawing anything within 136 m. Between them was a ring 52 m
 * wide where NEITHER SHEET DREW WATER. Joshua photographed it from 60 m
 * up on 2026-09-05: "there is a gap that shouldn't be there like v0" —
 * and v0 is right, v0 had no such gap.
 *
 * Fixed, he looked again (2026-09-06) and said the edge was "too small
 * and hard", and that the water "changes... and makes not stay the same
 * location" as he moved. Two faults, and both are v0's design rather
 * than v1's port of it:
 *
 *   TOO HARD — v0's ramp is 21% of the reach wide with a band of flat
 *   glass in the middle of it, where the swell has finished flattening
 *   but the sheets have not finished swapping. From 90 m up that reads
 *   as a soft-edged disc of moving water lying on a still sea. The ramp
 *   now starts at 35% and the swell and the alpha come down TOGETHER
 *   across all of it, so the waves just get smaller and the sheet
 *   carrying them is already transparent by the time they are gone.
 *   There is no flat annulus left to be the edge of anything.
 *
 *   DOESN'T FOLLOW HER — the fade was measured from the sheet's centre,
 *   and the sheet only re-anchors once she has crossed an eighth of its
 *   span. So the wave zone sat still while she moved and then jumped a
 *   whole step. It is measured from the CAMERA now (`eyeCentred` in
 *   waterLook), which is a uniform written every frame and costs
 *   nothing; the GEOMETRY keeps its hysteresis, because that is what
 *   refills 82,369 depths.
 *
 * IT IS NOT v0's REJECTED FIRST CUT, which flattened everything past
 * 34 m — a hard stop, on a sheet whose whole reach was 84 m — and made
 * the ocean read as glass because the middle distance was all far sheet.
 * This is a RAMP over two thirds of a reach that is 82 m at high: full
 * waves for the first 29 m, half height around 55, thinning past that.
 * `tests/seaOceanView.test.ts` pins that the ramp is at least half the
 * reach wide — the property that stops it being an edge — and that it
 * starts no later than v0's own 72%.
 */
const FADE_LO_OF_REACH = 0.35;
const FADE_HI_OF_REACH = 1.0;

/**
 * How far the camera may travel before a sheet re-anchors: about an
 * eighth of its span, rounded DOWN to a whole number of cells.
 *
 * The rounding is not tidiness. The centre is `snapTo(at, recentre)`, so
 * a recentre that is a multiple of the cell keeps every vertex on one
 * fixed world lattice for the life of the scene — and the near sheet's
 * vertices are where the swell is evaluated, so a lattice that shifted
 * between anchors would jog the drawn crests each time the sheet moved.
 * One snap then does both jobs: the hysteresis and the alignment.
 */
const RECENTRE_CELLS = 8;
const recentreOf = (n: number, cell: number): number => Math.max(1, Math.floor(n / RECENTRE_CELLS)) * cell;

/**
 * Vertices a side, per tier.
 *
 * HIGH AND ULTRA HIGH ARE v0's EXACTLY — 257 and 241 — because that is
 * the geometry the accepted look was accepted at. Medium coarsens the
 * far sheet only, which is flat and kilometres away. Low and ultra-low
 * pull the near sheet's reach in as well, which is visible and is meant
 * to be: at 24,050 vertices against v0's 124,130, ultra-low is the rung
 * for a phone that would otherwise be choosing between the sea and the
 * frame rate.
 */
const FAR_VERTICES: Readonly<Record<DetailTier, number>> = Object.freeze({
  'ultra-low': 97,
  low: 129,
  medium: 193,
  high: 257,
  'ultra-high': 257,
});

/**
 * How many vertices a side the NEAR sheet needs to reach this rung's
 * wave radius at the cell it is obliged to keep.
 *
 * DERIVED, NOT LISTED. The radius is the decision and it lives in
 * `assets/detailQuality.ts`; the cell belongs to this file and may not
 * move (see the header — it is what resolves the swell). A count is
 * simply those two divided, and writing it down as a third number is
 * inviting exactly the disagreement the crossfade bands already had.
 *
 * ODD, so the lattice has a vertex at its own centre. A sheet whose
 * middle falls in the gap between four vertices puts the camera —
 * which is what it is centred on — permanently mid-quad.
 */
export function nearVerticesFor(tier: DetailTier): number {
  const n = Math.round((2 * waveRadius(tier)) / NEAR_CELL);
  return n % 2 === 0 ? n + 1 : n;
}

export const SHEET_VERTICES: Readonly<Record<DetailTier, { far: number; near: number }>> = Object.freeze(
  Object.fromEntries(DETAIL_TIERS.map((tier) => [
    tier,
    Object.freeze({ far: FAR_VERTICES[tier], near: nearVerticesFor(tier) }),
  ])) as Record<DetailTier, { far: number; near: number }>,
);

/** How many vertices this tier submits every frame, both sheets. For a HUD, and for a test. */
export function sheetVertexCount(tier: DetailTier): number {
  const { far, near } = SHEET_VERTICES[tier];
  return far * far + near * near;
}

/**
 * How many ripple octaves a tier runs. Four is the accepted look and
 * what medium and above use; the coarse octaves alone still read as
 * moving water on a screen that cannot resolve the fine ones.
 */
export const TIER_OCTAVES: Readonly<Record<DetailTier, number>> = Object.freeze({
  'ultra-low': 2,
  low: 3,
  medium: 4,
  high: 4,
  'ultra-high': 4,
});

interface Sheet {
  readonly mesh: THREE.Mesh;
  readonly look: WaterLook;
  readonly depthAttr: Float32Array;
  readonly n: number;
  /** Mutable on the far sheet only: its span rides the camera's reach. */
  cell: number;
  recentre: number;
  /** Where it is now, snapped to its own recentre lattice. Null until the first fill. */
  centre: WorldPoint | null;
  /** The heightfield revision the depths were read at. */
  filledAt: number;
}

export interface OceanViewOptions {
  readonly field: Heightfield;
  readonly swell: SeaSwell;
  readonly textures: SeaTextures;
  /**
   * The RENDERING DETAIL rung — how far the waves reach and how many
   * ripple octaves run. Not the texture rung: `textures` carries its
   * own, and since 2026-09-05 the two are settings a player sets
   * separately (`assets/detailQuality.ts`).
   */
  readonly detail: DetailTier;
}

/**
 * WHAT THE OCEAN COSTS THE CPU, in milliseconds of wall clock.
 *
 * Joshua's brief for this phase named two suspects for v0's choppiness,
 * and the second was "probably wasn't optimized the best between CPU,
 * and GPU". That is answerable only by measuring, so the ocean times
 * ITSELF: `update` and `tick` are the whole of its per-frame CPU work,
 * and nothing else in the build has to know how to find them.
 *
 * WHY THE PEAK AND THE REFILL COUNT MATTER MORE THAN THE MEAN. The work
 * is not spread evenly. Most frames are two uniform writes and a
 * comparison — nothing. But when the camera crosses a sheet's recentre
 * lattice, `anchor` refills that sheet's depth attribute, which on a
 * medium near sheet is 241**2 = 58,081 heightfield reads IN ONE FRAME.
 * A mean hides that: a mean of 0.1 ms with a peak of 12 ms is not a
 * smooth ocean, it is a smooth ocean with a hitch in it, and a hitch
 * every few seconds is exactly what "slightly choppy" describes. So the
 * peak is kept, and so is the number of frames that refilled — between
 * them they say how often the stall happens and how much it costs.
 *
 * MILLISECONDS OF WALL CLOCK, NOT OF SIMULATION. This is instrumentation
 * and it measures the machine, so it never sees a clamped dt (CLAUDE.md).
 */
export interface OceanCost {
  /** Frames measured since the last reset. Zero means nothing has been drawn yet. */
  readonly frames: number;
  /** Milliseconds across all of them. */
  readonly totalMs: number;
  /** `totalMs / frames`, or zero before the first frame. */
  readonly meanMs: number;
  /** The worst single frame. Where a refill shows up. */
  readonly peakMs: number;
  /** How many of those frames refilled a sheet's depths. */
  readonly refills: number;
  /** Vertices submitted a frame — the GPU's side of the same question. */
  readonly vertices: number;
}

/** Wall clock. One clock for both call sites, named once so it stays that way. */
const now = (): number => performance.now();

export class OceanView {
  /** One group, so a layer toggle is one `visible` and never a walk. */
  readonly group = new THREE.Group();
  readonly detail: DetailTier;

  private readonly field: Heightfield;
  private readonly swell: SeaSwell;
  private readonly far: Sheet;
  private readonly near: Sheet;

  /** Accumulating within the CURRENT frame; `tick` closes it. */
  private spentMs = 0;
  private frames = 0;
  private totalMs = 0;
  private peakMs = 0;
  private refills = 0;

  constructor(options: OceanViewOptions) {
    this.field = options.field;
    this.swell = options.swell;
    this.detail = options.detail;
    this.group.name = 'ocean';

    const counts = SHEET_VERTICES[options.detail];
    const octaves = TIER_OCTAVES[options.detail];
    // THE EDGE IS HALF THE SPAN, LESS A CELL. `lattice` centres the sheet
    // on zero and runs from `-span/2` to `span/2 - cell`, so it is a
    // whole cell short on two of its four sides — and the largest circle
    // that fits inside it is therefore `span/2 - cell`.
    //
    // Reading it as the SPAN is what put every band outside the sheet and
    // opened the gap. Reading it as the half-span alone is nearly right
    // and fails on the small rungs: at ultra-low's 43 vertices the last
    // 2.8% of the radius is that one missing cell.
    const nearEdge = (counts.near * NEAR_CELL) / 2 - NEAR_CELL;
    // AND THE FADE IS MEASURED FROM THE CAMERA, which is not the sheet's
    // middle. `snapTo` ROUNDS, so between anchors the camera sits up to
    // half a recentre step away on each axis — √2/2 of a step on the
    // diagonal — and a circle drawn around IT reaches that much further
    // on one side than a circle drawn around the sheet. Subtract the
    // drift here and the fade fits from wherever the camera has got to,
    // which is the price of the wave zone following the player instead
    // of jumping a step behind her.
    const drift = recentreOf(counts.near, NEAR_CELL) * Math.SQRT1_2;
    const nearReach = nearEdge - drift;
    const handLo = nearReach * FADE_LO_OF_REACH;
    const handHi = nearReach * FADE_HI_OF_REACH;

    // edgeLo/edgeHi are the waterline Joshua approved — widening them
    // washed the beach out. edgeLo keeps the geometric cut hidden 35
    // units under, which is what stopped it being a hard line.
    const skin = {
      swell: options.swell,
      ripple: options.textures.ripple,
      foam: options.textures.foam,
      green: 0,
      surf: 1,
      sink: true,
      edgeLo: 35,
      edgeHi: 95,
      midAt: 700,
      deepAt: 2_600,
      texAmp: 0.4,
      octaves,
      // THE SEA DOES NOT FLOW ANYWHERE. See waterLook's header: with a
      // zero flow attribute the second advected phase samples the same
      // point, so emitting it is four texture reads a fragment for a
      // value the first phase already has.
      advected: false,
    } as const;

    const farLook = makeWaterLook({ ...skin, hole: { lo: handLo, hi: handHi } });
    // THE FAR SHEET SINKS FURTHER, and never writes depth: it is the
    // sheet UNDERNEATH, and a transparent surface that writes depth
    // rejects the one in front of it.
    farLook.material.polygonOffsetFactor = 6;
    farLook.material.polygonOffsetUnits = 40;
    farLook.material.depthWrite = false;
    this.far = this.sheet(counts.far, farCellFor(counts.far, 0), farLook, 1);

    const nearLook = makeWaterLook({
      ...skin,
      // ONE RAMP. The swell flattens over exactly the band the sheet
      // fades out across, so a wave never survives its own sheet and the
      // flat annulus that used to sit between them is gone.
      swellRim: { rimLo: handLo, rimHi: handHi, alphaLo: handLo, alphaHi: handHi },
      eyeCentred: true,
    });
    this.near = this.sheet(counts.near, NEAR_CELL, nearLook, 2);
  }

  private sheet(n: number, cell: number, look: WaterLook, order: number): Sheet {
    const geometry = lattice(n, cell);
    const mesh = new THREE.Mesh(geometry, look.material);
    mesh.renderOrder = order;
    // Both sheets are centred on the camera, so their bounding spheres
    // always contain it: a frustum test could never reject them, and
    // skipping it is the cheaper honest answer. What the tier moves is
    // the vertex COUNT — see the header.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      mesh,
      look,
      depthAttr: (geometry.getAttribute('depth') as THREE.BufferAttribute).array as Float32Array,
      n,
      cell,
      recentre: recentreOf(n, cell),
      centre: null,
      filledAt: -1,
    };
  }

  /**
   * Point the sea at the camera. One call a frame.
   *
   * Re-anchors a sheet when the camera has walked far enough, and
   * refills its depths when the GROUND ITSELF has changed under it — a
   * streamed high-detail tile landing is exactly that, and without the
   * revision check the sea would keep colouring itself from coarse
   * bathymetry until the player happened to travel far enough to force a
   * re-anchor. The clipmap learned this the same way.
   */
  update(at: WorldPoint, reach = 0): void {
    const began = now();
    const revision = this.field.revision();
    this.resize(this.far, farCellFor(this.far.n, reach));
    // BOTH are asked, and the far one's answer is kept rather than
    // dropped: a resize clears its centre, so the frame a growing far
    // sheet re-spaces itself is also a frame it refills all n**2 of its
    // own depths, and a cost record that only watched the near sheet
    // would call that frame free.
    const farRefilled = this.anchor(this.far, at, revision);
    const nearRefilled = this.anchor(this.near, at, revision);
    if (farRefilled || nearRefilled) this.refills += 1;
    // EVERY FRAME, not only on a refill: both sheets measure the
    // crossfade from the CAMERA now, and the camera moves every frame
    // even when the geometry does not. Two uniform writes.
    //
    // They are given the same point for the reason they always shared
    // one — the near sheet's fade out and the far sheet's hole are exact
    // complements, and a hole around a different centre is a ring of
    // doubled water on one side and none on the other.
    this.near.look.setEye(at.wx, at.wz);
    this.far.look.setHole(at.wx, at.wz);
    if (nearRefilled) {
      const centre = this.near.centre as WorldPoint;
      // THE SEA IS DRAWN ON THIS LATTICE, so gameplay is sampled on it
      // too: the drawn surface is piecewise-bilinear between vertices
      // and the analytic curve is not, and floating on the curve while
      // the sheet is drawn on the chords is exactly why a queen "seems
      // too low in the wave". Only the near sheet carries the swell, so
      // only the near sheet's grid counts.
      const corner = translate(centre, -(this.near.n * this.near.cell) / 2, -(this.near.n * this.near.cell) / 2);
      this.swell.setLattice({ ox: corner.wx, oz: corner.wz, cell: this.near.cell });
    }
    this.spentMs += now() - began;
  }

  /**
   * Re-space a sheet's vertices, keeping their count.
   *
   * The lattice is a grid of offsets from the sheet's own centre, so a
   * new cell is a rewrite of the position attribute and nothing else —
   * no allocation, no new geometry, no new material and no recompile.
   * Clearing the centre is what makes `anchor` refill the depths at the
   * new spacing on the very same call.
   */
  private resize(sheet: Sheet, cell: number): void {
    if (cell === sheet.cell) return;
    sheet.cell = cell;
    sheet.recentre = recentreOf(sheet.n, cell);
    const span = sheet.n * cell;
    const position = sheet.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const xyz = position.array as Float32Array;
    for (let cy = 0; cy < sheet.n; cy += 1) {
      for (let cx = 0; cx < sheet.n; cx += 1) {
        const i = (cy * sheet.n + cx) * 3;
        xyz[i] = cx * cell - span / 2;
        xyz[i + 2] = cy * cell - span / 2;
      }
    }
    position.needsUpdate = true;
    // A sphere sized for the old span would cull nothing here (both
    // sheets are frustum-exempt) but would be a lie to anything that
    // later asks the geometry how big it is.
    sheet.mesh.geometry.computeBoundingSphere();
    sheet.centre = null;
  }

  /** @returns whether the sheet moved or refilled. */
  private anchor(sheet: Sheet, at: WorldPoint, revision: number): boolean {
    const centre = snapTo(at, sheet.recentre);
    const stale = sheet.filledAt !== revision;
    if (sheet.centre !== null && !stale && samePoint(sheet.centre, centre)) {
      this.seat(sheet);
      return false;
    }
    sheet.centre = centre;
    sheet.filledAt = revision;
    const span = sheet.n * sheet.cell;
    const corner = translate(centre, -span / 2, -span / 2);
    // The column under each vertex — SIGNED, and the sign is the
    // shoreline. Negative depth over land interpolates through zero
    // exactly where the ground crosses sea level; clamping it moved the
    // waterline a whole cell inland.
    //
    // No allocation per sample: one WorldPoint a ROW, and the row's own
    // x walked by hand. A near-sheet refill is 58,081 reads and doing it
    // through 58,081 fresh branded objects is how the terrain clipmap
    // first cost 14 ms a move.
    for (let cy = 0; cy < sheet.n; cy += 1) {
      const row = cy * sheet.n;
      const start = translate(corner, 0, cy * sheet.cell);
      for (let cx = 0; cx < sheet.n; cx += 1) {
        sheet.depthAttr[row + cx] = -this.field.heightAt(world(start.wx + cx * sheet.cell, start.wz));
      }
    }
    sheet.mesh.geometry.getAttribute('depth').needsUpdate = true;
    this.seat(sheet);
    return true;
  }

  /** Re-seat both sheets after an origin rebase. */
  place(): void {
    this.seat(this.far);
    this.seat(this.near);
  }

  /** Seat against the floating origin; keep the skin world-locked. */
  private seat(sheet: Sheet): void {
    const centre = sheet.centre;
    if (centre === null) return;
    const seat = toLocal(centre);
    sheet.mesh.position.set(seat.lx, 0, seat.lz);
    sheet.look.setCentre(centre.wx, centre.wz);
  }

  /**
   * Advance the sea.
   *
   * ONE CLOCK: the swell advances HERE and everyone — both sheets'
   * uniforms and every gameplay query — reads the same now. There is
   * exactly one `tick` call site and this is it.
   */
  tick(dt: number): void {
    const began = now();
    const t = this.swell.tick(dt);
    this.far.look.clock.value = t;
    this.near.look.clock.value = t;

    // THE FRAME ENDS HERE, because this is the one place in the build
    // that runs once a frame per ocean and is documented as such. A
    // frame in which the layer is switched off reaches neither `update`
    // nor `tick` and is counted by neither — right rather than
    // convenient: an ocean nobody draws costs nothing, and averaging
    // those frames in would report a cheaper sea than the one on screen.
    this.frames += 1;
    this.spentMs += now() - began;
    this.totalMs += this.spentMs;
    if (this.spentMs > this.peakMs) this.peakMs = this.spentMs;
    this.spentMs = 0;
  }

  /**
   * What this ocean has cost the CPU since the last `resetCost`.
   *
   * A SNAPSHOT, not a live view: a probe that reads it, drives forty
   * frames and reads it again must be comparing two fixed numbers, and
   * handing out the accumulator itself would have the first one change
   * under it.
   */
  get cost(): OceanCost {
    return Object.freeze({
      frames: this.frames,
      totalMs: this.totalMs,
      meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames,
      peakMs: this.peakMs,
      refills: this.refills,
      vertices: this.vertexCount,
    });
  }

  /**
   * Start a fresh measuring window.
   *
   * The partial frame is dropped rather than carried: `update` may
   * already have run when this is called, and adding its half to the
   * next window's first frame would put a stall in a window that did not
   * have one.
   */
  resetCost(): void {
    this.spentMs = 0;
    this.frames = 0;
    this.totalMs = 0;
    this.peakMs = 0;
    this.refills = 0;
  }

  /** How many vertices this ocean submits a frame. */
  get vertexCount(): number {
    return this.far.n * this.far.n + this.near.n * this.near.n;
  }

  /**
   * Everything this made. NOT the textures — they are shared and owned
   * by `SeaTextures`, which is the whole reason they are injected.
   *
   * The swell's lattice is cleared too: it points at a mesh that is
   * about to stop existing, and leaving it set would have the gameplay
   * query sampling chords of a sheet nobody is drawing.
   */
  dispose(): void {
    this.swell.clearLattice();
    for (const sheet of [this.far, this.near]) {
      this.group.remove(sheet.mesh);
      sheet.mesh.geometry.dispose();
      sheet.look.material.dispose();
    }
    this.group.removeFromParent();
  }
}

/**
 * A flat square lattice at y = 0, carrying the two attributes the look
 * reads: the water column under each vertex, and the current.
 */
function lattice(n: number, cell: number): THREE.BufferGeometry {
  const span = n * cell;
  const pos = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  for (let cy = 0; cy < n; cy += 1) {
    for (let cx = 0; cx < n; cx += 1) {
      const i = cy * n + cx;
      pos[i * 3] = cx * cell - span / 2;
      pos[i * 3 + 1] = 0; // sea level, forever
      pos[i * 3 + 2] = cy * cell - span / 2;
      normals[i * 3 + 1] = 1;
    }
  }
  const faces = new Uint32Array((n - 1) * (n - 1) * 6);
  let f = 0;
  for (let cy = 0; cy < n - 1; cy += 1) {
    for (let cx = 0; cx < n - 1; cx += 1) {
      const a = cy * n + cx;
      faces[f] = a; faces[f + 1] = a + n; faces[f + 2] = a + 1;
      faces[f + 3] = a + 1; faces[f + 4] = a + n; faces[f + 5] = a + n + 1;
      f += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('depth', new THREE.BufferAttribute(new Float32Array(n * n), 1));
  // The sea does not flow anywhere — the look's advection needs the
  // attribute to exist, and zero is the honest value for it. It is also
  // why the ocean compiles the one-phase ripple: see waterLook.
  geometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));
  return geometry;
}
