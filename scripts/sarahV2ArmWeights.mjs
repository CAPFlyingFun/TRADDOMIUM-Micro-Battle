/**
 * SARAH v2's ARMPIT WEIGHTS, REBUILT ALONG HER SKIN (Joshua, 2026-10-15: raising v2's
 * arms "stretches large triangular surfaces outward around both shoulders and armpits").
 *
 * THE CAUSE, MEASURED. v1 and v2 share a skeleton (same 68 joints, same upper-arm
 * joints, same rest rotations) and v2's mesh is closed and intact. What differs is the
 * weighting under the arm. v2 is modelled arms-down, the arm hanging just behind her
 * side, and the auto-rig gave the back of her torso there 0.3-0.7 of the arm bone across
 * that gap (the bake's arm clean-up then raised it to 0.9) while the front of her chest
 * side kept almost none. Raised, the back of her torso is dragged up with the arm and the
 * front stays: the skin between becomes the triangular sheets. v1 is modelled in a T,
 * so nothing sits close enough to bleed.
 *
 * THE REPAIR. Around each shoulder the arm's share is solved as a harmonic function on
 * her own surface: held at 1 on the upper arm itself (from ARM_FROM_M down its axis,
 * within ARM_RADIUS_M of it), held at 0 at her midline, neck and the core of her breasts
 * and at the edge of the region, and smooth between. A share can only travel along her
 * skin, round the armpit, never across the gap between arm and side, which is how a
 * T-pose rig is weighted. The arm's own bones keep their split of it; the rest goes back
 * to the bones that held it, or to the collarbone. Weights only: her rest shape, every
 * morph and the approved v2 file are untouched; the result is written as a separate file.
 *
 *   node scripts/sarahV2ArmWeights.mjs public/models/sarah-v2.glb public/models/sarah-v2-arms.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** The region solved around each shoulder joint, metres. */
export const REGION_M = 0.3;
/** The upper arm held fully to the arm: this far down its axis from the shoulder joint, and within this of the axis. */
export const ARM_FROM_M = 0.12;
/** Where the arm is held whole on its INNER face, the side against her ribs (lower: the hollow there belongs to the armpit). */
export const ARM_INNER_FROM_M = 0.15;
export const ARM_RADIUS_M = 0.06;
/** Her midline and neck held to the torso (|x| under this). */
export const MIDLINE_M = 0.07;
/** Gauss-Seidel sweeps of the harmonic solve. */
export const SWEEPS = 2500;
/** How far, at most, the web's middle is drawn toward the shoulder's pivot with the arm level (a share of the way). */
export const TUCK = 0.5;
/** Height above the shoulder pivot (raised pose) where the tuck starts fading out over the deltoid. */
export const TOP_FROM_M = -0.06;
/** The shoulder's top is blended back to the approved weights: none where the arm's skin faces less than FACE_FROM toward her outside, all from FACE_TO (1 = straight out). */
export const FACE_FROM = 0.2;
export const FACE_TO = 0.65;

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const read = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };

