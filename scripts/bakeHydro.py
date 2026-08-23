#!/usr/bin/env python3
"""Bake Beyond Extinction's Kauai hydrography into the ant world's units.

Source: BE ships `hydro.json` (2.2 MB) beside the height tiles TMB already
bakes from - USGS NHDPlus HR, EPSG:4326, resolved to world metres. It holds
1,121 river polylines (49,665 centreline points, each x / elevation / z /
drainage-derived width) and 111 lakes with baked waterline elevations, rings
and holes. We are not rediscovering where Kauai's rivers are.

THE CONVERSION IS ONE MULTIPLY, and that is worth stating because it is only
true by a coincidence worth checking. BE's world runs x/z in [-28,000,
+28,000] metres, centred on the island; TMB's runs [-2,800,000, +2,800,000]
centimetres, centred on the same point (see `heightAt`, which indexes with
`(x + SPAN/2) / STEP`). Same island, same frame, same centre, so:

    TMB units = BE metres x 100        horizontally AND vertically

Had TMB's grid been addressed from a corner instead, every river would have
landed twenty-eight kilometres out to sea while the arithmetic still looked
right. The `--verify` pass below exists so that class of mistake cannot ship
quietly: it samples TMB's own height grid under every river point and reports
whether the island agrees the water is there.

X AND Z SURVIVE EXACTLY. BE's coordinates carry two decimal places of a
metre, so times a hundred they are whole centimetres and the bake asserts it.
Elevations and widths are rounded to the centimetre, which is finer than
anything downstream can use.

WHY BINARY. The JSON is 2.2 MB and would roughly double the download, onto a
loading screen that reports honest bytes. Packed, it is about a third of
that, and the point arrays land as typed arrays with no parse at all.

Usage:  python3 scripts/bakeHydro.py <BE-repo>/artifacts/beyond-extinction
        python3 scripts/bakeHydro.py <BE-repo>/... --verify   (also checks
        the result against public/kauai-1025.bin and writes hydro-check.png)
Writes: public/kauai-hydro.bin
"""

import gzip
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "kauai-hydro.bin"
GRID = ROOT / "public" / "kauai-1025.bin"

MAGIC = b"TMBH"
VERSION = 1
# One BE metre is this many TMB world units. See the module docstring.
PER_METRE = 100
# Mirrors src/world/kauai.ts. If these ever disagree the bake is wrong.
SPAN = 5_600_000
SAMPLES = 1025


def cm(metres: float) -> int:
    return int(round(metres * PER_METRE))


def exact(metres: float) -> int:
    """Convert a coordinate that MUST land on a whole centimetre."""
    scaled = metres * PER_METRE
    whole = round(scaled)
    if abs(scaled - whole) > 1e-6:
        raise SystemExit(f"{metres} m is not a whole number of centimetres")
    return int(whole)


def pad4(blob: bytearray) -> None:
    while len(blob) % 4:
        blob.append(0)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1]) / "public" / "assets" / "terrain" / "kauai" / "hydro.json"
    data = json.loads(src.read_text())
    rivers = data["rivers"]
    lakes = data["lakes"]

    names = bytearray()
    seen: dict[str, tuple[int, int]] = {}

    def name_of(text) -> tuple[int, int]:
        """Intern a name into the blob. Repeats are common: a river split
        across terrain tiles keeps its name in every piece."""
        if not text:
            return (0, 0)
        if text not in seen:
            raw = text.encode("utf-8")
            seen[text] = (len(names), len(raw))
            names.extend(raw)
        return seen[text]

    px: list[int] = []
    pz: list[int] = []
    py: list[int] = []
    pw: list[int] = []
    river_rows = bytearray()
    for river in rivers:
        first = len(px)
        for x, y, z, w in river["pts"]:
            px.append(exact(x))
            pz.append(exact(z))
            py.append(cm(y))
            width = cm(w)
            if not 0 < width < 65536:
                raise SystemExit(f"width {w} m does not fit a uint16 of centimetres")
            pw.append(width)
        at, length = name_of(river["name"])
        river_rows += struct.pack(
            "<IIIHBB", first, len(px) - first, at, length,
            river["order"], 1 if river["toOcean"] else 0,
        )

    rx: list[int] = []
    rz: list[int] = []
    ring_rows = bytearray()
    lake_rows = bytearray()
    rings = 0
    for lake in lakes:
        ring_from = rings
        # Ring 0 is the outer shore; the rest are islands in the lake.
        for ring in [lake["ring"], *lake["holes"]]:
            start = len(rx)
            for x, z in ring:
                rx.append(exact(x))
                rz.append(exact(z))
            ring_rows += struct.pack("<II", start, len(rx) - start)
            rings += 1
        at, length = name_of(lake["name"])
        lake_rows += struct.pack(
            "<IIIIHH", cm(lake["y"]) & 0xFFFFFFFF, ring_from, rings - ring_from,
            at, length, 0,
        )

    blob = bytearray()
    blob += struct.pack(
        "<4sHHIIIIII", MAGIC, VERSION, 0,
        len(rivers), len(px), len(lakes), rings, len(rx), len(names),
    )
    assert len(blob) == 32, len(blob)
    blob += river_rows
    blob += lake_rows
    blob += ring_rows
    # THE POINTS AS PARALLEL ARRAYS, not as records. Each lands 4-byte
    # aligned and decodes as a typed-array view over the same buffer with no
    # copying and no per-point loop; interleaved records would need a
    # DataView read per field. It also compresses far better, because
    # neighbouring coordinates resemble each other and neighbouring fields
    # do not.
    blob += struct.pack(f"<{len(px)}i", *px)
    blob += struct.pack(f"<{len(pz)}i", *pz)
    blob += struct.pack(f"<{len(py)}i", *py)
    blob += struct.pack(f"<{len(pw)}H", *pw)
    pad4(blob)
    blob += struct.pack(f"<{len(rx)}i", *rx)
    blob += struct.pack(f"<{len(rz)}i", *rz)
    blob += names
    pad4(blob)

    OUT.write_bytes(blob)
    agree_with_loader(len(blob))
    packed = len(gzip.compress(bytes(blob), 9))
    print(f"wrote {OUT} ({len(blob) / 1e6:.2f} MB, {packed / 1e6:.2f} MB gzipped)")
    print(f"  {len(rivers)} rivers, {len(px)} points, "
          f"{len(lakes)} lakes, {rings} rings, {len(rx)} ring points")
    print(f"  source JSON {src.stat().st_size / 1e6:.2f} MB")
    print(f"  x {min(px)}..{max(px)}  z {min(pz)}..{max(pz)}  "
          f"y {min(py)}..{max(py)}  width {min(pw)}..{max(pw)}")
    if max(abs(v) for v in px + pz) > SPAN // 2:
        raise SystemExit("a river point lies outside the island")

    if "--verify" in sys.argv:
        verify(px, pz, py, rx, rz)


