#!/usr/bin/env python3
"""BAKE THE STORY'S LABORATORY: the painted lab picture, rebuilt as a room.

    python3 scripts/bakeStoryLab.py        (needs Python 3 with numpy and opencv-python)

Reads  art/story/lab-night.jpg   (Joshua's Bazaart outpaint of the story's lab, 2026-09-29)
Writes public/models/lab-story.glb (one unlit mesh, one 2048 atlas; src/storylab draws it)

What it does, in order:
1. THE CAMERA the picture was painted from, recovered from the picture: the room's
   depth lines meet at one vanishing point (a Hough/RANSAC fit, 19 lines), the camera
   is level and turned 5.2 degrees off the room's axis, 1.43 m high at a 1300 px focal
   length on the original 2048 px frame; the ceiling's square vent and its light rows
   (a regular 0.97 m grid at 2.62 m) agree. The night outpaint is the original scaled by
   0.5506 and shifted, measured to under a pixel over 596 matched features, so one
   camera serves both.
2. THE ROOM as boxes (the benches, the desk, the racks, the shelves, the walls) and
   upright cards for the monitors, measured on the picture through that camera. The
   wall behind the camera, with its sliding door, is from ChatGPT's blueprint of the
   room (art/story/lab-blueprint.png): the one thing the picture never saw.
3. THE BAKE: every surface in half-metre tiles, each texel taking the picture's colour
   where the picture's camera saw it (facing it, nothing in the way, inside the frame)
   and a plain fill where it did not. From the picture's own camera the result IS the
   picture (mean difference 2.2 levels of 255).

It is manual-only (scripts/MANUAL.md) because it needs Python with numpy and OpenCV,
which the repository does not ship. Rerun it when the picture or the measurements change.
"""
import json, math, os, struct, sys
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ======================================================================================
"""THE CAMERA. The lab picture's camera, in the ROOM frame: x right, y up, z toward the camera
(three.js), floor y=0, camera at (0, H, 0). Picture pixels are the 2D stage's world
coords: the original 2048x1152 frame spans 0..2048, the expansion runs -790..2838."""
F = 1300.0          # focal length, px of the original frame
H = 1.43            # camera height, m
CX, CY = 1024.0, 581.0   # principal point = original centre, on the horizon (level camera)
VPX = 905.2         # the room's depth axis vanishes here
YAW = -np.arctan2(VPX - CX, F)   # the room axis appears at VPX, left of centre: the camera is turned YAW to the right
cyaw, syaw = np.cos(YAW), np.sin(YAW)
def ray(u, v):
    d = np.array([(u - CX) / F, -(v - CY) / F, -1.0])   # camera frame
    # camera frame -> room frame: rotate about y by -YAW (camera looks YAW to the right)
    return np.array([cyaw * d[0] - syaw * d[2], d[1], syaw * d[0] + cyaw * d[2]])
def proj(p):
    p = np.asarray(p, float) - [0, H, 0]
    c = np.array([cyaw * p[0] + syaw * p[2], p[1], -syaw * p[0] + cyaw * p[2]])
    return CX + F * c[0] / -c[2], CY - F * c[1] / -c[2]
def on_y(u, v, y):   # the point of pixel (u,v) on the horizontal plane y
    r = ray(u, v); t = (y - H) / r[1]; return np.array([0, H, 0]) + t * r
def on_x(u, v, x):
    r = ray(u, v); t = x / r[0]; return np.array([0, H, 0]) + t * r
def on_z(u, v, z):
    r = ray(u, v); t = z / r[2]; return np.array([0, H, 0]) + t * r

# The night outpaint (Joshua, 2026-09-29, Bazaart): the wide picture scaled by NS and
# shifted by (NX, NY), measured by 596 matched features with <1 px residual. Same camera.
NS, NX, NY = 0.5506, 288.86, 725.91
NIGHT = 2576
def night(u, v):   # stage world -> night image px
    return (u + 790) * NS + NX, (v + 182) * NS + NY
