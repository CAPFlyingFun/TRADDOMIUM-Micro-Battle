/** THE HIGH LEGGINGS' FIT CORRECTIONS (Joshua, 2026-10-19/20: "double check around the groin area and legs... it's
 * not smooth"; "fix the remaining 25% leggings geometry and check additional intermediate values"; "smooth the upper
 * edge of the over-belly leggings"). Rewrites ONLY the additive `shape:recoveryLeggings<key>` corrections; the 43
 * native targets, the skin and every native attribute stay byte-for-byte as recovered from the approved body.
 *
 *   node scripts/sarahV2Recovery/leggings-fit.mjs <leggings-in.glb> <body.glb> <out.glb> [--hem-delta delta.json] [--hem-only]
 *
 * Why these keys: her belly is a straight blend between native key sizes 0, 25, 30, 50, 60, 75, 100, 150 and 200
 * (belly25 peaks at 25, belly30 at 30 ...). A correction at each of those sizes makes every in-between size an exact
 * blend of two corrected shapes; with corrections at 0/50/100 only, the native in-between shapes (lumpy at 25%) showed
 * through. The Lab blends them with `fitWeights(bump, 'shape:recoveryLeggings', LEGGINGS_FIT_KEYS)`.
 *
 * Her vertices count as through the cloth by how high the nearest cloth sits above her skin along HER normal, and only
 * where that cloth lies roughly straight out from her: winding-free, since the back panels and the closed waistband face
 * inward, and skin just above the waistband (nearest the edge, sideways) never pushes it out.
 *
 * Per key, in posed world centimetres on her default body at that size:
 *  1. at 0-50% the cloth over the front of her torso, groin to top edge, is laid on her skin at the spot it covers at 100% (a nearest-
 *     point lay sends neighbours to opposite sides of the fold under her belly), then that fold (below 104 cm, so
 *     not her navel) is bridged outward, and the move is smoothed over the laid cloth so neighbours move alike;
 *  2. the top edge loop is smoothed along itself (briefly in 3D, then its height alone for long waves) and the change
 *     eased into the rows below;
 *  3. clearance both ways: no cloth point within CLEAR of her, and, around the waist (the top POKE_BELOW_TOP cm of each piece), no vertex of
 *     hers outside the cloth (her skin came through the middle of large cloth triangles near the top edge while every
 *     cloth vertex stood clear). Not lower: in the groin-to-thigh crease her normal flips and those pushes zig-zagged it;
 *  4. normal offsets are solved for how the Lab draws a leggings normal: rest + CPU offsets left RAW, + the GPU
 *     targets' normal offsets, normalized in the shader (SarahLabScene `normalizeNormals: false` for recovered clothes).
 * Then the ten `_HEM_<style>_<step>` cutoff fields are re-baked from the stored frames and shirt hem profiles
 * (optionally shifted by a shirt hem delta written by shirt-hem-fit.mjs), exactly as tests replay them.
 */
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { loadSkin, apply, read } from '../sarahV2ProcBikini/skin.mjs';
import { labWeights, defaults, evaluate } from './bikini/morphs.mjs';
import { SkinCollider } from './bikini/collider.mjs';

export const LEGGINGS_FIT_KEYS = [0, 25, 30, 50, 60, 75, 100, 150, 200];
// KEYS=0,25 refits only those keys (a quick look); the others keep what the input file has
const REFIT = process.env.KEYS ? process.env.KEYS.split(',').map(Number) : LEGGINGS_FIT_KEYS;
export const HEM_STEPS = [0, 50, 100, 150, 200];
const NATIVE_TARGETS = 43;
// GAME TUNING, world centimetres
const CLEAR = 0.15, SKIN_GAP = 0.25, WRAP_UP_TO = 50, BRIDGE_ROUNDS = 80, DISP_SMOOTH = 0, POKE_BELOW_TOP = 8.3, OVER_LEGGINGS = 0.08, EDGE_ROUNDS = 30, EDGE_HEIGHT_ROUNDS = 800, EDGE_RINGS = 8, EASE = 25;

