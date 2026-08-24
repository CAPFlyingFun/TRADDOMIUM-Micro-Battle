import * as THREE from 'three';
import { toLocal } from './origin';
import { world } from './coords';
import { reliefScale, terrainHeight } from './heightfield';
import type { Hydro } from './hydro';
import { channelDepth, FLAT_BED, riverPointLevels } from './rivers';

/**
 * THE SURFACE OF EVERY RIVER — 1,121 ribbons of moving water.
 *
 * Beyond Extinction solved most of this the hard way and wrote it down,
 * so three of its decisions are ported deliberately:
 *
 *  CENTRIPETAL CATMULL-ROM over [x, y, z, width] as one four-channel
 *  spline — position and width interpolated together, so a reach that
 *  narrows into a bend narrows THROUGH the bend. Centripetal (α = ½)
 *  rather than uniform because uniform Catmull-Rom overshoots on the
 *  uneven spacing NHDPlus vertices actually have, and an overshooting
 *  river visits places the river does not go.
 *
 *  DIRECTION BY CENTRAL DIFFERENCE, no miter mathematics. The resample
 *  is fine enough that the perpendicular turns smoothly on its own.
 *
 *  NEGATIVE POLYGON OFFSET — the opposite sign to the lakes and the
 *  ocean, and BE's comment explains the trap: a river lies close over
 *  its own bed for its whole length, so pushing its fragments DEEPER
 *  (the sign that stops the sea shimmering against the reef shelf)
 *  lets the bed win the depth test and freckle through the surface.
 *  Rivers are lifted toward the camera instead.
 *
 * And one of its constraints does not apply and is not ported: BE split
 * every reach per streaming tile and needed ghost vertices to stitch
 * the seams. Our reaches are whole. Junctions where two reaches meet
 * are covered by the wider trunk rather than stitched.
 *
 * ELEVATIONS COME LEVELLED from rivers.ts — already forced monotonic
 * downstream — so the surface never porpoises uphill.
 *
 * FLOATING ORIGIN: geometry is built with x/z relative to the reach's
 * own centroid in float64 and seated with `toLocal` on every rebase.
 * The vertex Y is the ABSOLUTE water elevation (float32 is sub-unit
 * out to the summit's 155,000) so the relief dial can be applied as
 * `mesh.scale.y` — a sloped surface cannot take the dial as a single
 * position the way a flat lake can.
 */

/**
 * HOW FAR A RIVER IS WORTH DRAWING — the transition tier's reach, two
 * hundred metres, and it used to be two kilometres.
 *
 * MEASURED, after three releases of blaming the wrong thing. At the
 * fix Joshua sent, the ribbon sits within seven CENTIMETRES of the
 * ground along its whole length — it is not floating and it never was.
 * What it does is stretch two kilometres away at a grazing angle, and
 * a 6.7 m channel seen nearly edge-on for two kilometres paints a dark
 * stripe across the middle of the screen with a dead-straight near
 * edge. That edge is the "gap": you can see the ground under it,
 * because the channel it lies in is 66 cm deep and invisible at that
 * distance.
 *
 * There is no shader fix for that. A stream can only read as a stream
 * while the valley holding it is resolved, and past the transition
 * tier it is not — a vertex every 3,125 units cannot show a 66 cm
 * trench. So the ribbons stop where their channel stops being
 * visible. It is the same resolution gate the terrain tiers already
 * live by, applied to the water at last instead of argued with.
 */
const REACH = 20_000;

/** Where the ribbons start fading, so the cut is not a pop. */
const FADE_FROM = 13_000;
/** Resample target along the spline, world units. Six real metres. */
const STEP = 600;
/** The ribbon stops just short of the channel edge — see the alpha fade. */
const EDGE = 0.98;

