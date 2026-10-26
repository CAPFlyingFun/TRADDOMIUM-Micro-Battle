"""Flatten moulded pleats in a base body's mesh (scripts/baseTouchup; see docs/reviews/base-touchups/README.md).

    python3 pleat.py <tag> <spec.json> [--from pos.bin nor.bin]

Each seam in the spec gives every welded vertex a distance to the seam. Vertices within `core`
are moved along the skin's normal onto a smooth patch fitted to the clean skin between `clean_in`
and `clean_out` either side, fading out by `feather`. Only the normal component moves, so the
texture does not slide. Writes <tag>/new-pos.bin, new-nor.bin (world space, every vertex).

seam kinds:
  {"kind": "loop", "y": [lo, hi], "rmax": m}                 a ring round the torso, height found per 10 deg
  {"kind": "leg_loop", "side": +1|-1, "y": [lo, hi], "back_only": true}   a ring round one leg
  {"kind": "plane_x", "x0": 0.006, "y": [lo, hi], "zmin": 0.0} a line down the front (the mirror seam)
  {"kind": "polyline_xy", "lines": [[[x, y], ...]], "side": "front"|"back", "zcut": z, "y": [lo, hi]}   drawn lines
  {"kind": "smooth_normals", ...}, {"kind": "rough", "boxes": [...]}   shading only; jagged patches
A seam with "mode": "fillet" is ROUNDED (Laplacian steps in its band) instead of projected: for a sharp
corner or a shelf, where a surface fitted across it would leave the edges of the step behind.
"""
import os, sys, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skin
from scipy.spatial import cKDTree
from scipy import sparse
from scipy.sparse.csgraph import connected_components

tag, spec_path = sys.argv[1:3]
spec = json.load(open(spec_path))
m = skin.load(tag); pos = m['pos'].astype(np.float64); nor = m['nor'].astype(np.float64); idx = m['idx']
if '--from' in sys.argv:
    k = sys.argv.index('--from')
    pos = np.fromfile(sys.argv[k + 1], np.float32).reshape(-1, 3).astype(np.float64)
    nor = np.fromfile(sys.argv[k + 2], np.float32).reshape(-1, 3).astype(np.float64)
key = np.round(m['pos'].astype(np.float64) / 1e-5).astype(np.int64)  # weld on the ORIGINAL positions
_, weld, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel()
P = pos[weld]; Nw = nor[weld]; F = inv[idx]; n = len(P)
e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
e2 = np.concatenate([e, e[:, ::-1]])
A = sparse.coo_matrix((np.ones(len(e2)), (e2[:, 0], e2[:, 1])), shape=(n, n)).tocsr(); A.data[:] = 1
Dm = sparse.diags(1 / np.asarray(A.sum(1)).ravel()) @ A

def local_normal_change(Q):
    fn = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]])
    VN = np.zeros_like(Q)
    for k in range(3): np.add.at(VN, F[:, k], fn)
    VN /= np.linalg.norm(VN, axis=1, keepdims=True) + 1e-12
    MN = Dm @ VN; MN /= np.linalg.norm(MN, axis=1, keepdims=True) + 1e-12
    return np.degrees(np.arccos(np.clip((VN * MN).sum(1), -1, 1)))

def ring_fit(ang, h, nd, sel, lo, step_deg=10):
    samples = []
    for a0 in np.radians(np.arange(-180, 180, step_deg)):
        s = sel & (ang >= a0) & (ang < a0 + np.radians(step_deg))
        if s.sum() < 15: continue
        nb = int(np.ceil((h[s].max() - lo) / 0.004)) + 1
        yb = np.clip(np.floor((h[s] - lo) / 0.004).astype(int), 0, nb - 1)
        prof = np.bincount(yb, nd[s], nb) / np.maximum(np.bincount(yb, None, nb), 1)
        k = prof.argmax(); bg = np.median(prof[prof > 0])
        samples.append((a0 + np.radians(step_deg / 2), lo + 0.004 * k + 0.002, max(prof[k] - bg, 0.1)))
    S = np.array(samples)
    B = lambda t: np.stack([np.ones_like(t)] + [f(k * t) for k in (1, 2, 3) for f in (np.cos, np.sin)], 1)
    Wt = np.sqrt(S[:, 2])
    coef, *_ = np.linalg.lstsq(B(S[:, 0]) * Wt[:, None], S[:, 1] * Wt, rcond=None)
    return lambda t: B(t) @ coef

