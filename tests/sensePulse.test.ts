/**
 * The antennae's arithmetic: the pulse (`src/sense/pulse.ts`) and what
 * it picks up (`src/sense/select.ts`).
 *
 * Plain node. Both modules are pure — no three, no DOM, no storage — so
 * everything here runs without a renderer, and the distances are in
 * world units at true scale: the six-metre reach is 600 of them.
 */
import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_SECONDS, CYCLE_SECONDS, EDGE_STRENGTH, FADE_AT, FADE_SECONDS, HOLD_SECONDS,
  LIT_SECONDS, SENSE_RADIUS, SWEEP_SECONDS, SensePulse,
} from '../src/sense/pulse';
import { PER_KIND_CAP, SENSE_CAPS, SenseSelection, TOTAL_CAP, type SenseEnvelope } from '../src/sense/select';
import type { SenseKind, SenseThing } from '../src/sense/senseTypes';
import { world } from '../src/world/coords';

const ORIGIN = world(1_400_000, 2_100_000);

/** A hair, for standing just short of a boundary without landing on it. */
const HAIR = 1e-6;

function thing(id: string, kind: SenseKind, east: number, north = 0, size = 10, height = 0): SenseThing {
  return { id, kind, name: id.toUpperCase(), at: world(ORIGIN.wx + east, ORIGIN.wz + north), height, size };
}

/** A pulse held wide open, for measuring the selection without the sweep moving under it. */
const FLAT: SenseEnvelope = { front: SENSE_RADIUS, strengthAt: () => 1 };

/** A pulse standing in its hold — the phase everything is lit in. */
function holding(): SensePulse {
  const pulse = new SensePulse();
  pulse.ping();
  pulse.tick(SWEEP_SECONDS + HOLD_SECONDS / 2);
  return pulse;
}

describe('the pulse: phases and their boundaries', () => {
  it('starts ready, dark, and costs nothing to ask', () => {
    const pulse = new SensePulse();
    expect(pulse.phase).toBe('ready');
    expect(pulse.ready).toBe(true);
    expect(pulse.lit).toBe(false);
    expect(pulse.front).toBe(0);
    expect(pulse.readyIn).toBe(0);
    expect(pulse.strengthAt(0)).toBe(0);
  });

  it('walks sweep, hold, fade, cooldown, ready', () => {
    const pulse = new SensePulse();
    expect(pulse.ping()).toBe(true);
    expect(pulse.phase).toBe('sweep');
    pulse.tick(SWEEP_SECONDS);
    expect(pulse.phase).toBe('hold');
    pulse.tick(HOLD_SECONDS);
    expect(pulse.phase).toBe('fade');
    pulse.tick(FADE_SECONDS);
    expect(pulse.phase).toBe('cooldown');
    pulse.tick(COOLDOWN_SECONDS);
    expect(pulse.phase).toBe('ready');
  });

  it('changes phase exactly on the boundary, not a hair before it', () => {
    const at = (seconds: number): string => {
      const pulse = new SensePulse();
      pulse.ping();
      pulse.tick(seconds);
      return pulse.phase;
    };
    expect(at(SWEEP_SECONDS - HAIR)).toBe('sweep');
    expect(at(SWEEP_SECONDS)).toBe('hold');
    expect(at(FADE_AT - HAIR)).toBe('hold');
    expect(at(FADE_AT)).toBe('fade');
    expect(at(LIT_SECONDS - HAIR)).toBe('fade');
    expect(at(LIT_SECONDS)).toBe('cooldown');
    expect(at(CYCLE_SECONDS - HAIR)).toBe('cooldown');
    expect(at(CYCLE_SECONDS)).toBe('ready');
  });

  it('is lit through the sweep, the hold and the fade, and dark either side', () => {
    const lit = (seconds: number): boolean => {
      const pulse = new SensePulse();
      pulse.ping();
      pulse.tick(seconds);
      return pulse.lit;
    };
    expect(lit(0.1)).toBe(true);
    expect(lit(FADE_AT - 1)).toBe(true);
    expect(lit(LIT_SECONDS - HAIR)).toBe(true);
    expect(lit(LIT_SECONDS)).toBe(false);
    expect(lit(CYCLE_SECONDS)).toBe(false);
  });

  it('goes dark the moment it starts cooling — the cooldown is not a dim overlay', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(LIT_SECONDS);
    expect(pulse.phase).toBe('cooldown');
    expect(pulse.front).toBe(0);
    expect(pulse.strengthAt(0)).toBe(0);
    expect(pulse.strengthAt(SENSE_RADIUS / 2)).toBe(0);
  });
});

