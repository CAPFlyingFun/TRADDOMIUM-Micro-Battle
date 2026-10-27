/**
 * The cloth sim's garment additions (Stage 2b): a topology may give each edge its own REST LENGTH (the flat pattern's)
 * in place of the one measured from `rest`; may rest every bend pair FLAT (`bendFlat`), its two triangles unfolded into
 * one plane at their rest lengths; and may mark particles (`capsuleMask`) that `step` pushes out of CAPSULES -- her
 * upper arms and forearms -- given at the start and the end of the frame and interpolated per substep, counted in
 * `ClothStepStats.capsuleContacts`. All on small synthetic sheets with her skin far away (no skin contact anywhere).
 */
import { describe, expect, it } from 'vitest';
import { ClothSim, type Capsules, type ClothSettings, type ClothTopology } from '../src/sarahlab/clothSim';
import { createContacts, type SkinContacts } from '../src/sarahlab/clothTypes';

const FRAME = 1 / 60;

/** An nx × ny sheet `spacing` 1 in the y = 0 plane (i along x, j along z), two triangles a cell. */
function sheet(nx: number, ny: number, extra?: Partial<ClothTopology>): ClothTopology {
  const count = nx * ny, rest = new Float32Array(count * 3), pin = new Float32Array(count);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) rest.set([i, 0, j], (j * nx + i) * 3);
  const triangles = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let t = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      triangles.set([a, c, b, b, c, d], t);
      t += 6;
    }
  }
  return { count, triangles, rest, pin, ...extra };
}

/** Skin far off to the side (a plane at x = -10,000 facing +x): every particle is 10,000 clear of it. */
function noSkin(count: number): SkinContacts {
  const c = createContacts(count);
  for (let k = 0; k < count; k++) { c.point.set([-1e4, 0, 0], k * 3); c.carried.set([-1e4, 0, 0], k * 3); c.normal.set([1, 0, 0], k * 3); c.standOff[k] = 0.1; }
  return c;
}

/** Still, weightless, exact rest lengths: a sheet left alone does not move, so anything that moves it is the feature. */
const STILL: Partial<ClothSettings> = { gravity: [0, 0, 0], restScale: 1, damping: 0, friction: 0, frictionAcross: 0 };

function capsules(list: { a: [number, number, number]; b: [number, number, number]; r: number }[]): Capsules {
  return {
    count: list.length,
    a: Float32Array.from(list.flatMap((c) => c.a)),
    b: Float32Array.from(list.flatMap((c) => c.b)),
    radius: Float32Array.from(list.map((c) => c.r)),
  };
}

/** Distance from p to segment a -> b. */
function toSegment(p: ArrayLike<number>, o: number, a: readonly number[], b: readonly number[]): number {
  const sx = b[0] - a[0], sy = b[1] - a[1], sz = b[2] - a[2], px = p[o] - a[0], py = p[o + 1] - a[1], pz = p[o + 2] - a[2];
  const ss = sx * sx + sy * sy + sz * sz;
  const t = Math.min(1, Math.max(0, ss > 0 ? (px * sx + py * sy + pz * sz) / ss : 0));
  return Math.hypot(px - t * sx, py - t * sy, pz - t * sz);
}

const dist = (x: Float32Array, a: number, b: number) => Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]);

/** Every particle of a 10 × 10 sheet still where it was laid (float noise from the solve aside). */
function expectAtRest(x: Float32Array): void {
  const laid = sheet(10, 10).rest;
  let worst = 0;
  for (let i = 0; i < laid.length; i++) worst = Math.max(worst, Math.abs(x[i] - laid[i]));
  expect(worst).toBeLessThan(1e-6);
}

function allFinite(a: Float32Array): boolean { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }

// A capsule under the middle of a 10 × 10 sheet: its axis runs along x at z = 4.5, half a unit below the sheet, so rows
// j = 4 and 5 (0.5 off the axis in z, 0.5 in y: 0.707 from it) lie inside a radius of 1 and nothing else does.
const AXIS_A: [number, number, number] = [-2, -0.5, 4.5], AXIS_B: [number, number, number] = [11, -0.5, 4.5];
const UNDER = capsules([{ a: AXIS_A, b: AXIS_B, r: 1 }]);
const insideAtStart = (i: number, nx: number) => { const j = Math.floor(i / nx); return j === 4 || j === 5; };

