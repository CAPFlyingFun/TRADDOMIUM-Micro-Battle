"""Hold a mesh fix clear of the garments it is worn under (scripts/baseTouchup).

    python3 garment_clearance.py <tag> <posed-dir> <states> [--margin 0.0003]

A seam rounded on the body moves skin outward as well as in. Worn under a fitted garment, skin that moves out can
come up through it. `<posed-dir>` holds the body (`body/`, the file as it is) and each garment (any other folder),
posed at each belly state (`<state>-p<n>-pos.bin`, `-idx.bin`, `<state>.json`) by the build's own morph targets and
skin; garments in the body's own file are its primitives after the first.

The clearance of a skin vertex is measured along its normal to the garment's TRIANGLES: a ray out to 10 mm, and in
to 2 mm, so skin already through a fitted garment's edge reads negative. Skin with no garment that near is not held. A vertex the fix moves must keep its clearance at least what it was, or
`margin`, whichever is smaller, at every state. A vertex that would not first loses the outward part of its move
(sliding along the skin and moving in stay, so a seam under a garment's edge still loses its jagged edge without
rising into it); one that still would loses the whole move. Each step is eased one ring into its neighbours and only
ever shrinks a move, and the check runs again until nothing sits under a garment. <work>/<tag>/new-pos.bin and
new-nor.bin are rewritten.

A fix's displacement is the same at every belly state: the morph targets are deltas added before skinning, so the
skin carries one local change through all of them."""
import os, sys, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skin
from scipy.spatial import cKDTree
from scipy import sparse

tag, posed, states = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
margin = float(sys.argv[sys.argv.index('--margin') + 1]) if '--margin' in sys.argv else 0.0003
REACH = 0.010; BEHIND = 0.002  # how far along the normal a garment counts
TOL = 0.0001   # how much deeper skin already under a garment's edge may go (a tenth of a millimetre)
D = f'{skin.ROOT}/{tag}'
p0 = np.fromfile(f'{D}/p0-pos.bin', np.float32).reshape(-1, 3).astype(np.float64)
n0 = np.fromfile(f'{D}/p0-nor.bin', np.float32).reshape(-1, 3).astype(np.float64)
p1 = np.fromfile(f'{D}/new-pos.bin', np.float32).reshape(-1, 3).astype(np.float64)
n1 = np.fromfile(f'{D}/new-nor.bin', np.float32).reshape(-1, 3).astype(np.float64)
d = p1 - p0
moved = np.where(np.linalg.norm(d, axis=1) > 1e-6)[0]
nr = n0 / (np.linalg.norm(n0, axis=1, keepdims=True) + 1e-12)
dn = (d * nr).sum(1)
d_out = np.maximum(dn, 0)[:, None] * nr           # the outward part of each move
d_rest = d - d_out                                 # sliding along the skin, and moving in

