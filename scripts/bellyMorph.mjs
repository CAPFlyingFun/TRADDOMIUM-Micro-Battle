/**
 * THE BUMP AS A SLIDER — morph targets that take a pregnant body's belly from
 * the master's full term down to nearly flat, round at every size.
 *
 * Joshua, 2026-10-07, on the base mannequin: "reversing the belly size from
 * this max size to almost flat". Two separate generations (one pregnant, one
 * not) cannot be blended — they never share vertices in the same order — so the
 * smaller shapes are made from THIS mesh: the same vertices, moved, stored as
 * differences (glTF morph targets). Clothes grown from the body
 * (`growClothes.mjs`) copy every target and shrink with it.
 *
 * AND ROUND ALL THE WAY (Joshua, the same evening, with a month-by-month series
 * of photographs: "the belly is not rounded like it should"). The first version
 * kept the full bump's footprint and squashed its depth, so every size between
 * was a wide shield, and it moved only along z, so the sides of the bump stayed
 * standing. A real bump is a round dome at every month, starting small and low
 * over the pubis and growing up and out. So:
 *
 *   - THE TORSO WITHOUT THE BUMP is an oval round a vertical axis at each
 *     height: as deep as a flat front (pubis to breastbone, a gentle `BULGE_M`)
 *     and as wide as the torso's BACK half there, which the bump never widens.
 *   - THE BUMP is a height field over (angle round that axis, height): how far
 *     the outermost skin stands outside the oval.
 *   - A SMALLER BELLY is that field shrunk by its size — in angle, height and
 *     depth alike — toward a point low on the front (`GROW_FROM` of the way up
 *     from the pubis, rising by `GROW_RISE` with size, so a large bump still
 *     fills up under the bust), its edge softened as it gets smaller. Each
 *     vertex outside the oval is drawn toward it along its own direction from
 *     the axis by the ratio of the small field to the full one, so the skin
 *     under and beside the bump moves in proportion and nothing folds.
 *   - FOUR KEYS (`KEYS`: 75%, 50%, 25%, flat), one target each; a renderer
 *     crossfades the two either side of its slider.
 *
 * Nothing moves above each column's crease under the bust (the breasts), below
 * the pubis, or round the back; where the full bump barely stands out the move
 * eases to nothing, so the waist and hips are never cut into. Every profile is
 * smoothed and read between samples, never from the nearest one: a step
 * between two neighbouring readings once left a vertex behind as a spike. The
 * NORMALS move too, or a smaller belly is lit as the big one.
 *
 * The body faces +z and is measured in the master's own units (metres).
 * A module, not a command; imported by `bakeHumans.mjs` for bodies with
 * `bellyMorph`.
 */
import * as THREE from 'three';

/** How far forward a flat (not pregnant) belly still stands of its anchor line, metres. */
export const BULGE_M = 0.022;
/** Half the width of the belly's columns, metres either side of the centre. */
export const HALF_WIDTH_M = 0.2;
/** The morph target's name, in the mesh's `extras.targetNames`: the flat one. */
export const TARGET = 'belly';
/**
 * The key sizes, as targets: the belly at 75%, 50% and 25% of its full size (in
 * width, height and depth alike) and flat. Between two keys a renderer blends the
 * two targets, so every size on the way is near a round belly, never a squashed one.
 */
export const KEYS = [['belly200', 2], ['belly150', 1.5], ['belly75', 0.75], ['belly50', 0.5], ['belly25', 0.25], [TARGET, 0]];
/** A smaller bump grows from this far up between the pubis and the breastbone. */
export const GROW_FROM = 0.03;
/** ...and that point rises by this much of the same span as the bump grows to full size. */
export const GROW_RISE = 0.25;
/** Above the grow point a smaller bump keeps size^TEARDROP of its height (below it, size): the teardrop. */
export const TEARDROP = 0.6;
/** Past full term (sizes over 1) the bump does NOT widen (Joshua: "don't make the width wider when going past 100%, only the belly depth")... */
export const GROW_WIDE = 0;
/** ...rises above its grow point by size^GROW_UP (the bust is in the way)... */
export const GROW_UP = 0.25;
/** ...and stretches DOWN below it by size^GROW_SAG: the weight fills the bottom and hangs. */
export const GROW_SAG = 0.85;
/** ...and stands out by size^GROW_DEEP of the full bump's depth. */
export const GROW_DEEP = 0.75;
/** ...and the push relaxed over the skin this many times, so it comes out one round curve. */
export const GROW_RELAX = 180;
/** Flat keeps this much of the bump: enough for the navel. */
export const FLAT_KEEP = 0.05;
/** Under the bump, its pull carries on down past the pubis and fades out over this, metres. */
export const UNDER_M = 0.07;
/** How far behind the full-term mound the flat body's pubis sits, metres (measured on her: the mound stood 3.4 cm proud of the thighs' front, a flat body's 1 cm). */
export const MOUND_M = 0.025;

/** The motion targets' names: the bump's weight, driven by a renderer's spring. */
export const MOTION_TARGETS = Object.freeze({ tilt: 'bellyTilt', bob: 'bellyBob', sway: 'bellySway' });
/**
 * bellyTilt at weight 1 is the weight's full droop, what the lab calls 20° (Joshua:
 * 200% tilts 20°): the bump's lower front dropped MOTION_SAG_M, leaning forward by
 * MOTION_SAG_FORWARD. It began as a rigid turn and became a sag (see `sag` below).
 */
export const MOTION_TILT_RAD = (20 * Math.PI) / 180;
export const MOTION_SAG_M = 0.06;
export const MOTION_SAG_FORWARD = (30 * Math.PI) / 180;
/** bellyBob and bellySway at weight 1 move the bump this far, metres. */
export const MOTION_BOB_M = 0.01;

