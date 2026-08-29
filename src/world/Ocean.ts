import * as THREE from 'three';
import { groundHeight } from './heightfield';
import { toLocal } from './origin';
import { world } from './coords';
import { makeWaterLook } from './waterLook';
import { clearSwellLattice, setSwellLattice, tickSwell } from './seaSwell';

/**
 * THE SEA'S SURFACE — two sheets wearing one look.
 *
 * The FAR sheet is the horizon's: 257 vertices at 32 m, flat at
 * y = 0, reaching 8 km out. At those distances the swell subtends
 * nothing, and the distance smear already owns the look out there.
 *
 * The NEAR sheet is hers: 129 vertices at 1.5 m, a 190 m window that
 * re-anchors as she moves, displaced every frame by the SWELL
 * (seaSwell.ts — the same table the gameplay query sums, baked into
 * the vertex shader as literals). Its swell flattens toward its own
 * rim and its alpha hands over to the far sheet across the same band
 * the far sheet's HOLE opens under it, so the seam is flat-meets-flat
 * and nobody double-draws the water.
 *
 * Sea LEVEL is still exactly 0 and the relief dial still cannot move
 * it; the swell is an excursion ABOUT zero that the shore fades away
 * (seaSwell's depth fade), so the feathered waterline keeps the beach
 * it fought for.
 *
 * BOTH wear waterLook (Beyond Extinction's ocean, ported constant for
 * constant) exactly as before — same colours, same foam, same alpha.
 * The lattice carries DEPTH per vertex (zero minus the drawn ground,
 * SIGNED — the v0.0.75 shoreline lesson) because everything the look
 * does is driven by the column under it.
 *
 * The sheets SINK in the depth buffer (positive polygon offset) so
 * near-coplanar shore terrain wins the tie — BE's flyover-shimmer
 * lesson.
 */

/** Far sheet: vertices a side, and 32 m between them. */
const N = 257;
const CELL = 3_200;
const RECENTRE = (N * CELL) / 8;

/**
 * Near sheet: 70 units between vertices, so the 4.2 m swell gets six
 * of them to a wavelength and arrives as a WAVE rather than as the
 * aliased suggestion of one. 241 a side covers 168 m around her —
 * enough that the moving water reaches the middle distance, which is
 * where the eye decides whether a sea is alive.
 */
const N2 = 241;
const CELL2 = 70;
const RECENTRE2 = (N2 * CELL2) / 8;

/**
 * Where the near sheet's swell flattens, sheet-local radius.
 *
 * THIS IS HOW FAR THE SEA MOVES. The first cut flattened everything
 * past 34 m, so the water she was actually looking AT — the middle
 * distance, out toward the horizon — was the flat far sheet, and the
 * whole ocean read as glass no matter how tall the waves near her
 * were. The wave zone now runs to sixty metres and hands over at
 * seventy-eight, which is about as far as centimetre-scale eyes have
 * any business resolving a wave anyway.
 */
const RIM_LO = 6_000;
const RIM_HI = 7_800;
/** Where near hands to far — near alpha out, far hole in. Inside the
 *  sheet's 8 435 half-span, so the fade finishes before the edge. */
const HAND_LO = 6_800;
const HAND_HI = 8_200;

interface Sheet {
  readonly mesh: THREE.Mesh;
  readonly depthAttr: Float32Array;
  readonly clock: { value: number };
  readonly centre: { value: THREE.Vector2 };
  readonly hole: { value: THREE.Vector2 };
  centreX: number;
  centreZ: number;
  placed: boolean;
}

function lattice(n: number, cell: number): THREE.BufferGeometry {
  const span = n * cell;
  const pos = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      pos[i * 3] = cx * cell - span / 2;
      pos[i * 3 + 1] = 0;                       // sea level, forever
      pos[i * 3 + 2] = cy * cell - span / 2;
      normals[i * 3 + 1] = 1;
    }
  }
  const faces = new Uint32Array((n - 1) * (n - 1) * 6);
  let f = 0;
  for (let cy = 0; cy < n - 1; cy++) {
    for (let cx = 0; cx < n - 1; cx++) {
      const a = cy * n + cx;
      faces[f++] = a; faces[f++] = a + n; faces[f++] = a + 1;
      faces[f++] = a + 1; faces[f++] = a + n; faces[f++] = a + n + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('depth', new THREE.BufferAttribute(new Float32Array(n * n), 1));
  // The sea does not flow anywhere — the look's advection needs the
  // attribute to exist, and zero is the honest value for it.
  geometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));
  return geometry;
}

export class Ocean {
  private readonly far: Sheet;
  private readonly near: Sheet;

