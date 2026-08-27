import * as THREE from 'three';
import { groundHeight } from './heightfield';
import { toLocal } from './origin';
import { world } from './coords';
import { makeWaterLook } from './waterLook';

/**
 * THE SEA'S SURFACE — the first this build has ever drawn.
 *
 * Until now the ocean was PAINT: terrain below zero wears the seabed
 * and reef bands and there was no water over it at all, which is why
 * the coast read as a tide gone out forever. This is the missing
 * sheet, and it deliberately owns nothing else: no swell, no tide, no
 * simulation. Sea level on this island is exactly 0 and stays there —
 * the relief dial scales the LAND, and zero times anything is the one
 * height the dial cannot move.
 *
 * IT WEARS THE SAME LOOK AS EVERY OTHER WATER (waterLook.ts — Beyond
 * Extinction's ocean, ported constant for constant), straight, where
 * the inland water wears it green-shifted. Joshua: "make sure our
 * ocean and waters look the same... just inland a slight bit of a
 * greenish tint." One shader; they cannot drift apart.
 *
 * A LATTICE, NOT A PLANE, because the look is driven by DEPTH and a
 * flat plane knows none. Each vertex carries the water column under it
 * (zero minus the drawn ground), which is what shapes the turquoise
 * shelf, the surf at the waterline, and the alpha that lets the reef
 * show through the shallows — the exact mechanics BE's coast mask fed
 * its shader, sourced here from the heightfield instead of a bake.
 *
 * The sheet SINKS in the depth buffer (positive polygon offset) so
 * near-coplanar shore terrain wins the tie — BE's flyover-shimmer
 * lesson, and this repo's own v0.0.78 one before that.
 */

/** Vertices a side. */
const N = 257;
/** World units between them — 32 m. The shoreline resolves no finer. */
const CELL = 3_200;
/** Re-anchor once the player is this far from the sheet's centre. */
const RECENTRE = (N * CELL) / 8;

export class Ocean {
  private readonly mesh: THREE.Mesh;
  private readonly depthAttr: Float32Array;
  private readonly clock: { value: number };
  private readonly centre: { value: THREE.Vector2 };
  private centreX = 0;
  private centreZ = 0;
  private placed = false;

  constructor(private readonly scene: THREE.Scene, anisotropy: number) {
    const span = N * CELL;
    const pos = new Float32Array(N * N * 3);
    const normals = new Float32Array(N * N * 3);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        const i = cy * N + cx;
        pos[i * 3] = cx * CELL - span / 2;
        pos[i * 3 + 1] = 0;                       // sea level, forever
        pos[i * 3 + 2] = cy * CELL - span / 2;
        normals[i * 3 + 1] = 1;
      }
    }
    const faces = new Uint32Array((N - 1) * (N - 1) * 6);
    let f = 0;
    for (let cy = 0; cy < N - 1; cy++) {
      for (let cx = 0; cx < N - 1; cx++) {
        const a = cy * N + cx;
        faces[f++] = a; faces[f++] = a + N; faces[f++] = a + 1;
        faces[f++] = a + 1; faces[f++] = a + N; faces[f++] = a + N + 1;
      }
    }
    this.depthAttr = new Float32Array(N * N);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(this.depthAttr, 1));
    // The sea does not flow anywhere — the look's advection needs the
    // attribute to exist, and zero is the honest value for it.
    geometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(N * N * 2), 2));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));
    const look = makeWaterLook({ green: 0, surf: 1, sink: true, edgeLo: 35, edgeHi: 300, midAt: 700, deepAt: 2600, texAmp: 0.40, anisotropy });
    this.clock = look.clock;
    this.centre = look.centre;
    this.mesh = new THREE.Mesh(geometry, look.material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Re-anchor the sheet when she has walked far enough. */
  follow(at: { wx: number; wz: number }): void {
    if (this.placed
      && Math.abs(at.wx - this.centreX) < RECENTRE
      && Math.abs(at.wz - this.centreZ) < RECENTRE) {
      this.place();
      return;
    }
    this.centreX = Math.round(at.wx / CELL) * CELL;
    this.centreZ = Math.round(at.wz / CELL) * CELL;
    this.placed = true;
    const span = N * CELL;
    const ox = this.centreX - span / 2;
    const oz = this.centreZ - span / 2;
    // The column under each vertex, once per re-anchor — SIGNED, and
    // the sign is the shoreline. Clamping land vertices to zero moved
    // the interpolated zero-crossing a whole 32 m cell inland of the
    // true waterline, so the fade band sat in the wrong place and the
    // geometric cut showed through it as a hard line. Negative depth
    // over land interpolates through zero exactly where the ground
    // crosses sea level, sub-cell, which is where the fade must live.
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        this.depthAttr[cy * N + cx] = -groundHeight(ox + cx * CELL, oz + cy * CELL);
      }
    }
    this.mesh.geometry.getAttribute('depth').needsUpdate = true;
    this.place();
  }

  /** Seat against the floating origin; keep the skin world-locked. */
  place(): void {
    const seat = toLocal(world(this.centreX, this.centreZ));
    this.mesh.position.set(seat.lx, 0, seat.lz);
    this.centre.value.set(this.centreX, this.centreZ);
  }

  update(dt: number): void {
    this.clock.value += dt;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
