/**
 * THE TOMBS LABORATORY, WALKED RATHER THAN INSPECTED.
 *
 * Every assertion below runs against the REAL plan — `planLab()` on the
 * canonical `LAB_SPEC`, the same 98 solids the renderer draws and the
 * same building the player starts inside. Nothing here builds a fixture
 * box to collide with, because a collision module tested against a
 * fixture is a collision module tested against the test.
 *
 * The questions are the ones a player answers with their feet, which is
 * the same standard `tests/tombsPlan.test.ts` set for the plan itself:
 *
 *  - DOES A WALL STOP YOU, AND DO YOU SLIDE ALONG IT? A body that stops
 *    dead on a wall it met at an angle cannot walk through a 1.4 m door
 *    it is not already square to.
 *  - CAN YOU LEAVE A ROOM ANYWHERE BUT A DOORWAY? Twenty-nine bodies
 *    walk north out of the laboratory from twenty-nine different places.
 *    Exactly the ones inside the sliding door's aperture reach the
 *    corridor, and the test knows which those are from the door's own
 *    width rather than from a number typed here.
 *  - DOES THE FLOOR CATCH YOU? The floor's top face is y = 0.000 and a
 *    body's feet are y = 0.000, so an integrator that hands back -0.002
 *    puts the capsule inside the room-sized slab it is standing on. That
 *    is what `STEP_UP` exists for and it is checked twice: on the open
 *    floor and on the laboratory door's threshold.
 *  - IS THE GLASS A WALL? `types.ts` rule 3 says a solid is a solid for
 *    everyone. The reinforced port is a window to the eye and a wall to
 *    the body, and both readings are asserted.
 *  - AND CAN A SLAB BE ADDED TO THE PLAN AND MISSED? The index is
 *    compared against the layout's own solids, by id, both ways.
 */
import { describe, expect, it } from 'vitest';
import { planLab } from '../src/world/tombs';
import {
  STEP_UP, ceilingOver, groundUnder, indexLab, moveBody, nearestInteraction, newBodyMove, newRayHit, rayHit,
  type BodyMove, type LabSolids,
} from '../src/world/tombs/collide';

const LAYOUT = planLab();
const SOLIDS = indexLab(LAYOUT);

/**
 * The test body. 0.30 m of radius is a 0.60 m shoulder span and 1.70 m of
 * height is an ordinary person — the same human scale `tombs/tombsTool.ts`
 * puts an eye at 1.65 m above the floor for. GAME TUNING from human
 * scale, not a measurement of anything.
 */
const RADIUS = 0.30;
const HEIGHT = 1.70;
/** Where the eye rides, for the rays. Matches `EYE_HEIGHT_M`. */
const EYE = 1.65;

/** A millimetre. Everything here is resolved to within a tenth of one. */
const MM = 1e-3;

/**
 * Walk a body in small steps and answer where it ended up.
 *
 * SMALL STEPS ON PURPOSE: 50 mm is about one frame of a walking pace, and
 * a collision that only works when it is handed the whole journey at once
 * is a collision that works in a test and not in a game. It also proves
 * the resting case — every step after the first begins with the body
 * flush against whatever stopped it.
 */
function walk(ix: LabSolids, x: number, y: number, z: number, dx: number, dz: number, steps: number): BodyMove {
  const at = { x, y, z };
  const delta = { x: dx, y: 0, z: dz };
  const out = newBodyMove();
  for (let i = 0; i < steps; i += 1) {
    moveBody(ix, at, RADIUS, HEIGHT, delta, out);
    at.x = out.x;
    at.y = out.y;
    at.z = out.z;
  }
  return out;
}