def load(folder, st, p):
    pos = np.fromfile(f'{posed}/{folder}/{st}-p{p}-pos.bin', np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(f'{posed}/{folder}/{st}-p{p}-idx.bin', np.uint32).reshape(-1, 3)
    return pos, idx

folders = sorted(f for f in os.listdir(posed) if os.path.isdir(f'{posed}/{f}'))
scenes = {}
for st in states:
    B, F = load('body', st, 0)
    fn = np.cross(B[F[:, 1]] - B[F[:, 0]], B[F[:, 2]] - B[F[:, 0]]); N = np.zeros_like(B)
    for k in range(3): np.add.at(N, F[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    tris = []
    for folder in folders:
        for m in json.load(open(f'{posed}/{folder}/{st}.json')):
            if folder == 'body' and m['prim'] == 0: continue
            G, I = load(folder, st, m['prim'])
            if len(I): tris.append(G[I])
    T = np.concatenate(tris) if tris else np.zeros((0, 3, 3))
    scenes[st] = (B, N, T, cKDTree(T.mean(1)) if len(T) else None, np.max(np.linalg.norm(T - T.mean(1, keepdims=True), axis=2)) if len(T) else 0)

def clearance(o, n, T):
    """Signed distance along n from o to the nearest of the triangles T (Moller-Trumbore, both ways); None if none."""
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    h = np.cross(n, e2); a = (e1 * h).sum(1)
    ok = np.abs(a) > 1e-14
    f = np.where(ok, 1 / np.where(ok, a, 1), 0)
    s = o - T[:, 0]; u = f * (s * h).sum(1)
    q = np.cross(s, e1); v = f * (q @ n); t = f * (e2 * q).sum(1)
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t <= REACH) & (t >= -BEHIND)
    if not hit.any(): return None
    t = t[hit]
    return t[np.argmin(np.abs(t))]

base = {}
checked = {}  # vertex -> the place it was last found clear at
def violators(p):
    bad = set()
    todo = [v for v in moved if v not in checked or np.any(checked[v] != p[v])]
    for st, (B, N, T, tree, rad) in scenes.items():
        if tree is None: continue
        for v in todo:
            key = (st, v)
            if key not in base:
                near = tree.query_ball_point(B[v], REACH + rad)
                base[key] = (near, clearance(B[v], N[v], T[near]) if near else None)
            near, c0 = base[key]
            if not near or c0 is None: continue  # no garment within reach of this skin: nothing to come through
            c1 = clearance(B[v] + (p[v] - p0[v]), N[v], T[near])
            if c1 is None: continue
            # clear of the garment by `margin`, or as clear as it was; where a fitted garment's edge already sat
            # slightly under the skin (they are fitted to within a millimetre or two), no deeper than it was
            if c0 is not None and c0 < margin: allowed = c0 - (TOL if c0 < 0 else 0)
            else: allowed = margin
            if c1 < allowed - 1e-5: bad.add(v)
    for v in todo:
        if v not in bad: checked[v] = p[v].copy()
    return bad

# welded mesh, to ease each step into the neighbours
key = np.round(p0 / 1e-5).astype(np.int64)
_, weld, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel()
idx = np.fromfile(f'{D}/p0-idx.bin', np.uint32).reshape(-1, 3); Fw = inv[idx]; n = len(weld)
e = np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]]); e2 = np.concatenate([e, e[:, ::-1]])
A = sparse.coo_matrix((np.ones(len(e2)), (e2[:, 0], e2[:, 1])), shape=(n, n)).tocsr(); A.data[:] = 1
Dm = sparse.diags(1 / np.asarray(A.sum(1)).ravel()) @ A
def ease(x, hit):
    """Lower x to 0 at the welded vertices hit, and their ONE ring of neighbours partway (only ever lower)."""
    x = x.copy(); x[hit] = 0
    m = np.zeros(n); m[hit] = 1
    ring = ((A @ m) > 0) & (m == 0)
    x[ring] = np.minimum(x[ring], (Dm @ x)[ring])
    return x

s_out = np.ones(n); s_all = np.ones(n)
place = lambda: p0 + (d_rest + d_out * s_out[inv][:, None]) * s_all[inv][:, None]
p = place()
for rnd in range(40):
    bad = violators(p)
    if rnd == 0 and os.environ.get('CLEARANCE_DUMP'): np.save(os.environ['CLEARANCE_DUMP'], np.array(sorted(bad), np.int64))
    if not bad: break
    w = np.unique(inv[list(bad)])
    first = w[s_out[w] > 0]; again = w[s_out[w] <= 0]
    if rnd >= 30:  # the last rounds take back the whole move at once, without easing, so it always ends
        s_out[w] = 0; s_all[w] = 0
    else:
        if len(first): s_out = ease(s_out, first)
        if len(again): s_all = ease(s_all, again)
    p = place()
    print(f'  round {rnd + 1}: {len(bad)} vertices would sit under a garment ({len(first)} lose their outward move, {len(again)} all of it)')
else:
    raise SystemExit('could not clear the garments in 40 rounds')
share = np.where(np.linalg.norm(d, axis=1) > 1e-9, np.linalg.norm(p - p0, axis=1) / np.maximum(np.linalg.norm(d, axis=1), 1e-12), 1)
nn = n0 * (1 - share[:, None]) + n1 * share[:, None]; nn /= np.linalg.norm(nn, axis=1, keepdims=True)
keep = np.linalg.norm(d, axis=1) <= 1e-6
p[keep] = p1[keep]; nn[keep] = n1[keep]
p.astype(np.float32).tofile(f'{D}/new-pos.bin'); nn.astype(np.float32).tofile(f'{D}/new-nor.bin')
print(f'{len(moved)} moved vertices: {int((s_out[inv][moved] < 0.999).sum())} keep less of their outward move, {int((s_all[inv][moved] < 0.999).sum())} less of all of it')