const args = process.argv.slice(2), flag = (n) => args.includes(`--${n}`), opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1]; };
const [legFile, bodyFile, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--hem-delta'));
const t0 = Date.now(), lap = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const lab = await labWeights(); const body = await loadSkin(bodyFile), leg = await loadSkin(legFile);
const mesh = leg.mesh, prims = mesh.listPrimitives(), buffer = leg.doc.getRoot().listBuffers()[0];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Seam duplicates (split for UVs) move as one point: welded at REST within 0.1 mm, by union-find. Rounding to a grid
 * missed 245 near-coincident pairs, so the two sides of the groin seam were moved apart into a jagged line. */
const welds = new Map();
function seamWeld(prim) {
  if (welds.has(prim)) return welds.get(prim);
  const R = read(prim.getAttribute('POSITION')), n = R.length / 3, P = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) P.set(apply(leg.T, [R[i*3], R[i*3+1], R[i*3+2]], 1).map((x) => x * 100), i * 3);
  const parent = Int32Array.from({ length: n }, (_, i) => i), find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const TOL = 0.01, grid = new Map(), cell = (i) => [0, 1, 2].map((e) => Math.floor(P[i*3+e] / TOL));
  for (let i = 0; i < n; i++) { const k = cell(i).join(','); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  for (let i = 0; i < n; i++) { const c = cell(i); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(`${c[0]+dx},${c[1]+dy},${c[2]+dz}`) ?? []) { if (j <= i) continue; if (Math.hypot(P[i*3]-P[j*3], P[i*3+1]-P[j*3+1], P[i*3+2]-P[j*3+2]) <= TOL) { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } } }
  const rep = new Int32Array(n); for (let i = 0; i < n; i++) rep[i] = find(i);
  // points within NEAR at rest but not welded (the crotch gusset seam's panel edges, 0.1-0.5 mm apart) get one move
  const NEAR = 0.05, g2 = new Map(), c2 = (i) => [0, 1, 2].map((e) => Math.floor(P[i*3+e] / NEAR)); for (let i = 0; i < n; i++) { const k = c2(i).join(','); if (!g2.has(k)) g2.set(k, []); g2.get(k).push(i); }
  const near = []; for (let i = 0; i < n; i++) { const c = c2(i); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of g2.get(`${c[0]+dx},${c[1]+dy},${c[2]+dz}`) ?? []) { if (j <= i || rep[i] === rep[j]) continue; if (Math.hypot(P[i*3]-P[j*3], P[i*3+1]-P[j*3+1], P[i*3+2]-P[j*3+2]) <= NEAR) near.push([rep[i], rep[j]]); } }
  rep.near = near;
  welds.set(prim, rep); return rep;
}

// ---- the nine correction targets, in key order after the 43 native ones ------------------------------------------
{ const names = leg.names.slice(0, NATIVE_TARGETS);
  for (const prim of prims) {
    const n = prim.getAttribute('POSITION').getCount(), have = new Map(prim.listTargets().slice(NATIVE_TARGETS).map((t, i) => [leg.names[NATIVE_TARGETS + i], t]));
    for (const t of prim.listTargets().slice(NATIVE_TARGETS)) prim.removeTarget(t);
    for (const key of LEGGINGS_FIT_KEYS) {
      const name = `shape:recoveryLeggings${key}`; let t = have.get(name);
      if (!t) { t = leg.doc.createPrimitiveTarget(name); for (const s of ['POSITION', 'NORMAL']) t.setAttribute(s, leg.doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3)).setBuffer(buffer)); }
      prim.addTarget(t);
    }
  }
  leg.names = [...names, ...LEGGINGS_FIT_KEYS.map((k) => `shape:recoveryLeggings${k}`)];
  mesh.setWeights([...mesh.getWeights().slice(0, NATIVE_TARGETS), ...LEGGINGS_FIT_KEYS.map(() => 0)]);
  mesh.setExtras({ ...mesh.getExtras(), targetNames: leg.names }); }