def project(Q, QN, dist, core, feather, clean_in, clean_out, R, region, wmul=None, agree=None, max_move=None):
    w = np.clip((feather - dist) / (feather - core), 0, 1); w = w * w * (3 - 2 * w); w[~region] = 0
    if wmul is not None: w = w * wmul
    clean = region & (dist > clean_in) & (dist < clean_out)
    moving = np.nonzero(w > 0)[0]
    tree = cKDTree(Q[clean]); CP = Q[clean]; CN = QN[clean]
    Q2 = Q.copy(); QN2 = QN.copy(); moved = 0
    for v in moving:
        nb = tree.query_ball_point(Q[v], R)
        if agree is not None and len(nb):
            # only skin facing the same way: near an armpit the ball also reaches the inside of the
            # arm, and fitting the back's surface to the arm pulls the back toward it
            nb = [k for k in nb if CN[k] @ QN[v] > agree]
        if len(nb) < 12: continue
        X = CP[nb]; g = np.exp(-((X - Q[v]) ** 2).sum(1) / (2 * (R / 2) ** 2))
        nrm = (CN[nb] * g[:, None]).sum(0); nrm /= np.linalg.norm(nrm)
        t1 = np.cross(nrm, [0, 1, 0]) if abs(nrm[1]) < 0.9 else np.cross(nrm, [1, 0, 0]); t1 /= np.linalg.norm(t1); t2 = np.cross(nrm, t1)
        L = X - Q[v]; u, vv, h = L @ t1, L @ t2, L @ nrm
        Bm = np.stack([np.ones_like(u), u, vv, u * u, u * vv, vv * vv], 1); sw = np.sqrt(g)
        c, *_ = np.linalg.lstsq(Bm * sw[:, None], h * sw, rcond=None)
        h0 = c[0] if max_move is None else float(np.clip(c[0], -max_move, max_move))
        Q2[v] = Q[v] + w[v] * h0 * nrm
        pn = nrm - c[1] * t1 - c[2] * t2; pn /= np.linalg.norm(pn)
        mx = pn * w[v] + QN[v] * (1 - w[v]); QN2[v] = mx / np.linalg.norm(mx); moved += 1
    d = np.linalg.norm(Q2 - Q, axis=1)
    return Q2, QN2, moved, d.max(), w