describe('the index over the laboratory plan', () => {
  it('holds every solid in the layout and nothing else', () => {
    const solid = new Set<string>();
    for (const s of LAYOUT.slabs) if (s.solid) solid.add(s.id);
    for (const p of LAYOUT.pillars) if (p.solid) solid.add(p.id);

    // Both directions, so a slab ADDED to the plan fails here rather than
    // silently becoming something a player can walk through.
    expect(SOLIDS.count).toBe(solid.size);
    expect(new Set(SOLIDS.ids)).toEqual(solid);
    expect(SOLIDS.ids).toHaveLength(SOLIDS.count);

    // The measurement the module's cell size was chosen against.
    expect(SOLIDS.count).toBe(102);
  });

  it('leaves out what the plan says is not solid', () => {
    // The chamber's 60 mm grating and a door's trim are drawn and not
    // walked into: `plan.ts` marks them `solid: false` and this is the
    // only place that decision is read.
    expect(SOLIDS.ids).not.toContain('chamber-grating');
    expect(SOLIDS.ids).not.toContain('lab-door:lintel');
    expect(SOLIDS.ids).not.toContain('jack-workstation:monitor');
    // And the glass IS solid, which is the same decision read the other way.
    expect(SOLIDS.ids).toContain('control-port');
  });

  it('registers every solid in at least one cell', () => {
    const seen = new Set<number>();
    for (const s of SOLIDS.bucketOf) seen.add(s);
    expect(seen.size).toBe(SOLIDS.count);
  });
});

describe('a wall stops a body and lets it slide', () => {
  it('runs the free axis while the blocked one stops', () => {
    // The laboratory's south wall stands at z = 16.00; a 0.30 m body can
    // reach z = 15.70. Walk at it diagonally from open floor.
    const out = walk(SOLIDS, -6.0, 0, 15.2, 0.05, 0.05, 20);
    expect(out.z).toBeCloseTo(15.70, 3);
    // The free axis ran its whole 1.00 m rather than being cancelled with it.
    expect(out.x).toBeCloseTo(-5.0, 3);
    expect(out.hitZ).toMatch(/^wall:laboratory/);
    expect(out.hitX).toBeNull();
    // A 3.25 m wall is not a step.
    expect(out.stepped).toBe(0);
  });

  it('stops square on and stays stopped', () => {
    const out = walk(SOLIDS, -6.0, 0, 15.2, 0, 0.05, 40);
    expect(out.z).toBeCloseTo(15.70, 3);
    expect(out.x).toBeCloseTo(-6.0, 6);
    expect(out.grounded).toBe(true);
  });

  it('stops a body at a desk rather than on top of it', () => {
    // Sarah's desk (ch 1) spans z 11.80..12.60 with its top at 0.75 m.
    const out = walk(SOLIDS, -6.0, 0, 13.6, 0, -0.05, 30);
    expect(out.z).toBeCloseTo(12.90, 3);
    expect(out.hitZ).toBe('sarah-workstation:desk');
    // 0.75 m is three times STEP_UP: a desk is furniture, not a step.
    expect(out.stepped).toBe(0);
    expect(out.y).toBeCloseTo(0, 6);
  });
});

describe('a wall is the only way a room is sealed', () => {
  /**
   * The laboratory's sliding door (ch 1) is 1.40 m wide centred on
   * x = -3.50, so its aperture runs -4.20 to -2.80 and a 0.30 m body
   * passes only while its centre is inside -3.90 to -3.10. Both numbers
   * come from the plan, not from this file.
   */
  const door = LAYOUT.doorways.find((d) => d.id === 'lab-door');
  if (!door) throw new Error('the plan has no lab-door');
  const passLo = door.at.x - door.width / 2 + RADIUS;
  const passHi = door.at.x + door.width / 2 - RADIUS;

  it('lets a body out of the laboratory through the doorway and nowhere else', () => {
    // A 10 m walk north from clear floor along the room's south end. The
    // corridor's own interior begins at z = 9.00.
    for (let x = -9.0; x <= -1.5 + 1e-9; x += 0.25) {
      const out = walk(SOLIDS, x, 0, 15.2, 0, -0.05, 200);
      const through = out.z < 9.0;
      if (x > passLo + 0.05 && x < passHi - 0.05) {
        expect(`${x.toFixed(2)} through`).toBe(`${x.toFixed(2)} ${through ? 'through' : 'stopped'}`);
      } else if (x < passLo - 0.05 || x > passHi + 0.05) {
        expect(`${x.toFixed(2)} stopped`).toBe(`${x.toFixed(2)} ${through ? 'through' : 'stopped'}`);
      }
    }
  });

  it('threads a body past a door jamb at the jamb, not at a square guess', () => {
    // The corner case the cylinder is kept round for. At x = -3.95 the
    // body's circle reaches 0.05 m past the jamb at x = -4.20, so it may
    // approach the wall's z face by sqrt(0.30² - 0.25²) = 0.1658 m and
    // stops at z = 9.5658. A body squared off to a 0.60 m box would stop
    // at 9.70 — 0.134 m of doorway that is not there, on an opening a
    // 0.60 m body has 0.80 m of room in.
    const off = 0.25;
    const w = Math.sqrt(RADIUS * RADIUS - off * off);
    const out = walk(SOLIDS, -3.95, 0, 10.4, 0, -0.05, 40);
    expect(out.z).toBeCloseTo(9.4 + w, 3);
    expect(out.z).toBeLessThan(9.70);
    expect(out.hitZ).toMatch(/^wall:laboratory/);
  });

  it('stops a body on the wall beside the doorway at the wall face', () => {
    // The wall between the laboratory and the corridor spans z 9.00..9.40.
    const out = walk(SOLIDS, -8.0, 0, 10.4, 0, -0.05, 40);
    expect(out.z).toBeCloseTo(9.70, 3);
    expect(out.hitZ).toMatch(/^wall:laboratory/);
  });

  it('carries a body through the doorway and on to the corridor wall', () => {
    // Through the lab door, across the 2.60 m corridor, stopped by the
    // wall to the control room at z = 6.40.
    const out = walk(SOLIDS, -3.50, 0, 10.4, 0, -0.05, 200);
    expect(out.z).toBeCloseTo(6.70, 3);
    expect(out.grounded).toBe(true);
  });

  it('will not let a body through the reinforced port', () => {
    // Ch 2's port is glass, and `types.ts` rule 3 says glass a renderer
    // can see through is glass a body stops at. The gap between the two
    // consoles is x -6.30..-5.00; a body walks north up the middle of it.
    const out = walk(SOLIDS, -5.65, 0, 3.0, 0, -0.05, 60);
    expect(out.z).toBeCloseTo(0.70, 3);
    expect(out.z).toBeGreaterThan(-0.4);
    expect(out.hitZ).not.toBeNull();
  });
});

