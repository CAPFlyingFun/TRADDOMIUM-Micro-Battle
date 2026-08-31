/**
 * THE FOG IS THE FEATURE, so these tests are mostly about its EDGE.
 *
 * Two things can go wrong with a discovery mask and neither of them
 * looks like a crash. The reveal can quietly become a square — which is
 * what a bounding box gives you for free, and what makes the fog peel
 * back in diamonds — so the boundary is asserted in real world
 * distances, on the axis and on the diagonal, at 0.99 and 1.01 of the
 * radius. And the encoding can quietly stop being a round trip, which
 * shows up a week later as an island the player has already walked
 * turning black again.
 *
 * `decodeDiscovery` reads text somebody could have edited, so the tests
 * have to be able to WRITE text somebody could have edited: `packRuns`
 * below is a deliberately independent encoder, small enough to read,
 * used to hand the decoder runs that overrun the grid and runs that
 * stop short of it. It doubles as a cross-check that the module's own
 * format is what it says it is.
 */
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_CELLS, REVEAL_RADIUS, decodeDiscovery, emptyDiscovery,
  encodeDiscovery, fractionSeen, reveal, seen, type Discovery,
} from '../src/game/discovery';
import { ISLAND_SPAN } from '../src/world/heightfield';
import { mapToWorld } from '../src/ui/islandMap';

const TOTAL = DISCOVERY_CELLS * DISCOVERY_CELLS;

/** One cell, in world units. 5,600,000 / 384 — about 146 metres. */
const CELL = ISLAND_SPAN / DISCOVERY_CELLS;

/**
 * How far a point can be from the centre of its own cell: half a cell
 * diagonal. Cells are judged by their centres, so this is exactly the
 * width of the band where the fog's edge is undecidable — inside
 * REVEAL_RADIUS minus this, certainly seen; outside plus this,
 * certainly not.
 */
const SLACK = CELL * Math.SQRT1_2;

function walked(from: number, to: number, wz: number, steps: number): Discovery {
  const known = emptyDiscovery();
  for (let i = 0; i <= steps; i++) {
    reveal(known, from + ((to - from) * i) / steps, wz);
  }
  return known;
}