/**
 * THE STREAMBED, and why a river needs one drawn for it.
 *
 * The last pass ended by naming the fault rather than fixing it: "the
 * trench has to be visible wherever the ribbon is, or the ribbon has
 * to stop sooner than the trench does". The ribbon was shortened to
 * the transition tier and it was still a flat band lying on a slope,
 * because 200 m is not the limit of the water — it is the limit of the
 * TERRAIN's ability to show a channel. A tier with a vertex every
 * 3,125 units cannot render a 550-unit-wide, 80-unit-deep trench at
 * any distance, near or far. Shortening the reach could never have
 * worked; it was chasing a distance problem that is a resolution one.
 *
 * So the channel gets drawn by the water, not by the ground. This is a
 * sheet three vertices wide — bank, thread, bank — laid on the SAME
 * carved field the walker reads (`terrainHeight`, which carries
 * `riverBed`), sampled every 600 units along instead of every 3,125.
 * The trench is in that field already and always was; nothing on
 * screen had the resolution to draw it.
 *
 * BEYOND EXTINCTION DID THIS TOO, and the difference in how is the
 * point. Its answer was to widen the carve until the render grid could
 * see it — a 96 m trench for a 6 m stream, which works when the camera
 * is a person and is absurd when it is an ant standing in the water.
 * We keep the true 5.5 m channel and give it its own geometry instead.
 * BE's numbers still apply, converted: a lift off the field so the
 * sheet beats the terrain mesh in a tie, and a hard cap under the
 * surface so it can never poke through the water it lies beneath.
 */
const BED_LIFT = 1.5;
/** ...but always this far under the surface, whatever the ground does. */
const BED_SINK = 1;

interface Drawn {
  readonly mesh: THREE.Mesh;
  readonly bed: THREE.Mesh | null;
  readonly cx: number;
  readonly cz: number;
}

/** Centripetal Catmull-Rom on one four-channel point row. */
function spline(
  points: Float64Array, out: number[],
): void {
  const rows = points.length / 4;
  if (rows < 2) return;
  const at = (i: number, c: number) => points[Math.max(0, Math.min(rows - 1, i)) * 4 + c];
  for (let i = 0; i < rows - 1; i++) {
    // Knots from PLANAR spacing, α = ½ — the centripetal family.
    const knot = (a: number, b: number) => Math.max(
      Math.hypot(at(b, 0) - at(a, 0), at(b, 2) - at(a, 2)), 1e-4,
    ) ** 0.5;
    const t0 = 0;
    const t1 = t0 + knot(i - 1, i);
    const t2 = t1 + knot(i, i + 1);
    const t3 = t2 + knot(i + 1, i + 2);
    const span = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 2) - at(i, 2));
    const steps = Math.max(1, Math.round(span / STEP));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      for (let c = 0; c < 4; c++) {
        // Barry–Goldman, one channel at a time.
        const p0 = at(i - 1, c);
        const p1 = at(i, c);
        const p2 = at(i + 1, c);
        const p3 = at(i + 2, c);
        const a1 = t1 - t0 > 0 ? p0 + ((p1 - p0) * (t - t0)) / (t1 - t0) : p1;
        const a2 = t2 - t1 > 0 ? p1 + ((p2 - p1) * (t - t1)) / (t2 - t1) : p2;
        const a3 = t3 - t2 > 0 ? p2 + ((p3 - p2) * (t - t2)) / (t3 - t2) : p3;
        const b1 = t2 - t0 > 0 ? a1 + ((a2 - a1) * (t - t0)) / (t2 - t0) : a2;
        const b2 = t3 - t1 > 0 ? a2 + ((a3 - a2) * (t - t1)) / (t3 - t1) : a3;
        out.push(t2 - t1 > 0 ? b1 + ((b2 - b1) * (t - t1)) / (t2 - t1) : b1);
      }
    }
  }
}

/**
 * One reach as a triangle strip, positions relative to (cx, 0, cz).
 *
 * Water level must stay monotonic AFTER the spline too: Catmull-Rom
 * can locally overshoot in Y where the drop is uneven, and an
 * overshoot on a river profile is a ripple of uphill water. Clamped
 * along the resampled row.
 */