describe('the step, and the floor face it was written for', () => {
  it('is a quarter of a metre and clears nothing the plan means to stop a body', () => {
    // Every solid top face in the building, in order, jumps 0.000 →
    // 0.450 (the entrance bench and the four chair seats) → 0.600 (the
    // array platform) → 0.750 (the desks). The step sits in that gap by
    // construction — which is why a chair's base and column are drawn
    // and NOT solid: a 0.04 m disc under the seat would be the first
    // thing in the building a body could step onto.
    expect(STEP_UP).toBe(0.25);
    expect(STEP_UP).toBeLessThan(0.45);
  });

  it('stands a body whose feet have sunk into the floor slab back on it', () => {
    // Two millimetres under, which is one frame of an integrator rounding.
    // Left alone the falling solver would ignore a floor the body is
    // already inside — correctly, since a body is let out of a solid and
    // not thrown out of one — and the body would fall through the
    // building. A face within a step of the feet is one to stand up onto.
    const out = walk(SOLIDS, -9.0, -0.002, 12.0, 0.05, 0, 10);
    expect(out.x).toBeCloseTo(-8.5, 3);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeLessThan(MM);
    expect(out.grounded).toBe(true);
    expect(out.hitX).toBeNull();
  });

  it('carries a body over the laboratory door threshold', () => {
    // The threshold is the piece of wall below the sliding door's sill —
    // y -0.40..0.00, the same top face as the floor but a SEPARATE slab
    // standing 0.30 m ahead of the body's own footprint. A body crossing
    // it with its feet a couple of millimetres low is walking at a face
    // level with its own soles: without the step it stops dead 0.30 m
    // short of a doorway that is wide open.
    const out = walk(SOLIDS, -3.50, -0.002, 9.9, 0, -0.05, 12);
    expect(out.z).toBeCloseTo(9.3, 3);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeLessThan(MM);
    expect(out.grounded).toBe(true);
  });

  it('carries a body over the chamber hatch threshold too', () => {
    // The same face on the other axis: the hatch between the plant and
    // the array chamber is cut through a wall that runs x 1.00..1.40, so
    // its threshold is what a body walking EAST out of the chamber meets.
    const out = walk(SOLIDS, 0.4, -0.002, -5.0, 0.05, 0, 12);
    expect(out.x).toBeCloseTo(1.0, 3);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.grounded).toBe(true);
  });

  it('does not lift a body onto anything taller than the step', () => {
    // The entrance bench is 0.45 m, the lowest thing in the building a
    // body is meant to be stopped by.
    const out = walk(SOLIDS, 8.30, 0, 12.6, 0, -0.05, 30);
    expect(out.stepped).toBe(0);
    expect(out.y).toBeCloseTo(0, 6);
  });
});

