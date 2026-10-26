"""Region touch-ups on a base body's textures, chosen on the body in 3D.

    python3 touch.py <tag> <spec.json> <outdir> [--base in.png] [--normal in.png]

spec = {"ops": [ {op, zone, ...}, ... ]}
  op "smooth":  colour across the skin's surface; sigma_mm, strength (0..1), detail (0..1)
  op "level":   colour toward the surface average at a large scale (evens out patchy baked shading)
  op "flatten": normal map toward flat; amount (0..1)
  op "gain":    colour times gain (lifts a cavity the mesh shades too dark)
zone: a list of shapes unioned; "except": shapes cut out. Each shape has a feather in metres.
  {"ellipsoid": [cx,cy,cz], "r": [rx,ry,rz]}
  {"box": [x0,y0,z0,x1,y1,z1]}
  {"curve": "<tag>/line_dy.npy" , "width": m}   per-vertex distance field saved by a fix script
  {"polyline_xy": [[x, y], ...], "width": m, "zmin"/"zmax": z, "mirror": true}   a line drawn on the body seen from the front
Positions are metres for a body standing 0..1.70 m, +Z the front, +X the body's left."""
import sys, json, numpy as np, os
sys.path.insert(0, os.path.dirname(__file__))
import skin
from PIL import Image

tag, spec_path, outdir = sys.argv[1:4]
args = dict(zip(sys.argv[4::2], sys.argv[5::2]))
os.makedirs(outdir, exist_ok=True)
spec = json.load(open(spec_path))
D = f'{skin.ROOT}/{tag}'
tid = np.load(f'{D}/tid.npy'); P = np.load(f'{D}/P.npy'); N = np.load(f'{D}/N.npy'); cov = tid >= 0
TEX = f'{skin.ROOT}/tex'
src_base = args.get('--base') or next(f'{TEX}/{f}' for f in os.listdir(TEX) if f.startswith(f'{tag}-Material_0-base'))
src_norm = args.get('--normal') or next(f'{TEX}/{f}' for f in os.listdir(TEX) if f.startswith(f'{tag}-Material_0-normal'))
base = np.asarray(Image.open(src_base).convert('RGB'))
norm = np.asarray(Image.open(src_norm).convert('RGB'))
H, W = tid.shape
if base.shape[:2] != (H, W): raise SystemExit('texture size differs from the bake')
lin = skin.srgb_to_lin(base)
nrm = norm.astype(np.float32) / 127.5 - 1

m = None
def per_vertex_field(path):
    global m
    if m is None:
        m = skin.load(tag); m['t'], m['b'] = tid, np.load(f'{D}/bary.npy') if os.path.exists(f'{D}/bary.npy') else None
    if m['b'] is None:
        t2, b2 = skin.raster(m, H); np.save(f'{D}/bary.npy', b2); m['b'] = b2
    f = np.load(path if os.path.isabs(path) else next((p for p in (os.path.join(skin.REPO, path), os.path.join(skin.ROOT, path)) if os.path.exists(p)), path)).astype(np.float32)
    return skin.attr_map(m, tid, m['b'], f[:, None])[..., 0]

def smooth01(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)

C = skin.charts(tag)
def grain_ratio(lin, op):
    """The skin's own fine grain, as a ratio to its local average, so a smoothed patch can be given
    it back: smoothing takes out the patchy shading AND the pores; this returns the pores. The
    average is taken inside each UV chart only, so a chart's edge (where the bake's seams are)
    carries no step from the chart beside it, and the ratio is clipped so nothing sharp returns.
    grain 0 = none (fully smooth), 1 = all of it; grain_px is the scale kept (a texel is ~0.77 mm)."""
    g = op.get('grain', 1.0)
    if g <= 0:
        return 1.0
    clip = op.get('grain_clip', 0.25)
    loc = skin.chart_blur(lin, C, op.get('grain_px', 3.0))
    r = np.clip(lin / np.maximum(loc, 1e-4), 1 - clip, 1 + clip)
    r[~cov] = 1.0
    if op.get('edge_grain_px'):
        # a chart's own edge is where the bake left its seam: a rim of texels lighter or darker than the
        # chart inside. Measured against an average that stops at that edge, the rim reads as "grain" and
        # would come back with it, a step along the chart's outline (under her right breast it outlined a
        # whole small chart). Near the edge the grain fades out.
        r = r ** smooth01(chart_edge_px() / op['edge_grain_px'])[..., None]
    return r ** g

_edge = None
def chart_edge_px():
    """Per texel, the distance in texels to the nearest edge of a UV chart."""
    global _edge
    if _edge is None:
        import cv2
        Cp = np.pad(C, 1, constant_values=-1)
        border = np.zeros(C.shape, bool)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                border |= Cp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] != C
        _edge = cv2.distanceTransform((~border).astype(np.uint8), cv2.DIST_L2, 5)
    return _edge