describe('the pulse: a ping costs something', () => {
  it('refuses a second ping until the cooldown is over', () => {
    const pulse = new SensePulse();
    expect(pulse.ping()).toBe(true);
    expect(pulse.ping()).toBe(false);
    pulse.tick(SWEEP_SECONDS);
    expect(pulse.ping()).toBe(false);
    pulse.tick(HOLD_SECONDS);
    expect(pulse.ping()).toBe(false);
    pulse.tick(FADE_SECONDS);
    expect(pulse.phase).toBe('cooldown');
    expect(pulse.ping()).toBe(false);
    pulse.tick(COOLDOWN_SECONDS - HAIR);
    expect(pulse.ping()).toBe(false);
    pulse.tick(HAIR);
    expect(pulse.ping()).toBe(true);
  });

  it('says how long until the next one, and reaches nought exactly at the end', () => {
    const pulse = new SensePulse();
    pulse.ping();
    expect(pulse.readyIn).toBeCloseTo(CYCLE_SECONDS, 9);
    pulse.tick(1);
    expect(pulse.readyIn).toBeCloseTo(CYCLE_SECONDS - 1, 9);
    pulse.tick(CYCLE_SECONDS);
    expect(pulse.readyIn).toBe(0);
    expect(pulse.ready).toBe(true);
  });

  it('a refused ping does not disturb the sweep already running', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS / 2);
    const front = pulse.front;
    expect(pulse.ping()).toBe(false);
    expect(pulse.front).toBe(front);
    expect(pulse.phase).toBe('sweep');
  });

  it('reset puts the antennae back in hand — a teardown, not a way round the cooldown', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(1);
    pulse.reset();
    expect(pulse.phase).toBe('ready');
    expect(pulse.lit).toBe(false);
    expect(pulse.front).toBe(0);
  });
});

describe('the pulse: the wavefront', () => {
  it('travels out at a constant pace and arrives at the rim when the sweep ends', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS / 4);
    expect(pulse.front).toBeCloseTo(SENSE_RADIUS / 4, 9);
    pulse.tick(SWEEP_SECONDS / 4);
    expect(pulse.front).toBeCloseTo(SENSE_RADIUS / 2, 9);
    pulse.tick(SWEEP_SECONDS / 2);
    expect(pulse.front).toBeCloseTo(SENSE_RADIUS, 9);
  });

  it('never reaches past the rim, however long the hold runs', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS + HOLD_SECONDS);
    expect(pulse.front).toBe(SENSE_RADIUS);
  });

  it('lights nothing it has not reached yet', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS / 2);
    expect(pulse.front).toBeCloseTo(SENSE_RADIUS / 2, 9);
    expect(pulse.strengthAt(SENSE_RADIUS / 4)).toBeGreaterThan(0);
    expect(pulse.strengthAt(SENSE_RADIUS * 0.75)).toBe(0);
    expect(pulse.strengthAt(SENSE_RADIUS)).toBe(0);
  });

  it('is a disc and not a ring: what the front has passed stays lit behind it', () => {
    const pulse = new SensePulse();
    pulse.ping();
    const near = SENSE_RADIUS / 10;
    pulse.tick(SWEEP_SECONDS / 4);
    expect(pulse.strengthAt(near)).toBeGreaterThan(0);
    // All the way out to the rim, and then through the whole hold.
    for (let i = 0; i < 40; i += 1) {
      pulse.tick(HOLD_SECONDS / 40);
      expect(pulse.front).toBeGreaterThanOrEqual(SENSE_RADIUS / 2);
      expect(pulse.strengthAt(near)).toBeGreaterThan(0.9);
    }
    expect(pulse.phase).toBe('hold');
  });

  it('ignores a dt that is not a step forward', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS / 2);
    const front = pulse.front;
    pulse.tick(0);
    pulse.tick(-5);
    pulse.tick(Number.NaN);
    pulse.tick(Number.POSITIVE_INFINITY);
    expect(pulse.front).toBe(front);
    expect(pulse.phase).toBe('sweep');
  });
});