if (!flag('hem-only')) {
  // her 100% skin, and the triangle list every size shares
  const W100 = defaults(lab, 100), B100 = evaluate(body, body.body, W100), IDX = [];
  for (let i = 0; i < body.I.length; i += 3) if ([0, 1, 2].some((e) => B100[body.I[i+e]*3+1] > 35 && B100[body.I[i+e]*3+1] < 140)) IDX.push(body.I[i], body.I[i+1], body.I[i+2]);
  const col100 = new SkinCollider(B100, IDX), bodyVerts = [...new Set(IDX)];
  const smoothNormals = (B) => { const key = (v) => `${Math.round(B[v*3]*1e4)},${Math.round(B[v*3+1]*1e4)},${Math.round(B[v*3+2]*1e4)}`, acc = new Map();
    for (let t = 0; t < IDX.length; t += 3) { const [a, b, c] = [IDX[t], IDX[t+1], IDX[t+2]]; const u = [0, 1, 2].map((e) => B[b*3+e] - B[a*3+e]), v = [0, 1, 2].map((e) => B[c*3+e] - B[a*3+e]); const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; for (const i of [a, b, c]) { const k = key(i); if (!acc.has(k)) acc.set(k, [0, 0, 0]); const m = acc.get(k); for (let e = 0; e < 3; e++) m[e] += n[e]; } }
    return (i) => { const m = acc.get(key(i)) ?? [0, 1, 0], l = Math.hypot(...m) || 1; return m.map((x) => x / l); }; };
  const bary = (B, t, q) => { const [a, b, c] = [IDX[t*3], IDX[t*3+1], IDX[t*3+2]]; const P = (i) => [B[i*3], B[i*3+1], B[i*3+2]]; const A0 = P(a), v0 = P(b).map((x, e) => x - A0[e]), v1 = P(c).map((x, e) => x - A0[e]), v2 = q.map((x, e) => x - A0[e]); const d = (x, y) => x[0]*y[0] + x[1]*y[1] + x[2]*y[2]; const d00 = d(v0, v0), d01 = d(v0, v1), d11 = d(v1, v1), d20 = d(v2, v0), d21 = d(v2, v1), den = d00*d11 - d01*d01 || 1e-12; const v = (d11*d20 - d01*d21) / den, w = (d00*d21 - d01*d20) / den; return [[a, b, c], [1 - v - w, v, w]]; };

  for (const key of REFIT) {
    const W = defaults(lab, key), k = leg.names.indexOf(`shape:recoveryLeggings${key}`);
    const B = evaluate(body, body.body, W), col = new SkinCollider(B, IDX), nrmK = smoothNormals(B);
    let mainMove = null;
    for (const prim of prims) {
      const mat = prim.getMaterial()?.getName(), T = prim.listTargets()[k], TP = T.getAttribute('POSITION'), TN = T.getAttribute('NORMAL');
      TP.setArray(new Float32Array(TP.getCount() * 3));
      const A = evaluate(leg, prim, W), n = A.length / 3, I = prim.getIndices().getArray();
      const rep = seamWeld(prim);
      const nb = new Map(); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[I[t+e]], b = rep[I[t+(e+1)%3]]; if (a === b) continue; if (!nb.has(a)) nb.set(a, new Set()); if (!nb.has(b)) nb.set(b, new Set()); nb.get(a).add(b); nb.get(b).add(a); }
      const reps = [...new Set(rep)], cur = new Map(reps.map((a) => [a, [A[a*3], A[a*3+1], A[a*3+2]]])), total = new Map(reps.map((a) => [a, [0, 0, 0]])), shaped = new Map();
      const move = (a, d, w = 1) => { const p = cur.get(a), t = total.get(a); for (let e = 0; e < 3; e++) { p[e] += d[e] * w; t[e] += d[e] * w; } };
      const notes = [];

      // 1. LAID ON HER, THEN BRIDGED (0-50%, the lower belly and groin)
      const mainCloth = mat === 'leggings' || mat === 'leggingsLow';
      if (mainCloth && key <= WRAP_UP_TO) {
        // the whole front of her torso from the groin to the top edge (the native small sizes crumple under the edge too)
        const wOf = (p) => ss(70, 77, p[1]) * (1 - ss(17, 24, Math.abs(p[0]))) * ss(-6, -1, p[2]);
        const bridgeOf = (p) => 1 - ss(100, 104, p[1]); // the fold under her belly, not her navel's own dimple
        const A100 = evaluate(leg, prim, W100);
        for (const a of reps) { const p = cur.get(a), w = wOf(p); if (!w) continue; shaped.set(a, w); const h = col100.closest([A100[a*3], A100[a*3+1], A100[a*3+2]]); if (!h) continue; const [vs, bw] = bary(B100, h.triangle, h.point); const q = [0, 0, 0], nn = [0, 0, 0]; vs.forEach((vi, j) => { const nv = nrmK(vi); for (let e = 0; e < 3; e++) { q[e] += bw[j] * B[vi*3+e]; nn[e] += bw[j] * nv[e]; } }); const ln = Math.hypot(...nn) || 1; move(a, q.map((x, e) => x + nn[e] / ln * SKIN_GAP - p[e]), w); }
        const outN = new Map(); for (const a of shaped.keys()) { const h = col.closest(cur.get(a)); if (h) outN.set(a, h.normal.slice()); }
        for (let r = 0; r < BRIDGE_ROUNDS; r++) { const upd = []; for (const [a, nrm] of outN) { const ns = nb.get(a); if (!ns || ns.size < 3) continue; const p = cur.get(a), m = [0, 0, 0]; for (const b of ns) { const y = cur.get(b); for (let e = 0; e < 3; e++) m[e] += y[e] / ns.size; } const o = ((m[0]-p[0])*nrm[0] + (m[1]-p[1])*nrm[1] + (m[2]-p[2])*nrm[2]) * shaped.get(a) * bridgeOf(p); if (o > 1e-4) upd.push([a, o * 0.7]); } for (const [a, o] of upd) move(a, outN.get(a), o); }
        // neighbours move alike: where a crease (groin to inner thigh) sent neighbouring points to different sides of
        // it, the laid cloth zig-zagged. The move itself is smoothed over the laid cloth; clearance below restores the gap.
        for (let r = 0; r < DISP_SMOOTH; r++) { const nx = new Map(); for (const [a, w] of shaped) { const ns = nb.get(a); if (!ns || ns.size < 3) continue; const m = [0, 0, 0]; for (const b of ns) { const t = total.get(b); for (let e = 0; e < 3; e++) m[e] += t[e] / ns.size; } nx.set(a, total.get(a).map((v, e) => v + 0.5 * w * (m[e] - v))); } for (const [a, t2] of nx) { const t = total.get(a), p = cur.get(a); for (let e = 0; e < 3; e++) { p[e] += t2[e] - t[e]; t[e] = t2[e]; } } }
        notes.push(`${shaped.size} laid on her and bridged`);
      }

      // 1b. THE WAISTBAND FOLLOWS THE LEGGINGS: a trim piece at the waist takes, at each point, the move of the leggings
      // surface under it (moved on its own, the low waistband and the leggings top crossed, dark through light grey)
      const isWaistband = !mainCloth && mainMove && (() => { let y = -Infinity; for (const a of reps) y = Math.max(y, cur.get(a)[1]); return y > 60; })();
      if (isWaistband) {
        const { A: MA, I: MI, total: MT, rep: MR } = mainMove, mc = new SkinCollider(MA, MI);
        for (const a of reps) { const p = cur.get(a), h = mc.closest(p); if (!h || h.distance > 2) continue; const t = h.triangle, vs = [MI[t*3], MI[t*3+1], MI[t*3+2]];
          const P0 = vs.map((v) => [MA[v*3], MA[v*3+1], MA[v*3+2]]), e0 = P0[1].map((x, e) => x - P0[0][e]), e1 = P0[2].map((x, e) => x - P0[0][e]), e2 = h.point.map((x, e) => x - P0[0][e]);
          const d = (x, y) => x[0]*y[0] + x[1]*y[1] + x[2]*y[2], d00 = d(e0, e0), d01 = d(e0, e1), d11 = d(e1, e1), d20 = d(e2, e0), d21 = d(e2, e1), den = d00*d11 - d01*d01 || 1e-12; const v = (d11*d20 - d01*d21) / den, w = (d00*d21 - d01*d20) / den, bw = [1 - v - w, v, w];
          const mv = [0, 0, 0]; vs.forEach((vi, j) => { const tv = MT.get(MR[vi]); for (let e = 0; e < 3; e++) mv[e] += bw[j] * tv[e]; }); move(a, mv); shaped.set(a, 1); }
        notes.push('waistband moved with the leggings under it');
      }
      // 2. THE TOP EDGE RUNS SMOOTHLY: the boundary loops above 100 cm (the leggings' and the waistband trim's), each
      // smoothed along itself and eased into the cloth below
      // the waist, measured from this piece's own top at this size (the high rise tops out near 116 cm, the low near 95)
      let topY = -Infinity; for (const a of reps) topY = Math.max(topY, cur.get(a)[1]);
      const reachesWaist = topY > 60 && !isWaistband, EDGE_FROM = topY - 16, POKE_LOW = topY - POKE_BELOW_TOP;
      if (reachesWaist) {
        const cnt = new Map(); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[I[t+e]], b = rep[I[t+(e+1)%3]]; if (a === b) continue; const kk = a < b ? `${a}|${b}` : `${b}|${a}`; cnt.set(kk, (cnt.get(kk) ?? 0) + 1); }
        const loop = new Map(); for (const [kk, c] of cnt) if (c === 1) { const [a, b] = kk.split('|').map(Number); if (cur.get(a)[1] < EDGE_FROM || cur.get(b)[1] < EDGE_FROM) continue; if (!loop.has(a)) loop.set(a, []); if (!loop.has(b)) loop.set(b, []); loop.get(a).push(b); loop.get(b).push(a); }
        const start = new Map([...loop.keys()].map((a) => [a, cur.get(a).slice()]));
        for (let r = 0; r < EDGE_ROUNDS; r++) { const nx = new Map(); for (const [a, ns] of loop) { if (ns.length !== 2) continue; const p = cur.get(a), m = ns.map((b) => cur.get(b)); nx.set(a, p.map((v, e) => 0.5 * v + 0.25 * (m[0][e] + m[1][e]))); } for (const [a, q] of nx) { const p = cur.get(a); for (let e = 0; e < 3; e++) p[e] = q[e]; } }
        // then its HEIGHT alone, far longer: that straightens waves centimetres long without drawing the loop in
        for (let r = 0; r < EDGE_HEIGHT_ROUNDS; r++) { const ny = new Map(); for (const [a, ns] of loop) { if (ns.length !== 2) continue; ny.set(a, 0.5 * cur.get(a)[1] + 0.25 * (cur.get(ns[0])[1] + cur.get(ns[1])[1])); } for (const [a, y] of ny) cur.get(a)[1] = y; }
        const D = new Map(); for (const [a, s0] of start) { const p = cur.get(a), d = p.map((v, e) => v - s0[e]); for (let e = 0; e < 3; e++) p[e] = s0[e]; D.set(a, d); }
        // loop corners and branch points (not two boundary neighbours) take their neighbours' average move, not none
        for (let it = 0; it < 4; it++) for (const [a, ns] of loop) if (ns.length !== 2) { const m = [0, 0, 0]; for (const b of ns) { const d = D.get(b); for (let e = 0; e < 3; e++) m[e] += d[e] / ns.length; } D.set(a, m); }
        // the rows below follow smoothly: a harmonic falloff, the edge's move held, nothing EDGE_RINGS rows down, and the
        // rows between relaxed to the average of their neighbours (each row copying its nearest edge point kinked it)
        const ring = new Map([...D.keys()].map((a) => [a, 0])); let frontier = [...D.keys()];
        for (let r = 1; r <= EDGE_RINGS + 1; r++) { const next = []; for (const a of frontier) for (const b of nb.get(a) ?? []) if (!ring.has(b)) { ring.set(b, r); next.push(b); } frontier = next; }
        const V = new Map([...ring.keys()].map((a) => [a, D.get(a) ?? [0, 0, 0]]));
        for (let it = 0; it < 120; it++) for (const [a, r] of ring) { if (r === 0 || r > EDGE_RINGS) continue; const ns = [...(nb.get(a) ?? [])].filter((x) => V.has(x)); if (!ns.length) continue; const m = [0, 0, 0]; for (const x of ns) { const v = V.get(x); for (let e = 0; e < 3; e++) m[e] += v[e] / ns.length; } V.set(a, m); }
        let most = 0; for (const [a, r] of ring) { if (r > EDGE_RINGS) continue; const v = V.get(a); move(a, v); shaped.set(a, Math.max(shaped.get(a) ?? 0, 1 - r / (EDGE_RINGS + 1))); most = Math.max(most, Math.hypot(...v)); }
        notes.push(`top edge ${D.size} points smoothed (moved at most ${(most*10).toFixed(1)} mm)`);
      }

      // near-coincident points share one move (their mean), so no seam opens or folds between them
      for (let it = 0; it < 6; it++) for (const [a, b] of rep.near) { const ta = total.get(a), tb = total.get(b); if (!ta || !tb) continue; for (let e = 0; e < 3; e++) { const m = 0.5 * (ta[e] + tb[e]); cur.get(a)[e] += m - ta[e]; cur.get(b)[e] += m - tb[e]; ta[e] = m; tb[e] = m; } }
      // 3. CLEAR OF HER BOTH WAYS
      let first = -1, firstPoke = -1;
      for (let round = 0; round < 8; round++) {
        const F = new Map(), push = (a, d) => { const o = F.get(a); if (!o || Math.hypot(...d) > Math.hypot(...o)) F.set(a, d); };
        let need = 0, poke = 0;
        for (const a of reps) { const p = cur.get(a); if (p[1] < 35) continue; const h = col.closest(p); if (h && h.signedDistance < CLEAR) { const m = CLEAR - h.signedDistance + 0.002, d = h.projectionDirection ?? h.normal; push(a, d.map((x) => x * m)); need++; } }
        if (reachesWaist) {
          const li = []; for (let t = 0; t < I.length; t += 3) { const y = (cur.get(rep[I[t]])[1] + cur.get(rep[I[t+1]])[1] + cur.get(rep[I[t+2]])[1]) / 3; if (y > 60 && y < 125) li.push(rep[I[t]], rep[I[t+1]], rep[I[t+2]]); }
          if (li.length) { const P = new Float64Array(n * 3); for (const a of reps) P.set(cur.get(a), a * 3); const lc = new SkinCollider(P, li);
            for (const v of bodyVerts) { const q = [B[v*3], B[v*3+1], B[v*3+2]]; if (q[1] < POKE_LOW || q[1] > topY + 7) continue; const h = lc.closest(q); if (!h || h.distance > 1.5) continue;
              // how high the nearest cloth sits above her skin along HER normal: winding-free (the back panels and the
              // closed waistband face inward), and only where that cloth lies roughly straight out from her
              const nv = nrmK(v), d = h.point.map((x, e) => x - q[e]), height = d[0]*nv[0] + d[1]*nv[1] + d[2]*nv[2], tang = Math.hypot(...d.map((x, e) => x - height * nv[e]));
              if (tang > 0.4 || height >= CLEAR || height < -1) continue;
              const m = CLEAR - height + 0.002, tri = [li[h.triangle*3], li[h.triangle*3+1], li[h.triangle*3+2]]; for (const a of tri) push(a, nv.map((x) => x * m)); poke++;
              if (process.env.DIAG && round === 0) { const kk = `y${Math.round(q[1]/4)*4} x${Math.round(q[0]/4)*4} z${Math.round(q[2]/4)*4}`; (globalThis.__pk ??= {})[kk] = Math.min((globalThis.__pk ?? {})[kk] ?? 9, height); } }
            if (process.env.DIAG && round === 0) { console.log('   pokes (cloth height above her):', Object.entries(globalThis.__pk ?? {}).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([k, v]) => `${k}:${(v*10).toFixed(1)}mm`).join('  ')); globalThis.__pk = {}; } }
        }
        if (round === 0) { first = need; firstPoke = poke; } if (!F.size) break;
        let G = F; for (let r = 0; r < EASE; r++) { const H = new Map(); for (const a of reps) { const own = F.get(a), x = G.get(a) ?? [0, 0, 0], ns = nb.get(a); if (!ns) { H.set(a, x); continue; } const m = [0, 0, 0]; for (const b of ns) { const y = G.get(b) ?? [0, 0, 0]; for (let e = 0; e < 3; e++) m[e] += y[e] / ns.size; } const sm = x.map((v, e) => 0.5 * v + 0.5 * m[e]); H.set(a, own && Math.hypot(...own) > Math.hypot(...sm) ? own.map((v, e) => 0.5 * v + 0.5 * sm[e]) : sm); } G = H; }
        for (const [a, d] of G) move(a, d);
      }
      notes.push(`clearance: ${first} cloth points too close, ${firstPoke} of her vertices through the cloth, at first`);

      // 3b. THE WAISTBAND STAYS ON THE OUTSIDE of the corrected leggings: at least OVER_LEGGINGS above them, measured along
      // her normal (both cloth layers of the band, so the leggings never show through it), eased over the band
      if (isWaistband) {
        const { A: MA, I: MI, total: MT, rep: MR } = mainMove, MC = Float64Array.from(MA, (x, i) => x + MT.get(MR[Math.floor(i / 3)])[i % 3]), mc = new SkinCollider(MC, MI);
        let lifted = 0, most2 = 0;
        for (let round = 0; round < 4; round++) { const F = new Map();
          for (const a of reps) { const p = cur.get(a), h = mc.closest(p); if (!h || h.distance > 1.5) continue; const sk = col.closest(h.point); if (!sk) continue; const n = sk.normal, height = (p[0]-h.point[0])*n[0] + (p[1]-h.point[1])*n[1] + (p[2]-h.point[2])*n[2]; if (height < OVER_LEGGINGS) F.set(a, n.map((x) => x * (OVER_LEGGINGS - height + 0.002))); }
          if (round === 0) lifted = F.size; if (!F.size) break;
          let G = F; for (let r = 0; r < 10; r++) { const H = new Map(); for (const a of reps) { const own = F.get(a), x = G.get(a) ?? [0, 0, 0], ns = nb.get(a); if (!ns) { H.set(a, x); continue; } const m = [0, 0, 0]; for (const b of ns) { const y = G.get(b) ?? [0, 0, 0]; for (let e = 0; e < 3; e++) m[e] += y[e] / ns.size; } const sm = x.map((v, e) => 0.5 * v + 0.5 * m[e]); H.set(a, own && Math.hypot(...own) > Math.hypot(...sm) ? own.map((v, e) => 0.5 * v + 0.5 * sm[e]) : sm); } G = H; }
          for (const [a, d] of G) { move(a, d); most2 = Math.max(most2, Math.hypot(...d)); } }
        notes.push(`${lifted} band points lifted onto the outside of the leggings (at most ${(most2*10).toFixed(1)} mm a round)`);
      }
      if (mainCloth) mainMove = { A, I, total, rep };
      // write the position offsets (local units)
      const nt = new Float32Array(n * 3); let most = 0; for (let i = 0; i < n; i++) { const t = total.get(rep[i]); most = Math.max(most, Math.hypot(...t)); nt.set(apply(leg.Ti, t.map((x) => x / 100), 0), i * 3); }
      TP.setArray(nt);
      // 4. normal offsets for the Lab's raw normal sum
      if (TN) {
        const vn = (pos) => { const N = new Float64Array(n * 3); for (let t = 0; t < I.length; t += 3) { const [ia, ib, ic] = [I[t], I[t+1], I[t+2]]; const u = [0, 1, 2].map((e) => pos(ib, e) - pos(ia, e)), v = [0, 1, 2].map((e) => pos(ic, e) - pos(ia, e)); const c = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; for (const i of [ia, ib, ic]) for (let e = 0; e < 3; e++) N[rep[i]*3+e] += c[e]; } const O = new Float64Array(n * 3); for (let i = 0; i < n; i++) { const r = rep[i], l = Math.hypot(N[r*3], N[r*3+1], N[r*3+2]) || 1; for (let e = 0; e < 3; e++) O[i*3+e] = N[r*3+e] / l; } return O; };
        TN.setArray(new Float32Array(n * 3));
        const RN = read(prim.getAttribute('NORMAL')); prim.listTargets().forEach((tg, kk) => { const w = W[leg.names[kk]] ?? 0, a2 = tg.getAttribute('NORMAL'); if (!w || !a2) return; const d = read(a2); for (let i = 0; i < RN.length; i++) RN[i] += d[i] * w; });
        const n1 = vn((i, e) => A[i*3+e] + total.get(rep[i])[e]);
        const nA = []; let agree = 0; for (let i = 0; i < n; i++) { const wn = apply(leg.T, [RN[i*3], RN[i*3+1], RN[i*3+2]], 0).map((x) => x / leg.tS); nA.push(wn); if (i % 50 === 0) agree += wn[0]*n1[i*3] + wn[1]*n1[i*3+1] + wn[2]*n1[i*3+2]; }
        const sg = agree >= 0 ? 1 : -1, nn = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const mv = Math.hypot(...total.get(rep[i])), blend = Math.max(Math.min(1, mv / 0.05), shaped.get(rep[i]) ?? 0); if (blend < 1e-3) continue; const len = Math.max(Math.hypot(...nA[i]), 0.5); const d = [0, 1, 2].map((e) => blend * (sg * n1[i*3+e] * len - nA[i][e])); if (Math.hypot(...d) < 1e-4) continue; nn.set(apply(leg.Ti, d, 0).map((x) => x * leg.tS), i * 3); }
        TN.setArray(nn);
      }
      lap(`${key}% ${mat} (${n}): ${notes.join('; ')}; moved at most ${(most*10).toFixed(1)} mm`);
    }
  }
}

