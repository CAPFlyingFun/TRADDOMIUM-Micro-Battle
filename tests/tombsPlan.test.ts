/**
 * THE TOMBS LABORATORY, CHECKED AS A BUILDING RATHER THAN AS A LIST.
 *
 * `planLab` expands six room rectangles and seven openings into every
 * slab, pillar, ring, lamp and doorway in the building, so the useful
 * questions are not "is this box where I typed it" — nobody typed it —
 * but the ones a player would find the answers to with their feet:
 *
 *  - CAN YOU GET OUT OF A ROOM WHERE THERE IS NO DOOR? The seal check
 *    walks a fine grid over the middle of every wall plane of every room
 *    and demands that each sample is inside a solid slab or inside a
 *    declared opening. It probes the middle of the wall (0.15 m in from
 *    the room's face, which is inside even the thinnest 0.4 m wall) so a
 *    sample is never sitting on a face and ambiguous.
 *  - CAN YOU GET TO EVERY ROOM? The room graph is built from `doorways`
 *    alone and flooded from the room the spawn stands in. The reinforced
 *    port is deliberately NOT an edge — it is glass — so the chamber has
 *    to be reachable the long way, through the plant, which is the way
 *    chapter 2 goes.
 *  - DOES ANYTHING SHARE A VOLUME WITH ANYTHING ELSE? Every solid pair —
 *    slab against slab, pillar against slab, pillar against pillar — is
 *    checked. Touching faces are fine; shared volume is a wall inside a
 *    desk.
 *
 * AND THE ONE THAT PROVES IT IS GENERATED: the whole battery runs again
 * against a spec whose laboratory is three metres wider. A pile of
 * hand-placed literals cannot pass that; a plan that derives its walls
 * from its rooms can only pass it.
 */
import { describe, expect, it } from 'vitest';
import { LAB_SPEC, ARRAY_SPINS, planLab, type LabSpec } from '../src/world/tombs/plan';
import { holds, maxOf, minOf, overlaps, type Box, type LabLayout, type Room, type RoomId, type Vec3 }
  from '../src/world/tombs/types';

// ---------------------------------------------------------------------------
// The floor plan, written out independently of the spec so the test pins
// the building rather than agreeing with whatever the spec now says.
// ---------------------------------------------------------------------------

const FLOOR_PLAN: Readonly<Record<RoomId, { x: readonly [number, number]; z: readonly [number, number]; ceiling: number }>> = {
  chamber: { x: [-13.0, 1.0], z: [-10.0, -0.4], ceiling: 7.0 },
  control: { x: [-13.0, 1.0], z: [0.4, 6.0], ceiling: 3.2 },
  utility: { x: [1.4, 13.0], z: [-10.0, 6.0], ceiling: 4.0 },
  corridor: { x: [-13.0, 13.0], z: [6.4, 9.0], ceiling: 2.7 },
  laboratory: { x: [-13.0, -1.0], z: [9.4, 16.0], ceiling: 3.0 },
  entrance: { x: [-0.6, 13.0], z: [9.4, 16.0], ceiling: 3.0 },
};

const ROOM_IDS = Object.keys(FLOOR_PLAN) as RoomId[];

/** How far into a wall the seal probe reaches: inside even the thinnest (0.4 m) wall. */
const PROBE_DEPTH = 0.15;
/** Sample spacing over a wall plane. A 0.3 m grid cannot step over a 1.4 m doorway. */
const STEP = 0.3;
/** Keep samples off the exact corner, where two walls meet and `holds` is inclusive. */
const INSET = 0.06;
/**
 * How far along the through-axis a doorway's aperture is believed to
 * reach: half the thickest wall (0.4) plus the probe depth (0.15), with a
 * little over. Wide enough to cover any wall a door is cut into, narrow
 * enough that it cannot excuse a hole in a different wall.
 */