def from_night(x, y):
    return (x - NX) / NS - 790, (y - NY) / NS - 182

# ======================================================================================
# The lab as boxes, metres, room frame (cam.py). Measured on the night outpaint.
# The room is symmetric about x = 0.34: the aisle between the two runs, the window and
# the racks either side of it all centre there. The camera stands 0.34 m left of it.
ZB = -3.91      # back wall
C = 2.62        # ceiling (its light rows then fall on a regular 0.97 m grid)
XL, XR = -1.45, 2.15   # side walls: behind the counters, a strip of shelving and cable
                       # runs along each (the blueprint's West and East elevations)
ZS = 1.10       # the south wall with the sliding door, behind the camera (blueprint)
ZN = ZS
DOOR = (0.34 - 0.62, 0.34 + 0.62, 2.10)   # sliding door: x from, x to, height; on the room's centre line
BOXES = [
  # left run: cabinets, counter top; ends 0.8 m in front of the camera
  ("L-cabinets", (XL, 0.00, ZB), (-0.50, 0.88, -0.78)),
  ("L-top",      (XL, 0.88, ZB), (-0.50, 0.92, -0.76)),
  # the low cabinet at the camera's left
  ("NL-cabinet", (XL, 0.00, -0.57), (-0.62, 0.86, ZN)),
  ("NL-top",     (XL, 0.86, -0.59), (-0.58, 0.90, ZN)),
  # right run, and the table nearer the camera
  ("R-cabinets", (1.22, 0.00, ZB), (XR, 0.82, -1.48)),
  ("R-top",      (1.16, 0.82, ZB), (XR, 0.86, -1.46)),
  ("NR-cabinet", (1.17, 0.00, -1.02), (XR, 0.86, ZN)),
  ("NR-top",     (1.06, 0.86, -1.04), (XR, 0.90, ZN)),
  # centre desk across the back, with the cabinet under it
  ("desk-top",   (-0.50, 0.76, ZB), (1.22, 0.80, -3.65)),
  ("desk-cab",   (0.55, 0.00, ZB), (0.90, 0.60, -3.72)),
  # the racks standing on the desk either side of the window
  ("L-tower",    (-0.89, 0.80, ZB), (-0.22, 2.04, -3.55)),
  ("R-tower",    (0.95, 0.80, ZB), (1.53, 2.07, -3.55)),
  # wall shelves
  ("L-shelf",    (XL, 1.52, -3.50), (-0.95, 1.56, 0.40)),
  ("L-shelf-hi", (XL, 1.72, -3.50), (-1.05, 1.76, 0.40)),
  ("R-shelf-hi", (1.65, 1.66, -3.50), (XR, 1.70, 0.40)),
  ("R-shelf-lo", (1.65, 1.45, -3.50), (XR, 1.49, 0.40)),
]
PLANES = [
  ("floor", "y", 0.0, (XL, XR), (ZB, ZN)),
  ("ceiling", "y", C, (XL, XR), (ZB, ZN)),
  ("back", "z", ZB, (XL, XR), (0.0, C)),
  ("south", "z", ZS, (XL, XR), (0.0, C)),
  ("left", "x", XL, (0.0, C), (ZB, ZN)),
  ("right", "x", XR, (0.0, C), (ZB, ZN)),
]