// ---- the cutoff fields, replayed from the stored frames exactly as tests replay them -------------------------------
const meta = mesh.getExtras().recoveryLeggingsHem;
if (meta) { const delta = opt('hem-delta') ? JSON.parse(readFileSync(opt('hem-delta'), 'utf8')) : null;
  for (const profile of meta.profiles) {
    const [, , style, stepText] = profile.semantic.split('_'), step = Number(stepText), shift = delta?.[style.toLowerCase()]?.[step];
    if (shift) { profile.cellLowerHemCm = profile.cellLowerHemCm.map((y, i) => y + shift[i]); profile.hemMinCm = Math.min(...profile.cellLowerHemCm); profile.hemMaxCm = Math.max(...profile.cellLowerHemCm); }
    const f = profile.frame, outer = new Matrix4().fromArray(f.bodyMatrix).multiply(new Matrix4().fromArray(f.bindMatrixInverse)), bind = new Matrix4().fromArray(f.bindMatrix), blend = new Matrix4(), map = new Matrix4(), v3 = new Vector3();
    for (const prim of prims) {
      const base = read(prim.getAttribute('POSITION')), corr = read(prim.listTargets()[leg.names.indexOf(`shape:recoveryLeggings${step}`)].getAttribute('POSITION'));
      const joints = read(prim.getAttribute('JOINTS_0')), skin = read(prim.getAttribute('WEIGHTS_0'));
      const morphs = prim.listTargets().slice(0, NATIVE_TARGETS).map((t) => ({ w: f.weights[f.dict[t.getName()]] ?? 0, t })).filter((m) => m.w).map((m) => ({ w: m.w, a: read(m.t.getAttribute('POSITION')) }));
      const dist = new Float32Array(base.length / 3);
      for (let v = 0; v < dist.length; v++) { const o = v * 3, p = [0, 1, 2].map((d) => Math.fround(base[o+d] + corr[o+d])); for (const m of morphs) for (let d = 0; d < 3; d++) p[d] += m.w * m.a[o+d];
        blend.elements.fill(0); for (let c = 0; c < 4; c++) for (let d = 0; d < 16; d++) blend.elements[d] += skin[v*4+c] * f.boneMatrices[joints[v*4+c]*16+d];
        map.copy(outer).multiply(blend).multiply(bind); v3.fromArray(p).applyMatrix4(map);
        const theta = Math.atan2(v3.x, v3.z + 6), cell = Math.floor(((theta / (2 * Math.PI) * 1024) % 1024 + 1024) % 1024); dist[v] = v3.y - profile.cellLowerHemCm[cell]; }
      const old = prim.getAttribute(profile.semantic); prim.setAttribute(profile.semantic, leg.doc.createAccessor(profile.semantic).setType('SCALAR').setArray(dist).setBuffer(buffer)); old?.dispose();
    }
  }
  mesh.setExtras({ ...mesh.getExtras(), recoveryLeggingsHem: meta });
  lap(`cutoff fields re-baked for ${meta.profiles.length} profiles${delta ? ' (shirt hem delta applied)' : ''}`); }
mesh.setExtras({ ...mesh.getExtras(), recoveryLeggings: { ...mesh.getExtras().recoveryLeggings, fitKeys: LEGGINGS_FIT_KEYS, fit: { script: 'scripts/sarahV2Recovery/leggings-fit.mjs', clearCm: CLEAR, skinGapCm: SKIN_GAP, laidUpTo: WRAP_UP_TO } } });

await leg.io.write(out, leg.doc); lap(`written ${out}`);