function identical(a: Discovery, b: Discovery): boolean {
  if (a.size !== b.size || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    if (a.cells[i] !== b.cells[i]) return false;
  }
  return true;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The smallest independent base64url encoder that can forge a body. */
function b64url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

/** A mask document built from run lengths, honest or otherwise. */
function packRuns(...runs: readonly number[]): string {
  const bytes: number[] = [];
  for (const run of runs) {
    let left = run;
    while (left >= 0x80) {
      bytes.push((left & 0x7f) | 0x80);
      left >>>= 7;
    }
    bytes.push(left);
  }
  return `d1:${DISCOVERY_CELLS}:${b64url(bytes)}`;
}

describe('a fresh mask', () => {
  it('knows nothing', () => {
    const known = emptyDiscovery();
    expect(fractionSeen(known)).toBe(0);
    expect(known.cells.length).toBe(TOTAL);
    expect(known.size).toBe(DISCOVERY_CELLS);
    expect(seen(known, 0, 0)).toBe(false);
    expect(seen(known, -412_345, 238_901)).toBe(false);
  });
});

describe('standing somewhere reveals it', () => {
  it('makes the point she is standing on known', () => {
    const known = emptyDiscovery();
    expect(seen(known, -412_345, 238_901)).toBe(false);
    expect(reveal(known, -412_345, 238_901)).toBeGreaterThan(0);
    expect(seen(known, -412_345, 238_901)).toBe(true);
  });

  it('reveals about the area of the disc and no more', () => {
    // A circle of 2 km on a 146 m lattice is π(R/CELL)² ≈ 591 cells. A
    // square would be (2R/CELL)² ≈ 752 — 27% more, and the difference
    // is the whole point.
    const known = emptyDiscovery();
    const fresh = reveal(known, 0, 0);
    const disc = Math.PI * (REVEAL_RADIUS / CELL) ** 2;
    const box = ((2 * REVEAL_RADIUS) / CELL) ** 2;
    console.log(`reveal(): ${fresh} cells; circle ${disc.toFixed(0)},`
      + ` square ${box.toFixed(0)}`);
    expect(fresh).toBeGreaterThan(disc * 0.94);
    expect(fresh).toBeLessThan(disc * 1.06);
  });
});

describe('the edge of the reveal is a circle in world units', () => {
  /**
   * Placed three tenths of a cell into cell 192 on both axes, on
   * purpose. A cell is 146 m and the gap between 0.99 and 1.01 of a 2
   * km radius is only 40 m, so on most alignments both probes land in
   * the SAME cell and the assertion proves nothing. At this offset a
   * cell boundary falls between them, on the axis and on the diagonal
   * alike, and the two probes are genuinely on opposite sides of the
   * edge.
   */
  const at = mapToWorld(192.3, 192.3, DISCOVERY_CELLS);
  const known = emptyDiscovery();
  reveal(known, at.wx, at.wz);

  it('sees a point just inside the radius, due east', () => {
    const inside = { wx: at.wx + REVEAL_RADIUS * 0.99, wz: at.wz };
    expect(Math.hypot(inside.wx - at.wx, inside.wz - at.wz)).toBeCloseTo(198_000, 6);
    expect(seen(known, inside.wx, inside.wz)).toBe(true);
  });

  it('does not see a point just outside the radius, due east', () => {
    const outside = { wx: at.wx + REVEAL_RADIUS * 1.01, wz: at.wz };
    expect(Math.hypot(outside.wx - at.wx, outside.wz - at.wz)).toBeCloseTo(202_000, 6);
    expect(seen(known, outside.wx, outside.wz)).toBe(false);
  });

  it('holds the same boundary on the diagonal — a circle, not a square', () => {
    // The diagonal is where a square gives itself away: at 0.99 of the
    // radius it agrees with a circle, and at 1.01 it does not.
    const step = (REVEAL_RADIUS * Math.SQRT1_2);
    const inside = { wx: at.wx + step * 0.99, wz: at.wz + step * 0.99 };
    const outside = { wx: at.wx + step * 1.01, wz: at.wz + step * 1.01 };
    expect(Math.hypot(inside.wx - at.wx, inside.wz - at.wz)).toBeCloseTo(198_000, 6);
    expect(Math.hypot(outside.wx - at.wx, outside.wz - at.wz)).toBeCloseTo(202_000, 6);
    expect(seen(known, inside.wx, inside.wz)).toBe(true);
    expect(seen(known, outside.wx, outside.wz)).toBe(false);
  });

  it('never reveals the corner a square mask would', () => {
    // Nine tenths of the radius on BOTH axes: comfortably inside a
    // square of half-width R, and 1.27 R from the centre.
    const corner = {
      wx: at.wx + REVEAL_RADIUS * 0.9,
      wz: at.wz + REVEAL_RADIUS * 0.9,
    };
    expect(Math.hypot(corner.wx - at.wx, corner.wz - at.wz))
      .toBeGreaterThan(REVEAL_RADIUS * 1.27);
    expect(seen(known, corner.wx, corner.wz)).toBe(false);
  });

  it('is a circle in every direction, to within one cell', () => {
    // The general statement, without leaning on any alignment: inside
    // the radius less half a cell diagonal is certainly known, outside
    // the radius plus it is certainly not.
    const centre = { wx: -1_234_567, wz: 890_123 };
    const disc = emptyDiscovery();
    reveal(disc, centre.wx, centre.wz);
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const near = REVEAL_RADIUS - SLACK - 1;
      const far = REVEAL_RADIUS + SLACK + 1;
      expect(seen(disc, centre.wx + dx * near, centre.wz + dz * near), `in ${i}`).toBe(true);
      expect(seen(disc, centre.wx + dx * far, centre.wz + dz * far), `out ${i}`).toBe(false);
    }
  });
});

describe('discovery is cumulative', () => {
  it('reveals nothing new the second time in the same place', () => {
    const known = emptyDiscovery();
    const first = reveal(known, 120_000, -75_000);
    expect(first).toBeGreaterThan(0);
    expect(reveal(known, 120_000, -75_000)).toBe(0);
    expect(fractionSeen(known)).toBeCloseTo(first / TOTAL, 12);
  });

  it('opens a corridor along a walk and keeps every step of it', () => {
    const known = walked(-1_000_000, 1_000_000, 0, 40);
    // Every point she passed through is still known at the end.
    for (let wx = -1_000_000; wx <= 1_000_000; wx += 50_000) {
      expect(seen(known, wx, 0), `${wx}`).toBe(true);
    }
    // Including the very first, which was revealed forty discs ago.
    expect(seen(known, -1_000_000, 0)).toBe(true);
    // The corridor has WALLS: 4 km off the line is well past the reveal.
    expect(seen(known, 0, -400_000)).toBe(false);
    expect(seen(known, 0, 400_000)).toBe(false);
    // And it is wider than one disc.
    const single = emptyDiscovery();
    reveal(single, 0, 0);
    expect(fractionSeen(known)).toBeGreaterThan(fractionSeen(single) * 5);
  });

  it('only ever grows', () => {
    const known = emptyDiscovery();
    let before = 0;
    for (let i = 0; i <= 20; i++) {
      reveal(known, -500_000 + i * 50_000, i * 20_000);
      const now = fractionSeen(known);
      expect(now).toBeGreaterThanOrEqual(before);
      before = now;
    }
    expect(before).toBeGreaterThan(0);
  });
});