describe('what is under a body and what is over it', () => {
  it('finds the laboratory floor at its own top face', () => {
    // `floor:laboratory` spans y -0.40..0.00, so the ground is 0.00.
    const floor = LAYOUT.slabs.find((s) => s.id === 'floor:laboratory');
    if (!floor) throw new Error('the plan has no floor:laboratory');
    expect(floor.box.at.y + floor.box.size.y / 2).toBeCloseTo(0, 9);
    expect(floor.box.at.y - floor.box.size.y / 2).toBeCloseTo(-0.4, 9);

    expect(groundUnder(SOLIDS, LAYOUT.spawn.at.x, LAYOUT.spawn.at.z, 1.0)).toBeCloseTo(0, 9);
    expect(groundUnder(SOLIDS, -9.0, 12.0, EYE)).toBeCloseTo(0, 9);
  });

  it('finds the highest face below, not merely the floor', () => {
    // Jack's desk (x -6.90..-5.10, z 9.80..10.60) has its top at 0.75.
    expect(groundUnder(SOLIDS, -6.0, 10.2, 2.0)).toBeCloseTo(0.75, 9);
    // Asked from under the desk top, the floor is the answer again.
    expect(groundUnder(SOLIDS, -6.0, 10.2, 0.5)).toBeCloseTo(0, 9);
    // The array platform is a CIRCLE of radius 1.60 about (-6.00, -5.20):
    // 1.50 m out is on it, 1.70 m out is the chamber floor beside it.
    expect(groundUnder(SOLIDS, -4.5, -5.2, 3.0)).toBeCloseTo(0.6, 9);
    expect(groundUnder(SOLIDS, -4.3, -5.2, 3.0)).toBeCloseTo(0, 9);
    // And round on the diagonal, where a squared pillar would differ:
    // (1.10, 1.10) out is 1.556 m and on it; (1.15, 1.15) is 1.626 m and
    // off it, while both are well inside the 3.20 m box it would sit in.
    expect(groundUnder(SOLIDS, -4.9, -6.3, 3.0)).toBeCloseTo(0.6, 9);
    expect(groundUnder(SOLIDS, -4.85, -6.35, 3.0)).toBeCloseTo(0, 9);
  });

  it('answers nothing where there is nothing, rather than zero', () => {
    expect(groundUnder(SOLIDS, -6.0, 13.0, -10)).toBe(-Infinity);
    expect(groundUnder(SOLIDS, 400, 400, 10)).toBe(-Infinity);
  });

  it('finds the ceiling a body cannot jump through', () => {
    // `ceiling:laboratory` spans y 3.00..3.25.
    expect(ceilingOver(SOLIDS, -9.0, 12.0, HEIGHT)).toBeCloseTo(3.0, 9);
    // The chamber is the tall room: 7.00 m to the underside of its ceiling.
    expect(ceilingOver(SOLIDS, -6.0, -8.0, HEIGHT)).toBeCloseTo(7.0, 9);
    expect(ceilingOver(SOLIDS, 400, 400, 0)).toBe(Infinity);
  });

  it('will not let a body rise through a ceiling', () => {
    const at = { x: -9.0, y: 0, z: 12.0 };
    const out = newBodyMove();
    moveBody(SOLIDS, at, RADIUS, HEIGHT, { x: 0, y: 5, z: 0 }, out);
    // The head stops under the 3.00 m ceiling, so the feet stop at 1.30.
    expect(out.y).toBeCloseTo(3.0 - HEIGHT, 3);
    expect(out.hitY).toBe('ceiling:laboratory');
    expect(out.grounded).toBe(false);
  });

  it('drops a body to the floor and holds it there', () => {
    // From 1.00 m up, which is the tallest a 1.70 m body can start in a
    // 3.00 m room without its own head in the ceiling slab.
    const at = { x: -9.0, y: 1.0, z: 12.0 };
    const out = newBodyMove();
    const fall = { x: 0, y: -0.5, z: 0 };
    for (let i = 0; i < 10; i += 1) {
      moveBody(SOLIDS, at, RADIUS, HEIGHT, fall, out);
      at.y = out.y;
    }
    expect(out.y).toBeCloseTo(0, 3);
    expect(out.grounded).toBe(true);
    expect(out.hitY).toBe('floor:laboratory');
  });
});