export function channelRows(stations: Float64Array): number[] | null {
  const smooth: number[] = [];
  spline(stations, smooth);
  const rows = smooth.length / 4;
  if (rows < 2) return null;

  // Re-impose the levelling the spline may have bent.
  const downhill = smooth[1] >= smooth[(rows - 1) * 4 + 1];
  if (downhill) {
    for (let i = 1; i < rows; i++) {
      if (smooth[i * 4 + 1] > smooth[(i - 1) * 4 + 1]) {
        smooth[i * 4 + 1] = smooth[(i - 1) * 4 + 1];
      }
    }
  } else {
    for (let i = rows - 2; i >= 0; i--) {
      if (smooth[i * 4 + 1] > smooth[(i + 1) * 4 + 1]) {
        smooth[i * 4 + 1] = smooth[(i + 1) * 4 + 1];
      }
    }
  }
  return smooth;
}

/**
 * The cross-channel axis at row `i`, by central difference.
 *
 * Shared so the bed and the surface cannot disagree about which way is
 * across: a bed half a degree out of step with the water it lies under
 * shows as one bank submerged and the other dry.
 */
function acrossAt(smooth: number[], rows: number, i: number): [number, number] {
  const back = Math.max(0, i - 1);
  const fore = Math.min(rows - 1, i + 1);
  let dx = smooth[fore * 4] - smooth[back * 4];
  let dz = smooth[fore * 4 + 2] - smooth[back * 4 + 2];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return [1, 0];
  dx /= run;
  dz /= run;
  return [dx, dz];
}

