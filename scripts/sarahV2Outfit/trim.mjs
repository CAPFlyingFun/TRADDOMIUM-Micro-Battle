// BOUND EDGES for a grown garment: every open edge of the cloth (neckline, armholes, hem, waistband,
// cuffs) traced as a loop, smoothed, and covered by a flat ribbon centred on it, bound to her skin and
// moved as one piece. Loops shorter than `minLen` (stray slivers) are skipped.
import { loadSkin, apply } from '../../scripts/sarahV2ProcBikini/skin.mjs';
import { binder, addPiece, smoothAlong } from '../../scripts/sarahV2ProcBikini/bind.mjs';
import { resample, layOnSurface, sweepRibbon, V } from '../../scripts/sarahV2ProcBikini/ribbon.mjs';
import { vertexNormals } from '../../scripts/fitMeshyBikini.mjs';
const { sub, len, add, scl } = V;
const [src, out, ...specs] = process.argv.slice(2);   // name:width:thick:clear:r,g,b
const s = await loadSkin(src); const bind = binder(s); const surface = { nearest: (p) => s.nearest(p) };
for (const sp of specs) {
  const [name, W, T, C, col] = sp.split(':'); const width = +W, thick = +T, clear = +C;
  const prim = s.mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === name);
  const P = prim.getAttribute('POSITION'), n = P.getCount(), v = [], pts = [];
  for (let i = 0; i < n; i += 1) { P.getElement(i, v); pts.push(apply(s.T, v, 1)); }
  // weld by place (the fabric's seam copies are not edges)
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) { const k = pts[i].map((x) => Math.round(x * 2e4)).join(','); if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
  const I = prim.getIndices().getArray(), ec = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e += 1) { const a = rep[I[t + e]], b = rep[I[t + (e + 1) % 3]]; if (a === b) continue; const k = a < b ? `${a},${b}` : `${b},${a}`; ec.set(k, (ec.get(k) || 0) + 1); }
  const adj = new Map(); for (const [k, c] of ec) if (c === 1) { const [a, b] = k.split(',').map(Number); for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } }
  const seen = new Set(), loops = [];
  for (const st of adj.keys()) { if (seen.has(st)) continue; const loop = [st]; seen.add(st); let prev = -1, cur = st;
    for (;;) { const nx = adj.get(cur).find((x) => x !== prev && !seen.has(x)); if (nx === undefined) break; loop.push(nx); seen.add(nx); prev = cur; cur = nx; }
    // walk the other way from the start too, so a broken chain comes back whole
    if (loop.length > 1) loops.push(loop.map((i) => pts[i])); }
  // join the pieces end to end (a cut edge pinches at a few vertices and the walk stops there)
  const D = (a, b) => len(sub(a, b)); const pieces = loops.splice(0); 
  while (pieces.length) { let chain = pieces.shift(); let grew = true;
    while (grew) { grew = false; let best = -1, bd = 0.012, flip = false, front = false;
      const head = chain[0], tail = chain[chain.length - 1];
      pieces.forEach((pc, k) => { for (const [d, f, fr] of [[D(tail, pc[0]), false, false], [D(tail, pc[pc.length - 1]), true, false], [D(head, pc[pc.length - 1]), false, true], [D(head, pc[0]), true, true]]) if (d < bd) { bd = d; best = k; flip = f; front = fr; } });
      if (best >= 0) { let pc = pieces.splice(best, 1)[0]; if (flip) pc = pc.slice().reverse(); chain = front ? [...pc, ...chain] : [...chain, ...pc]; grew = true; } }
    loops.push(chain); }
  const mat = s.doc.createMaterial(name + 'Trim').setBaseColorFactor([...col.split(',').map(Number), 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
  let made = 0;
  for (const L of loops) {
    const total = L.reduce((a, p, k) => a + len(sub(p, L[(k + 1) % L.length])), 0); if (total < 0.1) continue;
    // ORDER the edge by angle round the loop, in its own best-fit plane (an edge loop is a ring);
    // joined pieces otherwise double back and the binding zig-zags
    const c = scl(L.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / L.length);
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of L) { const d = sub(p, c); for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) cov[a][b] += d[a] * d[b]; }
    const power = (M, skip) => { let x = [Math.random(), Math.random(), Math.random()]; for (let k = 0; k < 60; k += 1) { let y = [0, 1, 2].map((a) => M[a][0] * x[0] + M[a][1] * x[1] + M[a][2] * x[2]); if (skip) { const d = y[0] * skip[0] + y[1] * skip[1] + y[2] * skip[2]; y = y.map((v2, a) => v2 - d * skip[a]); } const l = Math.hypot(...y) || 1; x = y.map((v2) => v2 / l); } return x; };
    const e1 = power(cov), e2 = power(cov, e1);
    const ord = L.map((p) => { const d = sub(p, c); return [Math.atan2(d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2], d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2]), p]; }).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    let path = resample(ord, 0.002, true);
    for (let r = 0; r < Number(process.env.TRIM_SMOOTH ?? 400); r += 1) for (const lam of [0.5, -0.53]) { const m = path.length; path = path.map((q, i) => { const a = path[(i - 1 + m) % m], b = path[(i + 1) % m]; return q.map((x, e) => x + lam * ((a[e] + b[e]) / 2 - x)); }); }
    // only pushed OUT where it would sit under the cloth's height, then eased so the push leaves no kink
    // the band sits at the height its own cloth edge stands off her (the tank stands further off over the
    // leggings at its hem than at its neck and arms), never under the given clearance
    const offs = L.map((q) => { const h = s.nearest(q); return h ? (q[0] - h.q[0]) * h.n[0] + (q[1] - h.q[1]) * h.n[1] + (q[2] - h.q[2]) * h.n[2] : clear; }).sort((a, b) => a - b);
    const want = Math.max(clear, offs[Math.floor(offs.length / 2)]) + thick / 2;
    console.log(`  edge stands ${(offs[Math.floor(offs.length / 2)] * 1000).toFixed(1)} mm off her; band laid at ${(want * 1000).toFixed(1)} mm`);
    { const m = path.length; const tau = (P2) => { for (let r = 0; r < Number(process.env.TRIM_FINAL ?? 200); r += 1) for (const lam of [0.5, -0.53]) P2 = P2.map((q, i) => { const a = P2[(i - 1 + m) % m], b = P2[(i + 1) % m]; return q.map((x, e) => x + lam * ((a[e] + b[e]) / 2 - x)); }); return P2; };
      for (let it = 0; it < 4; it += 1) {
        // the push each point needs, and the direction, both smoothed ALONG the edge before use
        let push = path.map((q) => { const h = s.nearest(q); if (!h) return [0, [0, 0, 1]]; const d = (q[0] - h.q[0]) * h.n[0] + (q[1] - h.q[1]) * h.n[1] + (q[2] - h.q[2]) * h.n[2]; return [Math.max(0, want - d), h.n]; });
        let amt = push.map((x) => x[0]), dir = push.map((x) => x[1]);
        for (let r = 0; r < 80; r += 1) { amt = amt.map((x, i) => Math.max(x, (amt[(i - 1 + m) % m] + 2 * x + amt[(i + 1) % m]) / 4)); dir = dir.map((x, i) => x.map((v2, e) => (dir[(i - 1 + m) % m][e] + 2 * v2 + dir[(i + 1) % m][e]) / 4)); }
        path = tau(path.map((q, i) => { const l = Math.hypot(...dir[i]) || 1; return add(q, scl(dir[i], amt[i] / l)); }));
      } }
    const laid = layOnSurface(path, surface, { clear: want, rounds: 0, closed: true, hug: 0 });
    { const P2 = laid.path, m = P2.length; let worst = 0, sum = 0; for (let i = 0; i < m; i += 1) { const a = sub(P2[i], P2[(i - 1 + m) % m]), b = sub(P2[(i + 1) % m], P2[i]); const c = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1)))) * 180 / Math.PI; worst = Math.max(worst, c); sum += c; }
      let wob = 0; for (let i = 0; i < m; i += 1) { const q = s.nearest(P2[i]); if (q) wob = Math.max(wob, q.dist); } console.log(`  path turn per 2 mm: worst ${worst.toFixed(1)} deg, mean ${(sum / m).toFixed(2)}; furthest off her ${(wob * 1000).toFixed(1)} mm`); }
    // and the laid line itself eased again along the edge (laying it on the cut surface brings back the
    // triangles' zigzag as a ripple some 4 cm long, which a Taubin pass keeps; a plain average removes it,
    // and over a loop this long shrinks it by far less than a millimetre)
    { const m = laid.path.length; let Q = laid.path.map((x) => [...x]); for (let r = 0; r < Number(process.env.TRIM_LAID ?? 600); r += 1) for (const lam of [0.5]) Q = Q.map((q, i) => { const a = Q[(i - 1 + m) % m], b = Q[(i + 1) % m]; return q.map((x, e) => x + lam * ((a[e] + b[e]) / 2 - x)); }); laid.path = Q;
      // then set back to its height off her: the offset each point needs (in or out), smoothed along the
      // edge so only its slow part is applied, never a ripple
      for (let it = 0; it < 4; it += 1) { let amt = Q.map((q) => { const h = s.nearest(q); return h ? want - ((q[0] - h.q[0]) * h.n[0] + (q[1] - h.q[1]) * h.n[1] + (q[2] - h.q[2]) * h.n[2]) : 0; }), dir = Q.map((q) => { const h = s.nearest(q); return h ? [...h.n] : [0, 0, 0]; });
        for (let r = 0; r < 200; r += 1) { amt = amt.map((x, i) => (amt[(i - 1 + m) % m] + 2 * x + amt[(i + 1) % m]) / 4); dir = dir.map((x, i) => x.map((v2, e) => (dir[(i - 1 + m) % m][e] + 2 * v2 + dir[(i + 1) % m][e]) / 4)); }
        Q = Q.map((q, i) => { const l = Math.hypot(...dir[i]) || 1; return q.map((x, e) => x + dir[i][e] / l * amt[i]); }); }
      laid.path = Q; }
    // the band's facing is eased ALONG the edge: per-point surface normals at a cut edge disagree from one
    // triangle to the next, and a band that follows them rolls in and out like a lettuce hem
    { const m = laid.normals.length; let N = laid.normals.map((x) => [...x]); for (let r = 0; r < Number(process.env.TRIM_ROLL ?? 300); r += 1) N = N.map((x, i) => x.map((v2, e) => (N[(i - 1 + m) % m][e] + 2 * v2 + N[(i + 1) % m][e]) / 4)); laid.normals = N.map((x) => { const l = Math.hypot(...x) || 1; return x.map((v2) => v2 / l); }); }
    const rib = sweepRibbon(laid.path, laid.normals, { width, thickness: thick, closed: true, seg: 12 });
    const bd = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: laid.path.length, closed: true, rounds: Number(process.env.TRIM_ALONG ?? 400) });
    addPiece(s, bd, rib.indices, mat, vertexNormals(bd.pos, rib.indices)); made += 1;
    console.log(`${name}: edge ${(total * 100).toFixed(0)} cm bound, ${(width * 1000).toFixed(0)} mm wide`);
  }
  // the trim shows with its garment: same name prefix is not enough for the Lab, so it is named in extras
  mat.setExtras({ trimOf: name });
}
await s.io.write(out, s.doc); console.log('written', out);