describe('the ray the camera is pulled in by', () => {
  const hit = newRayHit();
  const spawn = LAYOUT.spawn.at;
  const eye = { x: spawn.x, y: EYE, z: spawn.z };

  it('sees the laboratory door open all the way to the corridor', () => {
    // From the spawn (-6.00, 13.00) toward the sliding door's centre
    // (-3.50, 9.20). The door's near face is 4.31 m along that line and
    // the ray passes through the 1.40 m opening, so the first thing it
    // meets is the corridor's far wall.
    const door = LAYOUT.doorways.find((d) => d.id === 'lab-door');
    if (!door) throw new Error('the plan has no lab-door');
    const to = { x: door.at.x - spawn.x, y: 0, z: door.at.z - spawn.z };

    expect(rayHit(SOLIDS, eye, to, 7.0, hit)).toBeNull();

    const far = rayHit(SOLIDS, eye, to, 20, hit);
    expect(far).not.toBeNull();
    // The wall between the corridor and the control room, at z = 6.40:
    // 7.90 m along a line whose direction is 4.5486 units long.
    expect(far?.distance).toBeGreaterThan(7.8);
    expect(far?.distance).toBeLessThan(8.0);
  });

  it('measures a flat wall at its face', () => {
    // Due south from the spawn: the laboratory's south wall at z = 16.00.
    const out = rayHit(SOLIDS, eye, { x: 0, y: 0, z: 1 }, 20, hit);
    expect(out).not.toBeNull();
    expect(out?.distance).toBeCloseTo(3.0, 3);
    expect(out?.id).toMatch(/^wall:laboratory/);
    expect(out?.round).toBe(false);
  });

  it('measures a pillar at its radius, not at its bounding box', () => {
    // The array platform: radius 1.60 about (-6.00, -5.20). A ray 1.00 m
    // off its axis enters at sqrt(1.60² - 1.00²) = 1.2490 m short of the
    // centre, which is 2.5510 m from z = -9.00. A squared-off pillar
    // would answer 2.2000 — 0.35 m of wall that is not there.
    const from = { x: -5.0, y: 0.3, z: -9.0 };
    const out = rayHit(SOLIDS, from, { x: 0, y: 0, z: 1 }, 10, hit);
    expect(out).not.toBeNull();
    expect(out?.id).toBe('array-platform');
    expect(out?.round).toBe(true);
    expect(out?.distance).toBeCloseTo(3.8 - Math.sqrt(1.6 * 1.6 - 1.0), 3);
  });

  it('stops at the reinforced port, because the glass is solid', () => {
    // At eye height the port (sill 1.00, 1.80 tall) is what a camera in
    // the control room meets looking north into the chamber.
    const from = { x: -5.65, y: EYE, z: 3.0 };
    const out = rayHit(SOLIDS, from, { x: 0, y: 0, z: -1 }, 10, hit);
    expect(out).not.toBeNull();
    expect(out?.id).toBe('control-port');
    expect(out?.distance).toBeCloseTo(2.6, 3);
  });

  it('answers nothing for a ray that meets nothing, and zero from inside', () => {
    expect(rayHit(SOLIDS, eye, { x: 0, y: 0, z: 1 }, 1.0, hit)).toBeNull();
    expect(rayHit(SOLIDS, eye, { x: 0, y: 0, z: 0 }, 10, hit)).toBeNull();
    // Origin inside the laboratory floor slab: the camera is already in
    // the wall, and a distance of zero is what pulls it out.
    const inside = { x: -9.0, y: -0.2, z: 12.0 };
    const out = rayHit(SOLIDS, inside, { x: 0, y: 0, z: 1 }, 10, hit);
    expect(out?.distance).toBe(0);
  });
});

