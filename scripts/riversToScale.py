#!/usr/bin/env python3
"""CAN THE RIVERS BE DRAWN TO SCALE? Four panels that answer it.

Joshua asked, and the answer is a measurement rather than an opinion, so
this renders it:

  top left      to scale, whole island  - 1 px is 74 m, and the whole
                                          drainage of Kauai is a haze
  top right     by stream order         - what the spawn map ships
  bottom left   to scale, 4 km across   - the median stream reaches 1 px
  bottom right  to scale, 400 m across  - unmistakably a real river

A line thinner than a pixel cannot be drawn thinner than a pixel, so in
the to-scale panels its coverage becomes its ALPHA - which is exactly what
correct antialiasing produces, and exactly how faint it is. Past a pixel,
width is width.

`riverInk` in src/ui/islandMap.ts is the shipped version of the rule these
panels compare: the real width, or the thinnest line that can still be
seen, whichever is larger. At island scale everything hits the floor and
the top-right panel is the result; zoom in and the bottom two are, from
the same line and with no second code path.

Usage:  python3 scripts/riversToScale.py      (needs numpy + Pillow)
Writes: rivers-to-scale.png
"""
import struct, math
import numpy as np
from PIL import Image, ImageDraw

SPAN = 5_600_000
SAMPLES = 1025
STEP = SPAN / (SAMPLES - 1)
SIZE = 760

b = open('public/kauai-hydro.bin','rb').read()
nr, npt, nl, nring, nrp, nn = struct.unpack_from('<IIIIII', b, 8)
at = 32; riv = at; at += nr*16; lak = at; at += nl*20; rng = at; at += nring*8
X=at; at+=npt*4; Z=at; at+=npt*4; Y=at; at+=npt*4; W=at; at+=npt*2
at += (4-at%4)%4
RX=at; at+=nrp*4; RZ=at; at+=nrp*4; NM=at
px = np.frombuffer(b, '<i4', npt, X); pz = np.frombuffer(b, '<i4', npt, Z)
pw = np.frombuffer(b, '<u2', npt, W)
blob = b[NM:NM+nn]
rivers = []
for i in range(nr):
    first,count,nat,nlen,order,ocean = struct.unpack_from('<IIIHBB', b, riv+i*16)
    rivers.append((first,count,order,blob[nat:nat+nlen].decode() if nlen else None))

grid = np.frombuffer(open('public/kauai-1025.bin','rb').read(), '<i2').reshape(SAMPLES,SAMPLES).astype(np.float32)/10.0

def land(cx, cz, window):
    """Shaded relief for a square window centred on (cx,cz), `window` units wide."""
    u = np.linspace(cx-window/2, cx+window/2, SIZE)
    v = np.linspace(cz-window/2, cz+window/2, SIZE)
    gu = np.clip((u+SPAN/2)/STEP, 0, SAMPLES-1.001); gv = np.clip((v+SPAN/2)/STEP, 0, SAMPLES-1.001)
    c0 = gu.astype(int); r0 = gv.astype(int); fx = gu-c0; fz = gv-r0
    C0,R0 = np.meshgrid(c0,r0); FX,FZ = np.meshgrid(fx,fz)
    h = (grid[R0,C0]*(1-FX)*(1-FZ) + grid[R0,C0+1]*FX*(1-FZ)
         + grid[R0+1,C0]*(1-FX)*FZ + grid[R0+1,C0+1]*FX*FZ)
    wet = h <= 0
    t = np.clip(h/1500, 0, 1)
    r = 214 + (74-214)*np.clip(t*3,0,1); g = 199 + (120-199)*np.clip(t*3,0,1); bl = 158 + (62-158)*np.clip(t*3,0,1)
    hi = np.clip((t-0.5)*2,0,1); r = r+(235-r)*hi; g = g+(236-g)*hi; bl = bl+(240-bl)*hi
    dx = np.gradient(h, axis=1); dz = np.gradient(h, axis=0)
    lit = np.clip(1 + (dx+dz)/max(1.0, window/SIZE*0.35/100), 0.55, 1.45)
    img = np.dstack([np.where(wet,26,r*lit), np.where(wet,62,g*lit), np.where(wet,96,bl*lit)])
    return Image.fromarray(np.clip(img,0,255).astype(np.uint8), 'RGB')

