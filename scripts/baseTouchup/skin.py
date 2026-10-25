"""Skin touch-up kit for the Meshy base bodies (scripts/baseTouchup; see docs/reviews/base-touchups/README.md).

Everything is done on the body's SURFACE, not in the scattered UV atlas:
a texel is edited by where it sits on the body in 3D, so a region is chosen
in 3D and a blur measures distance across the skin, not across unrelated
atlas islands that happen to sit side by side in the image.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# the working folder: a body's dumps and maps (TOUCHUP_WORK, default .scratch/baseTouchup, which git ignores)
ROOT = os.environ.get('TOUCHUP_WORK') or os.path.join(REPO, '.scratch', 'baseTouchup')


def load(tag):
    d = f'{ROOT}/{tag}/p0'
    meta = json.load(open(d + '.json'))
    pos = np.fromfile(d + '-pos.bin', np.float32).reshape(-1, 3)
    nor = np.fromfile(d + '-nor.bin', np.float32).reshape(-1, 3)
    uv = np.fromfile(d + '-uv.bin', np.float32).reshape(-1, 2)
    idx = np.fromfile(d + '-idx.bin', np.uint32).reshape(-1, 3)
    return dict(meta=meta, pos=pos, nor=nor, uv=uv, idx=idx)


def raster(m, size):
    """Per texel: triangle id (-1 = no skin) and barycentrics, sampled at texel centres."""
    W = H = size
    uvp = m['uv'] * np.array([W, H], np.float32)  # pixel coords, texel centre at i + 0.5
    tri = uvp[m['idx']]  # (T,3,2)
    tid = np.full((H, W), -1, np.int32)
    bary = np.zeros((H, W, 3), np.float32)
    lo = np.floor(tri.min(1) - 0.5).astype(np.int64)
    hi = np.ceil(tri.max(1) - 0.5).astype(np.int64)
    span = (hi - lo + 1).max(1)
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
    ok = np.abs(den) > 1e-12
    for S in (4, 8, 16, 32, 64, 128, 256):
        sel = np.where(ok & (span <= S) & (span > S // 2 if S > 4 else span <= S))[0]
        if not len(sel):
            continue
        for start in range(0, len(sel), max(1, 4_000_000 // (S * S))):
            t = sel[start:start + max(1, 4_000_000 // (S * S))]
            gx, gy = np.meshgrid(np.arange(S), np.arange(S))
            X = lo[t, 0][:, None] + gx.ravel()[None]
            Y = lo[t, 1][:, None] + gy.ravel()[None]
            px, py = X + 0.5, Y + 0.5
            A, B, C, D = a[t], b[t], c[t], den[t][:, None]
            w0 = ((B[:, 1] - C[:, 1])[:, None] * (px - C[:, 0][:, None]) + (C[:, 0] - B[:, 0])[:, None] * (py - C[:, 1][:, None])) / D
            w1 = ((C[:, 1] - A[:, 1])[:, None] * (px - C[:, 0][:, None]) + (A[:, 0] - C[:, 0])[:, None] * (py - C[:, 1][:, None])) / D
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4) & (X >= 0) & (Y >= 0) & (X < W) & (Y < H)
            ti, k = np.nonzero(inside)
            tid[Y[ti, k], X[ti, k]] = t[ti]
            bary[Y[ti, k], X[ti, k]] = np.stack([w0[ti, k], w1[ti, k], w2[ti, k]], 1)
    return tid, bary


def attr_map(m, tid, bary, attr):
    """Interpolate a per-vertex attribute (V,k) to every covered texel."""
    out = np.zeros(tid.shape + (attr.shape[1],), np.float32)
    cov = tid >= 0
    v = m['idx'][tid[cov]]  # (n,3)
    w = bary[cov]
    out[cov] = (attr[v[:, 0]] * w[:, :1] + attr[v[:, 1]] * w[:, 1:2] + attr[v[:, 2]] * w[:, 2:3])
    return out


def srgb_to_lin(x):
    x = x.astype(np.float32) / 255
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.round(255 * np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)).astype(np.uint8)


def surface_blur(P, cov, img, wmask, sigma_m, cell_m=None, region_pad=None):
    """Blur `img` (H,W,C float) across the body's surface: texels are binned into a 3D grid by
    where they sit on the body, the grid is Gaussian-blurred, and the result is read back only
    where wmask > 0. Returns the blurred values for every texel (unchanged outside the mask)."""
    # The grid is built in TILES of at most TILE cells a side (plus a margin of 4 sigma), and only
    # tiles that hold a selected texel are built: a 1 mm grid over a whole body is hundreds of
    # millions of cells and does not fit in memory, but the skin is a thin shell, so most tiles
    # are empty.
    cell = cell_m or sigma_m / 2.5
    sel = wmask > 0
    if not sel.any():
        return img.copy()
    pad = region_pad or 4 * sigma_m
    padc = int(np.ceil(pad / cell)) + 2
    TILE = 160
    out = img.copy()
    C = img.shape[-1]
    ps = P[sel]
    lo = ps.min(0)
    tix = np.floor((ps - lo) / (TILE * cell)).astype(int)
    keys, inv = np.unique(tix, axis=0, return_inverse=True)
    inv = inv.ravel()
    covP = P[cov]; covV = img[cov]
    order = np.argsort(covP[:, 0]); covP = covP[order]; covV = covV[order]
    xs = covP[:, 0]
    s = sigma_m / cell
    vals = np.zeros((len(ps), C), np.float32)
    for k, key in enumerate(keys):
        t0 = lo + key * TILE * cell - padc * cell
        t1 = lo + (key + 1) * TILE * cell + padc * cell
        a, b = np.searchsorted(xs, [t0[0], t1[0]])
        cp = covP[a:b]
        m = np.all((cp >= t0) & (cp < t1), axis=1)
        cp = cp[m]; cv = covV[a:b][m]
        dims = np.ceil((t1 - t0) / cell).astype(int) + 1
        q = np.clip(np.floor((cp - t0) / cell).astype(int), 0, dims - 1)
        li = np.ravel_multi_index(q.T, dims)
        count = ndimage.gaussian_filter(np.bincount(li, minlength=np.prod(dims)).reshape(dims).astype(np.float32), s, mode='constant')
        idx = np.nonzero(inv == k)[0]
        coords = ((ps[idx] - t0) / cell).T
        den = np.maximum(ndimage.map_coordinates(count, coords, order=1), 1e-6)
        del count
        for c in range(C):
            g = ndimage.gaussian_filter(np.bincount(li, weights=cv[:, c], minlength=np.prod(dims)).reshape(dims).astype(np.float32), s, mode='constant')
            vals[idx, c] = ndimage.map_coordinates(g, coords, order=1) / den
            del g
    out[sel] = vals
    return out


def uv_local_blur(img, cov, radius_px):
    """Normalized blur inside the atlas, ignoring texels with no skin."""
    w = cov.astype(np.float32)
    num = cv_blur(img * w[..., None], radius_px)
    den = cv_blur(w[..., None], radius_px)
    return num / np.maximum(den, 1e-6)


def chart_blur(img, C, radius_px):
    """Normalized blur inside the atlas that never mixes two UV charts. C is the per-texel chart id
    (-1 = no skin). Charts sit a few texels apart in the atlas, closer than a blur's reach, so a plain
    blur would carry one chart's colour into the next one's edge: the very seam being removed."""
    out = np.zeros_like(img, dtype=np.float32)
    H, W = C.shape
    m = int(np.ceil(3 * radius_px)) + 1
    objs = ndimage.find_objects(C + 1)
    for k, sl in enumerate(objs):
        if sl is None:
            continue
        y0, y1 = max(sl[0].start - m, 0), min(sl[0].stop + m, H)
        x0, x1 = max(sl[1].start - m, 0), min(sl[1].stop + m, W)
        w = (C[y0:y1, x0:x1] == k).astype(np.float32)
        sub = img[y0:y1, x0:x1].astype(np.float32)
        num = cv_blur(np.ascontiguousarray(sub * w[..., None]), radius_px)
        den = cv_blur(np.ascontiguousarray(w[..., None]), radius_px)
        if num.ndim == 2: num = num[..., None]
        if den.ndim == 2: den = den[..., None]
        sel = w > 0
        out[y0:y1, x0:x1][sel] = (num / np.maximum(den, 1e-6))[sel]
    return out


def charts(tag):
    """Per-texel UV chart id, built by charts.py (triangles that share a vertex share a chart)."""
    return np.load(f'{ROOT}/{tag}/chart.npy')


def cv_blur(x, r):
    import cv2
    k = 2 * int(r * 3) + 1
    if x.ndim == 3 and x.shape[2] == 1:
        return cv2.GaussianBlur(x[..., 0], (k, k), r)[..., None]
    return cv2.GaussianBlur(x, (k, k), r)


def bleed(img, cov, edited, px=4):
    """Carry edited texels a few pixels into the empty gutter around their islands, so mip
    levels and bilinear filtering at island edges read the edit, not the old colour."""
    import cv2
    out = img.copy()
    ring = edited.copy()
    # a gutter texel an UNEDITED island also reads at its edge keeps its original colour
    near_kept = cv2.dilate((cov & ~edited).astype(np.uint8), np.ones((2 * px + 1, 2 * px + 1), np.uint8)).astype(bool)
    for _ in range(px):
        grown = cv2.dilate(ring.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        new = grown & ~ring & ~cov & ~near_kept
        if not new.any():
            break
        # value = mean of edited neighbours
        acc = np.zeros_like(out, dtype=np.float32)
        cnt = np.zeros(out.shape[:2], np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                sh_r = np.roll(np.roll(ring, dy, 0), dx, 1)
                sh_v = np.roll(np.roll(out, dy, 0), dx, 1).astype(np.float32)
                acc += sh_v * sh_r[..., None]
                cnt += sh_r
        ys, xs = np.nonzero(new)
        out[ys, xs] = (acc[ys, xs] / np.maximum(cnt[ys, xs], 1)[:, None]).astype(out.dtype)
        ring = ring | new
    return out
