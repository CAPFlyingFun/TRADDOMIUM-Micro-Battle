#!/usr/bin/env python3
"""Bake Beyond Extinction's Kauai vegetation rasters into one binary.

Source: BE ships four 384-square PNGs beside the height tiles, covering the
SAME 56x56 km world square (assets/terrain/kauai/veg). They come from ESA
WorldCover 10 m plus canopy/river rasters, so like hydro.json this is real
data about the real island rather than anything invented:

    landcover.png  ESA class per pixel - 10 tree, 20 shrub, 30 grass,
                   40 crop, 50 built, 60 bare, 80 water, 90 wetland
    canopy.png     tree canopy cover, 0-255
    river.png      river-corridor intensity, 0-255
    water.png      binary water mask (derivable from landcover == 80,
                   and so NOT baked)

Measured over the square: 54.3% water, 28.9% tree, 14.0% grass, 2.0% shrub.
Mean canopy over land is 167 of 255 - Kauai is genuinely dense.

ONE PIXEL IS 146 METRES, which is coarser than the height grid's 55 and is
fine for what this decides: it picks WHAT grows in a neighbourhood, never
where an individual blade stands. The scatter's own hash does that.

SAME FRAME AS EVERYTHING ELSE. Pixel (0,0) is the NW corner, u runs east and
v runs south, exactly like the height tiles - so the conversion is the same
one the hydrography uses and the same test can prove it.

Usage:  python3 scripts/bakeVeg.py <BE-repo>/artifacts/beyond-extinction
Writes: public/kauai-veg.bin
"""

import gzip
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "kauai-veg.bin"
MAGIC = b"TMBV"
VERSION = 1
GRID = 384


def layer(base: Path, name: str) -> np.ndarray:
    img = np.array(Image.open(base / name).convert("L"), dtype=np.uint8)
    if img.shape != (GRID, GRID):
        raise SystemExit(f"{name} is {img.shape}, expected {GRID} square")
    return img


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    base = Path(sys.argv[1]) / "public" / "assets" / "terrain" / "kauai" / "veg"
    cover = layer(base, "landcover.png")
    canopy = layer(base, "canopy.png")
    river = layer(base, "river.png")

    blob = bytearray()
    blob += struct.pack("<4sHHI", MAGIC, VERSION, 0, GRID)
    assert len(blob) == 12
    # Three parallel planes rather than interleaved triples: each decodes as
    # one typed-array view over the downloaded buffer, and neighbouring
    # values in a plane resemble each other so it compresses far better.
    blob += cover.tobytes()
    blob += canopy.tobytes()
    blob += river.tobytes()

    OUT.write_bytes(blob)
    packed = len(gzip.compress(bytes(blob), 9))
    print(f"wrote {OUT} ({len(blob) / 1e6:.2f} MB, {packed / 1e6:.2f} MB gzipped)")

    names = {10: "tree", 20: "shrub", 30: "grass", 40: "crop", 50: "built",
             60: "bare", 80: "water", 90: "wetland", 95: "mangrove"}
    values, counts = np.unique(cover, return_counts=True)
    share = sorted(zip(values, counts), key=lambda t: -t[1])
    print("  " + ", ".join(
        f"{names.get(int(v), v)} {100 * c / cover.size:.1f}%" for v, c in share[:6]))
    land = cover != 80
    print(f"  canopy over land: mean {canopy[land].mean():.0f}/255")
    agree_with_loader(len(blob))


def agree_with_loader(size: int) -> None:
    """Keep VEG_BYTES in src/world/landcover.ts honest — see bakeHydro.py."""
    import re

    loader = ROOT / "src" / "world" / "landcover.ts"
    if not loader.exists():
        return
    text = loader.read_text()
    found = re.search(r"export const VEG_BYTES = ([\d_]+);", text)
    if not found:
        raise SystemExit(f"cannot find VEG_BYTES in {loader}")
    stated = int(found.group(1).replace("_", ""))
    if stated == size:
        return
    pretty = f"{size:_}"
    loader.write_text(text.replace(found.group(0), f"export const VEG_BYTES = {pretty};"))
    print(f"  updated VEG_BYTES: {stated:_} -> {pretty}")


if __name__ == "__main__":
    main()
