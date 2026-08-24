#!/usr/bin/env python3
"""
WHERE THE WATER GOES, worked out from the island itself.

Every previous attempt drew water from one source (USGS courses) onto
terrain from another (the height grid), and the two disagreed: rivers
inside hillsides, ribbons over ground with no channel, a current pushing
her along on dry land. This bake removes that class of fault by
construction -- the channels are DERIVED from `kauai-1025.bin`, so they
cannot be anywhere the grid does not already have a valley.

  1. Rain, weighted onto the peaks. Waialeale takes ~9,500 mm a year and
     Mana on the leeward west ~500: a twentyfold difference across 40 km.
     Raining evenly would invent rivers the dry side does not have.
  2. Priority-flood every pit to the lowest lip it can spill over
     (Barnes, Lehman & Mulla 2014). A lake IS a depression full to its
     spill point, so `filled - land` is the standing water, and basins
     that fill past their rim merge into one body on their own.
  3. D8 steepest descent on that filled surface, then accumulate in
     descending-elevation order -- one pass, every donor before its
     receiver.
  4. Trace the channels above a discharge threshold into centrelines,
     and size each one from the flow it carries.

MEASURED against USGS NHD before any of this was written to disk: 82% of
the channels this finds land within 120 m of a real mapped river, from
terrain alone. The threshold is a dial and 0.01 is not a hydrologist's
choice -- see WATER_THRESHOLD.
"""
import argparse, heapq, math, struct, sys
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / 'public' / 'kauai-1025.bin'
OUT = ROOT / 'public' / 'kauai-flow.bin'

SAMPLES = 1025
SPAN_UNITS = 5_600_000          # world units across the island box
UNITS_PER_METRE = 100           # one unit is a centimetre
SPAN_M = SPAN_UNITS / UNITS_PER_METRE
CELL_M = SPAN_M / (SAMPLES - 1)

DRY_MM, WET_MM = 500.0, 9500.0
TRADE = (-0.70, -0.70)          # wind FROM the north-east

# WHAT COUNTS AS A STREAM, in cubic metres a second.
#
# NOT a hydrologist's number. USGS maps 1,638 km of river on Kauai and
# stops where a surveyor stops caring; at 0.01 this finds 2,973 km,
# which is 1.8x that -- and the excess is real. The windward side takes
# metres of rain a year and every gulch runs; a cartographer has no
# reason to draw the trickle behind a fern, and a queen who needs a
# drink has every reason to care about it.
#
# CHOSEN BY WALKING TIME, which is the measure that matters to her.
# Fresh water only (she cannot drink the sea), at her 25 cm/s:
#     Q > 0.5   median walk 17 min, worst tenth of the island 49 min
#     Q > 0.05  median 12 min, worst tenth 33 min
#     Q > 0.01  median  7.7 min, worst tenth 20 min
#     Q > 0.005 median  5.8 min, worst tenth 16 min
#
# RE-MEASURED ON THE REAL ISLAND, once the bake started reading the
# ground the game draws rather than the grid it was baked from. The
# smoothing dial fills in a third of the small pits, so every walk got
# longer and the dial had to move with it:
#     Q > 0.010 median 11.7 min, worst tenth 30 min
#     Q > 0.005 median  8.0 min, worst tenth 23 min   <-- here
#     Q > 0.002 median  3.6 min, worst tenth 15 min
# Straight-line distances, so the true tail is worse -- Na Pali and
# Waimea turn a 300 m line into a detour or a refusal.
WATER_THRESHOLD = 0.005

GROUND = ROOT / 'scripts' / '.ground.f32'

def load_grid():
    """
    THE GROUND THE GAME DRAWS, not the grid it was baked from.

    `scripts/sampleGround.ts` writes this by calling the game's own
    `terrainHeight` with the flow index unloaded, so it carries the
    smoothing dial, the shore easing, the cliff fade and the height
    dial — everything `baseLand` does. Reading `kauai-1025.bin` here
    instead, as this used to, simulated a different island from the one
    she stands on, which is the fault this rebuild exists to end.
    """
    if not GROUND.exists():
        sys.exit(f'{GROUND} is missing — run `npm run bake:ground` first')
    raw = np.fromfile(GROUND, dtype='<f4')
    if raw.size != SAMPLES * SAMPLES:
        sys.exit(f'{GROUND} holds {raw.size} samples, expected {SAMPLES**2}')
    return raw.astype(np.float64).reshape(SAMPLES, SAMPLES)          # metres

def rainfall(dem):
    gz, gx = np.gradient(dem, CELL_M)
    facing = -(gx * TRADE[0] + gz * TRADE[1])
    lift = np.clip(facing / 0.25, 0.0, 1.0)
    climb = np.clip(dem / 1200.0, 0.0, 1.0) ** 0.7
    wet = np.clip(0.55 * climb + 0.45 * lift * (0.35 + 0.65 * climb), 0.0, 1.0)
    mm = DRY_MM + (WET_MM - DRY_MM) * wet
    mm[dem <= 0] = 0.0
    return mm