describe('the world is bigger than the mask', () => {
  it('says no, rather than throwing, outside the island', () => {
    const known = emptyDiscovery();
    reveal(known, 0, 0);
    expect(seen(known, 3_000_000, 0)).toBe(false);
    expect(seen(known, -3_000_000, 0)).toBe(false);
    expect(seen(known, 0, 9_999_999)).toBe(false);
    expect(seen(known, -2_800_001, -2_800_001)).toBe(false);
    expect(seen(known, Number.NaN, 0)).toBe(false);
    expect(seen(known, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(seen(known, Number.NEGATIVE_INFINITY, Number.NaN)).toBe(false);
  });

  it('reveals nothing for a disc that misses the grid entirely', () => {
    const known = emptyDiscovery();
    expect(reveal(known, 3_500_000, 0)).toBe(0);
    expect(reveal(known, 0, -3_500_000)).toBe(0);
    expect(reveal(known, Number.NaN, 0)).toBe(0);
    expect(fractionSeen(known)).toBe(0);
  });
});

describe('the mask survives the save', () => {
  it('round-trips an unexplored island', () => {
    const known = emptyDiscovery();
    const text = encodeDiscovery(known);
    console.log(`encoded empty: ${text.length} chars — ${text}`);
    const back = decodeDiscovery(text)!;
    expect(back).not.toBeNull();
    expect(identical(back, known)).toBe(true);
    expect(fractionSeen(back)).toBe(0);
  });

  it('round-trips one disc', () => {
    const known = emptyDiscovery();
    reveal(known, -412_345, 238_901);
    const text = encodeDiscovery(known);
    console.log(`encoded one disc: ${text.length} chars`);
    const back = decodeDiscovery(text)!;
    expect(back).not.toBeNull();
    expect(identical(back, known)).toBe(true);
    expect(seen(back, -412_345, 238_901)).toBe(true);
  });

  it('round-trips a long walk', () => {
    const known = walked(-2_000_000, 2_000_000, -300_000, 120);
    const text = encodeDiscovery(known);
    const percent = (fractionSeen(known) * 100).toFixed(2);
    console.log(`encoded long walk: ${text.length} chars, ${percent}% seen`);
    const back = decodeDiscovery(text)!;
    expect(back).not.toBeNull();
    expect(identical(back, known)).toBe(true);
    expect(fractionSeen(back)).toBeCloseTo(fractionSeen(known), 12);
  });

  it('round-trips a fully explored island', () => {
    const known = emptyDiscovery();
    known.cells.fill(1);
    const text = encodeDiscovery(known);
    console.log(`encoded fully seen: ${text.length} chars — ${text}`);
    const back = decodeDiscovery(text)!;
    expect(back).not.toBeNull();
    expect(identical(back, known)).toBe(true);
    expect(fractionSeen(back)).toBe(1);
  });

  it('falls back to raw when runs would cost more, and still round-trips', () => {
    // The one shape run-length coding loses on: every cell different
    // from its neighbour, starting seen, so the runs cost one byte per
    // cell PLUS the empty leading unseen run. Unreachable by playing —
    // written straight into the cells because the fallback still has to
    // work the day something else produces it.
    const known = emptyDiscovery();
    for (let i = 0; i < known.cells.length; i++) known.cells[i] = i % 2 === 0 ? 1 : 0;
    const text = encodeDiscovery(known);
    console.log(`encoded worst case (raw fallback): ${text.length} chars`);
    expect(text.startsWith(`d1r:${DISCOVERY_CELLS}:`)).toBe(true);
    const back = decodeDiscovery(text)!;
    expect(back).not.toBeNull();
    expect(identical(back, known)).toBe(true);
    expect(fractionSeen(back)).toBeCloseTo(0.5, 12);
  });

  it('costs almost nothing for a realistic mask', () => {
    // The number that decides whether five save slots fit on a phone.
    const known = emptyDiscovery();
    reveal(known, -412_345, 238_901);
    const text = encodeDiscovery(known);
    console.log(`realistic single-disc mask: ${text.length} chars`);
    expect(text.length).toBeLessThan(2000);
  });

  it('writes the format it says it writes', () => {
    // Cross-checked against an encoder written from the doc comment
    // rather than from the module: one unseen run covering the grid.
    expect(encodeDiscovery(emptyDiscovery())).toBe(packRuns(TOTAL));
    const decoded = decodeDiscovery(packRuns(TOTAL))!;
    expect(decoded).not.toBeNull();
    expect(fractionSeen(decoded)).toBe(0);
  });
});

describe('a saved mask is untrusted text', () => {
  it('refuses nothing at all', () => {
    expect(decodeDiscovery(undefined)).toBeNull();
    expect(decodeDiscovery('')).toBeNull();
  });

  it('refuses garbage', () => {
    expect(decodeDiscovery('garbage')).toBeNull();
    expect(decodeDiscovery('::::')).toBeNull();
    expect(decodeDiscovery('d1:384')).toBeNull();
    expect(decodeDiscovery('d1:384:!!!!')).toBeNull();
    expect(decodeDiscovery('d1:384:AAAA:AAAA')).toBeNull();
    expect(decodeDiscovery('d2:384:AAAA')).toBeNull();
    expect(decodeDiscovery('{"cells":[0,0,0]}')).toBeNull();
  });

  it('refuses a mask from a different grid', () => {
    const known = emptyDiscovery();
    reveal(known, 0, 0);
    const text = encodeDiscovery(known);
    expect(decodeDiscovery(text)).not.toBeNull();
    expect(decodeDiscovery(text.replace('d1:384:', 'd1:256:'))).toBeNull();
    expect(decodeDiscovery(text.replace('d1:384:', 'd1:768:'))).toBeNull();
    expect(decodeDiscovery(text.replace('d1:384:', 'd1::'))).toBeNull();
  });

  it('refuses a truncated body', () => {
    const known = emptyDiscovery();
    reveal(known, 0, 0);
    const text = encodeDiscovery(known);
    for (const cut of [1, 2, 3, 4, 8, 20]) {
      expect(decodeDiscovery(text.slice(0, text.length - cut)), `cut ${cut}`).toBeNull();
    }
    // Runs that simply stop short of the grid are the same failure
    // wearing a valid base64 coat, and are refused rather than read as
    // a half-explored island.
    expect(decodeDiscovery(packRuns(10))).toBeNull();
    expect(decodeDiscovery(packRuns(TOTAL - 1))).toBeNull();
  });

  it('refuses runs that overrun the grid', () => {
    expect(decodeDiscovery(packRuns(TOTAL + 1))).toBeNull();
    expect(decodeDiscovery(packRuns(TOTAL, 1))).toBeNull();
    expect(decodeDiscovery(packRuns(0, TOTAL, 1))).toBeNull();
    expect(decodeDiscovery(packRuns(10_000_000))).toBeNull();
    expect(decodeDiscovery(packRuns(1_000, 1_000_000_000))).toBeNull();
  });

  it('refuses a blob far too large to be a mask', () => {
    // Refused on length before anything is allocated to look at it.
    expect(decodeDiscovery(`d1:384:${'A'.repeat(400_000)}`)).toBeNull();
    expect(decodeDiscovery(`d1r:384:${'A'.repeat(1_000_000)}`)).toBeNull();
  });

  it('refuses a raw body of the wrong length', () => {
    expect(decodeDiscovery('d1r:384:AAAA')).toBeNull();
  });
});

describe('the revision number', () => {
  it('moves only when a cell actually flips', () => {
    const known = emptyDiscovery();
    expect(known.revision).toBe(0);

    expect(reveal(known, 0, 0)).toBeGreaterThan(0);
    expect(known.revision).toBe(1);

    // Standing still is not news.
    expect(reveal(known, 0, 0)).toBe(0);
    expect(known.revision).toBe(1);

    // Nor is a step so small it stays inside what is already known.
    expect(reveal(known, 10, 10)).toBe(0);
    expect(known.revision).toBe(1);

    // Nor is a disc that misses the island altogether.
    expect(reveal(known, 3_500_000, 0)).toBe(0);
    expect(known.revision).toBe(1);

    // Somewhere new is.
    expect(reveal(known, 400_000, 0)).toBeGreaterThan(0);
    expect(known.revision).toBe(2);
  });
});
