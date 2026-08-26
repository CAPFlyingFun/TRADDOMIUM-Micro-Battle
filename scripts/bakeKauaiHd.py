#!/usr/bin/env python3
"""Bake Beyond Extinction's Kauai height tiles at FULL resolution.

`bakeKauai.py` assembles the same 64 tiles into one 4097-square grid and then
throws fifteen of every sixteen samples away -- `full[::4, ::4]` -- to reach the
1025 grid the island has shipped on since the beginning. That stride is one
sample every 54.7 m, and 54.7 m is 5,470 of the queen's body lengths: the whole
of Kauai's real shape below a district is simply not in the file. Everything
finer than that is procedural noise, which looks like ground and does not drain
like it. Measured: on a bicubic upsample of the 1025 grid, a patch of real
drainage that concentrates into 53 channel cells at true resolution concentrates
into NONE.

So this keeps all of it, tile by tile. The tiles are BE's own 8x8 split, 7 km
each, and they stay split because 4097 square is 33.6 MB and she only ever
stands on one of them: TMB streams terrain already, and 526 KB of fine ground
(197 KB over the wire) around her is a load the island can carry where the whole
grid is not.

FORMAT, and it matches `kauai-1025.bin` deliberately: raw little-endian int16
DECIMETRES of real elevation, 513 x 513, row-major, north-west first. No header
-- the size is the contract, exactly as the 1025 grid's is. Tiles overlap their
neighbours by one sample on the shared edge, which is what makes 8*512+1 = 4097
and what lets two tiles meet with no seam.

Nodata is floored at -6000 m, the same as the 1025 bake, so the two grids agree
sample for sample where they overlap. This bake ASSERTS that.

Usage:  python3 scripts/bakeKauaiHd.py <BE-repo>/artifacts/beyond-extinction
Writes: public/kauai-hd/A1.bin .. H8.bin  (64 files, 526 KB each, 33.6 MB)
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

TILE_PX = 513
COLS = "ABCDEFGH"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "kauai-hd"
COARSE = ROOT / "public" / "kauai-1025.bin"


def decode(path: Path) -> np.ndarray:
    """One Terrarium tile as metres of elevation. Same maths as bakeKauai.py."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    if rgb.shape[0] != TILE_PX or rgb.shape[1] != TILE_PX:
        raise SystemExit(f"{path} is {rgb.shape}, expected {TILE_PX} square")
    elev = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
    return np.maximum(elev, -6000)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    base = Path(sys.argv[1]) / "public" / "assets" / "terrain" / "kauai" / "height"
    if not base.is_dir():
        raise SystemExit(f"no height tiles at {base}")
    OUT.mkdir(parents=True, exist_ok=True)

    full = np.zeros((4097, 4097), dtype=np.float64)
    written = 0
    for row in range(8):          # row 0 = "1" = north
        for col in range(8):
            name = f"{COLS[col]}{row + 1}"
            tile = decode(base / COLS[col] / f"{name}.png")
            full[row * 512 : row * 512 + 513, col * 512 : col * 512 + 513] = tile
            dm = np.clip(np.round(tile * 10), -32768, 32767).astype("<i2")
            (OUT / f"{name}.bin").write_bytes(dm.tobytes())
            written += 1

    # THE TWO GRIDS MUST BE THE SAME ISLAND. The 1025 grid is this one strided
    # by four, so every coarse sample has to appear here unchanged. If this ever
    # fails, the far view and the ground under her feet are different places.
    coarse = np.fromfile(COARSE, dtype="<i2").reshape(1025, 1025)
    mine = np.clip(np.round(full * 10), -32768, 32767).astype("<i2")[::4, ::4]
    bad = int((coarse != mine).sum())
    if bad:
        raise SystemExit(f"HD tiles disagree with kauai-1025.bin at {bad} samples")

    land = full[(full > 0) & (full < 2000)]
    size = sum(f.stat().st_size for f in OUT.glob("*.bin"))
    print(f"wrote {written} tiles to {OUT} ({size / 1e6:.1f} MB)")
    print(f"  4097 square, one sample every {5600000 / 4096 / 100:.2f} m")
    print(f"  elevation {full.min():.0f} to {full.max():.0f} m, land mean {land.mean():.0f} m")
    print(f"  matches kauai-1025.bin on all {coarse.size:,} strided samples")


if __name__ == "__main__":
    main()
