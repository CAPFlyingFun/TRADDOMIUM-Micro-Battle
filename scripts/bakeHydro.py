#!/usr/bin/env python3
"""Bake Beyond Extinction's REAL Kauai hydrography into TMB world units.

WHY THIS EXISTS, AND WHY IT REPLACES A SUMMER OF WORK. TMB derived its own
waterways: sample the drawn island, priority-flood it, route D8, accumulate
rainfall, trace channels. That is the right mathematics and it was answering
the wrong question, because the island it was solving is a 54.7 m grid blurred
with a 100 m kernel -- and measured against real hydrography, that blur alone
puts the ground 13.28 m out and drops the fraction of river points sitting
within 5 m of their own terrain from 88% to 21%.

BE never had that problem, because BE never guessed. `hydro.json` is USGS
NHDPlus HR -- the surveyed river network of the actual island -- projected to
world metres. 1,121 runs, 264 of them named, Strahler order 1 to 5, 140
reaching the ocean, and 111 lakes as rings at a measured waterline. It aligns
with the terrain we already ship: 96.9% of its points sit within 10 m of the
4097 grid, median 0.47 m, with no axis flip. There is nothing to derive.

THE ONLY TRANSFORM IS SCALE. A TMB world unit is a centimetre and BE's are
metres, so every coordinate is multiplied by a hundred. Both worlds put the
island's centre at the origin across the same 56 km, which is why the check
above passes at all -- see the alignment assertion at the end of this bake.

FORMAT -- TMBH v1, little-endian throughout:

  magic u32 'TMBH' | version u16 | pad u16
  rivers u32 | points u32 | lakes u32 | rings u32 | verts u32 | nameBytes u32
                                                                    (32 bytes)
  rivers:  first u32, count u32, order u8, toOcean u8, tile u8, pad u8,
           name i16 (-1 unnamed), pad u16                           (16 bytes)
  points:  x i32, z i32, level i32, width u16, pad u16              (16 bytes)
  lakes:   firstRing u32, ringCount u32, level i32, tile u8, pad u8,
           name i16                                                 (16 bytes)
  rings:   firstVert u32, vertCount u32                              (8 bytes)
  verts:   x i32, z i32                                              (8 bytes)
  names:   UTF-8, NUL-separated; a name index is an ordinal into this

A lake's FIRST ring is its shoreline and the rest are holes -- islands standing
out of it. `tile` is BE's own 8x8 split as col*8 + row, so a run can be found
without walking every point of every river.

Usage:  python3 scripts/bakeHydro.py <BE-repo>/artifacts/beyond-extinction
Writes: public/kauai-hydro.bin
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "kauai-hydro.bin"
HD = ROOT / "public" / "kauai-hd"
MAGIC = 0x484D4254            # 'TMBH'
VERSION = 1
UNITS_PER_METRE = 100
SPAN_M = 56000.0
COLS = "ABCDEFGH"


def tile_index(name: str | None) -> int:
    """BE's 'E7' as col*8 + row, 0..63. 255 when the bake did not say."""
    if not name or len(name) < 2 or name[0] not in COLS:
        return 255
    return COLS.index(name[0]) * 8 + (int(name[1:]) - 1)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1]) / "public" / "assets" / "terrain" / "kauai" / "hydro.json"
    if not src.is_file():
        raise SystemExit(f"no hydrography at {src}")
    data = json.loads(src.read_text())
    print(f"source: {data['source']}")

    names: list[str] = []
    index: dict[str, int] = {}

    def name_id(n: str | None) -> int:
        if not n:
            return -1
        if n not in index:
            index[n] = len(names)
            names.append(n)
        return index[n]

    rivers, points = bytearray(), bytearray()
    at = 0
    for r in data["rivers"]:
        pts = r["pts"]
        rivers += struct.pack(
            "<IIBBBBhH", at, len(pts), min(255, r.get("order") or 0),
            1 if r.get("toOcean") else 0, tile_index(r.get("tile")), 0,
            name_id(r.get("name")), 0)
        for x, y, z, w in pts:
            points += struct.pack(
                "<iiiHH",
                round(x * UNITS_PER_METRE), round(z * UNITS_PER_METRE),
                round(y * UNITS_PER_METRE),
                max(0, min(65535, round(w * UNITS_PER_METRE))), 0)
        at += len(pts)

    lakes, rings, verts = bytearray(), bytearray(), bytearray()
    ring_at = vert_at = 0
    for l in data["lakes"]:
        loops = [l["ring"]] + list(l.get("holes") or [])
        lakes += struct.pack(
            "<IIiBBh", ring_at, len(loops), round(l["y"] * UNITS_PER_METRE),
            tile_index(l.get("tile")), 0, name_id(l.get("name")))
        for loop in loops:
            rings += struct.pack("<II", vert_at, len(loop))
            for x, z in loop:
                verts += struct.pack(
                    "<ii", round(x * UNITS_PER_METRE), round(z * UNITS_PER_METRE))
            vert_at += len(loop)
        ring_at += len(loops)

    blob = b"\x00".join(n.encode("utf-8") for n in names) + b"\x00" if names else b""
    head = struct.pack(
        "<IHHIIIIII", MAGIC, VERSION, 0, len(data["rivers"]), at,
        len(data["lakes"]), ring_at, vert_at, len(blob))
    OUT.write_bytes(head + rivers + points + lakes + rings + verts + blob)

    # THE RIVERS MUST STILL LAND ON THE ISLAND. Every coordinate has just been
    # multiplied by a hundred and written as an integer; if that has gone wrong
    # in any way the water is somewhere else, and "somewhere else" is exactly
    # the failure this whole rebuild exists to end. So it is checked HERE,
    # against the HD tiles, in the units the game will actually read.
    grid = np.zeros((4097, 4097), dtype=np.int16)
    for col in range(8):
        for row in range(8):
            t = np.fromfile(HD / f"{COLS[col]}{row + 1}.bin", dtype="<i2").reshape(513, 513)
            grid[row * 512 : row * 512 + 513, col * 512 : col * 512 + 513] = t
    p = np.frombuffer(bytes(points), dtype=np.int32).reshape(-1, 4)
    px, pz, plev = p[:, 0], p[:, 1], p[:, 2]
    span_u = SPAN_M * UNITS_PER_METRE
    c = np.clip(np.round((px + span_u / 2) / span_u * 4096).astype(int), 0, 4096)
    rr = np.clip(np.round((pz + span_u / 2) / span_u * 4096).astype(int), 0, 4096)
    ground = grid[rr, c].astype(np.float64) * 10          # decimetres -> units
    ok = (ground > -10000) & (ground < 200000)
    off = np.abs(plev[ok] - ground[ok]) / UNITS_PER_METRE
    near = float((off < 10).mean())
    if near < 0.9:
        raise SystemExit(f"only {near:.1%} of river points land within 10 m of the island")

    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    print(f"  {len(data['rivers']):,} rivers, {at:,} points, {len(names)} names")
    print(f"  {len(data['lakes'])} lakes, {ring_at} rings, {vert_at:,} vertices")
    print(f"  {near:.1%} of river points within 10 m of the HD island, "
          f"median {np.median(off):.2f} m")


if __name__ == "__main__":
    main()