  constructor(private readonly scene: THREE.Scene, anisotropy: number) {
    // A fresh mesh forgets the old lattice and NOTHING ELSE. Not the
    // wave table — which sea is running is the scene's decision and
    // this mesh only draws it — and, as of Stage F, not the clock
    // either: the water is rebuilt mid-transition when a new buoy
    // reading blends in, and restarting the clock there would jump the
    // phase of every wave in the ocean at once. Starting the sea over
    // belongs to whoever starts the SCENE over (IslandScene).
    clearSwellLattice();
    // edgeLo/edgeHi are the waterline Joshua approved — widening them
    // washed the beach out. The GRADUAL part he asked for lives
    // further out, in midAt/deepAt and the distance smear.
    const skin = {
      // THE SEA, said out loud. The breaker foam reads seaSwell's wave
      // table, which is the ocean's and nobody else's — see
      // waterLook's `ocean`.
      green: 0, surf: 1, sink: true, ocean: true,
      // edgeHi 130 -> 95: the sheet reaches its full body sooner, so
      // the water's edge READS as an edge (Joshua: "make the line a
      // little more defined") while edgeLo keeps the geometric cut
      // hidden 35 units under, which is what stopped it being a hard
      // line in the first place.
      edgeLo: 35, edgeHi: 95, midAt: 700, deepAt: 2600,
      texAmp: 0.40, anisotropy,
    } as const;
    // THE FAR SHEET SINKS FURTHER. Two transparent sheets sharing one
    // polygon offset fought for the depth buffer across the whole
    // crossfade band — Joshua: "I did see some Z-Fighting as well."
    // Pushing the horizon sheet deeper means the near sheet wins that
    // tie everywhere they overlap, and nothing flickers.
    const far = makeWaterLook({ ...skin, hole: { lo: HAND_LO, hi: HAND_HI } });
    far.material.polygonOffsetFactor = 6;
    far.material.polygonOffsetUnits = 40;
    // It never writes depth either: it is the sheet UNDERNEATH, and a
    // transparent surface that writes depth rejects the one in front.
    far.material.depthWrite = false;
    this.far = this.sheet(N, CELL, far, 1);
    const nearLook = makeWaterLook({
      ...skin,
      swell: { rimLo: RIM_LO, rimHi: RIM_HI, alphaLo: HAND_LO, alphaHi: HAND_HI },
    });
    this.near = this.sheet(N2, CELL2, nearLook, 2);
  }

  private sheet(
    n: number, cell: number,
    look: ReturnType<typeof makeWaterLook>, order: number,
  ): Sheet {
    const geometry = lattice(n, cell);
    const mesh = new THREE.Mesh(geometry, look.material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return {
      mesh,
      depthAttr: (geometry.getAttribute('depth') as THREE.BufferAttribute)
        .array as Float32Array,
      clock: look.clock,
      centre: look.centre,
      hole: look.hole,
      centreX: 0,
      centreZ: 0,
      placed: false,
    };
  }

  /** Re-anchor the sheets when she has moved far enough. */
  follow(at: { wx: number; wz: number }): void {
    this.anchor(this.far, N, CELL, RECENTRE, at);
    if (this.anchor(this.near, N2, CELL2, RECENTRE2, at)) {
      // The far sheet's hole follows the near sheet, not her — they
      // must share a centre or the crossfade bands part company.
      this.far.hole.value.set(this.near.centreX, this.near.centreZ);
    }
  }

  /** @returns whether the sheet moved (and refilled its depths). */
  private anchor(
    sheet: Sheet, n: number, cell: number, recentre: number,
    at: { wx: number; wz: number },
  ): boolean {
    if (sheet.placed
      && Math.abs(at.wx - sheet.centreX) < recentre
      && Math.abs(at.wz - sheet.centreZ) < recentre) {
      this.seat(sheet);
      return false;
    }
    sheet.centreX = Math.round(at.wx / cell) * cell;
    sheet.centreZ = Math.round(at.wz / cell) * cell;
    sheet.placed = true;
    const span = n * cell;
    const ox = sheet.centreX - span / 2;
    const oz = sheet.centreZ - span / 2;
    // The column under each vertex, once per re-anchor — SIGNED, and
    // the sign is the shoreline. Clamping land vertices to zero moved
    // the interpolated zero-crossing a whole cell inland of the true
    // waterline (v0.0.75); negative depth over land interpolates
    // through zero exactly where the ground crosses sea level.
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        sheet.depthAttr[cy * n + cx] = -groundHeight(ox + cx * cell, oz + cy * cell);
      }
    }
    sheet.mesh.geometry.getAttribute('depth').needsUpdate = true;
    // THE SEA IS DRAWN ON THIS LATTICE, so gameplay must be sampled on
    // it too — see seaSwell.setSwellLattice. Only the near sheet
    // carries the swell, so only the near sheet's grid counts.
    if (cell === CELL2) setSwellLattice(ox, oz, cell);
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
    const seat = toLocal(world(sheet.centreX, sheet.centreZ));
    sheet.mesh.position.set(seat.lx, 0, seat.lz);
    sheet.centre.value.set(sheet.centreX, sheet.centreZ);
  }

  update(dt: number): void {
    // ONE clock: the swell advances here and everyone — both sheets'
    // uniforms, the gameplay queries — reads the same now.
    const t = tickSwell(dt);
    this.far.clock.value = t;
    this.near.clock.value = t;
  }

  dispose(): void {
    for (const sheet of [this.far, this.near]) {
      this.scene.remove(sheet.mesh);
      sheet.mesh.geometry.dispose();
      (sheet.mesh.material as THREE.Material).dispose();
    }
  }
}
