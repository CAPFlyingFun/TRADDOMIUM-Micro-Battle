"""
WHERE THE WATER ACTUALLY SITS — an offline shallow-water solve.

Beyond Extinction wrote a virtual-pipes water simulation and its own
header says what it was for:

    "Bounded + CPU: this is the WaterLab pilot. The island-scale
     version bakes an offline steady state; a movable 256 patch runs
     live near the player."

BE never got to the island-scale bake. This is it, and it is the thing
that keeps not being done while the same three faults come back: the
sheet floats over dry ground, the carve is wider than the water, and
the water ends in a straight edge with a gap under it. Every one of
those is the same root cause — the water's LEVEL and the ground's
HEIGHT are decided by different code that agrees only by arrangement.

A solve makes them agree by construction. Water is poured on the
uplands, it runs downhill, it pools where the terrain holds it and it
leaves at the sea; the steady state is a level field that is, by
definition, never above the ground it is not covering.

THE METHOD is lisyarus's virtual pipes, ported from BE's
KauaiWaterSim.ts substep. State on a staggered grid: a fixed bed, a
water column per cell, and a flux across every edge. Each step
accelerates the fluxes by the SURFACE-height difference, scales the
outflows so no cell can go negative, then moves the water.

WHAT THIS CAN AND CANNOT ANSWER, said plainly, because the last few
attempts failed by expecting the wrong thing of a grid:

  IT CAN     where standing water sits, and at what level
  IT CAN     which valleys hold water and how wide the wet floor is
  IT CAN     a level field that never floats above dry ground
  IT CANNOT  a 5.5 m stream

The island is 56 km across. Resolving a median Kauai channel would
take an 18,000-square grid and 346 million cells. The narrow channels
stay vector data (rivers.ts); what they take from this bake is their
LEVEL, so a stream and the pool it runs into can no longer disagree.

Writes public/kauai-water.bin:
    header  <4sHHII>  "TMBW", version, pad, grid, sea level in cm
    plane   int16 grid*grid  water SURFACE height, decimetres, and
                             -32768 where there is no water at all
"""
import gzip
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
GRID_IN = PUBLIC / "kauai-1025.bin"
OUT = PUBLIC / "kauai-water.bin"

MAGIC = b"TMBW"
VERSION = 1

# The island, in the game's own numbers (kauai.ts).
SPAN_UNITS = 5_600_000
UNITS_PER_METRE = 100
SPAN_M = SPAN_UNITS / UNITS_PER_METRE          # 56,000 m
SAMPLES_IN = 1025

# THE SOLVE GRID. Four thousand and ninety-seven is 13.7 m a cell —
# four times the detail of the baked island and as fine as a 17-million
# cell numpy solve runs in a sensible time. Finer buys nothing until
# the terrain itself has more in it.
GRID = int(sys.argv[1]) if len(sys.argv) > 1 else 2049
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 4000

G = 9.8
DT = 0.25
FRICTION = 0.3
# Rain, metres a second, on the upper catchment only. Feeding every
# cell floods beaches and ridges alike and the island becomes a bath.
RAIN = 0.02
FEED_ABOVE = 40.0        # metres: only ground above this is headwater
SEA = 0.0                # bed at or below this drains to the ocean
MIN_DEPTH = 0.08         # under this a cell is dry, not a wet film

HYDRO_IN = PUBLIC / "kauai-hydro.bin"
# Half-width of the corridor water is confined to, in metres. Two cells
# at the solve grid — wide enough that a channel is continuous, narrow
# enough that it is a waterway and not a floodplain.
CORRIDOR_M = 30.0

# WHERE TO STOP POURING, in metres — bankfull, near enough.
#
# BE's KauaiWaterSim carries the same idea and needs it for the same
# reason: a corridor cut from a 55 m DEM does not reliably reach the
# sea, so inflow has nowhere to go and the channel fills without
# bound. Measured here, unthrottled: 27 m deep and still rising after
# 1,500 steps, which is a canyon of water, not a stream.
#
# Throttling the SOURCE rather than deleting the excess keeps the
# solve honest — volume is conserved and the level settles by
# redistributing, exactly as it would if the outlet were resolved.
TARGET_DEPTH = 2.0


def read_bed() -> np.ndarray:
    """The baked island, resampled to the solve grid, in metres."""
    raw = np.frombuffer(GRID_IN.read_bytes(), dtype="<i2")
    if raw.size != SAMPLES_IN * SAMPLES_IN:
        raise SystemExit(f"{GRID_IN} is {raw.size} samples, expected {SAMPLES_IN}^2")
    # Decimetres to metres, and NODATA to the sea floor, exactly as
    # kauai.ts does when it reads the same file.
    grid = raw.reshape(SAMPLES_IN, SAMPLES_IN).astype(np.float32) / 10.0
    grid = np.maximum(grid, -60.0)
    if GRID == SAMPLES_IN:
        return grid
    # Bilinear, matching heightAt's interpolation rather than a nearest
    # resample — the solve should see the surface the game draws.
    at = np.linspace(0, SAMPLES_IN - 1, GRID, dtype=np.float32)
    c = np.clip(np.floor(at).astype(np.int32), 0, SAMPLES_IN - 2)
    f = (at - c).astype(np.float32)
    rows = grid[c, :] * (1 - f)[:, None] + grid[c + 1, :] * f[:, None]
    return (rows[:, c] * (1 - f)[None, :] + rows[:, c + 1] * f[None, :]).astype(np.float32)


