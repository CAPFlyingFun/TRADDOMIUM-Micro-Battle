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
export const KEYS = [['belly75', 0.75], ['belly50', 0.5], ['belly25', 0.25], [TARGET, 0]];
/** A smaller bump grows from this far up between the pubis and the breastbone. */
export const GROW_FROM = 0.22;
/** ...and that point rises by this much of the same span as the bump grows to full size. */
export const GROW_RISE = 0.3;
/** Above the grow point a smaller bump keeps size^TEARDROP of its height (below it, size): the teardrop. */
export const TEARDROP = 0.35;
/** Flat keeps this much of the bump: enough for the navel. */
export const FLAT_KEEP = 0.05;

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
  const tops = Float32Array.from(crease, (_, c) => {
    const w = [];
    for (let d = -3; d <= 3; d += 1) if (c + d >= 0 && c + d < cols) w.push(crease[c + d]);
    return w.sort((p, q) => p - q)[Math.floor(w.length / 2)];
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
  const torso = (y) => {
    const tt = (y - yBot) / (yTop - yBot);
    const zc = zBot + (zTop - zBot) * tt + BULGE_M * Math.sin(Math.PI * Math.min(1, Math.max(0, tt))), zb = lerpAt(backS, y);
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
  const deltaFor = (size) => {
    const delta = new Float32Array(n * 3);
    let moved = 0, most = 0;
    for (let i = 0; i < n; i += 1) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y <= yBot || y >= yTop) continue;
      const yt = topAt(x);
      if (y >= yt) continue;
      const theta = polar[i * 3], rho = polar[i * 3 + 1], oval = polar[i * 3 + 2];
      if (Math.abs(theta) > SECTOR || rho <= oval) continue;
      const full = heightAt(theta, y);
      if (full < 0.001) continue;
      // a smaller belly's edge is soft, as a real early bump is: the shrunk field
      // is read through a blur that widens as the belly gets smaller (in the full
      // field's own scale, so a fixed softness on her)
      let small = 0;
      if (size > 0) {
        const soft = 1 - size, sa = (0.07 * soft) / size, sy = (0.018 * soft) / size;
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
        const up = size ** TEARDROP;
        const blend = smooth(gy - 0.04, gy + 0.04, y);
        const scaleY = size * (1 - blend) + up * blend;
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
      // a wide fade into the chest everywhere: a 6 mm one (where no breast sits over a
      // crease) let the top of a smaller bump pull in 3 cm against a still neighbour
      const topFade = 0.045;
      const k = smooth(yBot, yBot + 0.006, y) * smooth(yt, yt - topFade, y) * smooth(SECTOR, SECTOR - 0.35, Math.abs(theta));
      const pull = (rho - oval) * (1 - ratio) * k;
      if (pull <= 0) continue;
      const t = torso(y);
      const ux = x / rho, uz = (z - t.axis) / rho;
      delta[i * 3] = -ux * pull;
      delta[i * 3 + 2] = -uz * pull;
      moved += 1;
      most = Math.max(most, pull);
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
  for (let i = 0; i < n; i += 1) if (delta[i * 3 + 2] < 0) region.add(rep[i]);
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
  for (const [name, size] of KEYS) {
    const { delta, moved, most } = deltaFor(size);
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
  mesh.setExtras({ ...extras, targetNames: names });
  mesh.setWeights(weights);
  log(`belly: the centre's ${(centre.rise * 100).toFixed(1)} cm bump (from ${centre.bot.toFixed(2)} to ${centre.top.toFixed(2)} m up), grown from ${growY.toFixed(2)} m; ${report.join('; ')}`);
}