Q, QN = P.copy(), Nw.copy()
for sd in spec['seams']:
    if sd['kind'] == 'smooth_normals':
        # shading only: normals averaged over the mesh in a feathered box, positions untouched
        lo, hi = sd['y']; yf = sd.get('yfeather', 0.03)
        t = np.clip(np.minimum(Q[:, 1] - (lo - yf), (hi + yf) - Q[:, 1]) / yf, 0, 1); wv = t * t * (3 - 2 * t)
        if sd.get('back_only'): wv *= np.clip((-Q[:, 2] + sd.get('zcut', 0.0)) / 0.03 + 0.5, 0, 1)
        if 'xabs' in sd: wv *= (np.abs(Q[:, 0]) > sd['xabs'][0]) & (np.abs(Q[:, 0]) < sd['xabs'][1])
        SN = QN.copy()
        for _ in range(sd.get('iterations', 6)):
            SN = Dm @ SN; SN /= np.linalg.norm(SN, axis=1, keepdims=True) + 1e-12
        a = (wv * sd.get('amount', 1.0))[:, None]
        QN = QN * (1 - a) + SN * a; QN /= np.linalg.norm(QN, axis=1, keepdims=True)
        print(sd.get('name', 'smooth_normals'), 'vertices', int((wv > 0.01).sum()))
        continue
    if sd['kind'] == 'rough':
        # jagged patches (torn finger clefts, lumpy toes): find rough vertices inside the boxes, grow
        # them a few rings across the mesh, and Taubin-smooth only there (follows the mesh's own
        # connections, so neighbouring fingers are never joined)
        nd = local_normal_change(Q)
        inbox = np.zeros(n, bool)
        for b in sd['boxes']:
            b = np.array(b); inbox |= np.all((Q >= b[:3]) & (Q <= b[3:]), axis=1)
        rough = inbox & (nd > sd.get('threshold', 6.0))
        wv = rough.astype(np.float64)
        for _ in range(sd.get('grow', 3)):
            wv = np.maximum(wv, (A @ wv) / np.asarray(A.sum(1)).ravel() * 1.6)
        wv = np.clip(wv, 0, 1) * inbox
        for _ in range(sd.get('iterations', 10)):
            for lam in (0.55, -0.58):
                Q = Q + (lam * ((Dm @ Q) - Q)) * wv[:, None]
        core = np.clip(wv * 2 - 1, 0, 1)[:, None]
        for _ in range(sd.get('shrink_iterations', 0)):
            Q = Q + 0.5 * ((Dm @ Q) - Q) * core
        fn = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]])
        VN = np.zeros_like(Q)
        for k in range(3): np.add.at(VN, F[:, k], fn)
        VN /= np.linalg.norm(VN, axis=1, keepdims=True) + 1e-12
        a = np.clip(wv * 2, 0, 1)[:, None]; QN = QN * (1 - a) + VN * a; QN /= np.linalg.norm(QN, axis=1, keepdims=True)
        print(sd.get('name', 'rough'), 'rough', int(rough.sum()), 'smoothed', int((wv > 0.01).sum()))
        np.save(f'{skin.ROOT}/{tag}/rough-w-{sd.get("name", "rough").split()[0]}.npy', wv[inv])
        continue
    nd = local_normal_change(Q)
    lo, hi = sd['y']
    if sd['kind'] == 'loop':
        ang = np.arctan2(Q[:, 0], Q[:, 2]); r = np.hypot(Q[:, 0], Q[:, 2])
        sel = (Q[:, 1] > lo) & (Q[:, 1] < hi) & (r < sd.get('rmax', 0.2))
        yc = ring_fit(ang, Q[:, 1], nd, sel, lo)(ang)
        dist = np.abs(Q[:, 1] - yc)
        win = dist < sd.get('clean_out', 0.045)
        keep = win[e[:, 0]] & win[e[:, 1]]
        _, lab = connected_components(sparse.coo_matrix((np.ones(keep.sum()), (e[keep, 0], e[keep, 1])), shape=(n, n)), directed=False)
        seed = np.argmin(np.where(win & (Q[:, 2] > 0), np.abs(Q[:, 0]) + dist, 9)); region = lab == lab[seed]
    elif sd['kind'] == 'leg_loop':
        side = sd['side']
        leg = (Q[:, 0] * side > 0.02) & (Q[:, 1] > lo - 0.05) & (Q[:, 1] < hi + 0.05) & (np.abs(Q[:, 0]) < 0.25)
        cx, cz = Q[leg, 0].mean(), Q[leg, 2].mean()
        ang = np.arctan2(Q[:, 0] - cx, Q[:, 2] - cz)
        sel = leg & (Q[:, 1] > lo) & (Q[:, 1] < hi)
        yc = ring_fit(ang, Q[:, 1], nd, sel, lo)(ang)
        dist = np.abs(Q[:, 1] - yc)
        region = leg & (dist < sd.get('clean_out', 0.045))
        if sd.get('back_only'): region &= np.cos(ang) < 0.2
    elif sd['kind'] == 'polyline_xy':
        # distance, seen from the back (or front), to drawn lines on the body: [[x, y], ...] per line
        best = np.full(n, 9.0)
        for line in sd['lines']:
            L = np.array(line, float)
            for a, b in zip(L[:-1], L[1:]):
                ab = b - a; t = np.clip(((Q[:, [0, 1]] - a) @ ab) / (ab @ ab), 0, 1)
                best = np.minimum(best, np.linalg.norm(Q[:, [0, 1]] - (a + t[:, None] * ab), axis=1))
        dist = best
        face = (Q[:, 2] < sd.get('zcut', 0.0)) if sd.get('side', 'back') == 'back' else (Q[:, 2] > sd.get('zcut', 0.0))
        region = face & (Q[:, 1] > lo) & (Q[:, 1] < hi) & (dist < sd.get('clean_out', 0.05))
    elif sd['kind'] == 'plane_x':
        dist = np.abs(Q[:, 0] - sd.get('x0', 0.0))
        yf = sd.get('yfeather', 0.0)
        region = (Q[:, 1] > lo - yf) & (Q[:, 1] < hi + yf) & (Q[:, 2] > sd.get('zmin', 0.0)) & (dist < sd.get('clean_out', 0.045))
    wmul = None
    if sd['kind'] == 'plane_x' and sd.get('yfeather'):
        yf = sd['yfeather']; t = np.clip(np.minimum(Q[:, 1] - (lo - yf), (hi + yf) - Q[:, 1]) / yf, 0, 1); wmul = t * t * (3 - 2 * t)
    for ex in sd.get('except', []):
        c, rr = np.array(ex['ellipsoid']), np.array(ex['r'])
        q = np.sqrt((((Q - c) / rr) ** 2).sum(1)); t = np.clip(q - 1, 0, 1) / max(ex.get('feather_r', 0.5), 1e-6); t = np.clip(t, 0, 1)
        wmul = (wmul if wmul is not None else 1) * (t * t * (3 - 2 * t))
    if sd.get('mode') == 'fillet':
        # ROUND a sharp corner or a shelf instead of fitting a surface across it (a fit across a step leaves
        # the step's edges): plain Laplacian steps in the band move each vertex toward its neighbours'
        # average, which fills a concave corner and eases a convex one, fading out by `feather`
        core, feather = sd.get('core', 0.009), sd.get('feather', 0.018)
        w = np.clip((feather - dist) / (feather - core), 0, 1); w = w * w * (3 - 2 * w); w[~region] = 0
        if wmul is not None: w = w * wmul
        Q0 = Q.copy()
        steps = (0.5, -0.53) if sd.get('taubin') else (0.5,)
        for _ in range(sd.get('iterations', 30)):
            for lam in steps:
                Q = Q + lam * ((Dm @ Q) - Q) * w[:, None]
        dq = Q - Q0; mag = np.linalg.norm(dq, axis=1)
        if sd.get('max_move'):
            Q = Q0 + dq * np.minimum(1, sd['max_move'] / np.maximum(mag, 1e-12))[:, None]; mag = np.minimum(mag, sd['max_move'])
        # the normals turn by as much as the SHAPE turned: each keeps its own smoothing and gains the change in the
        # surface's geometric normal (replacing them with geometric normals drew a seam where the band ends, since the
        # file's own normals are smoother than its triangles)
        def vnormals(X):
            fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]]); V = np.zeros_like(X)
            for k in range(3): np.add.at(V, F[:, k], fn)
            return V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-12)
        QN = QN + (vnormals(Q) - vnormals(Q0)); QN /= np.linalg.norm(QN, axis=1, keepdims=True)
        moved, mx = int((mag > 1e-7).sum()), float(mag.max())
    else:
        Q, QN, moved, mx, w = project(Q, QN, dist, sd.get('core', 0.009), sd.get('feather', 0.018), sd.get('clean_in', 0.012), sd.get('clean_out', 0.045), sd.get('R', 0.035), region, wmul, sd.get('normal_agree'), sd.get('max_move'))
    if sd.get('post_smooth') and sd.get('mode') != 'fillet':
        # settle the small disagreements between neighbouring fitted patches (shrink-free)
        for _ in range(sd['post_smooth']):
            for lam in (0.5, -0.53):
                Q = Q + (lam * ((Dm @ Q) - Q)) * w[:, None]
        fn = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]])
        VN = np.zeros_like(Q)
        for k in range(3): np.add.at(VN, F[:, k], fn)
        VN /= np.linalg.norm(VN, axis=1, keepdims=True) + 1e-12
        a = w[:, None]; QN = QN * (1 - a) + VN * a; QN /= np.linalg.norm(QN, axis=1, keepdims=True)
    print(sd.get('name', sd['kind']), 'moved', moved, 'max mm', round(mx * 1000, 2))
    np.save(f'{skin.ROOT}/{tag}/pleat-w-{sd.get("name", sd["kind"]).split()[0]}.npy', w[inv])
# a welded vertex nothing moved keeps every copy's OWN position and normal (copies along a UV seam can carry
# different normals); only what a seam changed is written from the welded mesh
changed = (np.abs(Q - P).max(1) > 1e-7) | (np.abs(QN / np.linalg.norm(QN, axis=1, keepdims=True) - Nw / np.linalg.norm(Nw, axis=1, keepdims=True)).max(1) > 1e-4)
outP = pos.copy(); outN = nor.copy()
cv = changed[inv]
outP[cv] = Q[inv][cv]; outN[cv] = QN[inv][cv]
print('vertices changed', int(cv.sum()), 'of', len(cv))
outP.astype(np.float32).tofile(f'{skin.ROOT}/{tag}/new-pos.bin'); outN.astype(np.float32).tofile(f'{skin.ROOT}/{tag}/new-nor.bin')