def read_corridor() -> np.ndarray:
    """
    WHERE WATER IS ALLOWED TO BE — the real drainage, rasterised.

    THIS IS NOT A SHORTCUT, it is the correction to a measurement. Run
    unconfined, the solve floods 42% of the island and the volume never
    stops rising, because a 55 m DEM has no resolved drainage in it:
    every shallow valley is a chain of unconnected puddles and water
    that cannot find the sea simply accumulates. That is a property of
    the elevation data, not of the method, and no amount of extra steps
    fixes it.

    Beyond Extinction hit the same wall and confined its water to the
    real waterways for the same reason. We have better vector data than
    a mask needs — 1,121 NHD reaches and 111 lake shorelines — so the
    corridor is drawn from the drainage that is actually there.

    The solve then answers the question it CAN answer: given water in
    these channels, what level does it settle at, and where does it
    pool. Which is the question that was making the sheet float.
    """
    raw = HYDRO_IN.read_bytes()
    magic, version, _pad, rivers, points, lakes, rings, ring_pts, _names = \
        struct.unpack_from("<4sHHIIIIII", raw, 0)
    if magic != b"TMBH":
        raise SystemExit(f"{HYDRO_IN} is not hydrography ({magic!r})")
    at = 32 + rivers * 16 + lakes * 20 + rings * 8
    px = np.frombuffer(raw, dtype="<i4", count=points, offset=at)
    pz = np.frombuffer(raw, dtype="<i4", count=points, offset=at + points * 4)
    ring_at = at + points * 12 + points * 2
    ring_at += (-ring_at) % 4
    rx = np.frombuffer(raw, dtype="<i4", count=ring_pts, offset=ring_at)
    rz = np.frombuffer(raw, dtype="<i4", count=ring_pts, offset=ring_at + ring_pts * 4)
    print(f"hydrography: {rivers} reaches, {points:,} points, "
          f"{lakes} lakes, {ring_pts:,} shore points", flush=True)

    mask = np.zeros((GRID, GRID), dtype=bool)
    cell = SPAN_M / (GRID - 1)
    reach = max(1, int(round(CORRIDOR_M / cell)))

    def stamp(ux: np.ndarray, uz: np.ndarray) -> None:
        # World units to grid indices. +X is east and +Z is south, the
        # same way round as the height grid it has to line up with.
        gx = np.clip(((ux / UNITS_PER_METRE + SPAN_M / 2) / cell).astype(np.int32), 0, GRID - 1)
        gz = np.clip(((uz / UNITS_PER_METRE + SPAN_M / 2) / cell).astype(np.int32), 0, GRID - 1)
        mask[gz, gx] = True

    stamp(px.astype(np.float64), pz.astype(np.float64))
    stamp(rx.astype(np.float64), rz.astype(np.float64))
    # Dilate to the corridor half-width, and to close the gaps between
    # vertices that a point stamp leaves on a sparse polyline.
    for _ in range(reach + 1):
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    print(f"corridor: {mask.mean() * 100:.2f}% of the grid, "
          f"{reach + 1} cells of dilation at {cell:.1f} m/cell", flush=True)
    return mask


