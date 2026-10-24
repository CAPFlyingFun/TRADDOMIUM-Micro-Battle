/**
 * THE TEE AS TRUE CLOTH (Joshua, 2026-10-23: "I want to be able to see how much or little having a full soft body cloth
 * fabric would be"). On small sheets built here: a sheet hung from its top row falls, stays inside its strain limit and
 * never goes NaN; a sheet dropped on a skin plane settles on it at its stand-off and stays; skin that rises carries the
 * sheet lying on it; friction 1 holds a sheet on a 30° slope that friction 0 lets slide; and a 6,000-particle sheet --
 * the tee's size -- is timed, because the cost is the point of the experiment.
 *
 * And GRIP, after Joshua saw it tear the tee at its top (2026-10-24: "starts ripping up the outfit and does weird stuff
 * about 3s after I adjust the slider"): friction holds the cloth to the SPOT of skin it touched (`carried`), so cloth
 * on a sliding floor goes with it exactly and a nudged particle stops where it is put -- where the old nearest-point
 * difference made it slide on by the nudge every frame; and the grip is mostly up and down her ("only a max of 20% loss
 * horizontally"): `friction` of a slip down a wall, `frictionAcross` of one along it, `frictionAcross` every way on a
 * floor, with no jump in between.
 */
import { describe, expect, it } from 'vitest';
import { ClothSim, CLOTH_DEFAULTS, type ClothSettings, type ClothTopology } from '../src/sarahlab/clothSim';
import { copyContacts, createContacts, type SkinContacts } from '../src/sarahlab/clothTypes';

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

/**
 * Skin that is one plane under every particle: through `point`, facing `normal`, `standOff` thick; pins held at `pins`.
 * The plane is still, so the spot of it under each particle stays where it was: `carried` is `point`.
 */
