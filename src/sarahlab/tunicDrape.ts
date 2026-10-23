/**
 * THE SHIRT'S DRAPE BELOW HER WAIST (Joshua, 2026-10-22, drawn on her front and side: "add a smoothening effect like the
 * bust around the crotch area at the legs and seam bottom that extends to the belly... add the smoothing in the back to
 * do the same", with the shirt's length adjustable "from knee-length up to just above the crotch").
 *
 * Paint lies on her skin, so a painted shirt follows her into every hollow: up between her thighs, into the creases of
 * her groin, under her belly and under her seat. Real fabric spans them. The drape is that span, the way the cleavage
 * bridge (`cleavageBridge.ts`) is at her bust: a sheet in the shirt's fabric, from her waist down to the hem, that shows
 * only where it stands off her skin. Where it lies on her, it fades out and the paint is the shirt.
 *
 * Its shape, in level slices from her waist down to the hem, round an upright axis through her:
 * - In each slice, the outline that a band pulled round her would take: the convex outline of her trunk and both thighs
 *   (never her arms). It spans the gap between her thighs, front and back, and lies flat over her groin.
 * - Down from slice to slice, fabric falls: it cannot come back in toward her faster than DRAPE_SLOPE for each step
 *   down. Under her seat it falls from her seat to the backs of her thighs. In front it hangs from her belly nearly
 *   straight down (FRONT_SLOPE), open underneath, as a tee does over a bump.
 * - The hem is a band all the way round, as one line across both legs.
 *
 * It is fitted to her as she stands NOW -- her pose (a pregnant stance leans her spine back, more with a bigger bump)
 * and her belly's resting sag -- so the fabric falls straight down in her pose and nothing of her pokes through it.
 * Then it is carried back to her bind pose through its own bones, so skinning lays it exactly there again and it
 * moves with her on the graphics card like her own skin: each point takes its bones' weights from the skin it lies on,
 * and across a span, smoothly from the skin at either side of it (so between her legs it stretches as they move). Her
 * belly's motion (its bounce and sway away from rest) is carried over the same way. It is rebuilt when her shape or
 * pose changes (a slider, STAND / SIT), at most every REBUILD_MS.
 */
import * as THREE from 'three';
import { BODY_REGIONS, type BodyMap } from './bodyRegions';

/** The sheet's top, on her trunk (0 her hip joints, 1 the base of her neck): above her belly's fullest point. */
const T_TOP = 0.45;
/** Rows are about this far apart, as a share of her trunk (about 6 mm on her). */
const ROW_STEP = 0.01;
/** Points round her. */
const COLUMNS = 80;
/** The outline is smoothed over this many rows either side (and a column either side). */
const SMOOTH_ROWS = 3;
/** How far inside her raw outline the smoothed one may dip (a share of her trunk: about 1.2 mm, under the lift). */
const SKIN_SLACK = 0.002;
/** How fast fabric may come back in toward her going down: this much in for each unit down. */
const DRAPE_SLOPE = 0.8;
/** Where it has faded out it lies this far under her skin (a share of her trunk), hidden by the depth test. */
const LIFT = 0.002;
/** It starts to show where it stands this far off her skin (a share of her trunk: about 4 mm; shallower hollows, like
 * where a big belly meets her flank, stay paint), fully at twice that, and fades into her over this many points round
 * her and rows down, on the skin it lies on. */
const SHOW_FROM = 0.007, FEATHER_CELLS = 4;
/** A direction with no skin in it, up to this many columns wide, is skin if the skin either side is closer together than
 * this (a share of her trunk, about 2 cm). */
const FILL_COLUMNS = 6, FILL_GAP = 0.035;
/** How far off her counts, smoothed over this many passes; anything past GAP_CAP (a share of her trunk) is simply off. */
const GAP_PASSES = 10, GAP_CAP = 0.03;
/** Passes spreading its shading, and how much it is lit as facing straight out from her (0 none, 1 as much again). */
const NORMAL_PASSES = 4, FACE_OUT = 0.7;
/** The hem band: solid this far up from the hem, faded out by twice that (the paint's own edge rises through it). */
const HEM_BAND = 0.035;
/** How far it lifts off her where it shows fully (a share of her trunk: about 5 mm on her). Not where it is still fading
 * in, so a half-seen edge never stands out over the background at her outline. */