describe('ClothSim capsules', () => {
  it('pushes every masked particle inside a capsule out onto its surface, radially, and counts them', () => {
    const top = sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) });
    const sim = new ClothSim(top, { ...STILL, substeps: 4 }), skin = noSkin(top.count);
    const before = Float32Array.from(sim.positions);
    const stats = sim.step(FRAME, skin, skin, { before: UNDER, after: UNDER });
    // the 20 particles of rows 4 and 5 were inside; the count is the LAST substep's, by when the first push has carried
    // them clear (their velocity is what the push made of them), so it is at most those 20
    expect(stats.capsuleContacts).toBeLessThanOrEqual(20);
    expect(stats.contacts).toBe(0);
    // the capsule is the last thing a substep does to a position: nobody masked is left inside it
    for (let i = 0; i < top.count; i++) expect(toSegment(sim.positions, i * 3, AXIS_A, AXIS_B)).toBeGreaterThanOrEqual(1 - 1e-4);
    // out of it, upward (the axis is under the sheet): rows 4 and 5 have both risen
    for (const p of [4 * 10 + 5, 5 * 10 + 5]) expect(sim.positions[p * 3 + 1] - before[p * 3 + 1]).toBeGreaterThan(0.1);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('a single substep pushes exactly the particles that were inside, onto the radius', () => {
    const top = sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) });
    // no constraint can move anyone: stretch and bend at their rest, so the only motion is the capsule's
    const sim = new ClothSim(top, { ...STILL, substeps: 1 }), skin = noSkin(top.count);
    const stats = sim.step(FRAME, skin, skin, { before: UNDER, after: UNDER });
    expect(stats.capsuleContacts).toBe(20);
    // radially: row 4's particle at (5, 0, 4) was (0, +0.5, -0.5) off the axis, so it ends 1 out along that direction
    const p = 4 * 10 + 5;
    expect(sim.positions[p * 3]).toBeCloseTo(5, 6);
    expect(sim.positions[p * 3 + 1]).toBeCloseTo(-0.5 + Math.SQRT1_2, 5);
    expect(sim.positions[p * 3 + 2]).toBeCloseTo(4.5 - Math.SQRT1_2, 5);
    for (let i = 0; i < top.count; i++) {
      const d = toSegment(sim.positions, i * 3, AXIS_A, AXIS_B);
      if (insideAtStart(i, 10)) expect(d).toBeCloseTo(1, 5);
      else for (let k = 0; k < 3; k++) expect(sim.positions[i * 3 + k]).toBeCloseTo(top.rest[i * 3 + k], 6);
    }
  });

  it('leaves an unmasked particle alone, and a sheet with no mask (or no capsules) is never pushed', () => {
    // half masked: the columns i < 5
    const mask = new Uint8Array(100);
    for (let i = 0; i < 100; i++) mask[i] = i % 10 < 5 ? 1 : 0;
    const half = new ClothSim(sheet(10, 10, { capsuleMask: mask }), { ...STILL, substeps: 1 }), skin = noSkin(100);
    const s1 = half.step(FRAME, skin, skin, { before: UNDER, after: UNDER });
    expect(s1.capsuleContacts).toBe(10); // rows 4 and 5, columns 0..4
    for (let i = 0; i < 100; i++) {
      if (!insideAtStart(i, 10)) continue;
      const d = toSegment(half.positions, i * 3, AXIS_A, AXIS_B);
      if (mask[i]) expect(d).toBeCloseTo(1, 5);
      else expect(d).toBeLessThan(0.75); // still where it was: 0.707 off the axis, inside
    }

    // no mask at all: capsules handed to step do nothing, and the stat says so
    const none = new ClothSim(sheet(10, 10), { ...STILL, substeps: 4 });
    const s2 = none.step(FRAME, skin, skin, { before: UNDER, after: UNDER });
    expect(s2.capsuleContacts).toBe(0);
    expectAtRest(none.positions);

    // a mask shorter than count is ignored, not read past its end
    const short = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(50).fill(1) }), { ...STILL, substeps: 1 });
    expect(short.step(FRAME, skin, skin, { before: UNDER, after: UNDER }).capsuleContacts).toBe(0);

    // masked, but no capsules this step (or an empty set): nothing
    const masked = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 4 });
    expect(masked.step(FRAME, skin, skin).capsuleContacts).toBe(0);
    const empty = capsules([]);
    expect(masked.step(FRAME, skin, skin, { before: empty, after: empty }).capsuleContacts).toBe(0);
    expectAtRest(masked.positions);
  });

  it('never moves a fully pinned particle out of a capsule', () => {
    const top = sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) });
    const pin = new Float32Array(100);
    const held = 4 * 10 + 3;
    pin[held] = 1;
    const sim = new ClothSim({ ...top, pin }, { ...STILL, substeps: 2 }), skin = noSkin(100);
    skin.pinTarget.set(top.rest);
    const stats = sim.step(FRAME, skin, skin, { before: UNDER, after: UNDER });
    for (let k = 0; k < 3; k++) expect(sim.positions[held * 3 + k]).toBeCloseTo(top.rest[held * 3 + k], 6);
    expect(stats.capsuleContacts).toBeLessThan(20);
  });

  it('a capsule moving between the frame\'s two ends is interpolated per substep: one that sweeps through the sheet pushes it on the way', () => {
    // radius 1 along x at z = 4.5, from 3 below the sheet to 3 above it in one frame: at the start and at the end it
    // touches nothing, so only the substeps in between can have moved anyone
    const below = capsules([{ a: [-2, -3, 4.5], b: [11, -3, 4.5], r: 1 }]);
    const above = capsules([{ a: [-2, 3, 4.5], b: [11, 3, 4.5], r: 1 }]);
    const mk = () => new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 8 });
    const skin = noSkin(100);

    const swept = mk(), stats = swept.step(FRAME, skin, skin, { before: below, after: above });
    let moved = 0;
    for (let i = 0; i < 100; i++) if (Math.abs(swept.positions[i * 3 + 1]) > 0.1) moved++;
    expect(moved).toBeGreaterThan(5);
    // the last substep's capsule is `after` exactly, 3 above the sheet: nobody is still being pushed by it
    expect(stats.capsuleContacts).toBe(0);
    expect(allFinite(swept.positions)).toBe(true);

    // the same capsule standing still at either end touches nothing
    for (const still of [below, above]) {
      const sim = mk();
      expect(sim.step(FRAME, skin, skin, { before: still, after: still }).capsuleContacts).toBe(0);
      expectAtRest(sim.positions);
    }

    // and the radius is interpolated too: growing from 0.1 (touching nothing) to 1 by the frame's end, the last substep
    // sees the full radius, so the rows inside it end on its surface
    const thin = capsules([{ a: AXIS_A, b: AXIS_B, r: 0.1 }]);
    const grow = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 1 });
    expect(grow.step(FRAME, skin, skin, { before: thin, after: UNDER }).capsuleContacts).toBe(20);
    for (let i = 0; i < 100; i++) if (insideAtStart(i, 10)) expect(toSegment(grow.positions, i * 3, AXIS_A, AXIS_B)).toBeCloseTo(1, 5);
    // shrinking from 1 to 0.1 over four substeps: the first sees a radius of 0.775 (> 0.707, the rows inside) and pushes
    // them out to it; every later one is smaller and touches nobody, so the last counts none -- yet the rows moved
    // (damped hard, so the push leaves no velocity to carry them further)
    const shrink = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 4, damping: 1e6, stretchCompliance: 1e9, bendCompliance: 1e9, maxStretch: 1e3 });
    expect(shrink.step(FRAME, skin, skin, { before: UNDER, after: thin }).capsuleContacts).toBe(0);
    for (let i = 0; i < 100; i++) if (insideAtStart(i, 10)) expect(toSegment(shrink.positions, i * 3, AXIS_A, AXIS_B)).toBeCloseTo(0.775, 2);
    // a single substep sees only the frame's end, 0.1: nobody moves
    const once = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 1 });
    expect(once.step(FRAME, skin, skin, { before: UNDER, after: thin }).capsuleContacts).toBe(0);
    expectAtRest(once.positions);
  });

  it('pushes out of the nearest point of the SEGMENT: past an end it is the end cap\'s sphere', () => {
    // a short capsule ending under column 2: column 4 lies past its end
    const a: [number, number, number] = [-5, -0.5, 4.5], b: [number, number, number] = [2, -0.5, 4.5];
    const sim = new ClothSim(sheet(10, 10, { capsuleMask: new Uint8Array(100).fill(1) }), { ...STILL, substeps: 1 }), skin = noSkin(100);
    sim.step(FRAME, skin, skin, { before: capsules([{ a, b, r: 1 }]), after: capsules([{ a, b, r: 1 }]) });
    for (let i = 0; i < 100; i++) {
      const col = i % 10, d0 = toSegment(sheet(10, 10).rest, i * 3, a, b);
      if (d0 < 1) expect(toSegment(sim.positions, i * 3, a, b)).toBeCloseTo(1, 5);
      if (col >= 3) for (let k = 0; k < 3; k++) expect(sim.positions[i * 3 + k]).toBeCloseTo(sheet(10, 10).rest[i * 3 + k], 6);
    }
    // column 2's particles of rows 4 and 5 sit at the end itself (t clamps to 1): pushed straight off the cap's centre
    const p = 4 * 10 + 2;
    expect(toSegment(sim.positions, p * 3, a, b)).toBeCloseTo(1, 5);
    expect(sim.positions[p * 3]).toBeCloseTo(2, 5); // no sideways push: it was square over the end
  });
});