function planeContacts(count: number, point: [number, number, number], normal: [number, number, number], standOff: number, pins?: Float32Array): SkinContacts {
  const c = createContacts(count);
  const l = Math.hypot(...normal);
  for (let k = 0; k < count; k++) {
    c.point.set(point, k * 3);
    c.carried.set(point, k * 3);
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

/**
 * A floor (z = 0, facing +z, gravity -z) sliding along itself at `vel` units/s under `sim`, frame after frame, the way
 * the room runs it (`ClothShirt.frame`): this frame's contacts are `after`, last frame's are `before` (the first
 * frame's `before` is a copy of its `after`). Each contact's `point` is the floor straight under the particle -- the
 * NEAREST skin, which follows the particle, as `ClothSkin` finds it -- and `carried` is where the spot of floor that
 * was under it last frame has slid to. `oldWay` puts the bug back: carried = point, so friction holds to
 * `after.point - before.point`. `each(f, positions)` is called before frame f's contacts are taken, to look or nudge.
 */
function onSlidingFloor(sim: ClothSim, frames: number, vel: [number, number], oldWay: boolean, each?: (f: number, x: Float32Array) => void): void {
  const n = sim.count;
  let before = createContacts(n), after = createContacts(n);
  for (let f = 0; f < frames; f++) {
    each?.(f, sim.positions);
    const x = sim.positions;
    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      after.point[i3] = x[i3]; after.point[i3 + 1] = x[i3 + 1]; after.point[i3 + 2] = 0;
      after.normal[i3] = 0; after.normal[i3 + 1] = 0; after.normal[i3 + 2] = 1; after.standOff[i] = 0.5;
      const none = f === 0 || oldWay; // the first frame has no last contact to carry
      after.carried[i3] = none ? after.point[i3] : before.point[i3] + vel[0] * FRAME;
      after.carried[i3 + 1] = none ? after.point[i3 + 1] : before.point[i3 + 1] + vel[1] * FRAME;
      after.carried[i3 + 2] = 0;
    }
    if (f === 0) copyContacts(after, before);
    sim.step(FRAME, before, after);
    const swap = before; before = after; after = swap;
  }
}

/** One particle on its own: no edges, nothing but gravity and her skin acting on it. */
function lone(at: ArrayLike<number>, settings: Partial<ClothSettings>): ClothSim {
  return new ClothSim({ count: 1, triangles: new Uint32Array(0), rest: Float32Array.from(at), pin: new Float32Array(1) }, settings);
}

/**
 * The velocity along her skin a lone particle keeps after one substep's friction, moving at `velocity` over skin
 * through the origin facing `normal`, 0.1 inside its stand-off (so it touches). Gravity points down -y and only says
 * which way is up: it is made far too small to slip anything itself. One substep, no damping, so the share friction
 * takes is the share that is gone.
 */
function keptSlip(normal: readonly number[], velocity: readonly number[], friction: number, frictionAcross: number): [number, number, number] {
  const l = Math.hypot(normal[0], normal[1], normal[2]);
  const n: [number, number, number] = [normal[0] / l, normal[1] / l, normal[2] / l];
  const sim = lone([n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], { substeps: 1, damping: 0, gravity: [0, -1e-6, 0], friction, frictionAcross });
  sim.velocities.set(velocity);
  const skin = planeContacts(1, [0, 0, 0], n, 0.6);
  const x0 = Float32Array.from(sim.positions);
  sim.step(FRAME, skin, skin);
  const d = [0, 1, 2].map((k) => sim.positions[k] - x0[k]);
  const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; // the push out of her, which is not slip
  return [0, 1, 2].map((k) => (d[k] - dn * n[k]) / FRAME) as [number, number, number];
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
    // The plane rises 10 units over 30 frames; each frame's `before` and `after` differ. The spot of it that was at
    // `before.point` has risen with it, to `after.point`: that is `after.carried`.
    const before = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    const after = planeContacts(top.count, [0, 0, 0], [0, 0, 1], 0.5);
    for (let f = 0; f < 30; f++) {
      const z0 = (10 * f) / 30, z1 = (10 * (f + 1)) / 30;
      for (let k = 0; k < top.count; k++) { before.point[k * 3 + 2] = z0; after.point[k * 3 + 2] = z1; after.carried[k * 3 + 2] = z1; }
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
    // Downhill is "down her", so it is `friction` that holds it; across is a fifth of it, as the room sets it.
    const slid = (friction: number) => {
      const top = sheet(11, 11, place);
      const sim = new ClothSim(top, { gravity: [0, 0, -981], friction, frictionAcross: friction / 5 });
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

  it('a heavier particle gives way less: the weighted hem pulls the cloth, not the cloth the hem', () => {
    // a 2 × 2 sheet stretched to twice its width, nothing else acting: each side comes back in by its inverse mass
    const run = (mass?: Float32Array) => {
      const top = sheet(2, 2, (i, j) => [i * 10, -j * 10, 0]);
      const sim = new ClothSim({ ...top, mass }, { gravity: [0, 0, 0], damping: 0, substeps: 1, maxStretch: 10, stretchCompliance: 0, bendCompliance: 1 });
      sim.reset(Float32Array.from([0, 0, 0, 20, 0, 0, 0, -10, 0, 20, -10, 0]));
      const far = planeContacts(4, [0, 0, -1000], [0, 0, 1], 0);
      sim.step(FRAME, far, far);
      return [sim.positions[0], sim.positions[3]];
    };
    // how far the left side came in against the right (one Gauss-Seidel pass is not symmetric, so compare the two runs)
    const share = ([left, right]: number[]) => left / (20 - right);
    const even = share(run()), weighted = share(run(Float32Array.from([1, 4, 1, 4])));
    expect(even).toBeGreaterThan(0);
    expect(weighted).toBeGreaterThan(even * 2.5); // the right side, four times heavier, gave way about a quarter as much
  });

  it('cloth lying on skin that slides along itself goes with it exactly: friction holds the spot of skin it touched', () => {
    // A 6 × 6 sheet resting on a floor that slides 12 cm/s one way and 5 the other, friction 1 every way. The nearest
    // floor under each particle follows the particle; the spot of floor it touched goes with the floor. Held to that,
    // every particle keeps its place on the floor: no drift, no creep, the sheet's shape unchanged.
    const top = sheet(6, 6, (i, j) => [i, j, 0.5]);
    const sim = new ClothSim(top, { gravity: [0, 0, -981], friction: 1, frictionAcross: 1 });
    const vel: [number, number] = [12, 5], frames = 240, from = 20;
    let start = new Float32Array(0);
    onSlidingFloor(sim, frames, vel, false, (f, x) => { if (f === from) start = Float32Array.from(x); });
    // frames `from` to the last: the floor slid that many frames' worth since the snapshot
    const travel = [vel[0] * FRAME * (frames - from), vel[1] * FRAME * (frames - from), 0];
    let drift = 0;
    for (let i = 0; i < top.count; i++) {
      for (let k = 0; k < 3; k++) drift = Math.max(drift, Math.abs(sim.positions[i * 3 + k] - start[i * 3 + k] - travel[k]));
    }
    console.log(`[clothSim] sliding floor, ${frames - from} frames, ${travel[0].toFixed(1)} × ${travel[1].toFixed(1)} units: worst drift off it ${drift.toExponential(1)}`);
    expect(travel[0]).toBeGreaterThan(40);
    expect(drift).toBeLessThan(0.01); // a tenth of a millimetre over 44 cm: float rounding, not slip
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('a nudged particle stops where it is put; held to the nearest point instead (the old way) it slid on by the nudge every frame', () => {
    // What GRIP at its top did to the tee (Joshua, 2026-10-24): friction against `after.point - before.point` -- the
    // nearest skin, which moves when the PARTICLE moves -- read last frame's slide as her skin's own motion, and at
    // friction 1 made the particle repeat it, every frame, undamped. A nudge (a fold landing, the strain limit
    // putting an edge right) then never stops. On the same sliding floor, a lone particle is moved 1 unit across the
    // floor's travel between two frames; held to the spot of skin it touched, it stays 1 unit over and goes on with the
    // floor, and held the old way it slides another unit every frame (and never followed the floor at all).
    const run = (oldWay: boolean) => {
      const sim = lone([0, 0, 0.5], { gravity: [0, 0, -981], friction: 1, frictionAcross: 1 });
      let y0 = 0, x0 = 0;
      onSlidingFloor(sim, 90, [12, 0], oldWay, (f, x) => { if (f === 30) { y0 = x[1]; x0 = x[0]; x[1] += 1; } });
      return { across: sim.positions[1] - y0, along: sim.positions[0] - x0 };
    };
    const now = run(false), was = run(true);
    console.log(`[clothSim] nudged 1 unit, 60 frames on: held to the spot of skin ${now.across.toFixed(3)} across, held to the nearest point ${was.across.toFixed(1)}`);
    expect(now.across).toBeCloseTo(1, 3);
    expect(now.along).toBeCloseTo(12 * FRAME * 60, 2); // and it went on with the floor
    expect(was.across).toBeGreaterThan(30);
    expect(Math.abs(was.along)).toBeLessThan(1e-3);
  });

  it('grips up and down her with `friction` and across her with `frictionAcross`; on a floor, `frictionAcross` every way', () => {
    const fr = 0.7, fa = 0.2;
    // a wall facing +z, gravity down -y: "up across her" is +y
    const wall = [0, 0, 1];
    const down = keptSlip(wall, [0, -60, 0], fr, fa), up = keptSlip(wall, [0, 60, 0], fr, fa);
    const side = keptSlip(wall, [60, 0, 0], fr, fa), diagonal = keptSlip(wall, [60, -60, 0], fr, fa);
    expect(down[1]).toBeCloseTo(-60 * (1 - fr), 3); expect(down[0]).toBeCloseTo(0, 4);
    expect(up[1]).toBeCloseTo(60 * (1 - fr), 3);
    expect(side[0]).toBeCloseTo(60 * (1 - fa), 3); expect(side[1]).toBeCloseTo(0, 4);
    expect(diagonal[0]).toBeCloseTo(60 * (1 - fa), 3);
    expect(diagonal[1]).toBeCloseTo(-60 * (1 - fr), 3);
    // a floor facing +y: no up across it, so every way is across
    for (const v of [[60, 0, 0], [0, 0, 60], [42, 0, -42], [-30, 0, 51]]) {
      const kept = keptSlip([0, 1, 0], v, fr, fa);
      for (let k = 0; k < 3; k++) expect(kept[k]).toBeCloseTo(v[k] * (1 - fa), 3);
    }
    // a ceiling the same (her skin facing straight down, under her bust)
    expect(keptSlip([0, -1, 0], [60, 0, 0], fr, fa)[0]).toBeCloseTo(60 * (1 - fa), 3);
  });

  it('tilting her skin from level to a 45° slope moves the grip on a downhill slip smoothly from `frictionAcross` to `friction`', () => {
    const fr = 0.8, fa = 0.2;
    // the normal tilts from +y toward +z; downhill on it is (0, -sin, cos), which on the level is the horizontal +z
    const share = (deg: number) => {
      const a = (deg * Math.PI) / 180, n = [0, Math.cos(a), Math.sin(a)], d = [0, -Math.sin(a), Math.cos(a)];
      const kept = keptSlip(n, d.map((x) => x * 60), fr, fa);
      return (kept[0] * d[0] + kept[1] * d[1] + kept[2] * d[2]) / 60;
    };
    const across = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return keptSlip([0, Math.cos(a), Math.sin(a)], [60, 0, 0], fr, fa)[0] / 60;
    };
    let worst = 0, last = share(0);
    for (let k = 1; k <= 450; k++) {
      const s = share(k / 10);
      expect(s).toBeLessThanOrEqual(last + 1e-5); // only ever grips harder as the slope steepens
      worst = Math.max(worst, Math.abs(s - last));
      last = s;
      expect(across(k / 10)).toBeCloseTo(1 - fa, 4); // a slip along the slope's level line is across at every tilt
    }
    console.log(`[clothSim] level to 45°: kept ${share(0).toFixed(3)} → ${share(45).toFixed(3)}, biggest change in a tenth of a degree ${worst.toFixed(4)}`);
    expect(share(0)).toBeCloseTo(1 - fa, 4);
    expect(share(5)).toBeCloseTo(1 - fa, 4); // sin 5° < 0.1: still level as far as the grip is concerned
    expect(share(18)).toBeCloseTo(1 - fr, 4); // sin 18° > 0.3: all the way to `friction`
    expect(share(45)).toBeCloseTo(1 - fr, 4);
    // smoothstep's steepest is 1.5 / 0.2 a unit of sine; a tenth of a degree is 0.00175 of it: 0.013 of the 0.6 between
    expect(worst).toBeLessThan(0.01);
  });
});