const STAND_OFF = 0.008;
/** How far (trunk heights) the drape must hang clear of her skin before the skin under it loses the shirt's paint; fully by twice that. */
const HANG_FROM = 0.012;
/**
 * IN FRONT, UNDER HER BELLY, THE SHIRT HANGS (Joshua, 2026-10-23: from below, "the leggings under the belly should
 * win", and then, of a hem cut off on her belly: "the shirt still needs to be in front of the leggings... as there is
 * a sharp edge"). A tee falls from the fullest point of a bump nearly straight down, in front of it, and is open
 * underneath -- seen from the front it covers her, seen from below the leggings on her bump show under its hem. So in
 * front the fabric comes back in toward her at only FRONT_SLOPE for each step down, not DRAPE_SLOPE; at her sides and
 * back it still falls to her hips, thighs and seat. How much a direction is her front is her own skin's measure of it
 * (`around`: 0.5 her sides, 1 her front's middle), FRONT_FROM to FRONT_FROM + FRONT_OVER.
 */
const FRONT_SLOPE = 0.12, FRONT_FROM = 0.62, FRONT_OVER = 0.13;
/** Where it shows fully, it stands at least this far (a share of her trunk, about 1.5 mm on her) out from her skin, so it is drawn in front of whatever her skin wears (the leggings at its hem) and never fights it. */
const SOLID_LIFT = 0.003;
/** Her skin this far above the top and below the lowest hem (a share of her trunk) is measured too: she stands leaning,
 * so her skin is not at its rest height. */
const POSE_MARGIN = 0.1;
/** The top fades in over this much of her trunk. */
const TOP_FADE = 0.04;
/** Her skin round each point that lends it its weights. */
const NEAREST = 4;
/** Smoothing passes for the weights across a span. */
const PASSES = 120;
/** Rebuilt at most this often while her shape is changing. */
const REBUILD_MS = 200;
/** Her belly's motion shapes, carried over to the drape. */
export const DRAPE_MOTION_TARGETS = Object.freeze(['bellyTilt', 'bellyBob', 'bellySway']);
/** Never part of the outline: her arms and hands (handled by `arm`), head, neck and feet. */
const LEFT_OUT = new Set(['face', 'scalp', 'neck', 'handL', 'handR', 'footL', 'footR']);

