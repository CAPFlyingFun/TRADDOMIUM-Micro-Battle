/**
 * THE TEE AS TRUE CLOTH (Joshua, 2026-10-23: "I want to be able to see how much or little having a full soft body cloth
 * fabric would be"). On small sheets built here: a sheet hung from its top row falls, stays inside its strain limit and
 * never goes NaN; a sheet dropped on a skin plane settles on it at its stand-off and stays; skin that rises carries the
 * sheet lying on it; friction 1 holds a sheet on a 30° slope that friction 0 lets slide; and a 6,000-particle sheet --
 * the tee's size -- is timed, because the cost is the point of the experiment.
 */
import { describe, expect, it } from 'vitest';
import { ClothSim, CLOTH_DEFAULTS, type ClothTopology } from '../src/sarahlab/clothSim';
import { createContacts, type SkinContacts } from '../src/sarahlab/clothTypes';

const FRAME = 1 / 60;

/** An nx × ny sheet of particles `spacing` apart, two triangles a cell, placed by `place(i, j)` (i across, j down). */
function sheet(nx: number, ny: number, place: (i: number, j: number) => [number, number, number], pinned?: (i: number, j: number) => number): ClothTopology {
  const count = nx * ny;
  const rest = new Float32Array(count * 3);
  const pin = new Float32Array(count);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      rest.set(place(i, j), k * 3);
      pin[k] = pinned?.(i, j) ?? 0;
    }
  }
  const triangles = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let t = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      triangles.set([a, c, b, b, c, d], t);
      t += 6;
    }
  }
  return { count, triangles, rest, pin };
}

/** Skin that is one plane under every particle: through `point`, facing `normal`, `standOff` thick; pins held at `pins`. */
function planeContacts(count: number, point: [number, number, number], normal: [number, number, number], standOff: number, pins?: Float32Array): SkinContacts {
  const c = createContacts(count);
  const l = Math.hypot(...normal);
  for (let k = 0; k < count; k++) {
    c.point.set(point, k * 3);
    c.normal.set([normal[0] / l, normal[1] / l, normal[2] / l], k * 3);
    c.standOff[k] = standOff;
  }
  if (pins) c.pinTarget.set(pins);
  return c;
}

/** Every edge's length against its rest length: the worst ratio. */
function worstStretch(sim: ClothSim, rest: Float32Array): number {
  let worst = 0;
  const x = sim.positions;
  for (let e = 0; e < sim.edges.length; e += 2) {
    const a = sim.edges[e] * 3, b = sim.edges[e + 1] * 3;
    const now = Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]);
    const was = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
    worst = Math.max(worst, now / was);
  }
  return worst;
}

function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

/** Signed distance of every particle off the plane through `point` with unit `normal`: the least of them. */
function lowest(sim: ClothSim, point: [number, number, number], normal: [number, number, number]): number {
  let low = Infinity;
  const x = sim.positions;
  for (let i = 0; i < sim.count; i++) {
    const d = (x[i * 3] - point[0]) * normal[0] + (x[i * 3 + 1] - point[1]) * normal[1] + (x[i * 3 + 2] - point[2]) * normal[2];
    low = Math.min(low, d);
  }
  return low;
}

function centroid(sim: ClothSim): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < sim.count; i++) for (let k = 0; k < 3; k++) c[k] += sim.positions[i * 3 + k];
  return [c[0] / sim.count, c[1] / sim.count, c[2] / sim.count];
}

