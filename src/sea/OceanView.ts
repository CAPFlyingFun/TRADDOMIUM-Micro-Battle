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
 * swell flattens toward its own rim and its alpha hands over to the far
 * sheet across the same band the far sheet's HOLE opens under it, so the
 * seam is flat-meets-flat and nobody double-draws the water.
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
 * The rim and handover radii are therefore FRACTIONS of the near
 * sheet's own half-span rather than the absolute numbers v0 used, so the
 * crossfade keeps its shape at every size. At high and above the
 * arithmetic reproduces v0's numbers exactly.
 * ─────────────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { samePoint, snapTo, translate, world, type WorldPoint } from '../world/coords';
import type { Heightfield } from '../world/heightfield';
import { toLocal } from '../world/origin';
import type { SeaSwell } from '../world/sea/swell';
import type { SeaTextures } from './SeaTextures';
import { makeWaterLook, type WaterLook } from './waterLook';
import type { TextureTier } from '../assets/textureQuality';

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
 * Where the rim flattening and the crossfade sit, as fractions of the
 * near sheet's half-span.
 *
 * v0's absolute numbers over v0's half-span of 8,435: rim 6,000..7,800
 * and handover 6,800..8,200. Expressed this way they scale with the
 * sheet instead of falling outside it when it shrinks.
 *
 * THE WAVE ZONE IS MOST OF THE SHEET, deliberately. v0's first cut
 * flattened everything past 34 m, so the water actually being looked at
 * — the middle distance — was the flat far sheet, and the whole ocean
 * read as glass no matter how tall the waves near her were.
 */
const RIM_LO_OF_SPAN = 6_000 / 8_435;
const RIM_HI_OF_SPAN = 7_800 / 8_435;
const HAND_LO_OF_SPAN = 6_800 / 8_435;
const HAND_HI_OF_SPAN = 8_200 / 8_435;

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
export const SHEET_VERTICES: Readonly<Record<TextureTier, { far: number; near: number }>> = Object.freeze({
  'ultra-low': Object.freeze({ far: 97, near: 121 }),
  low: Object.freeze({ far: 129, near: 161 }),
  medium: Object.freeze({ far: 193, near: 241 }),
  high: Object.freeze({ far: 257, near: 241 }),
  'ultra-high': Object.freeze({ far: 257, near: 241 }),
});

/** How many vertices this tier submits every frame, both sheets. For a HUD, and for a test. */
export function sheetVertexCount(tier: TextureTier): number {
  const { far, near } = SHEET_VERTICES[tier];
  return far * far + near * near;
}

/**
 * How many ripple octaves a tier runs. Four is the accepted look and
 * what medium and above use; the coarse octaves alone still read as
 * moving water on a screen that cannot resolve the fine ones.
 */
export const TIER_OCTAVES: Readonly<Record<TextureTier, number>> = Object.freeze({
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
  readonly tier: TextureTier;
}

export class OceanView {
  /** One group, so a layer toggle is one `visible` and never a walk. */
  readonly group = new THREE.Group();
  readonly tier: TextureTier;

  private readonly field: Heightfield;
  private readonly swell: SeaSwell;
  private readonly far: Sheet;
  private readonly near: Sheet;

  constructor(options: OceanViewOptions) {
    this.field = options.field;
    this.swell = options.swell;
    this.tier = options.tier;
    this.group.name = 'ocean';

    const counts = SHEET_VERTICES[options.tier];
    const octaves = TIER_OCTAVES[options.tier];
    const nearSpan = counts.near * NEAR_CELL;
    const handLo = nearSpan * HAND_LO_OF_SPAN;
    const handHi = nearSpan * HAND_HI_OF_SPAN;

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
      swellRim: {
        rimLo: nearSpan * RIM_LO_OF_SPAN,
        rimHi: nearSpan * RIM_HI_OF_SPAN,
        alphaLo: handLo,
        alphaHi: handHi,
      },
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
    const revision = this.field.revision();
    this.resize(this.far, farCellFor(this.far.n, reach));
    this.anchor(this.far, at, revision);
    if (this.anchor(this.near, at, revision)) {
      const centre = this.near.centre as WorldPoint;
      // The far sheet's hole follows the NEAR SHEET, not the camera:
      // they must share a centre or the crossfade bands part company.
      this.far.look.hole.value.set(centre.wx, centre.wz);
      // THE SEA IS DRAWN ON THIS LATTICE, so gameplay is sampled on it
      // too: the drawn surface is piecewise-bilinear between vertices
      // and the analytic curve is not, and floating on the curve while
      // the sheet is drawn on the chords is exactly why a queen "seems
      // too low in the wave". Only the near sheet carries the swell, so
      // only the near sheet's grid counts.
      const corner = translate(centre, -(this.near.n * this.near.cell) / 2, -(this.near.n * this.near.cell) / 2);
      this.swell.setLattice({ ox: corner.wx, oz: corner.wz, cell: this.near.cell });
    }
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
    sheet.look.centre.value.set(centre.wx, centre.wz);
  }

  /**
   * Advance the sea.
   *
   * ONE CLOCK: the swell advances HERE and everyone — both sheets'
   * uniforms and every gameplay query — reads the same now. There is
   * exactly one `tick` call site and this is it.
   */
  tick(dt: number): void {
    const t = this.swell.tick(dt);
    this.far.look.clock.value = t;
    this.near.look.clock.value = t;
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