def agree_with_loader(size: int) -> None:
    """Keep `HYDRO_BYTES` in src/world/hydro.ts honest.

    The loading bar needs the file's size BEFORE the file arrives, and
    cannot get it from Content-Length (the host gzips, so that header
    counts different bytes than the stream yields). So the loader carries the
    number as a constant — and a hand-kept constant rots the first time
    anyone re-bakes. This is the bake refusing to let that happen quietly.
    """
    import re

    loader = ROOT / "src" / "world" / "hydro.ts"
    text = loader.read_text()
    found = re.search(r"export const HYDRO_BYTES = ([\d_]+);", text)
    if not found:
        raise SystemExit(f"cannot find HYDRO_BYTES in {loader}")
    stated = int(found.group(1).replace("_", ""))
    if stated == size:
        return
    pretty = f"{size:_}"
    loader.write_text(text.replace(found.group(0), f"export const HYDRO_BYTES = {pretty};"))
    print(f"  updated HYDRO_BYTES in {loader.name}: {stated:_} -> {pretty}")


def verify(px, pz, py, rx, rz) -> None:
    """Does TMB's own island agree the water is there?

    The check that a unit conversion cannot pass by accident. Every river
    point carries the elevation the DEM had under it; TMB's height grid comes
    from the same DEM, downsampled. Sample the grid at the converted position
    and the two should broadly agree — not exactly, because 1025 samples over
    56 km is one every 54.6 m and a river runs along the floor of a valley
    narrower than that, so the grid reads higher than the water almost
    everywhere. What matters is that the points land ON LAND and that the
    disagreement is valley-sized rather than island-sized.
    """
    import numpy as np

    grid = np.frombuffer(GRID.read_bytes(), dtype="<i2").reshape(SAMPLES, SAMPLES)
    step = SPAN / (SAMPLES - 1)
    ax = np.asarray(px, dtype=np.float64)
    az = np.asarray(pz, dtype=np.float64)
    ay = np.asarray(py, dtype=np.float64) / PER_METRE  # metres

    col = np.clip(((ax + SPAN / 2) / step).round().astype(int), 0, SAMPLES - 1)
    row = np.clip(((az + SPAN / 2) / step).round().astype(int), 0, SAMPLES - 1)
    under = grid[row, col] / 10.0  # decimetres -> metres

    land = float((under > 0).mean())
    gap = under - ay
    print("\nverify against public/kauai-1025.bin")
    print(f"  river points over land: {100 * land:.1f}%")
    print(f"  grid minus river elevation, metres: "
          f"median {np.median(gap):+.0f}, mean {gap.mean():+.0f}, "
          f"5th {np.percentile(gap, 5):+.0f}, 95th {np.percentile(gap, 95):+.0f}")
    print(f"  correlation of the two elevations: "
          f"{np.corrcoef(under, ay)[0, 1]:.4f}")
    if land < 0.9:
        raise SystemExit("FAILED: the rivers are not on the island")
    if np.corrcoef(under, ay)[0, 1] < 0.95:
        raise SystemExit("FAILED: the rivers do not follow the island's shape")
    print("  PASSED")
    draw(ax, az, rx, rz, grid)


def draw(ax, az, rx, rz, grid) -> None:
    """A picture, for the eyeball that the numbers cannot replace."""
    import numpy as np
    from PIL import Image

    size = 768
    land = grid > 0
    shade = np.where(land, 90 + np.clip(grid, 0, 15000) / 15000 * 140, 30)
    img = np.zeros((SAMPLES, SAMPLES, 3), dtype=np.uint8)
    img[..., 0] = np.where(land, shade, 20)
    img[..., 1] = np.where(land, shade * 0.92, 50)
    img[..., 2] = np.where(land, shade * 0.6, 90)
    pic = Image.fromarray(img).resize((size, size), Image.NEAREST)
    pixels = pic.load()

    def plot(xs, zs, colour):
        for x, z in zip(xs, zs):
            u = int((x + SPAN / 2) / SPAN * (size - 1))
            v = int((z + SPAN / 2) / SPAN * (size - 1))
            if 0 <= u < size and 0 <= v < size:
                pixels[u, v] = colour

    plot(ax, az, (90, 210, 255))
    plot(np.asarray(rx, dtype=np.float64), np.asarray(rz, dtype=np.float64),
         (255, 230, 90))
    out = ROOT / "hydro-check.png"
    pic.save(out)
    print(f"  wrote {out} — rivers in blue, lake shores in yellow")


if __name__ == "__main__":
    main()