def draw(base, cx, cz, window, mode, label):
    per = window / SIZE                      # world units per pixel
    pic = base.convert('RGBA')
    def to(i):
        return ((px[i]-cx)/per + SIZE/2, (pz[i]-cz)/per + SIZE/2)
    if mode == 'scale':
        # TO SCALE. A line thinner than a pixel cannot be drawn thinner than
        # a pixel, so its coverage becomes its ALPHA — which is exactly what
        # correct antialiasing would produce, and exactly how faint it is.
        buckets = {}
        for first,count,order,_ in rivers:
            for i in range(first, first+count-1):
                wide = pw[i]/per
                # Bucketed so each width is one composited layer, NOT
                # clamped: past a pixel the width is real width, and only
                # under a pixel does coverage become alpha.
                key = round(max(wide, 0.02)/0.02)*0.02 if wide < 1 else round(wide)
                buckets.setdefault(key, []).append((to(i), to(i+1)))
        for cover, segs in sorted(buckets.items()):
            layer = Image.new('RGBA', (SIZE,SIZE), (0,0,0,0))
            pen = ImageDraw.Draw(layer)
            wide = max(1, int(round(cover)))
            alpha = int(255*cover) if cover < 1 else 235
            for a,c in segs:
                pen.line([a,c], fill=(96,168,206,alpha), width=wide)
            pic = Image.alpha_composite(pic, layer)
    else:
        layer = Image.new('RGBA', (SIZE,SIZE), (0,0,0,0))
        pen = ImageDraw.Draw(layer)
        WEIGHT = [0,0.6,0.9,1.3,1.9,2.6]
        for first,count,order,_ in rivers:
            pts = [to(i) for i in range(first, first+count)]
            pen.line(pts, fill=(96,168,206,235), width=max(1,int(round(WEIGHT[order]))))
        pic = Image.alpha_composite(pic, layer)
    pen = ImageDraw.Draw(pic)
    pen.rectangle([0,0,SIZE-1,SIZE-1], outline=(200,175,110,255))
    pen.rectangle([0,SIZE-26,SIZE-1,SIZE-1], fill=(12,16,20,215))
    pen.text((9,SIZE-18), label, fill=(238,232,214,255))
    return pic.convert('RGB')

# The Wailua, east coast — the island's biggest river.
target = next(r for r in rivers if r[3] == 'North Fork Wailua River')
mid = target[0] + target[1]//2
wx, wz = int(px[mid]), int(pz[mid])
print('centre', wx, wz)

island = land(0,0,SPAN)
panels = [
    draw(island, 0,0, SPAN, 'scale',
         f'TO SCALE  ·  whole island  ·  1 px = {SPAN/SIZE/100:.0f} m  ·  median river = {550/(SPAN/SIZE):.3f} px'),
    draw(island, 0,0, SPAN, 'order',
         'BY STREAM ORDER  ·  whole island  ·  what ships today'),
    draw(land(wx,wz,400_000), wx,wz, 400_000, 'scale',
         f'TO SCALE  ·  4 km across  ·  1 px = {400_000/SIZE/100:.1f} m  ·  median river = {550/(400_000/SIZE):.1f} px'),
    draw(land(wx,wz,40_000), wx,wz, 40_000, 'scale',
         f'TO SCALE  ·  400 m across  ·  1 px = {40_000/SIZE/100:.2f} m  ·  median river = {550/(40_000/SIZE):.0f} px'),
]
sheet = Image.new('RGB', (SIZE*2+24, SIZE*2+24), (10,13,17))
for i,p in enumerate(panels):
    sheet.paste(p, (8 + (i%2)*(SIZE+8), 8 + (i//2)*(SIZE+8)))
sheet.save('rivers-to-scale.png')
print('wrote rivers-to-scale.png', sheet.size)