/** The breast targets: their size at the two ends of the breast scale (the model's own is the middle). */
export const BREAST_TARGETS = Object.freeze({ small: 'breast0', big: 'breast100', bob: 'breastBob' });
/** breast0 is this much of the model's breasts... */
export const BREAST_SMALL = 0.85;
/** ...and breast100 this much (about a cup and a half more). */
export const BREAST_BIG = 1.3;
/** A breast's reach from its tip to the chest wall, and its radius, metres (measured on her: about 10 cm and 7.5 cm). */
export const BREAST_DEPTH_M = 0.1;
export const BREAST_RADIUS_M = 0.075;

const COL = 0.01;

export function bellyMorph(doc, { log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION').getCount() > a.getAttribute('POSITION').getCount() ? p : a));
  const P = prim.getAttribute('POSITION');
  const n = P.getCount();
  const pos = new Float32Array(n * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < n; i += 1) { P.getElement(i, v); pos.set(v, i * 3); }

  // The skeleton tells where the hips and the chest are.
  const skin = doc.getRoot().listSkins()[0];
  const m = skin.getInverseBindMatrices().getArray();
  const ys = [];
  for (let o = 0; o < m.length; o += 16) ys.push(new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(Array.from(m.slice(o, o + 16))).invert()).y);
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().filter((c) => joints.includes(c)).length);
  const pelvis = kids.findIndex((k) => k >= 3);
  const hipY = Math.min(...joints[pelvis].listChildren().filter((c) => joints.includes(c)).map((c) => ys[joints.indexOf(c)]));
  // the chest: the next joint up the spine that branches three ways
  let chestY = Infinity;
  for (let i = 0; i < joints.length; i += 1) if (i !== pelvis && kids[i] >= 3 && ys[i] > ys[pelvis] && ys[i] < chestY) chestY = ys[i];
  if (!Number.isFinite(chestY)) { log('belly: no chest found; no morph'); return; }

  // Per centimetre of height, along the body's centre: the front (the bump's
  // profile), the back, and the waist's half width (arms are out at the T).
  const y0 = hipY - 0.15, rows = Math.ceil((chestY - y0) / COL);
  const frontC = new Float32Array(rows).fill(-Infinity), back = new Float32Array(rows).fill(Infinity);
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const r = Math.floor((y - y0) / COL);
    if (r < 0 || r >= rows || Math.abs(x) > 0.3) continue;
    if (Math.abs(x) < 0.03) { frontC[r] = Math.max(frontC[r], z); back[r] = Math.min(back[r], z); }
  }
  // fill rows a sparse front missed (they read the back of the body)
  for (let r = 1; r < rows - 1; r += 1) {
    const lo = Math.min(frontC[r - 1], frontC[r + 1]);
    if (Number.isFinite(lo) && !(frontC[r] >= lo - 0.02)) frontC[r] = (frontC[r - 1] + frontC[r + 1]) / 2;
  }
  const rowY = (r) => y0 + (r + 0.5) * COL;
  const at = (arr, y) => arr[Math.max(0, Math.min(rows - 1, Math.floor((y - y0) / COL)))];
  // The bump's peak, between the hips and the chest.
  let peak = -1;
  for (let r = 0; r < rows; r += 1) if (rowY(r) > hipY - 0.02 && rowY(r) < chestY - 0.05 && Number.isFinite(frontC[r]) && (peak < 0 || frontC[r] > frontC[peak])) peak = r;
  if (peak < 0) { log('belly: no bump found; no morph'); return; }
  // THE TOP ANCHOR: up from the peak, where the steep upper slope of the bump gives
  // way to the breastbone (the profile falls less than half a centimetre a centimetre).
  let top = peak;
  let steep = false;
  for (let r = peak + 1; r < rows; r += 1) {
    const fall = frontC[r - 1] - frontC[r];
    if (fall > 0.01) steep = true;
    if (steep && fall < 0.005) { top = r; break; }
  }
  // THE BOTTOM ANCHOR: the pubis, 7.5 cm under the hip joints (anatomy, not the
  // profile: the profile's minimum there is the gap between the legs).
  const yTop = rowY(top), yBot = hipY - 0.075;
  const zTop = frontC[top], zBot = at(frontC, yBot);
  const rise = frontC[peak] - Math.max(zTop, zBot);
  if (top === peak || rise < 0.04) { log(`belly: no bump to flatten (rise ${(rise * 100).toFixed(1)} cm); no morph`); return; }

  const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

  // THE BREASTS ARE NOT THE BELLY. Off the centre line, a breast's underside meets
  // the bump's upper slope below the breastbone; every column of the front gets its
  // own top, the crease there (the first low point of its profile above the bump),
  // so nothing above it moves. 1 cm columns, each widened to its neighbours and
  // with the bins that read the back of the body filled.
  const peakY = rowY(peak);
  const cols = Math.round((2 * HALF_WIDTH_M) / COL);
  const colOf = (x) => Math.floor((x + HALF_WIDTH_M) / COL);
  const raw = Array.from({ length: cols }, () => new Float32Array(rows).fill(-Infinity));
  for (let i = 0; i < n; i += 1) {
    const c = colOf(pos[i * 3]), r = Math.floor((pos[i * 3 + 1] - y0) / COL);
    if (c >= 0 && c < cols && r >= 0 && r < rows) raw[c][r] = Math.max(raw[c][r], pos[i * 3 + 2]);
  }
  const crease = new Float32Array(cols);
  for (let c = 0; c < cols; c += 1) {
    const f = new Float32Array(rows).fill(-Infinity);
    for (let d = -1; d <= 1; d += 1) if (raw[c + d]) for (let r = 0; r < rows; r += 1) f[r] = Math.max(f[r], raw[c + d][r]);
    for (let r = 1; r < rows - 1; r += 1) {
      const lo = Math.min(f[r - 1], f[r + 1]);
      if (Number.isFinite(lo) && !(f[r] >= lo - 0.02)) f[r] = (f[r - 1] + f[r + 1]) / 2;
    }
    // a crease only counts with a breast rising 1.5 cm over it, and only in the
    // upper part of the bump; a column with no breast keeps the breastbone's top
    const from = Math.max(peak, Math.floor((yTop - 0.12 - y0) / COL));
    let low = -1, breast = false;
    for (let r = from; r < rows; r += 1) {
      if (!Number.isFinite(f[r])) continue;
      if (low < 0 || f[r] < f[low]) low = r;
      if (f[r] > f[low] + 0.015 && r > low) { breast = true; break; }
    }
    crease[c] = breast ? Math.min(yTop, rowY(low)) : yTop;
  }
  // a moving median, so one column's stray reading cannot notch the boundary
  const medianTops = Float32Array.from(crease, (_, c) => {
    const w = [];
    for (let d = -3; d <= 3; d += 1) if (c + d >= 0 && c + d < cols) w.push(crease[c + d]);
    return w.sort((p, q) => p - q)[Math.floor(w.length / 2)];
  });
  // ...then eased across 9 cm, so the line the bump stops at under the bust bends
  // rather than steps where a breast begins (a step there left a notch at the
  // breast's outer edge on a big belly, and a lump under it on a smaller one)
  const tops = Float32Array.from(medianTops, (_, c) => {
    let sum = 0, wsum = 0;
    for (let d = -4; d <= 4; d += 1) {
      const k = Math.min(cols - 1, Math.max(0, c + d)), w = 5 - Math.abs(d);
      sum += w * medianTops[k]; wsum += w;
    }
    return sum / wsum;
  });

  // THE TORSO WITHOUT THE BUMP, as a cross-section at each height: an oval round a
  // vertical axis halfway between the back and the flat front, as deep as the flat
  // front and as wide as the torso's BACK half there (the bump widens the front of
  // the body, never the back). A bump vertex is described by its angle round that
  // axis and how far it stands outside the oval along it, so the belly's sides are
  // drawn in as well as its front: a flattening along z alone left the sides of the
  // full belly standing, a shield from the front and a nub from the side.
  const halfBack = new Float32Array(rows);
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const r = Math.floor((y - y0) / COL);
    if (r < 0 || r >= rows || Math.abs(x) > 0.3) continue;
    if (z < back[r] + 0.1) halfBack[r] = Math.max(halfBack[r], Math.abs(x));
  }
  // The per-centimetre readings are noisy and a step between two rows would step
  // the oval, leaving one vertex outside it and its neighbour 4 mm away inside (a
  // spike when the belly flattens). So both are smoothed down the body (a median,
  // then a mean, over 7 rows) and read between rows, never from the nearest one.
  const soften = (arr) => {
    const med = Float32Array.from(arr, (_, r) => {
      const w = [];
      for (let d = -3; d <= 3; d += 1) if (r + d >= 0 && r + d < rows && Number.isFinite(arr[r + d]) && arr[r + d] !== 0) w.push(arr[r + d]);
      return w.length ? w.sort((p, q) => p - q)[Math.floor(w.length / 2)] : arr[r];
    });
    return Float32Array.from(med, (_, r) => {
      let sum = 0, cnt = 0;
      for (let d = -3; d <= 3; d += 1) if (r + d >= 0 && r + d < rows) { sum += med[r + d]; cnt += 1; }
      return sum / cnt;
    });
  };
  const halfS = soften(halfBack), backS = soften(back);
  const lerpAt = (arr, y) => {
    const f = Math.min(rows - 1, Math.max(0, (y - y0) / COL - 0.5)), r = Math.floor(f), t = f - r;
    return arr[r] * (1 - t) + arr[Math.min(rows - 1, r + 1)] * t;
  };
  // ...and the flat body's pubis sits `MOUND_M` behind the full-term one: a bump at
  // term carries the mound forward with it, and anchoring the flat front on the
  // mound as the master has it left it standing as a stub under every smaller belly.
  const zBotFlat = zBot - MOUND_M;
  const torso = (y) => {
    const tt = (y - yBot) / (yTop - yBot);
    const zc = zBotFlat + (zTop - zBotFlat) * tt + BULGE_M * Math.sin(Math.PI * Math.min(1, Math.max(0, tt))), zb = lerpAt(backS, y);
    const axis = (zc + zb) / 2;
    return { axis, front: zc - axis, half: Math.max(0.07, lerpAt(halfS, y)) };
  };
  const ovalAt = (theta, t) => 1 / Math.sqrt((Math.sin(theta) / t.half) ** 2 + (Math.cos(theta) / t.front) ** 2);
  const SECTOR = (115 * Math.PI) / 180;

  // THE BUMP'S HEIGHT FIELD over (angle, height): how far the outermost skin stands
  // outside the oval. Each smaller belly is read off it, so it keeps her shape.
  const DA = (2 * Math.PI) / 180, DY = 0.005;
  const ga = Math.ceil((2 * SECTOR) / DA) + 1, gh = Math.ceil((yTop - yBot) / DY) + 1;
  let field = new Float32Array(ga * gh).fill(-1);
  const polar = new Float32Array(n * 3); // theta, rho, oval
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y <= yBot || y >= yTop) continue;
    const t = torso(y);
    const theta = Math.atan2(x, z - t.axis), rho = Math.hypot(x, z - t.axis), oval = ovalAt(theta, t);
    polar[i * 3] = theta; polar[i * 3 + 1] = rho; polar[i * 3 + 2] = oval;
    if (Math.abs(theta) > SECTOR) continue;
    const ca = Math.round((theta + SECTOR) / DA), cy = Math.round((y - yBot) / DY);
    const h = rho - oval;
    if (h > field[cy * ga + ca]) field[cy * ga + ca] = h;
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const next = new Float32Array(field);
    for (let cy = 0; cy < gh; cy += 1) for (let ca = 0; ca < ga; ca += 1) {
      if (field[cy * ga + ca] >= 0 && pass > 0) continue;
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const X = ca + dx, Y = cy + dy;
        if (X < 0 || X >= ga || Y < 0 || Y >= gh) continue;
        const v = field[Y * ga + X];
        if (v >= 0) { sum += v; cnt += 1; }
      }
      if (cnt) next[cy * ga + ca] = sum / cnt;
    }
    field = next;
  }
  for (let k = 0; k < field.length; k += 1) field[k] = Math.max(0, field[k]);
  const heightAt = (theta, y) => {
    const fa = (theta + SECTOR) / DA, fy = (y - yBot) / DY;
    const a0 = Math.floor(fa), y0g = Math.floor(fy), ta = fa - a0, ty = fy - y0g;
    const get = (X, Y) => (X < 0 || X >= ga || Y < 0 || Y >= gh ? 0 : field[Y * ga + X]);
    return (get(a0, y0g) * (1 - ta) + get(a0 + 1, y0g) * ta) * (1 - ty) + (get(a0, y0g + 1) * (1 - ta) + get(a0 + 1, y0g + 1) * ta) * ty;
  };

  // A SMALLER BELLY IS THE SAME BELLY, SMALLER: the field shrunk by `size` toward
  // the front, low in the abdomen (`GROW_FROM` of the way up from the pubis — a
  // bump starts just above it and grows up and out), in angle, height and depth
  // alike, so every size is round. Each vertex outside the oval is drawn toward
  // it along its own direction from the axis, by the ratio of the small field to
  // the full one there, so the skin under and beside the bump moves in proportion
  // and nothing folds. Where the full bump hardly stands out, the ratio eases to 1,
  // so the waist and hips are never cut into.
  // the crease's height read between columns, so it cannot step between them either
  const topAt = (x) => {
    const f = (x + HALF_WIDTH_M) / COL - 0.5, c = Math.floor(f), t = f - c;
    const get = (k) => (k < 0 || k >= cols ? yTop : tops[k]);
    return get(c) * (1 - t) + get(c + 1) * t;
  };
  const growY = yBot + GROW_FROM * (yTop - yBot);
  // How far a vertex standing `h` outside the oval at (theta, y) is drawn in, before
  // the fades: the shrunk field read against the full one.
  const pullFor = (size, theta, y, h) => {
    const full = heightAt(theta, y);
    if (full < 0.001) return 0;
    // a smaller belly's edge is soft, as a real early bump is: the shrunk field
    // is read through a blur that widens as the belly gets smaller (in the full
    // field's own scale, so a fixed softness on her)
    let small = 0;
    if (size > 0) {
      const soft = 1 - size, sa = (0.11 * soft) / size, sy = (0.03 * soft) / size;
      // a large bump fills up under the bust, a small one sits low: the point
      // it grows from rises with its size
      const gy = growY + GROW_RISE * size * (yTop - yBot);
      // THE TEARDROP (Joshua, 2026-10-07, with three more month-by-month series):
      // a growing bump is not a small ball sitting low but a teardrop, a long
      // gentle slope down from under the bust, fullest low, curving back in
      // quickly to the pubis, and only rounds out as it grows. So above the
      // point it grows from, the bump is shrunk less in height than below it
      // (`TEARDROP`: the upper half's scale is size^TEARDROP), blended smoothly
      // across that point so no crease marks the change.
      //
      // AND IT SITS ON THE PUBIS AT EVERY SIZE (Joshua, the same night: "have it start
      // at the lowest part and expand upwards and outwards... so the bottom of the belly
      // touches the area more so it looks seamless"). Below the grow point the bump is
      // not shrunk in height at all, only in depth and width, so its underside reaches
      // the pubis as the full one does; shrinking it toward the grow point there lifted
      // a smaller belly's bottom off the mound and left a band of flat skin under it.
      const up = size ** TEARDROP;
      const blend = smooth(gy - 0.04, gy + 0.04, y);
      const scaleY = 1 - blend + up * blend;
      const ta = theta / size, ty = gy + (y - gy) / scaleY;
      let sum = 0, wsum = 0;
      for (let da = -2; da <= 2; da += 1) for (let dy = -2; dy <= 2; dy += 1) {
        const w = Math.exp(-(da * da + dy * dy) / 4);
        sum += w * heightAt(ta + da * sa, ty + dy * sy);
        wsum += w;
      }
      small = (size * sum) / wsum;
    }
    let ratio = Math.min(1, Math.max(FLAT_KEEP, small / full));
    ratio = 1 - (1 - ratio) * smooth(0.004, 0.025, full);
    return h * (1 - ratio);
  };
  // UNDER THE BUMP (Joshua, 2026-10-07: "that bottom part between the legs right
  // under the belly isn't really moving and stands out like a stub"). A full-term
  // bump carries the pubic mound forward with it; when the belly stopped dead at
  // the pubis line, a smaller belly left the mound standing where the big one had
  // pushed it. So the bump's own pull at its bottom edge carries on DOWN past the
  // pubis, fading out over `UNDER_M` toward the crotch, on the front skin only
  // (near the oval's surface, never the inner thighs or the seat).
  const edgeY = yBot + 0.012;
  // SMOOTH AT EVERY SIZE (Joshua, 2026-10-07, with screenshots at 50% and 75%: "the
  // top and bottom of the belly needs to be smoother at certain sizes"). Each vertex
  // used to work out its own share of the shrink from the bump's raw height there,
  // and where the bump is thin (under the bust, over the pubis) neighbours read
  // different shares and the outline rippled. The share is worked out on the field's
  // own grid instead, blurred, and every vertex reads it between grid points.
  const blurGrid = (g, passes) => {
    let cur = g;
    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(cur.length);
      for (let cy = 0; cy < gh; cy += 1) for (let ca = 0; ca < ga; ca += 1) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const X = Math.min(ga - 1, Math.max(0, ca + dx)), Y = Math.min(gh - 1, Math.max(0, cy + dy));
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          sum += w * cur[Y * ga + X]; cnt += w;
        }
        next[cy * ga + ca] = sum / cnt;
      }
      cur = next;
    }
    return cur;
  };
  const readGrid = (g, theta, y) => {
    const fa = Math.min(ga - 1, Math.max(0, (theta + SECTOR) / DA)), fy = Math.min(gh - 1, Math.max(0, (y - yBot) / DY));
    const a0 = Math.min(ga - 2, Math.floor(fa)), y0g = Math.min(gh - 2, Math.floor(fy)), ta = fa - a0, ty = fy - y0g;
    const get = (X, Y) => g[Y * ga + X];
    return (get(a0, y0g) * (1 - ta) + get(a0 + 1, y0g) * ta) * (1 - ty) + (get(a0, y0g + 1) * (1 - ta) + get(a0 + 1, y0g + 1) * ta) * ty;
  };
  const cellTheta = (ca) => ca * DA - SECTOR, cellY = (cy) => yBot + cy * DY;
  // the share of each bit of bump a smaller belly KEEPS (1 = all of it), blurred
  const fullBlur = blurGrid(field, 7);
  const keepGrid = (size) => {
    const g = new Float32Array(ga * gh).fill(1);
    for (let cy = 0; cy < gh; cy += 1) for (let ca = 0; ca < ga; ca += 1) {
      const full = field[cy * ga + ca];
      if (full < 0.001) continue;
      g[cy * ga + ca] = 1 - pullFor(size, cellTheta(ca), cellY(cy), full) / full;
    }
    return blurGrid(g, 6);
  };
  // A BIGGER BELLY THAN THE MASTER (Joshua, the same night: "can we make the belly
  // stretch bigger than the current max... and let it naturally sag more at the
  // bottom so I can use in other games with twins, triplets"). The same bump, grown
  // from the full-term grow point: deeper (size^GROW_DEEP), no wider (GROW_WIDE 0), a
  // little taller above (size^GROW_UP, the bust is in the way) and stretched DOWN
  // below by size^GROW_SAG, so the extra weight fills the bottom and hangs. The grown
  // height is a grid too, blurred, and a vertex is pushed out to it along its own
  // direction from the axis; skin the full bump never reached (the sides, the band
  // under the bust) is pushed out by the grown height itself.
  const growGrid = (size) => {
    const gy = growY + GROW_RISE * (yTop - yBot);
    const wide = size ** GROW_WIDE, up = size ** GROW_UP, sag = size ** GROW_SAG;
    const g = new Float32Array(ga * gh);
    for (let cy = 0; cy < gh; cy += 1) for (let ca = 0; ca < ga; ca += 1) {
      const y = cellY(cy);
      const blend = smooth(gy - 0.05, gy + 0.05, y);
      const scaleY = sag * (1 - blend) + up * blend;
      g[cy * ga + ca] = size ** GROW_DEEP * heightAt(cellTheta(ca) / wide, gy + (y - gy) / scaleY);
    }
    return blurGrid(g, 4);
  };
  // the middle a grown bump swells from: at its fullest height, a third of the way
  // from the spine's axis to the front of the full bump
  const growC = (() => {
    const t = torso(peakY);
    return { y: peakY - 0.05, z: t.axis + 0.35 * (frontC[peak] - t.axis) };
  })();
  const deltaFor = (size) => {
    const delta = new Float32Array(n * 3);
    let moved = 0, most = 0;
    const grow = size > 1;
    const keep = grow ? null : keepGrid(size), big = grow ? growGrid(size) : null;
    for (let i = 0; i < n; i += 1) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y <= yBot - UNDER_M || y >= yTop) continue;
      const yt = topAt(x);
      if (y >= yt) continue;
      const t = torso(y);
      const dz = z - t.axis;
      const theta = Math.atan2(x, dz), rho = Math.hypot(x, dz), oval = ovalAt(theta, t);
      if (Math.abs(theta) > SECTOR) continue;
      const side = smooth(SECTOR, SECTOR - 0.35, Math.abs(theta));
      // a wide fade into the chest everywhere: a 6 mm one (where no breast sits over a
      // crease) let the top of a smaller bump pull in 3 cm against a still neighbour
      const topFade = 0.06;
      const upF = smooth(yt, yt - topFade, y);
      let pull;
      if (grow) {
        if (y < yBot - UNDER_M || rho < oval - 0.05) continue;
        const h = rho - oval;
        // how much MORE bump there is here than at full term, from two blurred grids:
        // smooth everywhere, and added to the skin as it is, so the navel and the
        // curve of her own belly ride out on top of it. Under the pubis line there is
        // no grid; the skin there takes the bottom row's
        const ye = Math.max(y, yBot + 0.05); // the skin over the pubis takes the growth from just above it, filling the pocket under the bump
        const extra = readGrid(big, theta, ye) - readGrid(fullBlur, theta, ye);
        // the bust sits on a big belly: a long fade under it, so no ledge. And A
        // TEARDROP AT THE BOTTOM (Joshua, 2026-10-07: "past 100%, smooth out more along
        // the bottom of the belly and pubic area to look smoother and like a teardrop"):
        // the growth tapers down over the pubis and past it, so the underside runs
        // smoothly into the mound as the point of a drop, never tucks in under itself
        const out = Math.max(0, extra) * smooth(yt, yt - 0.14, y) * side
          * smooth(yBot - UNDER_M, yBot + 0.07, y) * smooth(-0.05, 0, h);
        if (!(out > 0)) continue;
        // OUT FROM THE BUMP'S OWN MIDDLE, seen from the side: the lower half grows
        // forward AND down, so its underside comes out round and hangs over the pubis
        // (the sag); the upper half grows forward, never up into the bust; nothing grows
        // sideways; and at the very bottom the drop turns to forward, so the point of
        // the teardrop is not pushed down into the thighs
        const dx = 0;
        // (always leaning forward: on her flanks, level with the middle, a direction that
        // flipped from forward to straight down within millimetres tore the skin)
        let dy = y - growC.y, dzz = Math.max(0, z - growC.z) + 0.06;
        if (dy > 0) dy *= 0.15;
        else dy *= smooth(yBot - 0.02, yBot + 0.12, y);
        const l = Math.hypot(dx, dy, dzz) || 1;
        delta[i * 3] = (dx / l) * out;
        delta[i * 3 + 1] = (dy / l) * out;
        delta[i * 3 + 2] = (dzz / l) * out;
        moved += 1;
        most = Math.max(most, out);
        continue;
      } else {
        // under the edge the pull fades out toward the crotch
        const down = smooth(yBot - UNDER_M, edgeY, y);
        const yr = Math.max(y, edgeY);
        const lose = 1 - readGrid(keep, theta, yr);
        // the skin's own pull, where it stands outside the oval
        pull = rho > oval ? (rho - oval) * lose * upF * down * side : 0;
        // THE FOLD: low on the belly, where the full bump's underside tucks in over the
        // mound, the skin inside the oval moves with the outermost skin at its height (a
        // fold left still while the skin over it drew back stood out as a point), and
        // under the edge that pull carries down over the mound. Only near the front
        // surface (within a few centimetres of the oval), never between the thighs.
        const low = 1 - smooth(yBot + 0.03, yBot + 0.07, y);
        if (low > 0) {
          const front = smooth(-0.035, -0.01, rho - oval);
          pull = Math.max(pull, heightAt(theta, yr) * lose * front * low * upF * down * side);
        }
      }
      if (pull === 0 || !Number.isFinite(pull)) continue;
      const ux = x / rho, uz = dz / rho;
      delta[i * 3] = -ux * pull;
      delta[i * 3 + 2] = -uz * pull;
      moved += 1;
      most = Math.max(most, Math.abs(pull));
    }
    return { delta, moved, most: -most };
  };
  const centre = { rise, bot: yBot, top: yTop };
  // Normals: recompute both shapes the same way over welded positions, and store
  // the difference (so the authored normals stay as they were at weight 0).
  const idx = prim.getIndices().getArray();
  const normalsOf = (shift) => {
    const key = new Map(), rep = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
      if (!key.has(k)) key.set(k, i);
      rep[i] = key.get(k);
    }
    const acc = new Float32Array(n * 3);
    const p = (i, a) => pos[i * 3 + a] + (shift ? shift[i * 3 + a] : 0);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], cc = idx[f + 2];
      const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2);
      const vx = p(cc, 0) - p(a, 0), vy = p(cc, 1) - p(a, 1), vz = p(cc, 2) - p(a, 2);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const w of [rep[a], rep[b], rep[cc]]) { acc[w * 3] += nx; acc[w * 3 + 1] += ny; acc[w * 3 + 2] += nz; }
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const r = rep[i], l = Math.hypot(acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]) || 1;
      out[i * 3] = acc[r * 3] / l; out[i * 3 + 1] = acc[r * 3 + 1] / l; out[i * 3 + 2] = acc[r * 3 + 2] / l;
    }
    return out;
  };
  const before = normalsOf(null);
  const normalDelta = (delta) => {
  const after = normalsOf(delta);
  // Squashing the bump pinches its widest ring, and a few faces there fold; their
  // recomputed normals spike and light as a dark seam. So the flat shape's normals
  // are SMOOTHED across the moved region (and a ring round it) over the welded
  // mesh before the difference is taken, and a normal that turned more than 75
  // degrees from where it was is not trusted at all.
  const weld = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    if (!weld.has(k)) weld.set(k, i);
    rep[i] = weld.get(k);
  }
  const nb = new Map();
  const link = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  for (let f = 0; f < idx.length; f += 3) {
    const a = rep[idx[f]], b = rep[idx[f + 1]], c = rep[idx[f + 2]];
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  const region = new Set();
  for (let i = 0; i < n; i += 1) if (delta[i * 3] !== 0 || delta[i * 3 + 2] !== 0) region.add(rep[i]);
  for (let ring = 0; ring < 2; ring += 1) for (const r of [...region]) for (const u of nb.get(r) || []) region.add(u);
  let field = new Float32Array(after);
  for (let it = 0; it < 8; it += 1) {
    const next = new Float32Array(field);
    for (const r of region) {
      let x = field[r * 3], y = field[r * 3 + 1], z = field[r * 3 + 2];
      for (const u of nb.get(r) || []) { x += field[u * 3]; y += field[u * 3 + 1]; z += field[u * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      next[r * 3] = x / l; next[r * 3 + 1] = y / l; next[r * 3 + 2] = z / l;
    }
    field = next;
  }
  const ndelta = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = rep[i];
    if (!region.has(r)) continue;
    const dot = field[r * 3] * before[r * 3] + field[r * 3 + 1] * before[r * 3 + 1] + field[r * 3 + 2] * before[r * 3 + 2];
    if (dot < Math.cos((75 * Math.PI) / 180)) continue;
    for (let a = 0; a < 3; a += 1) ndelta[i * 3 + a] = field[r * 3 + a] - before[r * 3 + a];
  }
  return ndelta;
  };

  // One target a key size; the renderer crossfades the two either side of the
  // slider (`bellyWeights` in the Sarah Lab), so the belly is round all the way.
  // The other primitives (none on the masters) get empty targets, as glTF requires.
  const buffer = doc.getRoot().listBuffers()[0];
  const extras = mesh.getExtras() || {};
  const names = [...(extras.targetNames || [])];
  const weights = [...(mesh.getWeights() || [])];
  const report = [];
  // A GROWN BELLY IS RELAXED OVER THE SKIN ITSELF: each vertex's push eased toward its
  // neighbours' many times, the skin past the bump held still. A push worked out from
  // a grid and a few fades leaves corners where they meet (a flat front, a shelf under
  // it); relaxed over the mesh, the same growth comes out as one round curve.
  let weldCache = null;
  const welded = () => {
    if (weldCache) return weldCache;
    const map = new Map(), rep = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
      if (!map.has(k)) map.set(k, i);
      rep[i] = map.get(k);
    }
    const nb = new Map();
    const link = (a, b) => { if (a === b) return; if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
    const ix = prim.getIndices().getArray();
    for (let f = 0; f < ix.length; f += 3) {
      const a = rep[ix[f]], b = rep[ix[f + 1]], c = rep[ix[f + 2]];
      link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
    }
    weldCache = { rep, nb: new Map([...nb].map(([k, v]) => [k, [...v]])) };
    return weldCache;
  };
  const relax = (delta, iterations) => {
    const { rep, nb } = welded();
    const region = new Set();
    for (let i = 0; i < n; i += 1) if (delta[i * 3] !== 0 || delta[i * 3 + 1] !== 0 || delta[i * 3 + 2] !== 0) region.add(rep[i]);
    // the skin just past the push may be drawn along a little, so the edge eases too
    for (let ring = 0; ring < 3; ring += 1) for (const r of [...region]) for (const u of nb.get(r) || []) region.add(u);
    const list = [...region];
    let cur = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) if (rep[i] === i) for (let a = 0; a < 3; a += 1) cur[i * 3 + a] = delta[i * 3 + a];
    for (let it = 0; it < iterations; it += 1) {
      const next = new Float32Array(cur);
      for (const r of list) {
        const ns = nb.get(r);
        if (!ns || !ns.length) continue;
        let x = 0, y = 0, z = 0;
        for (const u of ns) { x += cur[u * 3]; y += cur[u * 3 + 1]; z += cur[u * 3 + 2]; }
        next[r * 3] = 0.5 * cur[r * 3] + (0.5 * x) / ns.length;
        next[r * 3 + 1] = 0.5 * cur[r * 3 + 1] + (0.5 * y) / ns.length;
        next[r * 3 + 2] = 0.5 * cur[r * 3 + 2] + (0.5 * z) / ns.length;
      }
      cur = next;
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) for (let a = 0; a < 3; a += 1) out[i * 3 + a] = cur[rep[i] * 3 + a];
    return out;
  };
  for (const [name, size] of KEYS) {
    const made = deltaFor(size);
    const { moved, most } = made;
    const delta = size > 1 ? relax(made.delta, GROW_RELAX) : made.delta;
    const ndelta = normalDelta(delta);
    for (const p of mesh.listPrimitives()) {
      const count = p.getAttribute('POSITION').getCount();
      const t = doc.createPrimitiveTarget(name);
      t.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? delta : new Float32Array(count * 3)));
      t.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? ndelta : new Float32Array(count * 3)));
      p.addTarget(t);
    }
    names.push(name);
    weights.push(0);
    report.push(`${name} ${Math.round(size * 100)}%: ${moved.toLocaleString()} vertices, up to ${(-most * 100).toFixed(1)} cm`);
  }
  // THE BUMP HAS WEIGHT (Joshua, 2026-10-07: "add a weight with the belly so it can
  // move and kind of jiggle, but not like jello... it could still tilt the belly
  // downward like 1-3° to look heavy"). Three more targets, each a small motion of
  // the full bump with its edges held still, for a renderer to drive with a spring
  // and a resting tilt (`bellyMotionWeights` in the Sarah Lab):
  //   bellyTilt  the bump's weight: its lower front dropped and eased (the lab's "20°")
  //   bellyBob   the bump dropped MOTION_BOB_M (a bounce, either sign)
  //   bellySway  the bump moved MOTION_BOB_M to her left (either sign)
  // The hold is a mask from the full field: nothing at the bump's edge (the waist,
  // the bust's crease, the pubis), all of it where the bump stands well out.
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y <= yBot || y >= yTop) continue;
    const yt = topAt(x);
    if (y >= yt) continue;
    const t = torso(y);
    const theta = Math.atan2(x, z - t.axis), rho = Math.hypot(x, z - t.axis), oval = ovalAt(theta, t);
    if (Math.abs(theta) > SECTOR || rho <= oval) continue;
    mask[i] = smooth(0.003, 0.06, rho - oval) * smooth(yBot, yBot + 0.05, y) * smooth(yt, yt - 0.06, y) * smooth(SECTOR, SECTOR - 0.5, Math.abs(theta));
  }
  const motions = [
    [MOTION_TARGETS.tilt, null], // the sag: built on its own below
    [MOTION_TARGETS.bob, (i, out) => { out[0] = 0; out[1] = -MOTION_BOB_M; out[2] = 0; }],
    [MOTION_TARGETS.sway, (i, out) => { out[0] = MOTION_BOB_M; out[1] = 0; out[2] = 0; }],
  ];
  const d3 = [0, 0, 0];
  // THE WEIGHT AS A SAG, NOT A SWING (Joshua, 2026-10-07, on 200% tilted 20°: "still
  // looks too sharp and could be smoother… at the bottom of the belly"). A rigid turn
  // about the bump's middle swung its bottom back into the pubis, where the hold ended
  // within 5 cm, and pinched it into a lip; it also flattened the front. So the weight
  // drops the bump instead: the lower front most, down and a little forward, the top
  // under the bust a third as much, fading out over the pubis and the bust, and the
  // whole of it relaxed over the skin so it comes out one smooth curve.
  const SAG_SECTOR = (75 * Math.PI) / 180;
  const sag = () => {
    const delta = new Float32Array(n * 3);
    const dirY = -Math.cos(MOTION_SAG_FORWARD), dirZ = Math.sin(MOTION_SAG_FORWARD);
    for (let i = 0; i < n; i += 1) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y <= yBot - 0.015 || y >= yTop) continue;
      const yt = topAt(x);
      if (y >= yt) continue;
      const t = torso(y);
      const theta = Math.atan2(x, z - t.axis), rho = Math.hypot(x, z - t.axis), oval = ovalAt(theta, t);
      // the front of the belly only: a sag that reached round her flanks moved her back
      if (Math.abs(theta) > SAG_SECTOR) continue;
      // most in the lower middle, easing out both ways: to the pubis slowly (so the
      // underside stays round, not a shelf) and to the bust to a third
      const height = smooth(yBot - 0.015, growC.y - 0.06, y) * (0.35 + 0.65 * (1 - smooth(growC.y - 0.06, yt, y)));
      const w = height * smooth(-0.02, 0.06, rho - oval) * smooth(yt, yt - 0.08, y) * smooth(SAG_SECTOR, SAG_SECTOR - 0.6, Math.abs(theta));
      if (!(w > 0)) continue;
      delta[i * 3 + 1] = dirY * MOTION_SAG_M * w;
      delta[i * 3 + 2] = dirZ * MOTION_SAG_M * w;
    }
    return relax(delta, 150);
  };
  for (const [name, at] of motions) {
    let delta = new Float32Array(n * 3);
    if (at) {
      for (let i = 0; i < n; i += 1) {
        if (!(mask[i] > 0)) continue;
        at(i, d3);
        for (let a = 0; a < 3; a += 1) delta[i * 3 + a] = d3[a] * mask[i];
      }
    } else delta = sag();
    for (const p of mesh.listPrimitives()) {
      const count = p.getAttribute('POSITION').getCount();
      const t = doc.createPrimitiveTarget(name);
      t.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? delta : new Float32Array(count * 3)));
      t.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array(count * 3)));
      p.addTarget(t);
    }
    names.push(name);
    weights.push(0);
  }
  // THE BREASTS GROW WITH THE BUMP (Joshua, 2026-10-07: "normally when pregnant the
  // breast size gets bigger": belly 50% with breasts 25%, 100% with 50%, 150% with
  // 75%, 200% with 100%). The model's own breasts are 50%; two targets reach either
  // end, `breast0` (BREAST_SMALL of their size) and `breast100` (BREAST_BIG), and the
  // lab sets them from the bump. Each breast is found from its own tip (the most
  // forward point above its column's crease, either side of the centre) and scaled out
  // from a base behind it, fading to nothing at its edges and above the crease under
  // it, so the chest, the armpit and the belly never move; then relaxed over the skin.
  const tips = [1, -1].map((side) => {
    let best = -1;
    for (let i = 0; i < n; i += 1) {
      const x = side * pos[i * 3], y = pos[i * 3 + 1];
      if (x < 0.03 || x > 0.2 || y < topAt(pos[i * 3]) + 0.01 || y > chestY + 0.25) continue;
      if (best < 0 || pos[i * 3 + 2] > pos[best * 3 + 2]) best = i;
    }
    return best;
  });
  const breastTarget = (scale, drop = 0) => {
    const delta = new Float32Array(n * 3);
    for (const tip of tips) {
      if (tip < 0) continue;
      const tx = pos[tip * 3], ty = pos[tip * 3 + 1], tz = pos[tip * 3 + 2];
      // the base: behind the tip on the chest wall; the ball the breast is: centred
      // between them, a little high (a breast hangs from its top)
      const bx = tx, by = ty + 0.015, bz = tz - BREAST_DEPTH_M;
      const cx = tx, cy = ty + 0.02, cz = tz - BREAST_DEPTH_M * 0.55;
      for (let i = 0; i < n; i += 1) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (Math.sign(x) !== Math.sign(tx)) continue;
        const d = Math.hypot(x - cx, y - cy, z - cz);
        if (d > BREAST_RADIUS_M * 1.4) continue;
        const crease = topAt(x);
        const w = (1 - smooth(BREAST_RADIUS_M * 0.75, BREAST_RADIUS_M * 1.35, d)) * smooth(cz - 0.02, cz + 0.02, z) * smooth(crease - 0.005, crease + 0.03, y);
        if (!(w > 0)) continue;
        delta[i * 3] += (scale - 1) * (x - bx) * w;
        delta[i * 3 + 1] += (scale - 1) * (y - by) * w - drop * w;
        delta[i * 3 + 2] += (scale - 1) * (z - bz) * w;
      }
    }
    return relax(delta, 40);
  };
  // ...and THE BREASTS BOUNCE TOO (Joshua, 2026-10-08: "add the same bounce for the
  // breasts"): `breastBob`, both breasts dropped MOTION_BOB_M with the same hold, for
  // the lab's second spring
  for (const [name, scale, drop] of [[BREAST_TARGETS.small, BREAST_SMALL, 0], [BREAST_TARGETS.big, BREAST_BIG, 0], [BREAST_TARGETS.bob, 1, MOTION_BOB_M]]) {
    const delta = breastTarget(scale, drop);
    const ndelta = normalDelta(delta);
    for (const p of mesh.listPrimitives()) {
      const count = p.getAttribute('POSITION').getCount();
      const t = doc.createPrimitiveTarget(name);
      t.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? delta : new Float32Array(count * 3)));
      t.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? ndelta : new Float32Array(count * 3)));
      p.addTarget(t);
    }
    names.push(name);
    weights.push(0);
  }
  report.push(`breasts: tips at ${tips.map((t) => (t < 0 ? 'none' : `(${pos[t * 3].toFixed(3)}, ${pos[t * 3 + 1].toFixed(2)})`)).join(' and ')}, ${BREAST_SMALL}x to ${BREAST_BIG}x`);
  report.push(`motion: tilt, bob, sway over ${mask.filter((w) => w > 0).length.toLocaleString()} vertices`);
  mesh.setExtras({ ...extras, targetNames: names });
  mesh.setWeights(weights);
  log(`belly: the centre's ${(centre.rise * 100).toFixed(1)} cm bump (from ${centre.bot.toFixed(2)} to ${centre.top.toFixed(2)} m up), grown from ${growY.toFixed(2)} m; ${report.join('; ')}`);
}