# ======================================================================================
"""Upright cards for the things that stand on the counters (monitors, the scope, the
laptop): each is a vertical quad through its bottom edge. Given as the picture's own
outline (night image, 1400 px display scale): bottom-left, bottom-right, top-left,
top-right, and the height of the surface the bottom edge sits at."""
K = 2576 / 1400
def P(d): return from_night(d[0] * K, d[1] * K)
CARDS_2D = [
  # name, BL, BR, TL, TR, base height
  ("mon-L-front", (238, 835), (345, 792), (228, 675), (333, 665), 1.02),
  ("mon-L-pair",  (380, 722), (493, 706), (374, 622), (490, 620), 1.02),
  ("red-box",     (342, 792), (438, 772), (340, 740), (440, 730), 0.92),
  ("mon-back-1",  (656, 674), (716, 672), (656, 630), (716, 630), 0.93),
  ("mon-back-2",  (726, 668), (766, 668), (726, 630), (766, 630), 0.93),
  ("mon-R-lap",   (915, 712), (972, 705), (918, 638), (975, 635), 0.90),
  ("scope-R",     (988, 748), (1148, 745), (990, 662), (1146, 665), 0.93),
  ("mon-R-big",   (1172, 830), (1330, 842), (1178, 656), (1325, 660), 0.95),
]
def build_cards():
    out = []
    inside = lambda p: XL + 0.05 < p[0] < XR - 0.05 and p[2] > ZB + 0.06
    for name, bl, br, tl, tr, yb in CARDS_2D:
        # a card the picture's outline would put through a wall stands on something higher
        while not (inside(on_y(*P(bl), yb)) and inside(on_y(*P(br), yb))): yb += 0.01
        B0 = on_y(*P(bl), yb); B1 = on_y(*P(br), yb)
        # the vertical plane through the bottom edge; the top corners are where the rays
        # through the outline's top corners meet it
        n = np.cross(B1 - B0, [0, 1, 0]); n /= np.linalg.norm(n)
        def hit(d):
            r = ray(*P(d)); o = np.array([0, H, 0]); t = n @ (B0 - o) / (n @ r); return o + t * r
        T0, T1 = hit(tl), hit(tr)
        # keep it a rectangle: tops straight above the bottoms, at the mean height
        h = (T0[1] + T1[1]) / 2
        T0 = np.array([B0[0], h, B0[2]]); T1 = np.array([B1[0], h, B1[2]])
        out.append((name, [B0, B1, T1, T0]))
    return out

# ======================================================================================
# THE BAKE


SRC = cv2.cvtColor(cv2.imread(os.path.join(ROOT, "art", "story", "lab-night.jpg")), cv2.COLOR_BGR2RGB).astype(np.float32)
SH, SW = SRC.shape[:2]
CAM = np.array([0.0, H, 0.0])
ATLAS = 2048
PAD = 4   # texels of edge-replicated border round every tile: JPEG blocks and filtering stay inside

# ---------------------------------------------------------------------------------- faces
faces = []   # dict(name, kind, O, U, V, N, solid_owner)
def face(name, kind, O, U, V, owner=None):
    O, U, V = map(lambda a: np.asarray(a, float), (O, U, V))
    N = np.cross(U, V); N /= np.linalg.norm(N)
    faces.append(dict(name=name, kind=kind, O=O, U=U, V=V, N=N, owner=owner))

def kind_of(name):
    if "top" in name: return "counter"
    if "shelf" in name: return "shelf"
    if "tower" in name: return "rack"
    return "cabinet"

for bi, (name, lo, hi) in enumerate(BOXES):
    x0, y0, z0 = lo; x1, y1, z1 = hi
    k = kind_of(name)
    # six faces, each wound so U x V points outward
    if x0 > XL + 1e-3: face(name + ".-x", k, (x0, y0, z0), (0, 0, z1 - z0), (0, y1 - y0, 0), bi)
    if x1 < XR - 1e-3: face(name + ".+x", k, (x1, y0, z1), (0, 0, z0 - z1), (0, y1 - y0, 0), bi)
    if y0 > 1e-3:       face(name + ".-y", k, (x0, y0, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), bi)
    face(name + ".+y", k, (x0, y1, z1), (x1 - x0, 0, 0), (0, 0, z0 - z1), bi)
    if z0 > ZB + 1e-3: face(name + ".-z", k, (x1, y0, z0), (x0 - x1, 0, 0), (0, y1 - y0, 0), bi)
    if z1 < ZS - 1e-3: face(name + ".+z", k, (x0, y0, z1), (x1 - x0, 0, 0), (0, y1 - y0, 0), bi)