describe('the pulse: strength', () => {
  it('falls with distance, from whole at your feet to the rim value at the edge', () => {
    const pulse = holding();
    const feet = pulse.strengthAt(0);
    const near = pulse.strengthAt(SENSE_RADIUS / 4);
    const mid = pulse.strengthAt(SENSE_RADIUS / 2);
    const rim = pulse.strengthAt(SENSE_RADIUS);
    expect(feet).toBe(1);
    expect(near).toBeLessThan(feet);
    expect(mid).toBeLessThan(near);
    expect(rim).toBeLessThan(mid);
    expect(rim).toBeCloseTo(EDGE_STRENGTH, 12);
  });

  it('gives nothing past the rim, and nothing to nonsense', () => {
    const pulse = holding();
    expect(pulse.strengthAt(SENSE_RADIUS + 1)).toBe(0);
    expect(pulse.strengthAt(Number.NaN)).toBe(0);
    expect(pulse.strengthAt(Number.POSITIVE_INFINITY)).toBe(0);
    // Behind you is still zero distance away.
    expect(pulse.strengthAt(-10)).toBe(1);
  });

  it('ebbs through the fade and is out at the end of it', () => {
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(FADE_AT);
    expect(pulse.strengthAt(0)).toBeCloseTo(1, 9);
    pulse.tick(FADE_SECONDS / 2);
    expect(pulse.strengthAt(0)).toBeCloseTo(0.5, 6);
    pulse.tick(FADE_SECONDS / 2);
    expect(pulse.strengthAt(0)).toBe(0);
  });

  it('is monotone in distance, which is what lets the caps be decided by distance alone', () => {
    const pulse = holding();
    let last = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= SENSE_RADIUS; d += 5) {
      const s = pulse.strengthAt(d);
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
  });
});