export async function sarahV2ArmWeights(src, dst, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src), skin = doc.getRoot().listSkins()[0], joints = skin.listJoints(), wt = joints.map((j) => j.getWorldTranslation());
  const T = mul(joints[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T);
  const child = (k) => joints[k].listChildren().find((c) => joints.includes(c));
  const ups = joints.map((_, k) => k).filter((k) => { const t = wt[k], c = child(k); if (!c) return false; const e = c.getWorldTranslation(); return Math.abs(t[0]) > 0.1 && Math.abs(t[0]) < 0.3 && t[1] > 1.2 && t[1] < 1.55 && Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]) > 0.18; });
  if (ups.length !== 2) throw new Error(`expected two upper arms, found ${ups.length}`);
  const under = (k, root) => { for (let n = joints[k]; n; n = n.getParentNode?.()) { if (n === joints[root]) return true; if (!joints.includes(n)) return false; } return false; };
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras()?.targetNames ?? [];
  for (const prim of mesh.listPrimitives()) {
    const P = read(prim.getAttribute('POSITION')), n = P.length / 3; for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
    const J = read(prim.getAttribute('JOINTS_0')), W = read(prim.getAttribute('WEIGHTS_0')), idx = prim.getIndices().getArray();
    const bt = names.indexOf('breast100'), bd = bt >= 0 ? read(prim.listTargets()[bt].getAttribute('POSITION')) : null;
    const key = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${P[i * 3].toFixed(6)},${P[i * 3 + 1].toFixed(6)},${P[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
    const U = key.size, rep = new Int32Array(U), nb = Array.from({ length: U }, () => new Set()); for (let i = 0; i < n; i += 1) rep[id[i]] = i;
    for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) { if (id[a] !== id[b]) { nb[id[a]].add(id[b]); nb[id[b]].add(id[a]); } }
    const wmap = Array.from({ length: U }, (_, u) => { const m = new Map(), i = rep[u]; for (let c = 0; c < 4; c += 1) if (W[i * 4 + c] > 0) m.set(J[i * 4 + c], (m.get(J[i * 4 + c]) || 0) + W[i * 4 + c]); return m; });
    for (const up of ups) {
      const s = wt[up], e = child(up).getWorldTranslation(), ax = [e[0] - s[0], e[1] - s[1], e[2] - s[2]], al = Math.hypot(...ax), au = ax.map((v) => v / al);
      const arm = new Set(joints.map((_, k) => (under(k, up) ? k : -1)).filter((k) => k >= 0)), collar = joints.indexOf(joints[up].getParentNode());
      const a0 = new Float32Array(U), fixed = new Int8Array(U).fill(-1), inReg = new Uint8Array(U);
      for (let u = 0; u < U; u += 1) {
        const i = rep[u], p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; for (const [k, x] of wmap[u]) if (arm.has(k)) a0[u] += x;
        if (Math.sign(p[0]) !== Math.sign(s[0])) { fixed[u] = 0; continue; }
        const r = [p[0] - s[0], p[1] - s[1], p[2] - s[2]], along = r[0] * au[0] + r[1] * au[1] + r[2] * au[2], radial = Math.hypot(r[0] - along * au[0], r[1] - along * au[1], r[2] - along * au[2]);
        const breast = bd ? Math.hypot(...apply(T, [bd[i * 3], bd[i * 3 + 1], bd[i * 3 + 2]], 0)) : 0;
        const inner = (r[0] - along * au[0]) * Math.sign(s[0]) < -0.01; // facing her ribs
        if (along > (inner ? ARM_INNER_FROM_M : ARM_FROM_M) && radial < ARM_RADIUS_M && a0[u] > 0.9) fixed[u] = 1; // the upper arm itself (from lower on its inner face, where held whole it pulled a fin out of her right armpit)
        else if (Math.hypot(...r) > REGION_M) fixed[u] = a0[u] > 0.97 && radial < ARM_RADIUS_M ? 1 : 0; // the region's edge
        else if (Math.abs(p[0]) < MIDLINE_M || breast > 0.003) fixed[u] = 0; // midline, neck, breast core
        else inReg[u] = 1;
      }
      // harmonic solve, started from the original shares
      const a = new Float32Array(U); for (let u = 0; u < U; u += 1) a[u] = fixed[u] >= 0 ? fixed[u] : a0[u];
      const free = []; for (let u = 0; u < U; u += 1) if (inReg[u] && nb[u].size) free.push(u);
      for (let sweep = 0; sweep < SWEEPS; sweep += 1) for (const u of free) { let sum = 0; for (const v of nb[u]) sum += a[v]; a[u] = sum / nb[u].size; }
      // THE SHOULDER'S TOP goes back toward the approved weights. Solved, the cap and the arm's
      // outward face lagged the arm and the top line sagged 2 cm between cap and arm (and the
      // trapezius rose); the approved file held that line level. So the solution is blended
      // back to the approved share by a weight that turns smoothly round the arm: whole on the
      // outward face (which a sideways raise turns into the top line) and on the top of the
      // shoulder, nothing on the front and back creases or in the armpit, where the approved
      // weights made the flaps. Smooth, so no seam opens where the two meet.
      let blended = 0;
      for (const u of free) {
        const i = rep[u], p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], r = [p[0] - s[0], p[1] - s[1], p[2] - s[2]], along = r[0] * au[0] + r[1] * au[1] + r[2] * au[2];
        const rad = [r[0] - along * au[0], r[1] - along * au[1], r[2] - along * au[2]], rl = Math.hypot(...rad), lateral = rl > 1e-4 ? rad[0] * Math.sign(s[0]) / rl : 0;
        const face = smooth(FACE_FROM, FACE_TO, lateral) * smooth(-0.1, -0.05, along) * (1 - smooth(ARM_RADIUS_M, ARM_RADIUS_M + 0.03, rl));
        const top = smooth(-0.01, 0.025, p[1] - s[1]) * smooth(MIDLINE_M - 0.02, MIDLINE_M + 0.01, Math.abs(p[0]));
        const g = Math.max(face, top); if (g <= 0) continue;
        a[u] += g * (a0[u] - a[u]); blended += 1;
      }
      log(`${joints[up].getName()}: ${blended} points on the shoulder's top blended back toward the approved weights`);
      // the new share written back: the arm's bones keep their split of it, the rest goes to the bones that held it (or the collarbone)
      let changed = 0, most = 0;
      for (const u of free) {
        const was = a0[u], now = Math.min(1, Math.max(0, a[u])), m = wmap[u]; if (Math.abs(now - was) < 0.005) continue;
        changed += 1; most = Math.max(most, Math.abs(now - was));
        const out = new Map();
        if (was > 1e-4) { for (const [k, x] of m) if (arm.has(k)) out.set(k, x * now / was); } else out.set(up, now);
        const rest = 1 - was; if (rest > 1e-4) { for (const [k, x] of m) if (!arm.has(k)) out.set(k, (out.get(k) || 0) + x * (1 - now) / rest); } else out.set(collar, (out.get(collar) || 0) + (1 - now));
        wmap[u] = out;
      }
      log(`${joints[up].getName()}: ${free.length} points solved around the shoulder, ${changed} changed (largest change ${(most * 100).toFixed(0)}% of the arm)`);
    }
    // THE RAISED-ARM CORRECTIVE, one per arm (armRaiseL / armRaiseR). With the arm raised
    // level, skin shared between arm and torso is drawn toward the shoulder's pivot (inside
    // her), most where it is half arm and half torso (the middle of the web), none on the
    // arm or the torso proper: the flat sheet becomes a hollow tucked into the armpit. The
    // move is taken back through her skinning to the rest pose, so it is a shape like any
    // other, nothing when the Lab leaves it off, and the Lab raises it with the arm.
    const raise = [];
    for (const up of ups) {
      const sp = wt[up], e = child(up).getWorldTranslation(), v = [e[0] - sp[0], e[1] - sp[1], e[2] - sp[2]], vl = Math.hypot(...v), u = v.map((x) => x / vl), o = [Math.sign(sp[0]), 0, 0];
      const c = [u[1] * o[2] - u[2] * o[1], u[2] * o[0] - u[0] * o[2], u[0] * o[1] - u[1] * o[0]], sn = Math.hypot(...c), k = c.map((x) => x / sn), th = Math.atan2(sn, u[0] * o[0]), cs = Math.cos(th), si = Math.sin(th);
      const K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]], R = [0, 1, 2].map((r) => [0, 1, 2].map((q) => (r === q ? 1 : 0) + si * K[r][q] + (1 - cs) * [0, 1, 2].reduce((t, m) => t + K[r][m] * K[m][q], 0)));
      const arm = new Set(joints.map((_, j) => (under(j, up) ? j : -1)).filter((j) => j >= 0)), d = new Float32Array(n * 3); let moved = 0, most = 0;
      for (let i = 0; i < n; i += 1) {
        const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; if (Math.sign(p[0]) !== Math.sign(sp[0])) continue;
        let a = 0; for (const [j, x] of wmap[id[i]]) if (arm.has(j)) a += x; a = Math.min(1, Math.max(0, a));
        const r0 = [p[0] - sp[0], p[1] - sp[1], p[2] - sp[2]], al0 = r0[0] * u[0] + r0[1] * u[1] + r0[2] * u[2], rad0 = Math.hypot(r0[0] - al0 * u[0], r0[1] - al0 * u[1], r0[2] - al0 * u[2]);
        const tuck = 4 * a * (1 - a) * TUCK; if (tuck < 0.01) continue;
        const r = [p[0] - sp[0], p[1] - sp[1], p[2] - sp[2]], rr = R.map((row) => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]);
        const posed = [0, 1, 2].map((m) => (1 - a) * p[m] + a * (sp[m] + rr[m]));
        // the web hangs BELOW the raised arm; the deltoid's top is above the pivot and is
        // left alone (pulled in, it dented into a notch over the shoulder cap)
        const below = 1 - smooth(TOP_FROM_M, TOP_FROM_M + 0.04, posed[1] - sp[1]); if (below <= 0) continue;
        const cpo = [0, 1, 2].map((m) => (sp[m] - posed[m]) * tuck * below);
        // the arm's own skin keeps its distance from the raised arm's axis (the tuck alone
        // thinned a raised arm by up to 40% beside a lowered one)
        const armness = (1 - smooth(ARM_RADIUS_M, ARM_RADIUS_M + 0.025, rad0)) * smooth(-0.01, 0.07, al0); // faded in over the top of the arm, so no step forms at the shoulder cap; and only what the tuck took is given back, never more
        if (armness > 0) {
          const ru = R.map((row) => row[0] * u[0] + row[1] * u[1] + row[2] * u[2]), t = [0, 1, 2].map((m) => posed[m] + cpo[m]), tr = [t[0] - sp[0], t[1] - sp[1], t[2] - sp[2]], ta = tr[0] * ru[0] + tr[1] * ru[1] + tr[2] * ru[2];
          const radv = [0, 1, 2].map((m) => tr[m] - ta * ru[m]), rl = Math.hypot(...radv);
          const pr = [posed[0] - sp[0], posed[1] - sp[1], posed[2] - sp[2]], pa = pr[0] * ru[0] + pr[1] * ru[1] + pr[2] * ru[2], radp = Math.hypot(pr[0] - pa * ru[0], pr[1] - pa * ru[1], pr[2] - pa * ru[2]);
          // out to the arm's own radius underneath; toward the deltoid's top, where the tuck fades,
          // only back to the radius the skinning gave it (more raised knobs on the shoulder)
          const lim = Math.min(rad0, radp) + below * Math.max(0, rad0 - radp);
          if (rl > 1e-5) { const want = rl + Math.max(0, lim - rl) * armness; for (let m = 0; m < 3; m += 1) cpo[m] = sp[m] + ta * ru[m] + radv[m] / rl * want - posed[m]; }
        }
        const B = [0, 1, 2].map((r2) => [0, 1, 2].map((q) => (r2 === q ? 1 - a : 0) + a * R[r2][q])), det = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
        const inv = [[B[1][1] * B[2][2] - B[1][2] * B[2][1], B[0][2] * B[2][1] - B[0][1] * B[2][2], B[0][1] * B[1][2] - B[0][2] * B[1][1]], [B[1][2] * B[2][0] - B[1][0] * B[2][2], B[0][0] * B[2][2] - B[0][2] * B[2][0], B[0][2] * B[1][0] - B[0][0] * B[1][2]], [B[1][0] * B[2][1] - B[1][1] * B[2][0], B[0][1] * B[2][0] - B[0][0] * B[2][1], B[0][0] * B[1][1] - B[0][1] * B[1][0]]].map((row) => row.map((x) => x / det));
        const bm = inv.map((row) => row[0] * cpo[0] + row[1] * cpo[1] + row[2] * cpo[2]);
        d.set(apply(Ti, bm, 0), i * 3); moved += 1; most = Math.max(most, Math.hypot(...cpo));
      }
      log(`${joints[up].getName()}: raised-arm corrective tucks ${moved} points, up to ${(most * 1000).toFixed(0)} mm toward the shoulder pivot`);
      raise.push({ name: sp[0] < 0 ? 'armRaiseR' : 'armRaiseL', d });
    }
    raise.sort((p2, q) => (p2.name < q.name ? -1 : 1));
    for (const { name, d } of raise) prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(d)).setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3))));
    const Jn = new Uint8Array(n * 4), Wn = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) { const top = [...wmap[id[i]]].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1]).slice(0, 4), sum = top.reduce((t, [, x]) => t + x, 0) || 1; top.forEach(([k, x], c) => { Jn[i * 4 + c] = k; Wn[i * 4 + c] = x / sum; }); }
    prim.getAttribute('JOINTS_0').setArray(Jn).setNormalized(false); prim.getAttribute('WEIGHTS_0').setArray(Wn).setNormalized(false);
  }
  const was = mesh.getWeights() ?? [];
  mesh.setExtras({ ...(mesh.getExtras() ?? {}), targetNames: [...names, 'armRaiseL', 'armRaiseR'], armWeights: '2026-10-15 harmonic armpits, approved shoulder top, raised-arm tuck' });
  mesh.setWeights([...(was.length === names.length ? was : new Array(names.length).fill(0)), 0, 0]);
  await io.write(dst, doc);
}

if (process.argv[1]?.endsWith('sarahV2ArmWeights.mjs')) await sarahV2ArmWeights(process.argv[2], process.argv[3]);