def priority_flood(dem):
    """Fill every pit to its spill level. Sea and border are the outlets."""
    N = SAMPLES
    filled = np.full(dem.shape, np.inf)
    seen = np.zeros(dem.shape, bool)
    heap = []
    for y in range(N):
        for x in (0, N - 1):
            heapq.heappush(heap, (dem[y, x], y, x)); seen[y, x] = True
            filled[y, x] = dem[y, x]
    for x in range(N):
        for y in (0, N - 1):
            if not seen[y, x]:
                heapq.heappush(heap, (dem[y, x], y, x)); seen[y, x] = True
                filled[y, x] = dem[y, x]
    sea = np.argwhere(dem <= 0.0)
    for y, x in sea:
        if not seen[y, x]:
            heapq.heappush(heap, (dem[y, x], y, x)); seen[y, x] = True
            filled[y, x] = dem[y, x]
    EPS = 1e-4                      # a hair of slope across a filled flat
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        e, y, x = pop(heap)
        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
            ny, nx = y + dy, x + dx
            if ny < 0 or nx < 0 or ny >= N or nx >= N or seen[ny, nx]:
                continue
            lift = e + EPS
            filled[ny, nx] = dem[ny, nx] if dem[ny, nx] > lift else lift
            seen[ny, nx] = True
            push(heap, (filled[ny, nx], ny, nx))
    return filled

def receivers(filled, dem):
    """D8 steepest descent. A sink points at itself."""
    N = SAMPLES
    flat = filled.ravel()
    land = (dem > 0.0).ravel()
    recv = np.arange(N * N, dtype=np.int64)
    best = np.zeros(N * N)
    for dy, dx in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
        run = math.hypot(dy, dx)
        shifted = np.roll(np.roll(filled, -dy, 0), -dx, 1)
        idx = np.roll(np.roll(np.arange(N*N).reshape(N,N), -dy, 0), -dx, 1)
        # Do not let the roll wrap around the edges of the island box.
        ok = np.ones((N, N), bool)
        if dy > 0: ok[-dy:, :] = False
        if dy < 0: ok[:-dy, :] = False
        if dx > 0: ok[:, -dx:] = False
        if dx < 0: ok[:, :-dx] = False
        drop = ((filled - shifted) / run).ravel()
        take = land & ok.ravel() & (drop > best)
        best[take] = drop[take]
        recv[take] = idx.ravel()[take]
    return recv

def accumulate(filled, rain_m3):
    """Route every cell's rain downstream, highest ground first."""
    recv = receivers(filled, filled)   # filled is >0 exactly where land is
    order = np.argsort(-filled.ravel(), kind='stable')
    acc = rain_m3.ravel().astype(np.float64).copy()
    a = acc.tolist(); r = recv.tolist()
    for i in order.tolist():
        j = r[i]
        if j != i:
            a[j] += a[i]
    return np.array(a).reshape(filled.shape), recv

def channel_width_m(q):
    """
    How wide a stream carrying `q` cubic metres a second runs.

    HYDRAULIC GEOMETRY, the standard w = a*Q^b with b near 0.5 (Leopold &
    Maddock 1953). `a` is set so the Wailua -- the island's largest, and
    the one reach anybody can check against a photograph -- lands near
    its real 30 m at the mouth. GAME TUNING ON A REAL LAW: the exponent
    is measured hydrology, the coefficient is fitted to one river.
    """
    return float(np.clip(5.2 * math.sqrt(max(q, 1e-6)), 0.6, 40.0))

def channel_depth_m(width):
    """
    Twelve per cent of width, floored at 30 cm and capped at 2.5 m.

    NOT Beyond Extinction's 0.6*width floored at 3 m. That floor exists
    so a PERSON can swim in every stream; she is a centimetre long and a
    three-metre trench for a five-metre creek is a canyon three hundred
    body lengths deep. The true channel stays true.
    """
    return float(np.clip(width * 0.12, 0.30, 2.5))

def trace(acc, recv, filled, dem):
    """
    Follow every channel downstream into a centreline.

    A reach starts at a channel HEAD -- a cell over the threshold with no
    upstream neighbour over it -- and runs until it reaches the sea or
    meets a cell already claimed by a larger reach. Tracing rather than
    rasterising is what keeps the true 5 m width: a raster channel is one
    cell wide, and a cell here is fifty-five metres.
    """
    N = SAMPLES
    q = acc / (365.25 * 24 * 3600.0)          # m3 a second
    chan = (q > WATER_THRESHOLD) & (dem > 0.0)
    qf = q.ravel(); land = (dem > 0.0).ravel()
    chanf = chan.ravel()
    # A head has no donor that is itself a channel.
    donors = np.zeros(N * N, np.int32)
    np.add.at(donors, recv[chanf], 1)
    is_head = chanf.copy()
    is_head[recv[chanf]] = False              # anything receiving is not a head
    claimed = np.zeros(N * N, bool)
    reaches = []
    heads = np.nonzero(is_head)[0]
    # Biggest first, so a trunk claims the shared course and tributaries
    # stop when they meet it rather than overwriting it.
    heads = heads[np.argsort(-qf[heads])]
    for h in heads.tolist():
        pts, i = [], h
        while True:
            if claimed[i] or not land[i]:
                break
            claimed[i] = True
            y, x = divmod(i, N)
            pts.append((x, y, float(filled.ravel()[i]), channel_width_m(qf[i])))
            j = int(recv[i])
            if j == i:
                break
            i = j
        if len(pts) >= 2:
            reaches.append(pts)
    return reaches, q, chan