for f in faces:
    lo, hi = BOXES[f["owner"]][1:]; ctr = (np.array(lo) + np.array(hi)) / 2
    fc = f["O"] + 0.5 * f["U"] + 0.5 * f["V"]
    assert f["N"] @ (fc - ctr) > 0, f"{f['name']} faces into its own box"

# the room's shell, facing in
face("floor", "floor", (XL, 0, ZS), (XR - XL, 0, 0), (0, 0, ZB - ZS))
face("ceiling", "ceiling", (XL, C, ZB), (XR - XL, 0, 0), (0, 0, ZS - ZB))
face("back", "wall", (XL, 0, ZB), (XR - XL, 0, 0), (0, C, 0))
face("south", "south", (XR, 0, ZS), (XL - XR, 0, 0), (0, C, 0))
face("left", "wall", (XL, 0, ZS), (0, 0, ZB - ZS), (0, C, 0))
face("right", "wall", (XR, 0, ZB), (0, 0, ZS - ZB), (0, C, 0))

CARDS = build_cards()
for ci, (name, (B0, B1, T1, T0)) in enumerate(CARDS):
    # front toward the camera, and a dark back
    n = np.cross(B1 - B0, T0 - B0)
    if n @ (CAM - B0) < 0: B0, B1, T1, T0 = B1, B0, T0, T1
    face(name + ".front", "screen", B0, B1 - B0, T0 - B0, ("card", ci))
    face(name + ".back", "cardback", B1, B0 - B1, T1 - B1, ("card", ci))

# every face in tiles of at most TILE metres, so each tile gets the resolution the
# picture has where it is: sharp by the camera, softer far off, a patch where unseen
TILE = 0.5
tiles = []
for pi, f in enumerate(faces):
    nu = max(1, math.ceil(np.linalg.norm(f["U"]) / TILE)); nv = max(1, math.ceil(np.linalg.norm(f["V"]) / TILE))
    if f["kind"] == "south": nu = nv = 1
    for a in range(nu):
        for b in range(nv):
            tiles.append(dict(f, O=f["O"] + a / nu * f["U"] + b / nv * f["V"], U=f["U"] / nu, V=f["V"] / nv,
                              parent=pi, name=f"{f['name']}[{a},{b}]"))
parents = faces
faces = tiles

# ------------------------------------------------------------------------------ occlusion
BOX_LO = np.array([b[1] for b in BOXES]); BOX_HI = np.array([b[2] for b in BOXES])
CARD_Q = [(np.array(q[0]), np.array(q[1]) - np.array(q[0]), np.array(q[3]) - np.array(q[0])) for _, q in CARDS]

def occluded(P, owner):
    """P: (n,3) points on a surface. True where something stands between them and the
    picture's camera."""
    D = P - CAM
    hit = np.zeros(len(P), bool)
    with np.errstate(divide="ignore", invalid="ignore"):
        for bi in range(len(BOXES)):
            t0 = (BOX_LO[bi] - CAM) / D; t1 = (BOX_HI[bi] - CAM) / D
            tn = np.nanmax(np.minimum(t0, t1), axis=1); tf = np.nanmin(np.maximum(t0, t1), axis=1)
            # a point on this box's own surface is entered at t = 1: only earlier entries count
            lim = 1 - 2e-3 if owner == bi else 1 - 1e-3
            hit |= (tn < tf) & (tn > 1e-3) & (tn < lim)
        for ci, (O, U, V) in enumerate(CARD_Q):
            if owner == ("card", ci): continue
            n = np.cross(U, V)
            den = D @ n
            t = ((O - CAM) @ n) / den
            X = CAM + t[:, None] * D - O
            a = (X @ U) / (U @ U); b = (X @ V) / (V @ V)
            hit |= (t > 1e-3) & (t < 1 - 1e-3) & (a >= 0) & (a <= 1) & (b >= 0) & (b <= 1)
    return hit