export function buildReach(
  stations: Float64Array, cx: number, cz: number,
): THREE.BufferGeometry | null {
  const smooth = channelRows(stations);
  if (!smooth) return null;
  const rows = smooth.length / 4;

  const positions = new Float32Array(rows * 2 * 3);
  const deep = new Float32Array(rows * 2);
  const uvs = new Float32Array(rows * 2 * 2);
  let along = 0;
  for (let i = 0; i < rows; i++) {
    const x = smooth[i * 4];
    const y = smooth[i * 4 + 1];
    const z = smooth[i * 4 + 2];
    const width = smooth[i * 4 + 3];
    const [dx, dz] = acrossAt(smooth, rows, i);
    const half = (width / 2) * EDGE;
    if (i > 0) {
      along += Math.hypot(x - smooth[(i - 1) * 4], z - smooth[(i - 1) * 4 + 2]);
    }
    for (const side of [-1, 1]) {
      const v = i * 2 + (side + 1) / 2;
      positions[v * 3] = x - cx + -dz * half * side;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z - cz + dx * half * side;
      // The CENTRE depth of the channel here. The strip has no centre
      // vertex — two per station — so the cross-channel shaping is the
      // fragment shader's job: it scales this by a profile of v, which
      // is exactly the carve's own shape seen from above.
      deep[v] = channelDepth(width);
      // u runs downstream in arc length, v across. The shader scrolls u.
      uvs[v * 2] = along / 800;
      uvs[v * 2 + 1] = (side + 1) / 2;
    }
  }

  const faces: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 2;
    faces.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(faces);
  // FLAT +Y NORMALS, written rather than computed — another ported BE
  // lesson: computeVertexNormals on a long thin strip shades each quad
  // facet visibly through the transparent water, and a river's real
  // slope is metres over kilometres, which is flat to any eye.
  const normals = new Float32Array(rows * 2 * 3);
  for (let v = 0; v < rows * 2; v++) normals[v * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/**
 * The streambed under one reach — bank, thread, bank.
 *
 * THREE VERTICES ACROSS, not two, and that is the whole shape of it: a
 * two-vertex strip can only ever be a flat plane between its banks,
 * which is what the surface already is. The middle vertex is the
 * thread of the channel, and dropping it to the carved bed is what
 * turns a painted band into water with something under it.
 *
 * SAMPLED, NOT ASSUMED. The Y comes from `terrainHeight` — the same
 * pure field the walker, the camera and the tests read — so the bed a
 * player sees is the bed she swims in, and a change to the carve moves
 * both together or neither. Capped under the surface so it can never
 * pierce the water, and lifted off the field so it wins the tie
 * against whatever the terrain tier happens to have drawn there.
 *
 * The edges use the SAME half-width as the surface, so the bed meets
 * the water exactly at the waterline and the ribbon gains a real edge
 * instead of a polygon boundary cut against open ground.
 */
export function buildStreambed(
  stations: Float64Array, cx: number, cz: number,
): THREE.BufferGeometry | null {
  const smooth = channelRows(stations);
  if (!smooth) return null;
  const rows = smooth.length / 4;

  const positions = new Float32Array(rows * 3 * 3);
  const normals = new Float32Array(rows * 3 * 3);
  for (let i = 0; i < rows; i++) {
    const x = smooth[i * 4];
    const level = smooth[i * 4 + 1];
    const z = smooth[i * 4 + 2];
    const width = smooth[i * 4 + 3];
    const [dx, dz] = acrossAt(smooth, rows, i);
    const half = (width / 2) * EDGE;
    const deep = channelDepth(width);
    for (let k = 0; k < 3; k++) {
      // k = 0 left bank, 1 the thread, 2 right bank.
      const side = k - 1;
      const wx = x + -dz * half * side;
      const wz = z + dx * half * side;
      // THE PROFILE THE CARVE ITSELF CUTS, read at this vertex's own
      // offset — flat-bottomed out to FLAT_BED, then a smoothstep wall
      // up to the rim. Not a second opinion about the channel's shape:
      // the same arithmetic as rivers.ts, so the drawn bed and the
      // carved one cannot drift apart.
      const across = k === 1 ? 0 : EDGE;
      const wall = Math.max(0, (across - FLAT_BED) / (1 - FLAT_BED));
      const eased = wall * wall * (3 - 2 * wall);
      const sink = Math.max(deep * (1 - eased), BED_SINK);
      // THE DEEPER OF THE TWO, and this is the correction the test
      // caught. Sampling the ground ALONE looks right and fails
      // silently: where the carve is muted — a tier reading it with
      // slack, a reach the footprint could not reach — the sample
      // comes back at or above the waterline, the cap flattens it, and
      // the bed is a flat sheet a centimetre under a flat surface,
      // which is the painted band this set out to remove. The profile
      // is the floor under that failure: a channel is drawn wherever a
      // ribbon is, and real ground deeper than the profile still wins.
      const v = i * 3 + k;
      positions[v * 3] = wx - cx;
      positions[v * 3 + 1] = Math.min(terrainHeight(wx, wz) + BED_LIFT, level - sink);
      positions[v * 3 + 2] = wz - cz;
      normals[v * 3 + 1] = 1;
    }
  }

  const faces: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 3;
    const b = a + 3;
    // Two quads per station pair — left half, then right half.
    faces.push(a, b, a + 1, a + 1, b, b + 1);
    faces.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(faces);
  return geometry;
}

export class RiverWater {
  private readonly drawn = new Map<number, Drawn>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bedMaterial: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private readonly rippleMap: { value: THREE.Texture };
  private seconds = 0;
  private lastCell = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hydro: Hydro,
  ) {
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.rippleMap = { value: flat };
    this.material = this.build();
    this.bedMaterial = this.buildBed();
  }

  wear(texture: THREE.Texture): void {
    this.rippleMap.value = texture;
  }

  /** Bring the nearby reaches into being and let the far ones go. */
  follow(at: { wx: number; wz: number }): void {
    // Re-decide only when she has crossed into a new decision cell —
    // the wanted-set walk over 1,121 reaches is not free.
    const cell = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (cell === this.lastCell) {
      // STILL RE-SEAT. The early return skips the 1,121-reach walk,
      // not the origin: a putAt teleport inside one decision cell still
      // moves the floating origin, and ribbons seated against the old
      // one drew the Wainiha sixty metres off its own trench. The
      // review caught it; LakeWater never had the bug only because its
      // follow() ends in place() unconditionally.
      this.place();
      return;
    }
    this.lastCell = cell;

    const levels = riverPointLevels();
    if (!levels) return;
    const wanted = new Set<number>();
    for (let r = 0; r < this.hydro.rivers.length; r++) {
      const river = this.hydro.rivers[r];
      // Near enough if any point's box distance is inside the reach.
      for (let i = 0; i < river.count; i += 4) {
        const p = river.first + i;
        if (Math.abs(this.hydro.x[p] - at.wx) < REACH
          && Math.abs(this.hydro.z[p] - at.wz) < REACH) {
          wanted.add(r);
          break;
        }
      }
    }

    for (const [index, reach] of this.drawn) {
      if (wanted.has(index)) continue;
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
      if (reach.bed) {
        this.scene.remove(reach.bed);
        reach.bed.geometry.dispose();
      }
      this.drawn.delete(index);
    }
    for (const index of wanted) {
      if (this.drawn.has(index)) continue;
      const river = this.hydro.rivers[index];
      const stations = new Float64Array(river.count * 4);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < river.count; i++) {
        const p = river.first + i;
        stations[i * 4] = this.hydro.x[p];
        stations[i * 4 + 1] = levels[p];
        stations[i * 4 + 2] = this.hydro.z[p];
        stations[i * 4 + 3] = this.hydro.width[p];
        cx += this.hydro.x[p];
        cz += this.hydro.z[p];
      }
      cx /= river.count;
      cz /= river.count;
      const geometry = buildReach(stations, cx, cz);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      // The bed BEFORE the surface: both are transparent, and three
      // sorts transparent draws by renderOrder first, so this is what
      // says the water goes over its own bed rather than under it.
      mesh.renderOrder = 1;
      mesh.visible = this.shownAll;
      this.scene.add(mesh);
      const bedGeometry = buildStreambed(stations, cx, cz);
      let bed: THREE.Mesh | null = null;
      if (bedGeometry) {
        bed = new THREE.Mesh(bedGeometry, this.bedMaterial);
        bed.renderOrder = 0;
        bed.visible = this.shownAll && this.shownBed;
        this.scene.add(bed);
      }
      this.drawn.set(index, { mesh, bed, cx, cz });
    }
    this.place();
  }

  /** Re-seat against the origin and the relief dial. */
  place(): void {
    const relief = reliefScale();
    for (const reach of this.drawn.values()) {
      const seat = toLocal(world(reach.cx, reach.cz));
      reach.mesh.position.set(seat.lx, 0, seat.lz);
      // The dial, as a scale: vertex Y is absolute water elevation.
      reach.mesh.scale.y = relief;
      // The bed is built in the same frame off the same field, so it
      // takes the same seat and the same dial — anything else and the
      // water would slide off its own channel on the relief slider.
      if (reach.bed) {
        reach.bed.position.set(seat.lx, 0, seat.lz);
        reach.bed.scale.y = relief;
      }
    }
  }

  update(dt: number): void {
    this.seconds += dt;
    this.clock.value = this.seconds;
  }

  get shown(): number {
    return this.drawn.size;
  }

  /** Hide or show every surface this owns — see __island.showWater. */
  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const it of this.drawn.values()) {
      it.mesh.visible = on;
      if (it.bed) it.bed.visible = on && this.shownBed;
    }
  }

  /** Remembered, so surfaces built after the toggle honour it too. */
  private shownAll = true;

  /** The bed alone — a measurement hook, see __island.showWater. */
  setBedVisible(on: boolean): void {
    this.shownBed = on;
    for (const it of this.drawn.values()) if (it.bed) it.bed.visible = on;
  }

  private shownBed = true;

  dispose(): void {
    for (const reach of this.drawn.values()) {
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
      if (reach.bed) {
        this.scene.remove(reach.bed);
        reach.bed.geometry.dispose();
      }
    }
    this.drawn.clear();
    this.material.dispose();
    this.bedMaterial.dispose();
  }

  /**
   * What the bed is made of.
   *
   * NO TEXTURE, DELIBERATELY. The band maps tile every 4 units, which
   * is 4 cm and right for ground under her feet; a bed running two
   * hundred metres out repeats them fifty thousand times and turns to
   * moire long before it turns to gravel. The terrain carries a
   * distance fade to survive that. Rather than a second copy of it,
   * the bed makes its own grain from position — two octaves of value
   * noise at gravel and sand scale, which cannot alias into a grid
   * because it never was one.
   *
   * IN THE REACH'S OWN FRAME, not the world's. Local position is
   * float32-safe at this scale where world position is not, and the
   * bed does not move relative to its own centroid, so the grain stays
   * glued to the gravel it is drawn on when the origin shifts.
   *
   * IT FADES ON THE SAME CURVE AS THE WATER. Anything else and the
   * ribbon would dissolve at 130 m over a streambed that did not,
   * leaving a bare trench painted on a hillside — a worse artefact
   * than the one this set out to fix.
   */
  private buildBed(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      // DARKER THAN THE BANK IT RUNS UNDER, and that is the whole
      // colour brief. The water is nearly clear at its margins — the
      // surface alpha falls off toward the banks by design, so the
      // shallows show what they are lying on — which means a bed mixed
      // to dry-sand brightness comes through the margin unfiltered and
      // reads as a towpath beside the river rather than as the bottom
      // of it. Wet ground is darker than the same ground dry; mixed
      // that way it reads as submerged, which is what it is.
      color: 0x4a4133,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      side: THREE.DoubleSide,
      // Sunk, the opposite of the surface above it: where the bed runs
      // out to the bank it IS the terrain, and there the terrain
      // should win rather than flicker against a duplicate of itself.
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 4,
    });

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vBed;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vBed = position;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vBed;
          float bedHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float bedNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(bedHash(i), bedHash(i + vec2(1.0, 0.0)), u.x),
              mix(bedHash(i + vec2(0.0, 1.0)), bedHash(i + vec2(1.0, 1.0)), u.x),
              u.y);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // Stones, then the sand between them. 30 units is a
            // pebble at her scale; 8 is grit.
            float grain = bedNoise(vBed.xz / 30.0) * 0.65
              + bedNoise(vBed.xz / 8.0) * 0.35;
            diffuseColor.rgb *= mix(0.80, 1.16, grain);
            // Out on the same curve as the surface above it.
            diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM}.0, ${REACH}.0, length(vViewPosition));
            if (diffuseColor.a < 0.02) discard;
          }`);
    };

    return material;
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2e6b64,
      roughness: 0.24,
      metalness: 0.06,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      // LIFTED, not sunk — see the class comment. The opposite sign to
      // the ocean and the lakes, and it is BE's lesson, not a typo.
      //
      // CONSTANT, THOUGH, NOT SLOPE-SCALED, and that part WAS a bug.
      // GL's offset is `factor x depthSlope + units x epsilon`, and the
      // depth slope of a ribbon seen nearly edge-on is enormous — so a
      // factor of -2 stopped being a tie-break and became a licence to
      // draw over whatever was in front. With the trench missing from
      // every tier past the streamed cells (see farHeight), half the
      // drainage was buried in hillside and this floated it back out as
      // a pale sheet you could fly through. The tier fix removes the
      // burial; dropping the factor removes the licence. What is left
      // is what was actually wanted: a constant nudge, enough to break
      // the tie where the surface meets its own bank and the bed and
      // the water really are coplanar.
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -8,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.clock;
      shader.uniforms.uRipple = this.rippleMap;
      shader.uniforms.uSky = { value: new THREE.Color(0xa8cfe2).convertSRGBToLinear() };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float deep;
          varying float vDeep;
          varying vec2 vFlow;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vFlow = uv;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vDeep = deep;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vDeep;
          varying vec2 vFlow;
          uniform sampler2D uRipple;
          uniform float uTime;
          uniform vec3 uSky;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // The ripple scrolls DOWNSTREAM: u is arc length along the
            // reach, so -u drift is water going the way the river goes,
            // every reach, with no per-reach direction anywhere. Two
            // octaves, offset rates, so the repeat never reads.
            vec3 chop = (texture2D(uRipple, vFlow * vec2(1.0, 0.6) - vec2(uTime * 0.11, 0.0)).xyz - 0.5)
              + (texture2D(uRipple, vFlow * vec2(2.3, 1.4) - vec2(uTime * 0.19, 0.02)).xyz - 0.5) * 0.6;
            normal = normalize(normal + vec3(chop.x, 0.0, chop.y) * 0.35);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // ACROSS the channel: deep tint midstream, glass at the
            // banks. v runs 0..1 bank to bank.
            float mid = 1.0 - abs(vFlow.y * 2.0 - 1.0);
            float body = vDeep * (0.35 + 0.65 * mid);
            // CALIBRATED TO A STREAM, not to an ocean, and this is why
            // the rivers read as blue ribbon laid on the ground.
            //
            // channelDepth gives a median Kauai reach 80 units — eighty
            // CENTIMETRES. Against a ramp that saturated at 120 that is
            // 79% of the way to the deep tint, so every stream on the
            // island was painted the colour of open sea: one flat dark
            // navy band, no shading across it, no bed showing through.
            // A knee-deep stream over sand is bright, not black.
            //
            // Ramped over 20 to 600 instead, so 80 sits near the
            // shallow end where it belongs and only a real pool goes
            // dark. Squared the other way round too: shallow is now the
            // default and depth has to be earned.
            float shallow = 1.0 - smoothstep(20.0, 600.0, body);
            diffuseColor.rgb = mix(
              vec3(0.020, 0.16, 0.22), vec3(0.26, 0.46, 0.42),
              shallow * shallow);

            // THE WATERLINE, which is the thing that was missing.
            //
            // Reported from the device: "the water's edge and even the
            // water is hard to see, it looks clear". It did, and this
            // line is why — the alpha ramped from nothing at the bank
            // to full only halfway across, so the outer HALF of every
            // channel was glass laid over sand. On a 5.5 m river that
            // is a metre and a half of invisible water either side,
            // and no edge at all to see.
            //
            // The fade was there to hide the polygon boundary against
            // ground that had no trench in it. It has a trench now
            // (see farHeight), so the edge can be an edge.
            // SHALLOW WATER IS SEE-THROUGH. Holding a stream at 90%
            // opaque hid the bed under it, which is most of what makes
            // shallow water look like water rather than like paint.
            diffuseColor.a *= (smoothstep(0.0, 0.16, mid) * 0.45 + 0.55)
              * mix(0.55, 1.0, 1.0 - shallow);
            // AND OUT WITH DISTANCE. vViewPosition is the fragment's
            // offset from the eye, so its length is how far away this
            // piece of river is — no uniform, no per-frame upload.
            diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM}.0, ${REACH}.0, length(vViewPosition));

            // And a bright rim ON the boundary. At her scale this is
            // not decoration: a meniscus a millimetre wide is a body
            // length of curved, sky-catching water, and it is the
            // single most legible thing about a puddle from an ant's
            // eye. A proper surface-tension model is still owed; this
            // is the read it would give.
            float rim = 1.0 - smoothstep(0.0, 0.10, mid);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.56, 0.55), rim * 0.8);
            diffuseColor.a = clamp(diffuseColor.a + rim * 0.35, 0.0, 1.0);
            if (diffuseColor.a < 0.02) discard;
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float face = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, pow(1.0 - face, 5.0) * 0.45);
          }`);
    };

    return material;
  }
}