describe('ClothSim rest lengths from the pattern (restLength) and flat bends (bendFlat)', () => {
  it('an edge rests at the length its topology gives, and one it does not answer for is measured from rest', () => {
    // one triangle, laid with sides 1, 1, √2; the pattern says (0,1) is 0.5 long and is silent on the rest
    const top: ClothTopology = {
      count: 3, triangles: Uint32Array.from([0, 1, 2]), rest: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), pin: new Float32Array(3),
      restLength: (a, b) => (a === 0 && b === 1 ? 0.5 : undefined),
    };
    const sim = new ClothSim(top, { ...STILL, stretchCompliance: 0, substeps: 8 }), skin = noSkin(3);
    for (let f = 0; f < 120; f++) sim.step(FRAME, skin, skin);
    expect(dist(sim.positions, 0, 1)).toBeCloseTo(0.5, 3);
    expect(dist(sim.positions, 0, 2)).toBeCloseTo(1, 3);
    expect(dist(sim.positions, 1, 2)).toBeCloseTo(Math.SQRT2, 3);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('asks restLength for each edge by its (lo, hi) pair, and ignores a length that is not a positive finite number', () => {
    const asked: string[] = [];
    const bad = [0, -1, Number.NaN, Infinity];
    let k = 0;
    const top: ClothTopology = {
      ...sheet(2, 3),
      restLength: (a, b) => { asked.push(`${a}-${b}`); return bad[k++ % bad.length]; },
    };
    const sim = new ClothSim(top, { ...STILL, stretchCompliance: 0 }), skin = noSkin(top.count);
    expect(asked.length).toBe(sim.edges.length / 2);
    for (let e = 0; e < sim.edges.length; e += 2) expect(asked).toContain(`${sim.edges[e]}-${sim.edges[e + 1]}`);
    for (const p of asked) { const [a, b] = p.split('-').map(Number); expect(a).toBeLessThan(b); }
    // every answer was refused, so the laid sheet is its own rest and nothing moves
    for (let f = 0; f < 10; f++) sim.step(FRAME, skin, skin);
    for (let i = 0; i < top.rest.length; i++) expect(sim.positions[i]).toBeCloseTo(top.rest[i], 6);
  });

  it('the strain limit holds to the given length too', () => {
    // the pattern says every edge is half what it is laid at; with stretch made powerless only the strain limit acts,
    // and it pulls each edge to at most maxStretch × its pattern length
    const top = sheet(4, 4);
    const rest = top.rest;
    const sim = new ClothSim({ ...top, restLength: (a, b) => 0.5 * dist(rest, a, b) }, { ...STILL, stretchCompliance: 1e9, bendCompliance: 1e9, maxStretch: 1.1, substeps: 4 });
    const skin = noSkin(top.count);
    for (let f = 0; f < 60; f++) sim.step(FRAME, skin, skin);
    let worst = 0;
    for (let e = 0; e < sim.edges.length; e += 2) {
      const a = sim.edges[e], b = sim.edges[e + 1];
      worst = Math.max(worst, dist(sim.positions, a, b) / (0.5 * dist(rest, a, b)));
    }
    expect(worst).toBeLessThan(1.1 + 0.02);
  });

  // Two triangles folded 90° across their shared edge (0)-(1) along x: c = 2 stands up off it, d = 3 lies out along z.
  // Folded, c and d are √2 apart; unfolded flat they are 2.
  const fold = (extra?: Partial<ClothTopology>): ClothTopology => ({
    count: 4,
    triangles: Uint32Array.from([0, 1, 2, 1, 0, 3]),
    rest: Float32Array.from([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, 0, 1]),
    pin: new Float32Array(4),
    ...extra,
  });

  it('bendFlat rests a bend pair at its triangles\' distance laid flat, so a folded pair unfolds; without it the fold is its rest', () => {
    const settings = { ...STILL, stretchCompliance: 0, bendCompliance: 0, substeps: 8 };
    const skin = noSkin(4);
    const flat = new ClothSim(fold({ bendFlat: true }), settings);
    expect(flat.bendPairs.length).toBe(2);
    expect([flat.bendPairs[0], flat.bendPairs[1]]).toEqual([2, 3]);
    for (let f = 0; f < 240; f++) flat.step(FRAME, skin, skin);
    expect(dist(flat.positions, 2, 3)).toBeCloseTo(2, 2);
    // the triangles kept their sides while unfolding
    expect(dist(flat.positions, 0, 1)).toBeCloseTo(1, 2);
    expect(dist(flat.positions, 0, 2)).toBeCloseTo(Math.hypot(0.5, 1), 2);
    expect(dist(flat.positions, 1, 3)).toBeCloseTo(Math.hypot(0.5, 1), 2);

    for (const extra of [{}, { bendFlat: false }]) {
      const folded = new ClothSim(fold(extra), settings);
      for (let f = 0; f < 60; f++) folded.step(FRAME, skin, skin);
      expect(dist(folded.positions, 2, 3)).toBeCloseTo(Math.SQRT2, 5);
    }
  });

  it('bendFlat lays the triangles flat at the GIVEN edge lengths when restLength gives them', () => {
    // the pattern is the laid fold at twice the size: flat, c and d are 4 apart, and every side is twice as long
    const laid = fold().rest;
    const sim = new ClothSim(fold({ bendFlat: true, restLength: (a, b) => 2 * dist(laid, a, b) }), { ...STILL, stretchCompliance: 0, bendCompliance: 0, substeps: 8 });
    const skin = noSkin(4);
    for (let f = 0; f < 600; f++) sim.step(FRAME, skin, skin);
    expect(dist(sim.positions, 0, 1)).toBeCloseTo(2, 2);
    expect(dist(sim.positions, 2, 3)).toBeCloseTo(4, 2);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('bendFlat leaves an already flat sheet at rest, and a rolled sheet unrolls toward its flat width', () => {
    const skin = noSkin(60);
    const flatSheet = new ClothSim(sheet(6, 10, { bendFlat: true }), { ...STILL, substeps: 4 });
    for (let f = 0; f < 30; f++) flatSheet.step(FRAME, skin, skin);
    const laid = sheet(6, 10).rest;
    for (let i = 0; i < laid.length; i++) expect(flatSheet.positions[i]).toBeCloseTo(laid[i], 4);

    // the same 6 × 10 sheet rolled a quarter turn round the z axis: its two long edges 5 apart flat, ~4.5 rolled
    const nx = 6, ny = 10, R = 5 / (Math.PI / 2), rolled = sheet(nx, ny);
    const rest = new Float32Array(rolled.rest.length);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const th = i / R;
      rest.set([R * Math.sin(th), R * (1 - Math.cos(th)), j], (j * nx + i) * 3);
    }
    const width = (x: Float32Array) => { let s = 0; for (let j = 0; j < ny; j++) s += dist(x, j * nx, j * nx + nx - 1); return s / ny; };
    const start = width(rest);
    // (the default bend compliance and some damping: an undamped solve at compliance 0 drifts on float rounding alone)
    const settings = { ...STILL, damping: 1.5, substeps: 8 };
    const flatTo = new ClothSim({ ...rolled, rest, bendFlat: true }, settings);
    const keep = new ClothSim({ ...rolled, rest }, settings);
    for (let f = 0; f < 180; f++) { flatTo.step(FRAME, skin, skin); keep.step(FRAME, skin, skin); }
    expect(width(keep.positions)).toBeCloseTo(start, 3);
    expect(width(flatTo.positions)).toBeGreaterThan(start + 0.25);
    expect(width(flatTo.positions)).toBeLessThan(5 + 0.05);
  });
});