def to_src(P):
    """Room points -> night image pixel coordinates (vectorised proj + night)."""
    Q = P - CAM
    cx_ = cyaw * Q[:, 0] + syaw * Q[:, 2]; cz = -syaw * Q[:, 0] + cyaw * Q[:, 2]
    u = CX + F * cx_ / -cz; v = CY - F * Q[:, 1] / -cz
    return (u + 790) * NS + NX, (v + 182) * NS + NY, -cz

def bilinear(img, x, y):
    x0 = np.clip(np.floor(x).astype(int), 0, img.shape[1] - 2); y0 = np.clip(np.floor(y).astype(int), 0, img.shape[0] - 2)
    fx = np.clip(x - x0, 0, 1)[:, None]; fy = np.clip(y - y0, 0, 1)[:, None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)

# ------------------------------------------------------------------ resolution per face
def density(f):
    # the source's own pixels per metre where the face is seen, clamped
    ctr = f["O"] + 0.5 * f["U"] + 0.5 * f["V"]
    _, _, depth = to_src(ctr[None])
    d = max(0.3, float(depth[0]))
    return float(np.clip(F * NS / d, 60, 420))

def coarse_vis(f, n=24):
    ii, jj = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n)
    P = f["O"] + ii.reshape(-1, 1) * f["U"] + jj.reshape(-1, 1) * f["V"]
    sx, sy_, depth = to_src(P)
    vis = ((CAM - P) @ f["N"] > 1e-4) & (sx >= 0) & (sx < SW - 1) & (sy_ >= 0) & (sy_ < SH - 1) & (depth > 0.05)
    if vis.any(): vis[vis] &= ~occluded(P[vis], f["owner"])
    return float(vis.mean())
for f in faces:
    f["dens"] = density(f)
    f["cvis"] = coarse_vis(f)
    if f["kind"] == "south": f["dens"] = 60
    if f["cvis"] == 0 and f["kind"] != "south":
        f["dens"] = 1e-6   # never seen: a plain patch is all it needs
area_px = sum(np.linalg.norm(f["U"]) * np.linalg.norm(f["V"]) * f["dens"] ** 2 * max(f["cvis"], 0.05) for f in faces)
def sizes(scale):
    for f in faces:
        d = f["dens"] * scale
        f["w"] = int(np.clip(math.ceil(np.linalg.norm(f["U"]) * d), 4, ATLAS - 2 * PAD))
        f["h"] = int(np.clip(math.ceil(np.linalg.norm(f["V"]) * d), 4, ATLAS - 2 * PAD))
def fits():
    x = y = rowh = 0
    for f in sorted(faces, key=lambda f: -f["h"]):
        w, h = f["w"] + 2 * PAD, f["h"] + 2 * PAD
        if x + w > ATLAS: x, y, rowh = 0, y + rowh, 0
        if y + h > ATLAS: return False
        x += w; rowh = max(rowh, h)
    return True
scale = min(1.0, math.sqrt(0.9 * ATLAS * ATLAS / area_px))
sizes(scale)
while not fits():
    scale *= 0.97; sizes(scale)
print(f"{len(parents)} faces in {len(faces)} tiles, density scale {scale:.2f}")

# ------------------------------------------------------------------------------ texturing
PLAIN = {   # the kinds' own colours where the picture has nothing to say (sampled below)
    "floor": None, "ceiling": None, "wall": None, "cabinet": None, "counter": None,
    "shelf": None, "rack": None, "screen": (18, 22, 28), "cardback": (20, 22, 26), "south": None,
}
kind_samples = {k: [] for k in PLAIN}
for f in faces:
    w, h = f["w"], f["h"]
    ii, jj = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    P = f["O"] + ii.reshape(-1, 1) * f["U"] + jj.reshape(-1, 1) * f["V"]
    sx, sy_, depth = to_src(P)
    facing = (CAM - P) @ f["N"] > 1e-4
    inside = (sx >= 0) & (sx < SW - 1) & (sy_ >= 0) & (sy_ < SH - 1) & (depth > 0.05)
    vis = facing & inside
    if vis.any():
        vis[vis] &= ~occluded(P[vis], f["owner"])
    col = np.zeros((len(P), 3), np.float32)
    if vis.any():
        col[vis] = bilinear(SRC, sx[vis], sy_[vis])
        kind_samples[f["kind"]].append(col[vis])
    f["col"] = col.reshape(h, w, 3); f["vis"] = vis.reshape(h, w)
    f["visfrac"] = float(vis.mean())

