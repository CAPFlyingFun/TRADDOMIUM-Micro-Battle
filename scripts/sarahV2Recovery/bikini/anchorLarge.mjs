// THE BIKINI BOTTOM KEEPS ITS PLACE PAST 100% (Joshua, 2026-10-18: "keep the front, sides, and back anchored
// appropriately to the pelvis and hips... don't simply enlarge the entire bikini"). Bound to the skin, the front
// rode her growing lower belly down 4 cm and forward 5 cm by 200%, which pulled the waist low and the side strings
// steep. Here, for belly150 and belly200 only, each point instead keeps its 100% place and moves only as far as
// it must to stay outside her at that size (straight out from the nearest skin, so under the bump the waist
// tucks under it rather than riding it forward), the move eased evenly over the cloth and pushed back out
// wherever the easing left it inside her. belly150 is given 8 mm more so the 125% crossfade stays clear. The approved 100% and every smaller size are untouched; between keys the Lab crossfades as before.
//   node scripts/sarahV2Recovery/bikini/anchorLarge.mjs <bottom.glb> <body.glb> <out.glb>
// (run on the alpha.98 bottom, git show 6fffd4d:public/models/sarah-v2-bottom.glb; then bikini/verify.mjs)
import { loadSkin, apply } from '../../sarahV2ProcBikini/skin.mjs';
import { labWeights, defaults, evaluate, lowerBodyCollider } from './morphs.mjs';
import { SkinCollider } from './collider.mjs';
import { closestBary } from '../../fitMeshyBikini.mjs';
const [bottomFile, bodyFile, out] = process.argv.slice(2);
const lab = await labWeights();
const s = await loadSkin(bottomFile), body = await loadSkin(bodyFile);
const B100 = evaluate(body, body.body, defaults(lab, 100)), col100 = lowerBodyCollider(B100, body.I);
const MIN_CLEAR = 0.16, EASE = Number(process.env.EASE ?? 20);
const desired = new Map(); const native = new Map(); for (const key of [150, 200]) for (const prim of s.mesh.listPrimitives()) native.set(`${key}:${s.mesh.listPrimitives().indexOf(prim)}`, evaluate(s, prim, defaults(lab, key)));
for (const key of [150, 200]) {
  const W = defaults(lab, key), name = `belly${key}`, k = s.names.indexOf(name);
  const Bk = evaluate(body, body.body, W), colK = lowerBodyCollider(Bk, body.I);
  for (const prim of s.mesh.listPrimitives()) {
    const X100 = evaluate(s, prim, defaults(lab, 100)), Xk = evaluate(s, prim, W), n = X100.length / 3;
    const I = prim.getIndices().getArray();
    // welded neighbours
    const keyOf = (i) => `${Math.round(X100[i*3]*1e3)},${Math.round(X100[i*3+1]*1e3)},${Math.round(X100[i*3+2]*1e3)}`;
    const repMap = new Map(), rep = new Int32Array(n); for (let i = 0; i < n; i++) { const kk = keyOf(i); if (!repMap.has(kk)) repMap.set(kk, i); rep[i] = repMap.get(kk); }
    const nb = new Map(); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[I[t+e]], b = rep[I[t+(e+1)%3]]; if (a === b) continue; if (!nb.has(a)) nb.set(a, new Set()); if (!nb.has(b)) nb.set(b, new Set()); nb.get(a).add(b); nb.get(b).add(a); }
    const reps = [...new Set(rep)];
    // each point's own clearance at 100% (the fabric's thickness is kept), then pushed out of the bigger body
    const D = new Map(); let moved = 0, most = 0;
    for (const a of reps) { const q = [X100[a*3], X100[a*3+1], X100[a*3+2]]; const h0 = col100.closest(q); const clear = Math.max(MIN_CLEAR, Math.min(1.2, h0 ? h0.signedDistance : MIN_CLEAR));
      const p = q.slice(); for (let pass = 0; pass < 12; pass++) { const h = colK.closest(p); if (!h || h.signedDistance >= clear - 1e-4) break; const step = clear - h.signedDistance + 0.001; const dir = h.projectionDirection ?? h.normal; for (let e = 0; e < 3; e++) p[e] += dir[e] * step; }
      const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; const l = Math.hypot(...d); if (l > 0.01) { moved++; most = Math.max(most, l); } D.set(a, d); }
    // ease the move evenly over the cloth (a fold-free field), then push back out whatever the easing left
    // inside her, and repeat: the result is smooth AND clear of her
    const EXTRA = key === 150 ? Number(process.env.EXTRA150 ?? 0.8) : Number(process.env.EXTRA200 ?? 0.5); const clearOf = new Map();
    for (const a of reps) { const h0 = col100.closest([X100[a*3], X100[a*3+1], X100[a*3+2]]); clearOf.set(a, Math.max(MIN_CLEAR, Math.min(1.2, h0 ? h0.signedDistance : MIN_CLEAR)) + (Math.hypot(...D.get(a)) > 0.01 ? EXTRA : 0)); }
    let G = D;
    for (let round = 0; round < 4; round++) {
      for (let r = 0; r < EASE; r++) { const H = new Map(); for (const a of reps) { const x = G.get(a), ns = nb.get(a); if (!ns) { H.set(a, x); continue; } const m = [0, 0, 0]; for (const b of ns) { const y = G.get(b); for (let e = 0; e < 3; e++) m[e] += y[e] / ns.size; } H.set(a, x.map((v, e) => 0.5 * v + 0.5 * m[e])); } G = H; }
      let fixed = 0; const H = new Map();
      for (const a of reps) { const d = G.get(a).slice(); const p = [X100[a*3] + d[0], X100[a*3+1] + d[1], X100[a*3+2] + d[2]]; const clear = clearOf.get(a);
        for (let pass = 0; pass < 12; pass++) { const h = colK.closest(p); if (!h || h.signedDistance >= clear - 1e-4) break; const step = clear - h.signedDistance + 0.001; const dir = h.projectionDirection ?? h.normal; for (let e = 0; e < 3; e++) { p[e] += dir[e] * step; d[e] += dir[e] * step; } if (pass === 0) fixed++; }
        H.set(a, d); }
      G = H; if (!fixed) break; console.log(`  round ${round}: ${fixed} points pushed back out after easing`);
    }
    // where each point should sit at this size; the shape itself is solved last, after the controls are re-taken
    const Y = new Float64Array(n * 3); for (let i = 0; i < n; i++) { const d = G.get(rep[i]); for (let e = 0; e < 3; e++) Y[i*3+e] = X100[i*3+e] + d[e]; }
    desired.set(`${key}:${s.mesh.listPrimitives().indexOf(prim)}`, Y);
    console.log(`${name} ${prim.getMaterial()?.getName()} (${n} verts): ${moved} points moved out of her, most ${most.toFixed(2)} cm`);
  }
}
// THE CONTROLS FOLLOW THE SKIN THE CLOTH NOW SITS ON. A point tucked under the bump still carried the tilt and
// belly-height offsets of the skin it was first bound to, so with BELLY TILT or HEIGHT moved off their defaults
// at 200% it went into her. Where a point moved, those size-specific controls are re-taken from the skin nearest
// it at that size (blended in by how far it moved). Controls that act at every size are left as bound, so the
// approved 100% is untouched.
const REBIND = { 150: ['shape:bellyHeightUp150', 'shape:bellyHeightDown150'], 200: ['bellyTilt', 'shape:bellyHeightUp200', 'shape:bellyHeightDown200', ...(process.env.REBIND_ALL !== '1' ? [] : ['shape:bellyWidth', 'shape:bellyDepth', 'shape:bellyLower', 'shape:bellyUpper'])] };
for (const key of [150, 200]) {
  const W = defaults(lab, key), Bk = evaluate(body, body.body, W), full = new SkinCollider(Bk, body.I);
  const tk = REBIND[key].map((nm) => [nm, s.names.indexOf(nm), body.names.indexOf(nm)]).filter(([, a, b]) => a >= 0 && b >= 0);
  s.mesh.listPrimitives().forEach((prim, pi) => {
    const Xn = desired.get(`${key}:${pi}`), Xo = native.get(`${key}:${pi}`), n = Xn.length / 3; let changed = 0;
    const arrays = tk.map(([, a]) => prim.listTargets()[a].getAttribute('POSITION'));
    const vals = arrays.map((A) => { const o = new Float32Array(A.getCount() * 3), e = []; for (let i = 0; i < A.getCount(); i++) { A.getElement(i, e); o.set(e, i * 3); } return o; });
    for (let i = 0; i < n; i++) { const mv = Math.hypot(Xn[i*3] - Xo[i*3], Xn[i*3+1] - Xo[i*3+1], Xn[i*3+2] - Xo[i*3+2]); const t = Math.min(1, Math.max(0, (mv - 0.2) / 0.8)); const w = t * t * (3 - 2 * t); if (!w) continue;
      const q = [Xn[i*3], Xn[i*3+1], Xn[i*3+2]], h = full.closest(q); if (!h) continue; const tri = [body.I[h.triangle*3], body.I[h.triangle*3+1], body.I[h.triangle*3+2]];
      const bc = closestBary(q, ...tri.map((v) => [Bk[v*3], Bk[v*3+1], Bk[v*3+2]]));
      tk.forEach(([, , b], j) => { const D = body.tgtLocal[b]; for (let e = 0; e < 3; e++) { const want = bc[0] * D[tri[0]*3+e] + bc[1] * D[tri[1]*3+e] + bc[2] * D[tri[2]*3+e]; vals[j][i*3+e] = (1 - w) * vals[j][i*3+e] + w * want; } });
      changed++; }
    arrays.forEach((A, j) => A.setArray(vals[j]));
    console.log(`${key}%: ${tk.map(([nm]) => nm).join(', ')} re-taken from the skin under ${changed} moved points (${prim.getMaterial()?.getName()} part ${pi})`);
  });
}
// LAST, the size shapes themselves: (where the point should sit) - (everything else the Lab applies at that size)
for (const key of [150, 200]) { const W = defaults(lab, key), k = s.names.indexOf(`belly${key}`);
  s.mesh.listPrimitives().forEach((prim, pi) => { const Y = desired.get(`${key}:${pi}`), Xk = evaluate(s, prim, W), n = Xk.length / 3;
    const T = prim.listTargets()[k].getAttribute('POSITION'), old2 = [], nt = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { T.getElement(i, old2); const err = [0, 1, 2].map((e) => (Y[i*3+e] - Xk[i*3+e]) / 100); const dl = apply(s.Ti, err, 0); for (let e = 0; e < 3; e++) nt[i*3+e] = old2[e] + dl[e]; }
    T.setArray(nt); }); console.log(`belly${key} solved against the re-taken controls`); }
await s.io.write(out, s.doc); console.log('written', out);