const APERTURE_REACH = 0.6;
/** The array platform's top, which the innermost ring has to clear. */
const PLATFORM_TOP = 0.6;
/**
 * A nanometre of slop, and the reason for it: a `Box` is a CENTRE and a
 * SIZE, so two boxes built to meet exactly at a face come back from
 * `minOf`/`maxOf` differing by an ulp — 3.6e-16 m in this building. Every
 * comparison below that asks "do these two meet or overlap" therefore
 * shrinks both by this much first. A nanometre is not a shared volume,
 * and it is eight orders of magnitude below anything the plan means.
 */
const SLOP = 1e-9;

/** The box, a nanometre smaller on every side. */
function shrunk(b: Box): Box {
  return { at: b.at, size: { x: b.size.x - SLOP * 2, y: b.size.y - SLOP * 2, z: b.size.z - SLOP * 2 } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function everyId(layout: LabLayout): string[] {
  return [
    ...layout.slabs.map((s) => s.id),
    ...layout.pillars.map((p) => p.id),
    ...layout.rings.map((r) => r.id),
    ...layout.lamps.map((l) => l.id),
    ...layout.doorways.map((d) => d.id),
    ...layout.interactions.map((i) => i.id),
  ];
}

function roomNamed(layout: LabLayout, id: RoomId): Room {
  const found = layout.rooms.find((r) => r.id === id);
  if (!found) throw new Error(`no room '${id}' in the layout`);
  return found;
}

/** Samples from `from` to `to` inclusive, never fewer than the two ends. */
function ticks(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v < to; v += step) out.push(v);
  out.push(to);
  return out;
}

/** A solid slab that contains the point. Pillars do not hold walls up. */
function solidAt(layout: LabLayout, p: Vec3): boolean {
  return layout.slabs.some((s) => s.solid && holds(s.box, p));
}

/**
 * Which axis a doorway passes through, derived from the room it leaves
 * rather than trusted from the plan: the doorway's centre lies outside
 * its own room on exactly one axis, and that is the axis its wall is
 * thin along.
 */
function throughAxis(layout: LabLayout, from: RoomId, at: Vec3): 'x' | 'z' {
  const inside = roomNamed(layout, from).inside;
  const lo = minOf(inside);
  const hi = maxOf(inside);
  return at.x < lo.x || at.x > hi.x ? 'x' : 'z';
}

function inDoorway(layout: LabLayout, p: Vec3, axis: 'x' | 'z'): boolean {
  return layout.doorways.some((d) => {
    if (throughAxis(layout, d.from, d.at) !== axis) return false;
    const through = axis === 'x' ? Math.abs(p.x - d.at.x) : Math.abs(p.z - d.at.z);
    const along = axis === 'x' ? Math.abs(p.z - d.at.z) : Math.abs(p.x - d.at.x);
    return through <= APERTURE_REACH && along <= d.width / 2 && p.y >= d.at.y && p.y <= d.at.y + d.height;
  });
}

interface Leak {
  readonly room: RoomId;
  readonly side: string;
  readonly at: Vec3;
}

/**
 * Every place a body could walk out of a room where no opening was
 * declared, and how many points were looked at — because a seal check
 * that sampled nothing would pass, and pass silently.
 */
function leaks(layout: LabLayout): { holes: Leak[]; samples: number } {
  const found: Leak[] = [];
  let samples = 0;
  for (const room of layout.rooms) {
    const lo = minOf(room.inside);
    const hi = maxOf(room.inside);
    const sides: { side: string; axis: 'x' | 'z'; plane: number }[] = [
      { side: 'west', axis: 'x', plane: lo.x - PROBE_DEPTH },
      { side: 'east', axis: 'x', plane: hi.x + PROBE_DEPTH },
      { side: 'north', axis: 'z', plane: lo.z - PROBE_DEPTH },
      { side: 'south', axis: 'z', plane: hi.z + PROBE_DEPTH },
    ];
    for (const s of sides) {
      const across = s.axis === 'x'
        ? ticks(lo.z + INSET, hi.z - INSET, STEP)
        : ticks(lo.x + INSET, hi.x - INSET, STEP);
      for (const a of across) {
        for (const y of ticks(lo.y + INSET, hi.y - INSET, STEP)) {
          const p: Vec3 = s.axis === 'x' ? { x: s.plane, y, z: a } : { x: a, y, z: s.plane };
          samples += 1;
          if (solidAt(layout, p) || inDoorway(layout, p, s.axis)) continue;
          found.push({ room: room.id, side: s.side, at: p });
        }
      }
    }
  }
  return { holes: found, samples };
}

/** Every place a room has no floor under it or no ceiling over it. */
function openLids(layout: LabLayout): string[] {
  const found: string[] = [];
  for (const room of layout.rooms) {
    const lo = minOf(room.inside);
    const hi = maxOf(room.inside);
    for (const x of ticks(lo.x + INSET, hi.x - INSET, STEP)) {
      for (const z of ticks(lo.z + INSET, hi.z - INSET, STEP)) {
        if (!solidAt(layout, { x, y: -0.05, z })) found.push(`${room.id} floor at ${x.toFixed(2)},${z.toFixed(2)}`);
        if (!solidAt(layout, { x, y: hi.y + 0.05, z })) found.push(`${room.id} ceiling at ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
  return found;
}

/** Flood the room graph from the spawn, through the doorways and nothing else. */
function reachedFromSpawn(layout: LabLayout): Set<string> {
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)?.add(b);
  };
  for (const d of layout.doorways) {
    const to = d.to ?? 'outside';
    link(d.from, to);
    link(to, d.from);
  }
  const start = layout.rooms.find((r) => holds(r.inside, layout.spawn.at));
  if (!start) throw new Error('the spawn is not inside any room');
  const seen = new Set<string>([start.id]);
  const queue = [start.id as string];
  while (queue.length > 0) {
    const here = queue.shift() as string;
    for (const next of edges.get(here) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** A pillar's footprint against a box, in the plan and in height. */
function pillarHitsBox(p: { at: Vec3; radius: number; height: number }, b: Box): boolean {
  const lo = minOf(b);
  const hi = maxOf(b);
  if (p.at.y >= hi.y - SLOP || p.at.y + p.height <= lo.y + SLOP) return false;
  const dx = Math.max(lo.x - p.at.x, 0, p.at.x - hi.x);
  const dz = Math.max(lo.z - p.at.z, 0, p.at.z - hi.z);
  const reach = p.radius - SLOP;
  return dx * dx + dz * dz < reach * reach;
}

function sharedVolume(layout: LabLayout): string[] {
  const bad: string[] = [];
  const solids = layout.slabs.filter((s) => s.solid);
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      if (overlaps(shrunk(solids[i].box), shrunk(solids[j].box))) bad.push(`${solids[i].id} + ${solids[j].id}`);
    }
  }
  const posts = layout.pillars.filter((p) => p.solid);
  for (const p of posts) {
    for (const s of solids) {
      if (pillarHitsBox(p, s.box)) bad.push(`${p.id} + ${s.id}`);
    }
  }
  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      const a = posts[i];
      const c = posts[j];
      const gap = Math.hypot(a.at.x - c.at.x, a.at.z - c.at.z);
      const tall = a.at.y < c.at.y + c.height && c.at.y < a.at.y + a.height;
      if (tall && gap < a.radius + c.radius - SLOP) bad.push(`${a.id} + ${c.id}`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// The canonical building
// ---------------------------------------------------------------------------

const lab = planLab();

describe('the TOMBS laboratory as planned', () => {
  it('names everything in it exactly once', () => {
    const ids = everyId(lab);
    const seen = new Set(ids);
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(twice, `ids used more than once: ${[...new Set(twice)].join(', ')}`).toEqual([]);
    expect(seen.size).toBe(ids.length);
    // Lower kebab, with ':' and '-' as the only separators (house style:
    // `tree:cx,cz:site`). A capital or a space would be a typo that only
    // showed up as a lookup that quietly missed.
    for (const id of ids) expect(id, `id '${id}' is not lower-kebab`).toMatch(/^[a-z0-9]+([:-][a-z0-9]+)*$/);
  });

  it('holds every room the manuscript names, once, at the surveyed bounds', () => {
    expect(lab.rooms.map((r) => r.id).sort()).toEqual([...ROOM_IDS].sort());
    for (const id of ROOM_IDS) {
      const plan = FLOOR_PLAN[id];
      const inside = roomNamed(lab, id).inside;
      const lo = minOf(inside);
      const hi = maxOf(inside);
      expect(lo.x, `${id} west`).toBeCloseTo(plan.x[0], 9);
      expect(hi.x, `${id} east`).toBeCloseTo(plan.x[1], 9);
      expect(lo.z, `${id} north`).toBeCloseTo(plan.z[0], 9);
      expect(hi.z, `${id} south`).toBeCloseTo(plan.z[1], 9);
      expect(lo.y, `${id} floor`).toBe(0);
      expect(hi.y, `${id} ceiling`).toBeCloseTo(plan.ceiling, 9);
    }
    // 26 x 26 m of interior inside a shell 0.4 m proud of it (site.ts).
    const lo = minOf(lab.bounds);
    const hi = maxOf(lab.bounds);
    expect(lo.x).toBeCloseTo(-13.4, 9);
    expect(hi.x).toBeCloseTo(13.4, 9);
    expect(lo.z).toBeCloseTo(-10.4, 9);
    expect(hi.z).toBeCloseTo(16.4, 9);
  });

  it('is sealed: every wall plane is solid but where an opening is declared', () => {
    const { holes, samples } = leaks(lab);
    const first = holes.slice(0, 5).map((h) => `${h.room} ${h.side} at ${h.at.x.toFixed(2)},${h.at.y.toFixed(2)},${h.at.z.toFixed(2)}`);
    expect(holes.length, `gaps in the walls (${holes.length}): ${first.join(' | ')}`).toBe(0);
    // Not vacuous: 24 wall planes on a 0.3 m grid is tens of thousands of points.
    expect(samples).toBeGreaterThan(10_000);
  });

  it('the seal check can fail: take the longest wall away and it says so', () => {
    // A guard that cannot fail is worse than no guard, so the guard is
    // pinned the way `simulationCore.test.ts` pins its own scanner.
    const walls = lab.slabs.filter((s) => s.solid && s.surface === 'wall');
    const longest = walls.reduce((a, s) => (s.box.size.x * s.box.size.z > a.box.size.x * a.box.size.z ? s : a), walls[0]);
    const holed: LabLayout = { ...lab, slabs: lab.slabs.filter((s) => s.id !== longest.id) };
    expect(leaks(holed).holes.length, `removing ${longest.id} left the building sealed`).toBeGreaterThan(0);
  });

  it('has a floor under every room and a ceiling over it', () => {
    const open = openLids(lab);
    expect(open.length, `${open.length} open: ${open.slice(0, 5).join(' | ')}`).toBe(0);
  });

  it('reaches every room, and the island, from the spawn through the doorways', () => {
    const seen = reachedFromSpawn(lab);
    for (const id of ROOM_IDS) expect(seen.has(id), `${id} is not reachable from the spawn`).toBe(true);
    expect(seen.has('outside'), 'the outer door does not lead anywhere reachable').toBe(true);
  });

  it('puts the chamber behind the plant, because the port is glass and not a door', () => {
    // Ch 2 walks the long way round for a reason; the graph has to agree.
    expect(lab.doorways.map((d) => d.id).sort()).toEqual(
      ['chamber-hatch', 'control-door', 'entrance-door', 'lab-door', 'outer-door', 'utility-door'],
    );
    const hatch = lab.doorways.find((d) => d.id === 'chamber-hatch');
    expect(hatch?.from).toBe('chamber');
    expect(hatch?.to).toBe('utility');
  });

  it('starts the player standing on the laboratory floor, in nothing solid, facing north', () => {
    const start = lab.rooms.find((r) => holds(r.inside, lab.spawn.at));
    expect(start?.id).toBe('laboratory');
    expect(lab.spawn.at.y).toBe(0);
    // 0 faces -Z; the renderer assigns this straight to `rotation.y`.
    expect(lab.spawn.yaw).toBe(0);
    for (const y of [0.1, 0.9, 1.7]) {
      const p: Vec3 = { x: lab.spawn.at.x, y, z: lab.spawn.at.z };
      expect(solidAt(lab, p), `the spawn is inside something solid at ${y} m`).toBe(false);
      expect(lab.pillars.some((q) => q.solid && pillarHitsBox(q, { at: p, size: { x: 0.01, y: 0.01, z: 0.01 } })))
        .toBe(false);
    }
  });

  it('never puts two solid things in the same place', () => {
    const bad = sharedVolume(lab);
    expect(bad.length, `${bad.length} overlapping solids: ${bad.slice(0, 6).join(' | ')}`).toBe(0);
  });

  it('glazes the reinforced port, solid, in the wall between the control room and the chamber', () => {
    const port = lab.slabs.find((s) => s.id === 'control-port');
    expect(port, 'the reinforced port is missing').toBeDefined();
    expect(port?.surface).toBe('glass');
    // Solid: `types.ts` says a solid is a solid for everyone, and nobody
    // walks into the chamber through the glass (ch 2).
    expect(port?.solid).toBe(true);
    const lo = minOf(port?.box ?? lab.bounds);
    const hi = maxOf(port?.box ?? lab.bounds);
    // It fills the 0.8 m wall between chamber (ends z = -0.4) and control (begins z = +0.4).
    expect(lo.z).toBeCloseTo(-0.4, 9);
    expect(hi.z).toBeCloseTo(0.4, 9);
    expect(hi.x - lo.x).toBeCloseTo(8.0, 9);
    expect(hi.y - lo.y).toBeCloseTo(1.8, 9);
    expect(lo.y).toBeCloseTo(1.0, 9);
    // And it is not a doorway: no edge of the room graph runs through it.
    expect(lab.doorways.some((d) => d.id === 'control-port')).toBe(false);
  });

  it('leaves the array stopped, five rings on one centre at five angles', () => {
    expect(lab.rings).toHaveLength(5);
    const hub = lab.rings[0].at;
    for (const ring of lab.rings) {
      expect(ring.at).toEqual(hub);
      // Ch 3 leaves them at rest. A plan is not a state machine.
      expect(ring.spin).toBe(0);
      // Clear of the 0.6 m platform below and the 7 m ceiling above.
      expect(hub.y - ring.radius * Math.sin(ring.tilt) - ring.tube).toBeGreaterThan(PLATFORM_TOP);
    }
    const tilts = lab.rings.map((r) => r.tilt);
    expect(new Set(tilts).size, 'two rings share an angle').toBe(tilts.length);
    expect(lab.rings.map((r) => r.radius)).toEqual([2.6, 2.2, 1.8, 1.5, 1.2]);
    // The speeds a caller would start it with: signed, so neighbours turn against each other.
    expect(ARRAY_SPINS).toHaveLength(lab.rings.length);
    for (let i = 1; i < ARRAY_SPINS.length; i += 1) {
      expect(Math.sign(ARRAY_SPINS[i]), `spins ${i - 1} and ${i} turn the same way`).toBe(-Math.sign(ARRAY_SPINS[i - 1]));
    }
  });

  it('puts every interaction inside the room it names, within reach', () => {
    for (const use of lab.interactions) {
      const inside = roomNamed(lab, use.room).inside;
      expect(holds(inside, use.at), `${use.id} is not inside ${use.room}`).toBe(true);
      expect(use.reach, `${use.id} reach`).toBeGreaterThanOrEqual(0.9);
      expect(use.reach, `${use.id} reach`).toBeLessThanOrEqual(1.5);
      expect(use.label.length).toBeGreaterThan(0);
      expect(use.prompt.length).toBeGreaterThan(0);
    }
    // The eight the manuscript asks for, by the id they are namespaced under.
    const ids = lab.interactions.map((i) => i.id);
    for (const want of [
      'use:jack-workstation', 'use:sarah-workstation', 'use:lab-intercom', 'use:primary-console',
      'use:secondary-console', 'use:shutdown-lever', 'use:map-display', 'use:outer-door',
    ]) expect(ids, `${want} is missing`).toContain(want);
  });

  it('carries both sets of lights in the control room at once (ch 2)', () => {
    const here = lab.lamps.filter((l) => l.room === 'control');
    const normal = here.filter((l) => l.mode === 'normal');
    const emergency = here.filter((l) => l.mode === 'emergency');
    expect(normal.length).toBeGreaterThan(0);
    expect(emergency.length).toBeGreaterThan(0);
    // The emergency set is the smaller and the dimmer one: the change reads as a loss.
    expect(emergency.length).toBeLessThan(normal.length);
    expect(emergency[0].intensity).toBeLessThan(normal[0].intensity);
    for (const room of ROOM_IDS) {
      expect(lab.lamps.some((l) => l.room === room && l.mode === 'normal'), `${room} has no lighting`).toBe(true);
      expect(lab.lamps.some((l) => l.room === room && l.mode === 'emergency'), `${room} has no emergency lighting`).toBe(true);
    }
  });

  it('plans the same building every time', () => {
    expect(planLab()).toEqual(planLab());
    expect(planLab(LAB_SPEC)).toEqual(planLab());
  });
});

// ---------------------------------------------------------------------------
// The proof that it is generated: the same checks, a different building
// ---------------------------------------------------------------------------

describe('a laboratory three metres wider', () => {
  const wider: LabSpec = {
    ...LAB_SPEC,
    rooms: LAB_SPEC.rooms.map((r) => (r.id === 'laboratory' ? { ...r, x: [-16.0, -1.0] as readonly [number, number] } : r)),
  };
  const big = planLab(wider);

  it('grows the room, its shell and its lighting with the spec', () => {
    const inside = roomNamed(big, 'laboratory').inside;
    expect(minOf(inside).x).toBeCloseTo(-16.0, 9);
    expect(minOf(big.bounds).x).toBeCloseTo(-16.4, 9);
    // The benches followed the far wall rather than staying where they were typed.
    const bench = big.slabs.find((s) => s.id === 'lab-bench-1');
    expect(minOf(bench?.box ?? big.bounds).x).toBeCloseTo(-16.0, 9);
  });

  it('is still sealed, still connected, and still has nothing inside anything', () => {
    const { holes, samples } = leaks(big);
    expect(holes.length, `gaps: ${holes.slice(0, 5).map((h) => `${h.room} ${h.side}`).join(' | ')}`).toBe(0);
    expect(samples).toBeGreaterThan(10_000);
    expect(openLids(big)).toEqual([]);
    const seen = reachedFromSpawn(big);
    for (const id of ROOM_IDS) expect(seen.has(id), `${id} is not reachable`).toBe(true);
    expect(seen.has('outside')).toBe(true);
    const bad = sharedVolume(big);
    expect(bad.length, `overlapping solids: ${bad.slice(0, 6).join(' | ')}`).toBe(0);
    expect(new Set(everyId(big)).size).toBe(everyId(big).length);
  });
});