psamples = {}
for f in faces:
    if f["vis"].any(): psamples.setdefault(f["parent"], []).append(f["col"][f["vis"]])
pmed = {p: np.median(np.concatenate(v), axis=0) for p, v in psamples.items()}
for k, s in kind_samples.items():
    if PLAIN[k] is None and s:
        PLAIN[k] = tuple(np.median(np.concatenate(s), axis=0))
for k in PLAIN:
    if PLAIN[k] is None: PLAIN[k] = PLAIN["wall"] or (70, 76, 82)
PLAIN["south"] = PLAIN["wall"]

def south_texture(f):
    """The blueprint's South elevation: wall, a sliding double door on the centre line."""
    w, h = f["w"], f["h"]
    img = np.zeros((h, w, 3), np.float32); img[:] = PLAIN["wall"]
    U = f["U"]; L = np.linalg.norm(U)
    # texel -> room x: the face runs from XR (u=0) to XL (u=1); y from 0 (bottom row, v=0)
    xs = XR + (np.arange(w) + 0.5) / w * (XL - XR); ys = (np.arange(h) + 0.5) / h * C
    X, Y = np.meshgrid(xs, ys)
    d0, d1, dh = DOOR
    frame = (X > d0 - 0.06) & (X < d1 + 0.06) & (Y < dh + 0.06)
    leaf = (X > d0) & (X < d1) & (Y < dh)
    img[frame] = np.array(PLAIN["cabinet"]) * 0.75
    img[leaf] = np.array(PLAIN["cabinet"]) * 1.05
    seam = leaf & (np.abs(X - (d0 + d1) / 2) < 0.012)
    img[seam] = np.array(PLAIN["cabinet"]) * 0.45
    for gx in (d0 + 0.18, d1 - 0.18):   # a glass strip in each leaf
        glass = leaf & (np.abs(X - gx) < 0.07) & (Y > 1.0) & (Y < 1.9)
        img[glass] = (40, 60, 74)
    return img

for f in faces:
    if f["kind"] == "south":
        f["tex"] = south_texture(f); continue
    img = f["col"].copy(); vis = f["vis"]
    base = np.array(PLAIN[f["kind"]], np.float32)
    if f["parent"] in pmed:
        base = pmed[f["parent"]] * 0.9 + base * 0.1
    img[~vis] = base
    if vis.any() and (~vis).any():
        # soften the line between what the picture saw and the fill
        m = (~vis).astype(np.uint8) * 255
        img8 = np.clip(img, 0, 255).astype(np.uint8)
        img8 = cv2.inpaint(img8, cv2.erode(m, np.ones((3, 3), np.uint8)) & cv2.dilate(255 - m, np.ones((9, 9), np.uint8)), 4, cv2.INPAINT_TELEA)
        img = img8.astype(np.float32)
    f["tex"] = img