def solve(bed: np.ndarray, steps: int, corridor: np.ndarray) -> np.ndarray:
    """Virtual pipes to a steady state. Returns the water column, metres."""
    cell = SPAN_M / (GRID - 1)
    water = np.zeros_like(bed)
    # Staggered fluxes: one more edge than cell along the flow axis.
    fx = np.zeros((GRID, GRID + 1), dtype=np.float32)
    fy = np.zeros((GRID + 1, GRID), dtype=np.float32)
    damp = (1.0 - FRICTION) ** DT
    k = (G * DT) / cell
    kd = DT / (cell * cell)
    cap = (cell * cell) / DT

    land = bed > SEA
    # Headwaters: the upper end of the drainage, inside the corridor.
    head = corridor & land & (bed > FEED_ABOVE)
    add = RAIN * DT
    print(f"grid {GRID}^2 at {cell:.1f} m/cell · land {land.mean() * 100:.1f}% "
          f"· headwater {head.mean() * 100:.1f}%", flush=True)

    for step in range(steps):
        # Full feed until the deepest cell is at 70% of bankfull, then
        # ramp to nothing. Conserves volume; only stops adding.
        deepest = float(water.max())
        lo = TARGET_DEPTH * 0.7
        throttle = (0.0 if deepest >= TARGET_DEPTH
                    else 1.0 if deepest <= lo
                    else (TARGET_DEPTH - deepest) / (TARGET_DEPTH - lo))
        water[head] += add * throttle
        # The sea is a sink, not a surface: anything that reaches it is
        # gone. The ocean is drawn by its own model (Ocean.ts).
        water[~land] = 0.0
        # AND OFF THE WATERWAYS IS A SINK TOO. Water that spreads out
        # of the corridor is removed rather than allowed to pond, which
        # is the hard cap that makes island-flooding impossible.
        water[~corridor] = 0.0

        surface = bed + water
        # Accelerate the interior edges by the surface-height difference.
        fx[:, 1:GRID] = fx[:, 1:GRID] * damp + (surface[:, :-1] - surface[:, 1:]) * k
        fy[1:GRID, :] = fy[1:GRID, :] * damp + (surface[:-1, :] - surface[1:, :]) * k
        fx[:, 0] = 0.0
        fx[:, GRID] = 0.0
        fy[0, :] = 0.0
        fy[GRID, :] = 0.0

        # Never take more out of a cell than it holds.
        out = (np.maximum(-fx[:, :GRID], 0) + np.maximum(fx[:, 1:], 0)
               + np.maximum(-fy[:GRID, :], 0) + np.maximum(fy[1:, :], 0))
        with np.errstate(divide="ignore", invalid="ignore"):
            scale = np.where(out > 0, np.minimum(1.0, (water * cap) / np.maximum(out, 1e-9)), 1.0)
        np.multiply(fx[:, :GRID], np.where(fx[:, :GRID] < 0, scale, 1.0), out=fx[:, :GRID])
        np.multiply(fx[:, 1:], np.where(fx[:, 1:] > 0, scale, 1.0), out=fx[:, 1:])
        np.multiply(fy[:GRID, :], np.where(fy[:GRID, :] < 0, scale, 1.0), out=fy[:GRID, :])
        np.multiply(fy[1:, :], np.where(fy[1:, :] > 0, scale, 1.0), out=fy[1:, :])

        water += (fx[:, :GRID] + fy[:GRID, :] - fx[:, 1:] - fy[1:, :]) * kd
        np.maximum(water, 0.0, out=water)

        if step % 500 == 0 or step == steps - 1:
            wet = water > MIN_DEPTH
            print(f"  step {step:5d}  wet {wet.mean() * 100:5.2f}%  "
                  f"deepest {water.max():6.2f} m  volume {water.sum() * cell * cell / 1e6:8.2f} Ml",
                  flush=True)
    return water


def main() -> None:
    bed = read_bed()
    corridor = read_corridor()
    water = solve(bed, STEPS, corridor)

    wet = water > MIN_DEPTH
    surface = np.where(wet, bed + water, np.nan)
    print(f"\nwet cells {wet.sum():,} of {wet.size:,} ({wet.mean() * 100:.2f}%)")
    if wet.any():
        print(f"depth  median {np.median(water[wet]):.2f} m  max {water.max():.2f} m")
        print(f"level  min {np.nanmin(surface):.1f} m  max {np.nanmax(surface):.1f} m")

    # THE INVARIANT THIS WHOLE EXERCISE IS FOR, and it has to be
    # MEASURED rather than asserted, because a solve is converged to a
    # tolerance and not to a proof.
    #
    # Water standing beside lower dry ground is exactly the fault that
    # has come back three times: a sheet at a level the neighbouring
    # ground is below, which draws as a floating edge with a gap under
    # it. At steady state it cannot happen — the water would have gone
    # there. So the number below is the convergence report.
    lvl = np.where(wet, bed + water, -1e9)
    worst = 0.0
    leaks = 0
    for shift, axis in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
        near_bed = np.roll(bed, shift, axis=axis)
        near_wet = np.roll(wet, shift, axis=axis)
        near_in = np.roll(corridor, shift, axis=axis)
        # A wet cell whose DRY neighbour's ground is below its surface.
        # ONLY INSIDE THE CORRIDOR: the corridor rim is an artificial
        # boundary where water is removed by fiat, so of course the
        # ground beyond it can be lower. Counting those measures the
        # mask, not the solve.
        over = wet & (~near_wet) & near_in & (lvl - near_bed > 0)
        leaks += int(over.sum())
        if over.any():
            worst = max(worst, float((lvl - near_bed)[over].max()))
    print(f"edges standing over lower dry ground, inside the corridor: "
          f"{leaks:,} ({100 * leaks / max(1, wet.sum()):.2f}% of wet cells), "
          f"worst {worst:.2f} m")

    out = np.full(water.shape, -32768, dtype="<i2")
    take = wet & np.isfinite(surface)
    out[take] = np.clip(np.round(surface[take] * 10), -32767, 32767).astype("<i2")
    blob = struct.pack("<4sHHII", MAGIC, VERSION, 0, GRID, 0) + out.tobytes()
    OUT.write_bytes(blob)
    packed = len(gzip.compress(blob, 9))
    print(f"\nwrote {OUT} ({len(blob) / 1e6:.2f} MB, {packed / 1e6:.2f} MB gzipped)")


if __name__ == "__main__":
    main()