def shape_w(s):
    f = s.get('feather', 0.01)
    if 'ellipsoid' in s:
        c = np.array(s['ellipsoid']); r = np.array(s['r'])
        q = np.sqrt((((P - c) / r) ** 2).sum(-1))  # 1 on the surface of the ellipsoid
        d = (q - 1) * r.min()  # approx metres outside
        return smooth01(-d / f + 1) if f > 0 else (q <= 1).astype(np.float32)
    if 'box' in s:
        b = np.array(s['box']); lo, hi = b[:3], b[3:]
        out = np.maximum(np.maximum(lo - P, P - hi), 0)
        d = np.sqrt((out ** 2).sum(-1))
        return smooth01(1 - d / f)
    if 'curve' in s:
        dist = per_vertex_field(s['curve'])
        return smooth01((s['width'] + f - dist) / f)
    if 'polyline_xy' in s:
        # distance, seen from the front (x, y), to a line drawn on the body; zmin keeps it to the front
        pts = np.array(s['polyline_xy'], np.float32)
        if s.get('mirror'):
            pts = np.concatenate([pts[::-1] * [-1, 1], pts[1:] if pts[0, 0] == 0 else pts])
        q = P[..., :2]
        d = np.full(q.shape[:2], np.inf, np.float32)
        for a, b in zip(pts[:-1], pts[1:]):
            ab = b - a
            t = np.clip(((q - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
            d = np.minimum(d, np.linalg.norm(q - (a + t[..., None] * ab), axis=-1))
        w = smooth01((s['width'] + f - d) / f)
        if 'zmin' in s:
            w = w * (P[..., 2] > s['zmin'])
        if 'zmax' in s:
            w = w * (P[..., 2] < s['zmax'])
        return w
    raise ValueError(s)

def facing(s, w):
    # "ny_min": only skin whose normal points at least this much up (keeps a zone off the underside of a breast)
    return w * (N[..., 1] > s['ny_min']) if 'ny_min' in s else w

def zone_w(z):
    w = np.zeros((H, W), np.float32)
    for s in z['shapes']: w = np.maximum(w, facing(s, shape_w(s)))
    for s in z.get('except', []): w = w * (1 - shape_w(s))
    w[~cov] = 0
    return w

edited = np.zeros((H, W), bool)
for op in spec['ops']:
    w = zone_w(op['zone']) * op.get('strength', 1.0)
    sel = w > 1e-3
    print(op['op'], op.get('name', ''), 'texels', int(sel.sum()))
    if op['op'] in ('smooth', 'level'):
        sig = op['sigma_mm'] / 1000
        blurred = skin.surface_blur(P, cov, lin, w, sig)
        if 'detail' in op and 'grain' not in op:
            op = dict(op, grain=op['detail'])
        lin = lin * (1 - w[..., None]) + blurred * grain_ratio(lin, dict(op, grain=op.get('grain', 0.0))) * w[..., None]
        edited |= sel
    elif op['op'] == 'seams':
        # find colour jumps the skin's shape does not explain: texels far from their own small-scale
        # surface average, grown across the surface, then smoothed at a larger scale
        zone = w
        small = skin.surface_blur(P, cov, lin, zone, op.get('detect_mm', 4) / 1000)
        lum = lambda x: x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        hp = np.abs(lum(lin) - lum(small))
        t0, t1 = op.get('threshold', [0.008, 0.03])
        score = smooth01((hp - t0) / (t1 - t0)) * (zone > 1e-3)
        grown = skin.surface_blur(P, cov, score[..., None], zone, op.get('grow_mm', 8) / 1000)[..., 0]
        mask = smooth01(grown * op.get('grow_gain', 6.0)) * zone
        blurred = skin.surface_blur(P, cov, lin, mask, op['sigma_mm'] / 1000)
        # a texel far brighter or darker than its surroundings is a LINE (a baked crease or a seam),
        # not a pore: it gets no grain back, or the line would come back with it
        # (judged against this zone's own grain: the strongest ~1% of its texels, since a coarse-grained
        # skin's pores are as strong as a fine-grained skin's lines)
        zsel = zone > 1e-3
        g0, g1 = (np.percentile(hp[zsel], op.get('line_guard_pct', [99, 99.8])) if zsel.any() else (1, 2))
        from scipy import ndimage as ndi
        guard = ndi.maximum_filter(smooth01((hp - g0) / (g1 - g0)), size=3)
        r = grain_ratio(lin, op)
        if not np.isscalar(r):
            r = r ** (1 - guard[..., None])
        lin = lin * (1 - mask[..., None]) + blurred * r * mask[..., None]
        if op.get('flatten'):
            a = (mask * op['flatten'])[..., None]
            flat = np.zeros_like(nrm); flat[..., 2] = 1
            nrm = nrm * (1 - a) + flat * a
            nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-6
        sel = mask > 1e-3; edited |= sel
        Image.fromarray(np.round(mask * 255).astype(np.uint8)).save(f'{outdir}/seam-mask-{spec["ops"].index(op)}.png')
        print('   seam texels', int((mask > 0.5).sum()))
    elif op['op'] == 'gain':
        lin = lin * (1 + (op['gain'] - 1) * w[..., None])
        edited |= sel
    elif op['op'] == 'flatten':
        a = (w * op.get('amount', 1.0))[..., None]
        flat = np.zeros_like(nrm); flat[..., 2] = 1
        nrm = nrm * (1 - a) + flat * a
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-6
        edited |= sel
out_base = skin.lin_to_srgb(lin)
out_norm = np.clip(np.round((nrm + 1) * 127.5), 0, 255).astype(np.uint8)
# every texel not edited keeps its exact original bytes, the empty gutters included...
keep = ~edited
out_base[keep] = base[keep]; out_norm[keep] = norm[keep]
# ...except gutter texels that only an edited island reads, which take the edit
out_base = skin.bleed(out_base, cov, edited, 4)
out_norm = skin.bleed(out_norm, cov, edited, 4)
Image.fromarray(out_base).save(f'{outdir}/base.png')
Image.fromarray(out_norm).save(f'{outdir}/normal.png')
mask = np.zeros((H, W), np.uint8); mask[edited] = 255
Image.fromarray(mask).save(f'{outdir}/edited-mask.png')
print('edited texels', int(edited.sum()), 'of', int(cov.sum()))