describe('what a body is close enough to touch', () => {
  /** The three the laboratory holds, from `plan.ts`. */
  const jack = LAYOUT.interactions.find((i) => i.id === 'use:jack-workstation');
  const sarah = LAYOUT.interactions.find((i) => i.id === 'use:sarah-workstation');
  const intercom = LAYOUT.interactions.find((i) => i.id === 'use:lab-intercom');

  it('has the three the manuscript names, at the reaches the plan gives them', () => {
    expect(jack?.reach).toBe(1.2);
    expect(sarah?.reach).toBe(1.2);
    expect(intercom?.reach).toBe(0.9);
    expect(jack?.at.x).toBeCloseTo(-6.0, 9);
    expect(jack?.at.y).toBeCloseTo(1.08, 9);
    expect(jack?.at.z).toBeCloseTo(10.2, 9);
  });

  it("returns Jack's workstation from within 1.2 m of it", () => {
    expect(nearestInteraction(LAYOUT, { x: -6.0, y: 1.08, z: 10.2 })?.id).toBe('use:jack-workstation');
    // 0.70 m south of the point, which is where a body standing at the
    // desk's south edge has its chest.
    expect(nearestInteraction(LAYOUT, { x: -6.0, y: 1.08, z: 10.9 })?.id).toBe('use:jack-workstation');
    // 1.15 m east of the point and still his; 1.25 m and no longer. Due
    // south is the wrong axis to test the edge of his reach on, because
    // Sarah's point is 2.00 m along it and takes over at 11.20.
    expect(nearestInteraction(LAYOUT, { x: -4.85, y: 1.08, z: 10.2 })?.id).toBe('use:jack-workstation');
    expect(nearestInteraction(LAYOUT, { x: -4.75, y: 1.08, z: 10.2 })).toBeNull();
  });

  it('returns the nearest of two in reach, not the one with room to spare', () => {
    // Halfway between the two desks both are candidates; 0.05 m nearer
    // Jack's decides it.
    expect(nearestInteraction(LAYOUT, { x: -6.0, y: 1.08, z: 11.15 })?.id).toBe('use:jack-workstation');
    expect(nearestInteraction(LAYOUT, { x: -6.0, y: 1.08, z: 11.25 })?.id).toBe('use:sarah-workstation');
  });

  it('returns nothing from the middle of the laboratory floor', () => {
    expect(nearestInteraction(LAYOUT, { x: -9.0, y: 1.08, z: 12.7 })).toBeNull();
    expect(nearestInteraction(LAYOUT, { x: -9.0, y: 0, z: 12.7 })).toBeNull();

    // The room's GEOMETRIC centre is not that spot, and the difference is
    // worth pinning rather than glossing: (-7.00, 12.70) is 1.118 m from
    // Sarah's point at chest height, inside her 1.2 m reach, and 1.554 m
    // from it at the feet, outside. Which one a scene asks with is the
    // scene's decision, and this is the measurement it should make it on.
    expect(nearestInteraction(LAYOUT, { x: -7.0, y: 1.08, z: 12.7 })?.id).toBe('use:sarah-workstation');
    expect(nearestInteraction(LAYOUT, { x: -7.0, y: 0, z: 12.7 })).toBeNull();
  });

  it('reaches nothing from another room', () => {
    expect(nearestInteraction(LAYOUT, { x: -6.0, y: 1.08, z: -5.0 })?.id).toBe('use:array-platform');
    expect(nearestInteraction(LAYOUT, { x: 12.0, y: 1.08, z: 0 })).toBeNull();
  });
});

describe('a body that starts inside something can walk out of it', () => {
  it('is not held by the solid it is already in', () => {
    // A teleport, a bad spawn or a plan edited under a standing player.
    // Being pushed out is how a body inside a floor gets launched through
    // a ceiling, so it is let out on its own feet instead.
    // Standing inside the entrance bench (x 7.50..9.50, z 10.95..11.45,
    // top 0.45) with the feet at 0.10 — a third of a metre under its top
    // face, so too deep for `settleUp` to stand the body onto it.
    const out = walk(SOLIDS, 8.5, 0.1, 11.2, 0, 0.05, 40);
    // It walks clean out and on across the entrance hall, rather than
    // being held by the one solid every direction is "into".
    expect(out.z).toBeCloseTo(13.2, 3);
    expect(out.y).toBeCloseTo(0.1, 6);
  });
});

describe('a step allocates nothing', () => {
  it("writes the caller's out object and returns it", () => {
    const out = newBodyMove();
    const same = moveBody(SOLIDS, { x: -9, y: 0, z: 12 }, RADIUS, HEIGHT, { x: 0.1, y: 0, z: 0 }, out);
    expect(same).toBe(out);
    expect(out.x).toBeCloseTo(-8.9, 6);

    const ray = newRayHit();
    const got = rayHit(SOLIDS, { x: -9, y: EYE, z: 12 }, { x: 0, y: 0, z: 1 }, 20, ray);
    expect(got).toBe(ray);
  });
});