const smooth01 = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** The convex outline of points (x, z), counter-clockwise (Andrew's monotone chain). */
function hull2(xs: Float64Array, zs: Float64Array, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b] || zs[a] - zs[b]);
  const cross = (o: number, a: number, b: number) => (xs[a] - xs[o]) * (zs[b] - zs[o]) - (zs[a] - zs[o]) * (xs[b] - xs[o]);
  const lower: number[] = [], upper: number[] = [];
  for (const i of order) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop(); lower.push(i); }
  for (let k = order.length - 1; k >= 0; k--) { const i = order[k]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop(); upper.push(i); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export class TunicDrape {
  readonly mesh: THREE.SkinnedMesh;
  private readonly candidates: number[] = [];
  private readonly maxRows: number;
  private hem: number | null = null;
  private dirty = true;
  private lastBuild = -Infinity;
  private readonly motion: number[] = [];
  /** Her motion shapes' weights when the drape was last fitted to her. */
  private builtAt: number[] = [];
  /**
   * Per vertex of her body, 0 to 1: how far the drape hangs clear of her skin there, where it shows (under her belly,
   * under her seat). The shirt's paint is taken off that skin (`fabricMaterial.ts`, `fabricHang`): cloth hanging away
   * from her does not colour the skin under it, which from below must read as skin, or what she wears under the shirt
   * (Joshua, 2026-10-22: "part of the underside of the belly is red... it should remain skin color unless it's shadow").
   * `hangVersion` moves on every rebuild.
   */
  readonly hang: Float32Array;
  hangVersion = 0;

  constructor(private readonly body: THREE.SkinnedMesh, private readonly map: BodyMap, lowestHem: number) {
    for (let v = 0; v < map.region.length; v++) {
      const id = BODY_REGIONS[map.region[v] - 1]?.id ?? '';
      if (Number.isFinite(map.arm[v]) || LEFT_OUT.has(id)) continue;
      if (map.trunk[v] <= T_TOP + POSE_MARGIN && map.trunk[v] >= lowestHem - POSE_MARGIN) this.candidates.push(v);
    }
    this.maxRows = Math.ceil((T_TOP - lowestHem) / ROW_STEP) + 2;
    this.hang = new Float32Array(map.region.length);
    const n = this.maxRows * COLUMNS, geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('fabricRest', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('fabricRestNormal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    // wound so each face looks out of her (columns go round counter-clockwise seen from above, rows go down)
    const index: number[] = [];
    for (let r = 0; r + 1 < this.maxRows; r++) for (let c = 0; c < COLUMNS; c++) {
      const a = r * COLUMNS + c, b = r * COLUMNS + ((c + 1) % COLUMNS), d = a + COLUMNS, e = b + COLUMNS;
      index.push(a, b, d, b, e, d);
    }
    geometry.setIndex(index);
    // her belly's motion shapes, where she has them as shapes (they move on the graphics card, as hers do)
    const dict = body.morphTargetDictionary ?? {}, morphs = body.geometry.morphAttributes.position ?? [];
    const targets: THREE.BufferAttribute[] = [];
    const names: Record<string, number> = {};
    for (const name of DRAPE_MOTION_TARGETS) {
      const at = dict[name];
      if (at === undefined || !morphs[at]) continue;
      names[name] = targets.length;
      this.motion.push(at);
      targets.push(new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    }
    if (targets.length) { geometry.morphAttributes.position = targets; geometry.morphTargetsRelative = true; }
    // two-sided: looked at from below, up under her belly, the inside of the shirt is cloth too
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, transparent: true, side: THREE.DoubleSide });
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    if (targets.length) { this.mesh.morphTargetDictionary = names; this.mesh.morphTargetInfluences = targets.map(() => 0); }
    this.mesh.name = 'tunicDrape';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // a child of her body, so it stands where she does; bound to her own skeleton the same way she is
    body.add(this.mesh);
    this.mesh.bindMode = body.bindMode;
    this.mesh.bind(body.skeleton, body.bindMatrix);
  }

  /** The hem, on her trunk, or null to take the drape off. */
  wear(hem: number | null): void {
    if (hem !== this.hem) this.dirty = true;
    this.hem = hem;
    this.mesh.visible = hem !== null && this.mesh.visible && !this.dirty;
    if (hem === null) { this.mesh.visible = false; if (this.hang.some((h) => h > 0)) { this.hang.fill(0); this.hangVersion++; } }
  }

  /** Her shape has changed: build again (not at once: at the next frame, at most every REBUILD_MS). */
  reshape(): void { this.dirty = true; }

  /** Its material blends; call after anything that dresses the material (which may set it opaque). */
  feathered(): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    if (!m.transparent) { m.transparent = true; m.depthWrite = true; m.needsUpdate = true; }
    // drawn over her skin where the two are one surface
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4;
  }

  /** Once a frame: rebuild if her shape changed, and carry her belly's motion over. */
  update(now = performance.now()): void {
    if (this.hem === null) return;
    if (this.dirty && now - this.lastBuild >= REBUILD_MS) { this.lastBuild = now; this.dirty = false; this.build(this.hem); this.mesh.visible = true; }
    const from = this.body.morphTargetInfluences, to = this.mesh.morphTargetInfluences;
    if (from && to) this.motion.forEach((at, i) => { to[i] = (from[at] ?? 0) - (this.builtAt[i] ?? 0); });
  }

  private build(hemT: number): void {
    const body = this.body, map = this.map, T = map.trunkLength, g = this.mesh.geometry;
    // her shape now, as she rests: a big belly's resting sag is one of her motion shapes (its tilt grows with its size),
    // and fitting the drape to anything but the shape she is in leaves her belly poking through it. The drape's own
    // motion shapes then carry only how far she moves from here (a bounce, a sway)
    const influences = body.morphTargetInfluences;
    this.builtAt = this.motion.map((at) => influences?.[at] ?? 0);
    const cand = this.candidates, nc = cand.length, px = new Float64Array(nc), py = new Float64Array(nc), pz = new Float64Array(nc);
    const p = new THREE.Vector3();
    body.skeleton.update();
    for (let i = 0; i < nc; i++) { body.getVertexPosition(cand[i], p); px[i] = p.x; py[i] = p.y; pz[i] = p.z; }

    const rows = Math.max(2, Math.min(this.maxRows, Math.ceil((T_TOP - hemT) / ROW_STEP) + 1));
    const step = (T_TOP - hemT) / (rows - 1);
    // her height of each row, as she stands now (positions are in her own units, up is y; the map's trunk is height from
    // her hip joints at rest, which is how her hips are found)
    let hipY = 0, k = 0;
    for (let i = 0; i < nc; i++) { const t = map.trunk[cand[i]]; if (Math.abs(t) < 0.02) { hipY += py[i] - t * T; k++; } }
    hipY = k ? hipY / k : 0;
    const rowOf = (i: number) => Math.round((hipY + T_TOP * T - py[i]) / (step * T));
    const buckets: number[][] = Array.from({ length: rows }, () => []);
    for (let i = 0; i < nc; i++) { const r = rowOf(i); if (r >= 0 && r < rows) buckets[r].push(i); }
    // the upright axis: through the middle of her at her hip joints
    let ax = 0, az = 0, na = 0;
    {
      const r0 = Math.round(T_TOP / step), slice = [...(buckets[r0 - 1] ?? []), ...(buckets[r0] ?? []), ...(buckets[r0 + 1] ?? [])];
      for (const i of slice) { ax += px[i]; az += pz[i]; na++; }
      ax = na ? ax / na : 0; az = na ? az / na : 0;
    }
    const n = rows * COLUMNS;
    const R = new Float64Array(n), skin = new Float64Array(n), alpha = new Float32Array(n), standOff = new Float32Array(n), fixed = new Uint8Array(n);
    const near: Int32Array = new Int32Array(n * NEAREST).fill(-1), nearW = new Float32Array(n * NEAREST);
    const cosA = Float64Array.from({ length: COLUMNS }, (_, c) => Math.cos((2 * Math.PI * c) / COLUMNS));
    const sinA = Float64Array.from({ length: COLUMNS }, (_, c) => Math.sin((2 * Math.PI * c) / COLUMNS));
    const sliceOf = (r: number) => [...(buckets[r - 1] ?? []), ...buckets[r], ...(buckets[r + 1] ?? [])];
    // 1. each slice: her skin round the axis by direction, and the band's outline round her
    const skinN = new Int32Array(COLUMNS);
    for (let r = 0; r < rows; r++) {
      // measured at the row's own height (a slope measured over a thicker slice reads too far out, and leaves a lip)
      const own = buckets[r].length >= 12 ? buckets[r] : sliceOf(r), slice = own, m = slice.length, xs = new Float64Array(m), zs = new Float64Array(m);
      for (let j = 0; j < m; j++) { xs[j] = px[slice[j]] - ax; zs[j] = pz[slice[j]] - az; }
      const sk = skin.subarray(r * COLUMNS, (r + 1) * COLUMNS);
      skinN.fill(0);
      for (let j = 0; j < m; j++) {
        const c = ((Math.round((Math.atan2(zs[j], xs[j]) / (2 * Math.PI)) * COLUMNS) % COLUMNS) + COLUMNS) % COLUMNS;
        sk[c] = Math.max(sk[c], Math.hypot(xs[j], zs[j])); skinN[c]++;
      }
      // a direction no vertex happened to fall in is skin too, if the skin either side of it is close together (where
      // her belly stretches her skin thin); a wide gap (between her thighs) stays a gap
      for (let c = 0; c < COLUMNS; c++) if (!skinN[c]) {
        let a = -1, b = -1;
        for (let d = 1; d <= FILL_COLUMNS && a < 0; d++) if (skinN[(c - d + COLUMNS) % COLUMNS]) a = d;
        for (let d = 1; d <= FILL_COLUMNS && b < 0; d++) if (skinN[(c + d) % COLUMNS]) b = d;
        if (a < 0 || b < 0) continue;
        const ra = sk[(c - a + COLUMNS) % COLUMNS], rb = sk[(c + b) % COLUMNS], ang = (2 * Math.PI * (a + b)) / COLUMNS;
        if (Math.sqrt(ra * ra + rb * rb - 2 * ra * rb * Math.cos(ang)) < FILL_GAP * T) sk[c] = ra + ((rb - ra) * a) / (a + b);
      }
      const h = m >= 3 ? hull2(xs, zs, m) : [];
      for (let c = 0; c < COLUMNS; c++) {
        const dx = cosA[c], dz = sinA[c];
        let best = 0;
        for (let e = 0; e < h.length; e++) {
          const a = h[e], b = h[(e + 1) % h.length], ex = xs[b] - xs[a], ez = zs[b] - zs[a];
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-12) continue;
          const lam = (xs[a] * ez - zs[a] * ex) / den, s2 = (xs[a] * dz - zs[a] * dx) / den;
          if (lam > best && s2 >= -1e-9 && s2 <= 1 + 1e-9) best = lam;
        }
        R[r * COLUMNS + c] = best || sk[c];
      }
    }
    // how much each direction is her front (her skin's own measure, averaged over the skin in it): there the fabric
    // hangs straight from her bump rather than falling back to her thighs
    const fall = new Float64Array(COLUMNS).fill(DRAPE_SLOPE);
    {
      const sum = new Float64Array(COLUMNS), cnt = new Float64Array(COLUMNS);
      for (let k = 0; k < nc; k++) {
        const r = rowOf(k);
        if (r < 0 || r >= rows) continue;
        const c = ((Math.round((Math.atan2(pz[k] - az, px[k] - ax) / (2 * Math.PI)) * COLUMNS) % COLUMNS) + COLUMNS) % COLUMNS;
        sum[c] += map.around[cand[k]]; cnt[c]++;
      }
      for (let c = 0; c < COLUMNS; c++) {
        const front = cnt[c] ? smooth01((sum[c] / cnt[c] - FRONT_FROM) / FRONT_OVER) : 0;
        fall[c] = DRAPE_SLOPE + (FRONT_SLOPE - DRAPE_SLOPE) * front;
      }
      // smoothed round her, so the change from hanging to falling has no corner
      for (let pass = 0; pass < 4; pass++) {
        const was = fall.slice();
        for (let c = 0; c < COLUMNS; c++) fall[c] = (was[(c + COLUMNS - 1) % COLUMNS] + 2 * was[c] + was[(c + 1) % COLUMNS]) / 4;
      }
    }
    // 2. smoothed, as cloth is (each slice's outline is sampled from slightly different skin), never inside her; then
    // fabric falls from the row above
    {
      const tmp = new Float64Array(n);
      for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
        let s2 = 0, w = 0;
        for (let dr = -SMOOTH_ROWS; dr <= SMOOTH_ROWS; dr++) {
          const q = r + dr;
          if (q < 0 || q >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) { const k2 = dc ? 0.5 : 1; s2 += k2 * R[q * COLUMNS + ((c + dc + COLUMNS) % COLUMNS)]; w += k2; }
        }
        tmp[r * COLUMNS + c] = s2 / w;
      }
      // her skin's own outline, lightly smoothed too (each row's is sampled from the vertices that happen to be in it),
      // so where the shirt is the outline -- round her hips -- its edge does not step from row to row. What smoothing
      // takes off a bump is far less than the lift a showing shirt stands off her by
      const skinS = new Float64Array(n);
      for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        if (!skin[i]) continue;
        let s2 = 0, w = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const q = r + dr;
          if (q < 0 || q >= rows) continue;
          const v = skin[q * COLUMNS + ((c + dc + COLUMNS) % COLUMNS)];
          if (v) { s2 += v; w++; }
        }
        skinS[i] = s2 / w;
      }
      for (let i = 0; i < n; i++) R[i] = Math.max(tmp[i], skinS[i] ? Math.max(skinS[i], skin[i] - SKIN_SLACK * T) : skin[i]);
      for (let r = 1; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        R[i] = Math.max(R[i], R[i - COLUMNS] - fall[c] * step * T);
      }
    }
    // 3. how far it stands off her, smoothed (so what shows is whole patches, not single points either side of the line)
    const gapOf = new Float64Array(n);
    for (let i = 0; i < n; i++) gapOf[i] = skin[i] > 0 ? Math.min(GAP_CAP * T, R[i] - skin[i]) : GAP_CAP * T;
    for (let pass = 0; pass < GAP_PASSES; pass++) {
      const was = gapOf.slice();
      for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        let sum = was[i] * 2, w = 2;
        for (const j of [r * COLUMNS + ((c + 1) % COLUMNS), r * COLUMNS + ((c + COLUMNS - 1) % COLUMNS), r > 0 ? i - COLUMNS : -1, r + 1 < rows ? i + COLUMNS : -1]) if (j >= 0) { sum += was[j]; w++; }
        gapOf[i] = sum / w;
      }
    }
    // what shows, and the skin each point lies on
    for (let r = 0; r < rows; r++) {
      const slice = sliceOf(r), m = slice.length;
      for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        const gap = gapOf[i];
        // solid wherever it stands off her at all; the fade into her is added below, over skin it lies on
        alpha[i] = standOff[i] = smooth01((gap / T - SHOW_FROM) / SHOW_FROM);
        // where it lies on her, it takes her own skin's weights; across a span, they are carried in from either side
        fixed[i] = gap / T < 1.5 * SHOW_FROM ? 1 : 0;
        const qx = (R[i] + LIFT * T) * cosA[c] + ax, qz = (R[i] + LIFT * T) * sinA[c] + az;
        const best = near.subarray(i * NEAREST, (i + 1) * NEAREST), bd = new Float64Array(NEAREST).fill(Infinity);
        for (let j = 0; j < m; j++) {
          const d = (px[slice[j]] - qx) ** 2 + (pz[slice[j]] - qz) ** 2;
          if (d >= bd[NEAREST - 1]) continue;
          let q = NEAREST - 1;
          while (q > 0 && bd[q - 1] > d) { bd[q] = bd[q - 1]; best[q] = best[q - 1]; q--; }
          bd[q] = d; best[q] = slice[j];
        }
        let sum = 0;
        for (let q = 0; q < NEAREST; q++) if (best[q] >= 0) { const w = 1 / (Math.sqrt(bd[q]) + 1e-4 * T); nearW[i * NEAREST + q] = w; sum += w; }
        for (let q = 0; q < NEAREST; q++) nearW[i * NEAREST + q] /= sum || 1;
      }
    }

    // the fade: out from where it stands off her, across the skin it lies on (where it and her skin are one surface, so
    // the fade shows nothing of what is behind), then the hem band and the top
    // first up: where it falls away from her (under her belly, under her seat), it is the surface all the way up to
    // where the fall begins -- her belly's widest point, her seat's fullest -- fading in from there. So the underside of
    // her belly is one smooth surface of shirt, and the hand-over to her own skin is where the two are lit alike rather
    // than along the dark curve underneath (Joshua, 2026-10-22: from the front "barely" visible; at 100-200% no hard
    // line on the sides)
    for (let c = 0; c < COLUMNS; c++) {
      let off = -1;
      for (let r = 0; r < rows && off < 0; r++) if (standOff[r * COLUMNS + c] > 0.5) off = r;
      if (off <= 0) continue;
      let top = 0;
      for (let r = 1; r <= off; r++) if (R[r * COLUMNS + c] > R[top * COLUMNS + c]) top = r;
      const span = Math.max(1, off - top);
      for (let r = top; r < off; r++) { const i = r * COLUMNS + c; alpha[i] = Math.max(alpha[i], (r - top) / span); }
    }
    for (let pass = 0; pass < FEATHER_CELLS; pass++) {
      const was = alpha.slice();
      for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        let m = was[r * COLUMNS + ((c + 1) % COLUMNS)];
        m = Math.max(m, was[r * COLUMNS + ((c + COLUMNS - 1) % COLUMNS)]);
        if (r > 0) m = Math.max(m, was[i - COLUMNS]);
        if (r + 1 < rows) m = Math.max(m, was[i + COLUMNS]);
        alpha[i] = Math.max(was[i], m - 1 / FEATHER_CELLS);
      }
    }
    for (let r = 0; r < rows; r++) {
      const t = T_TOP - r * step, band = 1 - smooth01((t - hemT - HEM_BAND) / HEM_BAND), top = smooth01((T_TOP - t) / TOP_FADE);
      for (let c = 0; c < COLUMNS; c++) { const i = r * COLUMNS + c; alpha[i] = Math.max(smooth01(alpha[i]), band) * top; }
    }
    // the skin it hangs clear of: each of her vertices against the drape at its own height and direction
    this.hang.fill(0);
    for (let k = 0; k < nc; k++) {
      const r = rowOf(k);
      if (r < 0) continue;
      const dx = px[k] - ax, dz = pz[k] - az;
      const c = ((Math.round((Math.atan2(dz, dx) / (2 * Math.PI)) * COLUMNS) % COLUMNS) + COLUMNS) % COLUMNS, i = r * COLUMNS + c;
      if (r < rows) {
        const clear = (R[i] - Math.hypot(dx, dz)) / T;
        // only under drape that is whole there: under a part still fading in, the paint stays, or what is under the
        // shirt would show through the fade as dark patches
        this.hang[cand[k]] = smooth01((alpha[i] - 0.9) / 0.1) * smooth01((clear - HANG_FROM) / HANG_FROM);
      }
      // below the hem, as she stands now, no shirt at all: a big bump hangs lower than the shirt reaches, but its paint
      // (measured on her at rest) still ran on down it -- seen from below, red under the hem
      const row = (hipY + T_TOP * T - py[k]) / (step * T);
      this.hang[cand[k]] = Math.max(this.hang[cand[k]], Math.max(0, Math.min(1, 0.5 + (row - (rows - 1) - 0.5) / 2)));
    }
    this.hangVersion++;

    // what each point carries from her skin: bone weights, her rest place and direction (for the fabric's pattern),
    // and her belly's motion
    const si = body.geometry.getAttribute('skinIndex'), sw = body.geometry.getAttribute('skinWeight');
    const rest = body.geometry.getAttribute('fabricRest'), restN = body.geometry.getAttribute('fabricRestNormal') ?? body.geometry.getAttribute('normal');
    const morphs = body.geometry.morphAttributes.position ?? [];
    const bones = new Map<number, number>();
    for (const i of cand) for (let q = 0; q < 4; q++) if (sw.getComponent(i, q) > 0) { const b = si.getComponent(i, q); if (!bones.has(b)) bones.set(b, bones.size); }
    const B = bones.size, M = this.motion.length, CH = B + 6 + 3 * M;
    const val = new Float32Array(n * CH);
    for (let i = 0; i < n; i++) {
      const o = i * CH;
      for (let q = 0; q < NEAREST; q++) {
        const ci = near[i * NEAREST + q];
        if (ci < 0) continue;
        const v = cand[ci], w = nearW[i * NEAREST + q];
        for (let s = 0; s < 4; s++) { const bw = sw.getComponent(v, s); if (bw > 0) val[o + bones.get(si.getComponent(v, s))!] += w * bw; }
        // the pattern: how far her rest surface is from where her skin is now, carried across a span, so the knit runs
        // straight over it instead of being squeezed between the two sides
        if (rest) { val[o + B] += w * (rest.getX(v) - px[ci]); val[o + B + 1] += w * (rest.getY(v) - py[ci]); val[o + B + 2] += w * (rest.getZ(v) - pz[ci]); }
        val[o + B + 3] += w * restN.getX(v); val[o + B + 4] += w * restN.getY(v); val[o + B + 5] += w * restN.getZ(v);
        this.motion.forEach((at, mi) => { const d = morphs[at]; val[o + B + 6 + 3 * mi] += w * d.getX(v); val[o + B + 7 + 3 * mi] += w * d.getY(v); val[o + B + 8 + 3 * mi] += w * d.getZ(v); });
      }
    }
    // across a span (between her thighs, under her belly and seat), smoothly from the skin either side: a few passes
    // of averaging each free point with its neighbours, the points on her skin held
    const free: number[] = [], nbs: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
      const i = r * COLUMNS + c;
      if (fixed[i]) continue;
      free.push(i);
      nbs.push((r * COLUMNS + ((c + 1) % COLUMNS)) * CH, (r * COLUMNS + ((c + COLUMNS - 1) % COLUMNS)) * CH, (r > 0 ? i - COLUMNS : i + COLUMNS) * CH, (r + 1 < rows ? i + COLUMNS : i - COLUMNS) * CH);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      for (let f = 0; f < free.length; f++) {
        const o = free[f] * CH, a = nbs[4 * f], b = nbs[4 * f + 1], c2 = nbs[4 * f + 2], d = nbs[4 * f + 3];
        for (let ch = 0; ch < CH; ch++) val[o + ch] = 0.25 * (val[a + ch] + val[b + ch] + val[c2 + ch] + val[d + ch]);
      }
    }

    const P = g.getAttribute('position') as THREE.BufferAttribute, C = g.getAttribute('color') as THREE.BufferAttribute;
    const FR = g.getAttribute('fabricRest') as THREE.BufferAttribute, FN = g.getAttribute('fabricRestNormal') as THREE.BufferAttribute;
    const SI = g.getAttribute('skinIndex') as THREE.BufferAttribute, SW = g.getAttribute('skinWeight') as THREE.BufferAttribute;
    const targets = g.morphAttributes.position as THREE.BufferAttribute[] | undefined;
    const boneOf = [...bones.keys()];
    const boneMatrices = body.skeleton.boneMatrices!, blend = new THREE.Matrix4(), unpose = new THREE.Matrix4(), at = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const y = hipY + (T_TOP - r * step) * T;
      for (let c = 0; c < COLUMNS; c++) {
        // wherever any of it shows it lies ON her outline (its depth bias, `feathered`, draws it over her skin there), so a
        // fading edge neither weaves in and out of her skin (a ragged line) nor stands out over the background (a fuzzy
        // rim round her hips); where it has faded out entirely, just under her skin, hidden by the depth test
        const i = r * COLUMNS + c, o = i * CH;
        // and where it truly stands off her (falling from her belly or seat, across her thighs) a little further, up to
        // STAND_OFF (Joshua, 2026-10-22: "make the sides on the belly from 100-200% slightly more off the skin")
        let rr = R[i] + (alpha[i] > 0.01 ? STAND_OFF * T * smooth01((standOff[i] - 0.6) / 0.4) : -LIFT * T);
        // a fading part that does not stand off her lies ON her skin, not on the outline round her: the outline can sit a
        // few millimetres out where it bridges a hollow, and a half-faded strip there showed past her silhouette as
        // torn fabric (Joshua, 2026-10-22: "frills... a little tear on sides of the belly"). What stands off, and what is
        // solid, keeps its place
        if (skin[i] > 0 && alpha[i] > 0.01 && rr > skin[i]) rr -= (1 - standOff[i]) * (1 - alpha[i]) * (rr - skin[i]);
        // where it shows fully, a little out from her skin, so it is always drawn in front of what her skin wears
        if (skin[i] > 0 && alpha[i] > 0.5) rr = Math.max(rr, skin[i] + SOLID_LIFT * T * smooth01((alpha[i] - 0.5) / 0.5));
        const x = ax + rr * cosA[c], z = az + rr * sinA[c];
        C.setXYZW(i, 1, 1, 1, alpha[i]);
        FR.setXYZ(i, x + val[o + B], y + val[o + B + 1], z + val[o + B + 2]);
        const nl = Math.hypot(val[o + B + 3], val[o + B + 4], val[o + B + 5]) || 1;
        FN.setXYZ(i, val[o + B + 3] / nl, val[o + B + 4] / nl, val[o + B + 5] / nl);
        // the four strongest bones, normalized
        const top: [number, number][] = [];
        for (let b = 0; b < B; b++) { const w = val[o + b]; if (w > 1e-4) top.push([b, w]); }
        top.sort((a, b2) => b2[1] - a[1]);
        let sum = 0;
        for (let q = 0; q < 4 && q < top.length; q++) sum += top[q][1];
        for (let q = 0; q < 4; q++) {
          const e = top[q];
          SI.setComponent(i, q, e ? boneOf[e[0]] : 0);
          SW.setComponent(i, q, e && sum > 0 ? e[1] / sum : q === 0 && !sum ? 1 : 0);
        }
        targets?.forEach((tg, mi) => tg.setXYZ(i, val[o + B + 6 + 3 * mi], val[o + B + 7 + 3 * mi], val[o + B + 8 + 3 * mi]));
        // laid where she stands now, then carried back to her bind pose through its own bones, so that skinning puts it
        // exactly here again
        blend.elements.fill(0);
        for (let q = 0; q < 4; q++) {
          const w = SW.getComponent(i, q);
          if (!w) continue;
          const off16 = SI.getComponent(i, q) * 16;
          for (let e = 0; e < 16; e++) blend.elements[e] += w * boneMatrices[off16 + e];
        }
        unpose.multiplyMatrices(body.bindMatrixInverse, blend).multiply(body.bindMatrix).invert();
        at.set(x, y, z).applyMatrix4(unpose);
        P.setXYZ(i, at.x, at.y, at.z);
      }
    }
    // rows below the hem are folded onto it: drawn nowhere, and adding nothing to its normals
    for (let i = n; i < this.maxRows * COLUMNS; i++) P.setXYZ(i, P.getX(n - COLUMNS + (i % COLUMNS)), P.getY(n - COLUMNS + (i % COLUMNS)), P.getZ(n - COLUMNS + (i % COLUMNS)));
    g.setDrawRange(0, (rows - 1) * COLUMNS * 6);
    g.computeVertexNormals();
    // lit as cloth: its shading spread over a few points round and down, so where it leaves her it turns gently
    {
      const N = g.getAttribute('normal') as THREE.BufferAttribute, a = N.array as Float32Array, b = new Float32Array(n * 3);
      for (let pass = 0; pass < NORMAL_PASSES; pass++) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < COLUMNS; c++) {
          const i = r * COLUMNS + c, js = [i, r * COLUMNS + ((c + 1) % COLUMNS), r * COLUMNS + ((c + COLUMNS - 1) % COLUMNS), r > 0 ? i - COLUMNS : i, r + 1 < rows ? i + COLUMNS : i];
          let x = 0, y = 0, z = 0;
          for (const j of js) { x += a[j * 3]; y += a[j * 3 + 1]; z += a[j * 3 + 2]; }
          // and, where it shows, lit as though it faced out a little more than it does: where it falls away under her
          // belly it faces down, which reads from the front as a dark band; from the side its outline still shows the
          // fall. The turn is as gradual as its fade into her, so where it leaves her belly there is no hard line
          // (Joshua, 2026-10-22, circled at 100-200%)
          if (pass === NORMAL_PASSES - 1) { const l0 = Math.hypot(x, y, z) || 1; const k = FACE_OUT * Math.max(standOff[r * COLUMNS + c], alpha[r * COLUMNS + c] * alpha[r * COLUMNS + c]); x = x / l0 + k * cosA[c]; y /= l0; z = z / l0 + k * sinA[c]; }
          const l = Math.hypot(x, y, z) || 1;
          b[i * 3] = x / l; b[i * 3 + 1] = y / l; b[i * 3 + 2] = z / l;
        }
        a.set(b);
      }
      N.needsUpdate = true;
    }
    for (const a of [P, C, FR, FN, SI, SW, ...(targets ?? [])]) a.needsUpdate = true;
    g.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