describe('the cloth sim', () => {
  it('builds each shared edge once and pairs the vertices facing across it', () => {
    const top = sheet(4, 3, (i, j) => [i, 0, j]);
    const sim = new ClothSim(top);
    // A 4 × 3 grid: 3·3 across, 4·2 down, 3·2 diagonals.
    expect(sim.edges.length / 2).toBe(9 + 8 + 6);
    // Every edge two triangles share has exactly one bend pair: all 23 less the 10 round the border.
    expect(sim.bendPairs.length / 2).toBe(23 - 2 * (3 + 2));
    const keys = new Set<string>();
    for (let e = 0; e < sim.edges.length; e += 2) keys.add(`${sim.edges[e]}-${sim.edges[e + 1]}`);
    expect(keys.size).toBe(sim.edges.length / 2);
  });

  it('a sheet pinned along its top row hangs under gravity, inside its strain limit, with nothing NaN', () => {
    const n = 20;
    // Laid out flat (y = 0), the pinned row at z = 0; it has to swing down to hang.
    const top = sheet(n, n, (i, j) => [i, 0, j], (_i, j) => (j === 0 ? 1 : 0));
    const sim = new ClothSim(top);
    // Skin far off to the side, facing away from the sheet: nothing touches it.
    const skin = planeContacts(top.count, [-1e4, 0, 0], [1, 0, 0], 0.5, top.rest);
    let worst = 0;
    for (let f = 0; f < 120; f++) {
      const stats = sim.step(FRAME, skin, skin);
      expect(stats.contacts).toBe(0);
      worst = Math.max(worst, worstStretch(sim, top.rest));
    }
    expect(allFinite(sim.positions)).toBe(true);
    expect(allFinite(sim.velocities)).toBe(true);
    let bottomY = 0;
    for (let i = 0; i < n; i++) bottomY += sim.positions[((n - 1) * n + i) * 3 + 1] / n;
    expect(bottomY).toBeLessThan(-10);
    // The pinned row never moved.
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) expect(sim.positions[i * 3 + k]).toBe(top.rest[i * 3 + k]);
    console.log(`[clothSim] hanging 20×20: bottom row at y ${bottomY.toFixed(2)}, worst edge ${worst.toFixed(4)} × rest`);
    expect(worst).toBeLessThanOrEqual(CLOTH_DEFAULTS.maxStretch + 0.01);
  });

  it('a sheet dropped on her skin settles at its stand-off and stays there', () => {
    const top = sheet(16, 16, (i, j) => [i, j, 5]);
    const sim = new ClothSim(top, { gravity: [0, 0, -981] });
    const skin = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    let stats = sim.step(FRAME, skin, skin);
    for (let f = 0; f < 90; f++) {
      stats = sim.step(FRAME, skin, skin);
      expect(lowest(sim, [0, 0, 0], [0, 0, 1])).toBeGreaterThanOrEqual(0.5 - 1e-3);
    }
    expect(stats.contacts).toBe(top.count);
    // A second later it is still lying there, not sunk and not bouncing.
    for (let f = 0; f < 60; f++) {
      sim.step(FRAME, skin, skin);
      expect(lowest(sim, [0, 0, 0], [0, 0, 1])).toBeGreaterThanOrEqual(0.5 - 1e-3);
    }
    let highest = -Infinity;
    for (let i = 0; i < top.count; i++) highest = Math.max(highest, sim.positions[i * 3 + 2]);
    expect(highest).toBeLessThan(0.5 + 0.05);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('skin that moves carries the sheet lying on it', () => {
    const top = sheet(12, 12, (i, j) => [i, j, 0.5]);
    const sim = new ClothSim(top, { gravity: [0, 0, -981] });
    const still = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    for (let f = 0; f < 30; f++) sim.step(FRAME, still, still);
    // The plane rises 10 units over 30 frames; each frame's `before` and `after` differ.
    const before = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    const after = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    for (let f = 0; f < 30; f++) {
      const z0 = (10 * f) / 30, z1 = (10 * (f + 1)) / 30;
      for (let k = 0; k < top.count; k++) { before.point[k * 3 + 2] = z0; after.point[k * 3 + 2] = z1; }
      sim.step(FRAME, before, after);
      expect(lowest(sim, [0, 0, z1], [0, 0, 1])).toBeGreaterThanOrEqual(0.5 - 1e-3);
    }
    const [, , cz] = centroid(sim);
    expect(cz).toBeGreaterThan(10.5 - 1e-3);
    expect(cz).toBeLessThan(10.5 + 1);
  });

  it('friction 1 holds a sheet on a 30° slope that friction 0 lets slide', () => {
    const tilt = Math.PI / 6;
    // The plane through the origin faces n = (sin, 0, cos): it falls away toward +x. Gravity is straight down (-z).
    const normal: [number, number, number] = [Math.sin(tilt), 0, Math.cos(tilt)];
    const downhill = [Math.cos(tilt), 0, -Math.sin(tilt)];
    const standOff = 0.5;
    const place = (i: number, j: number): [number, number, number] => {
      const u = i - 5, v = j - 5;
      return [u * downhill[0] + normal[0] * standOff, v, u * downhill[2] + normal[2] * standOff];
    };
    const slid = (friction: number) => {
      const top = sheet(11, 11, place);
      const sim = new ClothSim(top, { gravity: [0, 0, -981], friction });
      const skin = planeContacts(top.count, [0, 0, 0], normal, standOff);
      const c0 = centroid(sim);
      for (let f = 0; f < 60; f++) sim.step(FRAME, skin, skin);
      expect(allFinite(sim.positions)).toBe(true);
      expect(lowest(sim, [0, 0, 0], normal)).toBeGreaterThanOrEqual(standOff - 1e-3);
      const c1 = centroid(sim);
      return (c1[0] - c0[0]) * downhill[0] + (c1[2] - c0[2]) * downhill[2];
    };
    const sticky = slid(1), slippery = slid(0);
    console.log(`[clothSim] 30° slope, 1 s: friction 1 slid ${sticky.toFixed(3)}, friction 0 slid ${slippery.toFixed(1)}`);
    expect(Math.abs(sticky)).toBeLessThan(1);
    expect(slippery).toBeGreaterThan(50);
  });

  it('a pin between 0 and 1 holds softly, and a step of 0 or NaN changes nothing', () => {
    const top = sheet(5, 5, (i, j) => [i, 0, j], (_i, j) => (j === 0 ? 0.5 : 0));
    const sim = new ClothSim(top);
    const skin = planeContacts(top.count, [-1e4, 0, 0], [1, 0, 0], 0.5, top.rest);
    const start = Float32Array.from(sim.positions);
    expect(sim.step(0, skin, skin).substeps).toBe(0);
    expect(sim.step(Number.NaN, skin, skin).substeps).toBe(0);
    expect(Array.from(sim.positions)).toEqual(Array.from(start));
    for (let f = 0; f < 60; f++) sim.step(FRAME, skin, skin);
    // Held but not exactly: the soft row sags a little below its target and nowhere near the free rows.
    const y = sim.positions[2 * 3 + 1];
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-2);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('draws a flat sheet with unit normals square to it, into its own buffer or the one given', () => {
    const top = sheet(6, 6, (i, j) => [i, j, 0]);
    const sim = new ClothSim(top);
    const own = sim.normals();
    expect(sim.normals()).toBe(own);
    const given = new Float32Array(top.count * 3);
    expect(sim.normals(given)).toBe(given);
    for (let i = 0; i < top.count; i++) {
      expect(Math.abs(given[i * 3 + 2])).toBeCloseTo(1, 6);
      expect(given[i * 3 + 2]).toBe(given[2]); // all one way
    }
  });

  it('times a 6,000-particle sheet, the tee\'s size, lying on her skin', () => {
    const nx = 100, ny = 60;
    const top = sheet(nx, ny, (i, j) => [i, 2, j], (i, j) => (j === 0 && i % 10 === 0 ? 1 : 0));
    const sim = new ClothSim(top);
    const skin = planeContacts(top.count, [0, 0, 0], [0, 1, 0], 0.5, top.rest);
    expect(sim.count).toBe(6000);
    // Warm the JIT so the reading is the loop and not the compiler.
    for (let f = 0; f < 10; f++) sim.step(FRAME, skin, skin);
    let total = 0, contacts = 0;
    const frames = 60;
    for (let f = 0; f < frames; f++) {
      const stats = sim.step(FRAME, skin, skin);
      total += stats.ms;
      contacts = stats.contacts;
    }
    const mean = total / frames;
    console.log(`[clothSim] 6,000 particles, ${sim.edges.length / 2} edges, ${sim.bendPairs.length / 2} bend pairs, ${CLOTH_DEFAULTS.substeps} substeps: ${mean.toFixed(2)} ms a step (mean of ${frames}), ${contacts} touching`);
    expect(contacts).toBeGreaterThan(5000);
    expect(allFinite(sim.positions)).toBe(true);
    expect(mean).toBeLessThan(50);
  });
});