# --------------------------------------------------------------------------------- atlas
order = sorted(range(len(faces)), key=lambda i: -faces[i]["h"])
atlas = np.zeros((ATLAS, ATLAS, 3), np.uint8)
x = y = rowh = 0
for i in order:
    f = faces[i]; w, h = f["w"] + 2 * PAD, f["h"] + 2 * PAD
    if x + w > ATLAS: x, y, rowh = 0, y + rowh, 0
    if y + h > ATLAS: sys.exit(f"atlas full at face {f['name']}")
    # the texture's rows run bottom-up (v = 0 at O); images run top-down
    tex = np.clip(f["tex"][::-1], 0, 255).astype(np.uint8)
    atlas[y:y + h, x:x + w] = cv2.copyMakeBorder(tex, PAD, PAD, PAD, PAD, cv2.BORDER_REPLICATE)
    f["uv"] = ((x + PAD) / ATLAS, (y + PAD) / ATLAS, (x + PAD + f["w"]) / ATLAS, (y + PAD + f["h"]) / ATLAS)
    x += w; rowh = max(rowh, h)
used = y + rowh
print(f"atlas rows used {used}/{ATLAS}")

# ----------------------------------------------------------------------------------- GLB
pos, nor, uv, idx = [], [], [], []
for f in faces:
    O, U, V, N = f["O"], f["U"], f["V"], f["N"]
    u0, v0, u1, v1 = f["uv"]
    base = len(pos)
    # glTF uv: (0,0) is the image's top-left; the face's v=0 (at O) is the texture's bottom row
    for (a, b), (tu, tv) in zip([(0, 0), (1, 0), (1, 1), (0, 1)], [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]):
        pos.append(O + a * U + b * V); nor.append(N); uv.append((tu, tv))
    idx += [base, base + 1, base + 2, base, base + 2, base + 3]
pos = np.array(pos, np.float32); nor = np.array(nor, np.float32); uv = np.array(uv, np.float32); idx = np.array(idx, np.uint32)

ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(atlas, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 86])
jpg = jpg.tobytes()
blobs = [pos.tobytes(), nor.tobytes(), uv.tobytes(), idx.tobytes(), jpg]
views, off, bin_ = [], 0, b""
for b in blobs:
    views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b)})
    pad = (-len(b)) % 4
    bin_ += b + b"\0" * pad; off += len(b) + pad
views[0]["target"] = views[1]["target"] = views[2]["target"] = 34962; views[3]["target"] = 34963
gltf = {
    "asset": {"version": "2.0", "generator": "tmb-story lab bake"},
    "extensionsUsed": ["KHR_materials_unlit"],
    "scene": 0, "scenes": [{"nodes": [0]}],
    "nodes": [{"name": "Lab", "mesh": 0}],
    "meshes": [{"name": "Lab", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
    "materials": [{"name": "LabPicture", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1},
                   "extensions": {"KHR_materials_unlit": {}}}],
    "textures": [{"source": 0, "sampler": 0}],
    "samplers": [{"magFilter": 9729, "minFilter": 9729, "wrapS": 33071, "wrapT": 33071}],
    "images": [{"bufferView": 4, "mimeType": "image/jpeg"}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
        {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": len(uv), "type": "VEC2"},
        {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ],
    "bufferViews": views, "buffers": [{"byteLength": len(bin_)}],
}
js = json.dumps(gltf, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
out = os.path.join(ROOT, "public", "models", "lab-story.glb")
with open(out, "wb") as fo:
    fo.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
    fo.write(struct.pack("<II", len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack("<II", len(bin_), 0x004E4942)); fo.write(bin_)
# the picture's own camera, for the scene's "as painted" shot
meta = {"camera": {"position": [0, H, 0], "yawDeg": float(np.degrees(YAW)),
                   "focalPx": F * NS, "imagePx": [SW, SH], "principalPx": list(map(float, night(CX, CY)))},
        "room": {"xl": XL, "xr": XR, "zb": ZB, "zs": ZS, "ceiling": C}}
print(json.dumps(meta))
print(f"wrote {out}: {len(faces)} faces, {len(idx)//3} triangles, {len(bin_)/1e6:.2f} MB; texture {len(jpg)/1e6:.2f} MB")
print("visible share per face kind:", {k: round(float(np.mean([f['visfrac'] for f in faces if f['kind']==k])),2) for k in PLAIN if any(f['kind']==k for f in faces)})