def to_world(x, y):
    """Grid cell -> world units, the frame everything else lives in."""
    step = SPAN_UNITS / (SAMPLES - 1)
    return x * step - SPAN_UNITS / 2, y * step - SPAN_UNITS / 2

def write(reaches, filled, dem, path):
    """
    TMBF: a header, one row per reach, then the shared station arrays.

      magic u32 | version u16 | pad u16 | reaches u32 | points u32
      ponds u32 | threshold f32 | pad u32 | pad u32      (32 bytes)
      per reach: first u32, count u32
      points:  x i32, z i32, y i32 (world units), width u16
      ponds:   x i32, z i32, level i32, depth u16   (world units)
    """
    pts = [p for r in reaches for p in r]
    depth = np.where(dem > 0.0, filled - dem, 0.0)
    py, px = np.nonzero(depth > 0.05)
    # THIRTY-TWO BYTES, and the second pad is what makes it so. Eight
    # fields pack to 28; both readers were written against a 32-byte
    # header, so every array after it was read four bytes early. The
    # decoder's own length check would have caught it at boot, which is
    # exactly what that check is for — but it is cheaper to make the
    # header the size it claims than to find out on a device.
    head = struct.pack('<IHHIIIfII', 0x46424D54, 1, 0,
                       len(reaches), len(pts), len(px), WATER_THRESHOLD, 0, 0)
    rows = b''.join(struct.pack('<II', off, len(r))
                    for off, r in zip(np.cumsum([0] + [len(r) for r in reaches]), reaches))
    X = np.empty(len(pts), '<i4'); Z = np.empty(len(pts), '<i4')
    Y = np.empty(len(pts), '<i4'); W = np.empty(len(pts), '<u2')
    for k, (gx, gy, elev, wm) in enumerate(pts):
        wx, wz = to_world(gx, gy)
        X[k] = int(round(wx)); Z[k] = int(round(wz))
        Y[k] = int(round(elev * UNITS_PER_METRE))
        W[k] = int(round(min(65535, wm * UNITS_PER_METRE)))
    PX = np.empty(len(px), '<i4'); PZ = np.empty(len(px), '<i4')
    PL = np.empty(len(px), '<i4'); PD = np.empty(len(px), '<u2')
    for k in range(len(px)):
        wx, wz = to_world(int(px[k]), int(py[k]))
        PX[k] = int(round(wx)); PZ[k] = int(round(wz))
        PL[k] = int(round(filled[py[k], px[k]] * UNITS_PER_METRE))
        PD[k] = int(round(min(65535, depth[py[k], px[k]] * UNITS_PER_METRE)))
    path.write_bytes(head + rows + X.tobytes() + Z.tobytes() + Y.tobytes()
                     + W.tobytes() + PX.tobytes() + PZ.tobytes()
                     + PL.tobytes() + PD.tobytes())
    return len(pts), len(px)

def main():
    global WATER_THRESHOLD
    ap = argparse.ArgumentParser()
    ap.add_argument('--threshold', type=float, default=WATER_THRESHOLD)
    WATER_THRESHOLD = ap.parse_args().threshold

    dem = load_grid()
    print(f'grid   {SAMPLES}^2 over {SPAN_M/1000:.0f} km = {CELL_M:.1f} m/cell'
          f'  summit {dem.max():.0f} m')
    mm = rainfall(dem)
    land = dem > 0
    print(f'rain   {mm[land].min():.0f}-{mm[land].max():.0f} mm/yr,'
          f' island mean {mm[land].mean():.0f}')
    filled = priority_flood(dem)
    rain_m3 = (mm / 1000.0) * (CELL_M * CELL_M)
    acc, recv = accumulate(filled, rain_m3)
    reaches, q, chan = trace(acc, recv, filled, dem)
    depth = np.where(land, filled - dem, 0.0)
    ponded = depth > 0.05
    print(f'ponds  {ponded.sum():,} cells,'
          f' {100*ponded.sum()/land.sum():.2f}% of land,'
          f' median {np.median(depth[ponded]):.2f} m, max {depth[ponded].max():.1f} m')
    print(f'flow   biggest {q[land].max():.1f} m3/s'
          f'   channels {chan.sum():,} cells'
          f'   ({chan.sum()*CELL_M/1000:.0f} km at Q > {WATER_THRESHOLD})')
    npts, nponds = write(reaches, filled, dem, OUT)
    widths = [w for r in reaches for (_,_,_,w) in r]
    print(f'reaches {len(reaches):,}  points {npts:,}  ponds {nponds:,}')
    print(f'width  {min(widths):.1f}-{max(widths):.1f} m,'
          f' median {np.median(widths):.1f} m')
    print(f'wrote  {OUT.relative_to(ROOT)}  {OUT.stat().st_size/1e6:.2f} MB')

if __name__ == '__main__':
    main()