describe('the selection: reach', () => {
  it('holds nothing while the pulse is dark', () => {
    const selection = new SenseSelection();
    const pulse = new SensePulse();
    const found = selection.select([thing('worm', 'creature', 100)], ORIGIN, SENSE_RADIUS, pulse);
    expect(found).toHaveLength(0);
  });

  it('drops anything past the radius', () => {
    const selection = new SenseSelection();
    const found = selection.select(
      [thing('near', 'creature', 100), thing('rim', 'creature', SENSE_RADIUS), thing('out', 'creature', SENSE_RADIUS + 1)],
      ORIGIN, SENSE_RADIUS, FLAT,
    );
    expect(found.map((s) => s.id)).toEqual(['near', 'rim']);
  });

  it('never reports what the wavefront has not reached yet', () => {
    const selection = new SenseSelection();
    const pulse = new SensePulse();
    pulse.ping();
    pulse.tick(SWEEP_SECONDS / 2);
    const found = selection.select(
      [thing('near', 'creature', 100), thing('far', 'creature', SENSE_RADIUS - 10)],
      ORIGIN, SENSE_RADIUS, pulse,
    );
    expect(found.map((s) => s.id)).toEqual(['near']);
  });

  it('measures horizontally: a thing sixty metres below is still under your feet', () => {
    const selection = new SenseSelection();
    const buried = thing('buried', 'creature', 100, 0, 15, -6000);
    const aloft = thing('aloft', 'creature', 200, 0, 15, 6000);
    const found = selection.select([aloft, buried], ORIGIN, SENSE_RADIUS, FLAT);
    expect(found.map((s) => s.id)).toEqual(['buried', 'aloft']);
    expect(found[0].distance).toBeCloseTo(100, 9);
  });

  it('reports nearest first, in world units at true scale', () => {
    const selection = new SenseSelection();
    const found = selection.select(
      [thing('c', 'creature', 0, 500), thing('a', 'creature', 120), thing('b', 'creature', 300, 400)],
      ORIGIN, SENSE_RADIUS, FLAT,
    );
    expect(found.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    // Six metres is 600 units; the diagonal one is a clean 3-4-5 at five metres.
    expect(found[0].distance).toBeCloseTo(120, 9);
    expect(found[1].distance).toBeCloseTo(500, 9);
    expect(found[2].distance).toBeCloseTo(500, 9);
    expect(SENSE_RADIUS).toBe(600);
  });

  it('carries the thing across whole, with the strength the pulse gives it', () => {
    const selection = new SenseSelection();
    const pulse = holding();
    const [near] = selection.select(
      [thing('worm', 'creature', 300, 0, 15, 42)],
      ORIGIN, SENSE_RADIUS, pulse,
    );
    expect(near.id).toBe('worm');
    expect(near.kind).toBe('creature');
    expect(near.name).toBe('WORM');
    expect(near.size).toBe(15);
    expect(near.height).toBe(42);
    expect(near.at.wx).toBe(ORIGIN.wx + 300);
    expect(near.strength).toBeCloseTo(pulse.strengthAt(300), 12);
    expect(near.strength).toBeLessThan(1);
    expect(near.strength).toBeGreaterThan(EDGE_STRENGTH);
  });

  it('dims with distance, the way the fill in the screenshots does', () => {
    const selection = new SenseSelection();
    const found = selection.select(
      [thing('a', 'creature', 60), thing('b', 'creature', 300), thing('c', 'creature', 580)],
      ORIGIN, SENSE_RADIUS, holding(),
    );
    expect(found[0].strength).toBeGreaterThan(found[1].strength);
    expect(found[1].strength).toBeGreaterThan(found[2].strength);
  });
});

describe('the selection: the caps', () => {
  function lawn(blades: number, worms: number): SenseThing[] {
    const things: SenseThing[] = [];
    // The grass is UNDER YOUR FEET and the worms are metres out, which
    // is the worst case for a plain nearest-first list.
    for (let i = 0; i < blades; i += 1) things.push(thing(`grass${i}`, 'plant', 1 + (i % 50) * 0.01, i * 0.001, 4));
    for (let i = 0; i < worms; i += 1) things.push(thing(`worm${i}`, 'creature', 400 + i * 10, 0, 15));
    return things;
  }

  it('a lawn of ten thousand blades cannot drown three worms', () => {
    const selection = new SenseSelection();
    const found = selection.select(lawn(10_000, 3), ORIGIN, SENSE_RADIUS, FLAT);
    const worms = found.filter((s) => s.kind === 'creature').map((s) => s.id);
    expect(worms).toEqual(['worm0', 'worm1', 'worm2']);
    expect(found.filter((s) => s.kind === 'plant')).toHaveLength(PER_KIND_CAP);
    expect(found).toHaveLength(PER_KIND_CAP + 3);
  });

  it('holds one kind to its own cap even when it is the only thing in reach', () => {
    const selection = new SenseSelection();
    const found = selection.select(lawn(10_000, 0), ORIGIN, SENSE_RADIUS, FLAT);
    expect(found).toHaveLength(PER_KIND_CAP);
    // A cap is a maximum, not a quota: the other kinds' slots go unused
    // rather than being filled with more grass.
    expect(found.length).toBeLessThan(TOTAL_CAP);
  });

  it('keeps the nearest of a kind and drops the rest', () => {
    const selection = new SenseSelection();
    const things: SenseThing[] = [];
    // Furthest first, so a cap that took the list in order would be caught.
    for (let i = 30; i > 0; i -= 1) things.push(thing(`p${i}`, 'plant', i * 10));
    const found = selection.select(things, ORIGIN, SENSE_RADIUS, FLAT);
    expect(found.map((s) => s.id)).toEqual(
      Array.from({ length: PER_KIND_CAP }, (_, i) => `p${i + 1}`),
    );
  });

  it('holds the total when every kind is crowded, dealt round the kinds', () => {
    const selection = new SenseSelection();
    const things: SenseThing[] = [];
    for (let i = 0; i < 40; i += 1) {
      things.push(thing(`c${i}`, 'creature', 10 + i));
      things.push(thing(`p${i}`, 'plant', 10 + i));
      things.push(thing(`m${i}`, 'material', 10 + i));
    }
    const found = selection.select(things, ORIGIN, SENSE_RADIUS, FLAT);
    expect(found).toHaveLength(TOTAL_CAP);
    const kinds = (kind: SenseKind): number => found.filter((s) => s.kind === kind).length;
    expect(kinds('creature')).toBe(8);
    expect(kinds('plant')).toBe(8);
    expect(kinds('material')).toBe(8);
  });

  it('spills the unused slots onto the kinds that are there', () => {
    const selection = new SenseSelection();
    const things: SenseThing[] = [thing('worm', 'creature', 500)];
    for (let i = 0; i < 40; i += 1) things.push(thing(`m${i}`, 'material', 10 + i));
    const found = selection.select(things, ORIGIN, SENSE_RADIUS, FLAT);
    expect(found.filter((s) => s.kind === 'material')).toHaveLength(PER_KIND_CAP);
    expect(found.filter((s) => s.kind === 'creature')).toHaveLength(1);
  });

  it('takes the caps it is given', () => {
    const selection = new SenseSelection();
    const things: SenseThing[] = [];
    for (let i = 0; i < 20; i += 1) {
      things.push(thing(`c${i}`, 'creature', 10 + i));
      things.push(thing(`p${i}`, 'plant', 10 + i));
    }
    expect(selection.select(things, ORIGIN, SENSE_RADIUS, FLAT, { perKind: 2, total: 10 })).toHaveLength(4);
    expect(selection.select(things, ORIGIN, SENSE_RADIUS, FLAT, { perKind: 10, total: 3 })).toHaveLength(3);
    expect(selection.select(things, ORIGIN, SENSE_RADIUS, FLAT, { perKind: 0, total: 0 })).toHaveLength(0);
    expect(SENSE_CAPS.perKind).toBe(PER_KIND_CAP);
    expect(SENSE_CAPS.total).toBe(TOTAL_CAP);
  });
});

describe('the selection: what it costs', () => {
  it('refills its own array rather than making one a frame', () => {
    const selection = new SenseSelection();
    const things = [thing('a', 'creature', 100), thing('b', 'plant', 200)];
    const first = selection.select(things, ORIGIN, SENSE_RADIUS, FLAT);
    const second = selection.select(things, ORIGIN, SENSE_RADIUS, FLAT);
    expect(second).toBe(first);
    expect(selection.sightings).toBe(first);
    expect(second).toHaveLength(2);
  });

  it('clears back to nothing', () => {
    const selection = new SenseSelection();
    selection.select([thing('a', 'creature', 100)], ORIGIN, SENSE_RADIUS, FLAT);
    selection.clear();
    expect(selection.sightings).toHaveLength(0);
  });

  it('leaves no stale sighting behind when the sweep finds less than it did', () => {
    const selection = new SenseSelection();
    const many = [thing('a', 'creature', 100), thing('b', 'creature', 200), thing('c', 'creature', 300)];
    expect(selection.select(many, ORIGIN, SENSE_RADIUS, FLAT)).toHaveLength(3);
    const found = selection.select([many[0]], ORIGIN, SENSE_RADIUS, FLAT);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('a');
  });
});
