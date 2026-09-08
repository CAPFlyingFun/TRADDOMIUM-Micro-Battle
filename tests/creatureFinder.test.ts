/**
 * The finder's arithmetic (`src/creatures/finder.ts`): which animal is
 * nearest, whether it is buried, and where a camera has to stand to see
 * a 15 cm worm on a phone.
 *
 * Plain node, like the rest of `creatures/`: the module is core, so
 * every one of these runs without a DOM, a renderer or a camera.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUND_CLEARANCE, MIN_STANDOFF, UNDER_GROUND, VIEW_LENGTHS, VIEW_RISE,
  isUnderground, metresOfUnits, nearestSighting, sightings, standoffOf, unitsOfMetres, viewpointFor,
} from '../src/creatures/finder';
import { APHID, EARTHWORM, HOUSEFLY, unitsOfMm, type CreatureId } from '../src/creatures/species';
import { newCreature, type CreatureState } from '../src/creatures/state';
import { compassBearing, compassWord, world } from '../src/world/coords';

const FOCUS = world(1000, 2000);

function creature(id: string, species: CreatureId, wx: number, wz: number, height = 0): CreatureState {
  return newCreature({ id, species, cellKey: '0,0', at: world(wx, wz), height, heading: 0, phase: 0 });
}

describe('units', () => {
  it('a metre is a hundred world units, both ways', () => {
    expect(unitsOfMetres(1)).toBe(100);
    expect(unitsOfMetres(30)).toBe(3000);
    expect(metresOfUnits(100)).toBe(1);
    expect(metresOfUnits(unitsOfMetres(12.5))).toBeCloseTo(12.5, 10);
  });
});

describe('nearestSighting', () => {
  it('holds nothing when the simulation is holding nothing', () => {
    expect(nearestSighting([], FOCUS)).toBeNull();
  });

  it('picks the nearest by HORIZONTAL distance and reports it in world units', () => {
    const near = creature('w1', 'earthworm', 1000 + 300, 2000);
    const far = creature('w2', 'earthworm', 1000, 2000 + 900);
    const found = nearestSighting([far, near], FOCUS);
    expect(found?.id).toBe('w1');
    expect(found?.distance).toBeCloseTo(300, 6);
    expect(metresOfUnits(found?.distance ?? 0)).toBeCloseTo(3, 6);
  });

  it('ignores height when choosing: a camera 60 m up is still standing over the worm below it', () => {
    // The nearer one is deep underground, the further one at the surface.
    const under = creature('w1', 'earthworm', 1000 + 100, 2000, -50);
    const surface = creature('w2', 'earthworm', 1000 + 400, 2000, 0);
    expect(nearestSighting([surface, under], FOCUS)?.id).toBe('w1');
  });

  it('filters by species when asked', () => {
    const fly = creature('f1', 'housefly', 1000 + 10, 2000);
    const worm = creature('w1', 'earthworm', 1000 + 500, 2000);
    expect(nearestSighting([fly, worm], FOCUS)?.id).toBe('f1');
    expect(nearestSighting([fly, worm], FOCUS, { species: new Set<CreatureId>(['earthworm']) })?.id).toBe('w1');
    expect(nearestSighting([fly, worm], FOCUS, { species: new Set<CreatureId>(['aphid']) })).toBeNull();
  });

  it('says how deep, and reads no ground as unknown rather than as the surface', () => {
    const buried = creature('w1', 'earthworm', 1000, 2000, 98.8);
    expect(nearestSighting([buried], FOCUS)?.under).toBeNull();
    expect(isUnderground(nearestSighting([buried], FOCUS)!)).toBe(false);

    const withGround = nearestSighting([buried], FOCUS, { groundAt: () => 100 });
    // 12 mm under, in a world of centimetres: 1.2 units.
    expect(withGround?.under).toBeCloseTo(1.2, 6);
    expect(isUnderground(withGround!)).toBe(true);
  });

  it('a body at or just under the surface is not called buried: the pin changes when the body stops being drawn', () => {
    const shallow = creature('w1', 'earthworm', 1000, 2000, 100 - UNDER_GROUND * 0.5);
    expect(isUnderground(nearestSighting([shallow], FOCUS, { groundAt: () => 100 })!)).toBe(false);
    const deeper = creature('w2', 'earthworm', 1000, 2000, 100 - UNDER_GROUND * 2);
    expect(isUnderground(nearestSighting([deeper], FOCUS, { groundAt: () => 100 })!)).toBe(true);
    // A fly ABOVE the ground reads as a negative depth, never as buried.
    const flying = creature('f1', 'housefly', 1000, 2000, 140);
    const seen = nearestSighting([flying], FOCUS, { groundAt: () => 100 });
    expect(seen?.under).toBeCloseTo(-40, 6);
    expect(isUnderground(seen!)).toBe(false);
  });
});

describe('sightings', () => {
  it('returns every creature, nearest first', () => {
    const list = [
      creature('c', 'earthworm', 1000 + 900, 2000),
      creature('a', 'earthworm', 1000 + 100, 2000),
      creature('b', 'housefly', 1000 + 400, 2000),
    ];
    expect(sightings(list, FOCUS).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('carries the behaviour through, so a pin can say what the animal is doing', () => {
    const worm = creature('w1', 'earthworm', 1000, 2000);
    worm.behaviour = 'burrow';
    expect(sightings([worm], FOCUS)[0].behaviour).toBe('burrow');
  });
});

describe('standoffOf', () => {
  it('is three body lengths for anything big enough, and a floor for anything smaller', () => {
    // A 150 mm worm: 15 units × 3 = 45.
    expect(standoffOf(EARTHWORM)).toBeCloseTo(unitsOfMm(EARTHWORM.lengthMm) * VIEW_LENGTHS, 6);
    expect(standoffOf(EARTHWORM)).toBeCloseTo(45, 6);
    // A 6.5 mm housefly is still big enough for the rule: 1.95 units.
    expect(standoffOf(HOUSEFLY)).toBeCloseTo(unitsOfMm(HOUSEFLY.lengthMm) * VIEW_LENGTHS, 6);
    // Only the 2.5 mm aphid reaches the floor: three lengths of it is
    // 0.75 units, closer than the finder will ever ask a camera to go.
    expect(unitsOfMm(APHID.lengthMm) * VIEW_LENGTHS).toBeLessThan(MIN_STANDOFF);
    expect(standoffOf(APHID)).toBe(MIN_STANDOFF);
  });

  it('puts every animal across a useful part of a 932x430 phone screen', () => {
    // A 60° vertical field: the visible height at distance d is 2·d·tan30°.
    const pixels = (lengthMm: number, standoff: number): number =>
      (unitsOfMm(lengthMm) / (2 * standoff * Math.tan((30 * Math.PI) / 180))) * 430;
    // THE WHOLE POINT OF THE INSTRUMENT: none of the three may come out
    // the handful of pixels they are when flown past by hand.
    expect(pixels(EARTHWORM.lengthMm, standoffOf(EARTHWORM))).toBeGreaterThan(100);
    expect(pixels(APHID.lengthMm, standoffOf(APHID))).toBeGreaterThan(60);
    expect(pixels(HOUSEFLY.lengthMm, standoffOf(HOUSEFLY))).toBeGreaterThan(100);
    // And the floor is well clear of the camera's 0.1-unit near plane.
    expect(standoffOf(APHID)).toBeGreaterThan(0.1 * 5);
  });
});

describe('viewpointFor', () => {
  const worm = () => nearestSighting([creature('w1', 'earthworm', 2000, 3000, 100)], FOCUS)!;

  it('stands one standoff away, on the side the camera is already on', () => {
    // The camera is due east of the worm, so the viewpoint is due east too.
    const view = viewpointFor(worm(), EARTHWORM, { from: world(2000 + 5000, 3000) });
    expect(view.at.wx).toBeCloseTo(2000 + standoffOf(EARTHWORM), 6);
    expect(view.at.wz).toBeCloseTo(3000, 6);
  });

  it('looks back at the animal, in the actor convention, tipped down', () => {
    const view = viewpointFor(worm(), EARTHWORM, { from: world(2000 + 5000, 3000) });
    // Standing east and looking west: ahead is (sin h, cos h) = (-1, 0), so h = -90°.
    expect(Math.sin(view.heading)).toBeCloseTo(-1, 6);
    expect(Math.cos(view.heading)).toBeCloseTo(0, 6);
    // And a compass agrees it is looking WEST — the mirrored-compass trap.
    expect(compassWord(compassBearing(view.heading))).toBe('W');
    expect(view.pitch).toBeLessThan(0);
    expect(view.pitch).toBeCloseTo(Math.atan2(-standoffOf(EARTHWORM) * VIEW_RISE, standoffOf(EARTHWORM)), 6);
  });

  it('rises above the animal rather than lying on the floor with it', () => {
    const view = viewpointFor(worm(), EARTHWORM, { from: world(2000 + 5000, 3000) });
    expect(view.height).toBeCloseTo(100 + standoffOf(EARTHWORM) * VIEW_RISE, 6);
  });

  it('comes from due south when nothing says where the camera is, or when it is exactly on top', () => {
    const fromNothing = viewpointFor(worm(), EARTHWORM);
    expect(fromNothing.at.wz).toBeCloseTo(3000 + standoffOf(EARTHWORM), 6);
    expect(fromNothing.at.wx).toBeCloseTo(2000, 6);
    // Looking north from due south.
    expect(compassWord(compassBearing(fromNothing.heading))).toBe('N');

    const onTop = viewpointFor(worm(), EARTHWORM, { from: world(2000, 3000) });
    expect(onTop.at.wz).toBeCloseTo(3000 + standoffOf(EARTHWORM), 6);
    expect(Number.isFinite(onTop.heading)).toBe(true);
  });

  it('never puts the camera inside the hill, and clears it by a fraction of the standoff', () => {
    const view = viewpointFor(worm(), EARTHWORM, { from: world(2000 + 5000, 3000), groundAt: () => 400 });
    expect(view.height).toBeGreaterThanOrEqual(400 + standoffOf(EARTHWORM) * GROUND_CLEARANCE);
    // An aphid's clearance scales with it: a fixed one would put the
    // camera many standoffs up and turn the shot into a plan view.
    const aphid = nearestSighting([creature('a1', 'aphid', 2000, 3000, 100)], FOCUS)!;
    const close = viewpointFor(aphid, APHID, { from: world(2000 + 5000, 3000), groundAt: () => 100 });
    expect(close.height - 100).toBeLessThan(standoffOf(APHID));
  });

  it('looks at a BURIED worm from over the ground, not from under it', () => {
    const buried = nearestSighting([creature('w1', 'earthworm', 2000, 3000, 88)], FOCUS, { groundAt: () => 100 })!;
    expect(isUnderground(buried)).toBe(true);
    const view = viewpointFor(buried, EARTHWORM, { from: world(2000 + 5000, 3000), groundAt: () => 100 });
    // Above the GROUND (100), not above the worm (88).
    expect(view.height).toBeGreaterThan(100);
    expect(view.height).toBeCloseTo(100 + standoffOf(EARTHWORM) * VIEW_RISE, 6);
    // And it is aimed down at where the worm actually is.
    expect(view.pitch).toBeLessThan(0);
  });

  it('takes a standoff override, for a probe that wants a fixed frame', () => {
    const view = viewpointFor(worm(), EARTHWORM, { from: world(2000 + 5000, 3000), standoff: 200 });
    expect(view.at.wx).toBeCloseTo(2200, 6);
    expect(view.height).toBeCloseTo(100 + 200 * VIEW_RISE, 6);
  });
});

describe('compassWord', () => {
  it('names the eight points, and wraps rather than falling off the end', () => {
    expect(compassWord(0)).toBe('N');
    expect(compassWord(45)).toBe('NE');
    expect(compassWord(90)).toBe('E');
    expect(compassWord(180)).toBe('S');
    expect(compassWord(270)).toBe('W');
    expect(compassWord(315)).toBe('NW');
    expect(compassWord(359)).toBe('N');
    expect(compassWord(360)).toBe('N');
    expect(compassWord(-90)).toBe('W');
    expect(compassWord(Number.NaN)).toBe('N');
  });

  it('agrees with the bearing conversion at the four quarters', () => {
    // heading 0 is +wz, which is SOUTH (world/coords.ts).
    expect(compassWord(compassBearing(0))).toBe('S');
    expect(compassWord(compassBearing(Math.PI / 2))).toBe('E');
    expect(compassWord(compassBearing(Math.PI))).toBe('N');
    expect(compassWord(compassBearing(-Math.PI / 2))).toBe('W');
  });
});

describe('preferVisible', () => {
  const ground = (): number => 100;

  it('passes over a nearer buried worm for one that can actually be seen', () => {
    // The complaint in one test: the nearest animal in a forest is
    // usually a worm under the soil, and being taken to it is being
    // taken to a patch of dirt.
    const buried = creature('w1', 'earthworm', 1000 + 100, 2000, 100 - 5);
    const visible = creature('a1', 'aphid', 1000 + 400, 2000, 130);
    expect(nearestSighting([buried, visible], FOCUS, { groundAt: ground })?.id).toBe('w1');
    expect(nearestSighting([buried, visible], FOCUS, { groundAt: ground, preferVisible: true })?.id).toBe('a1');
  });

  it('still names the buried one when every animal in reach is buried', () => {
    const near = creature('w1', 'earthworm', 1000 + 100, 2000, 100 - 5);
    const far = creature('w2', 'earthworm', 1000 + 900, 2000, 100 - 5);
    const found = nearestSighting([far, near], FOCUS, { groundAt: ground, preferVisible: true });
    expect(found?.id).toBe('w1');
    expect(isUnderground(found!)).toBe(true);
  });

  it('changes nothing when no ground is known: nothing can be called buried', () => {
    const a = creature('w1', 'earthworm', 1000 + 100, 2000, 50);
    const b = creature('a1', 'aphid', 1000 + 400, 2000, 130);
    expect(nearestSighting([a, b], FOCUS, { preferVisible: true })?.id).toBe('w1');
  });

  it('takes the nearest visible one, not merely the first', () => {
    const list = [
      creature('a3', 'aphid', 1000 + 800, 2000, 130),
      creature('w1', 'earthworm', 1000 + 50, 2000, 100 - 5),
      creature('a1', 'aphid', 1000 + 300, 2000, 130),
      creature('a2', 'aphid', 1000 + 500, 2000, 130),
    ];
    expect(nearestSighting(list, FOCUS, { groundAt: ground, preferVisible: true })?.id).toBe('a1');
  });
});

describe('the species filter: what makes a second press show a different model', () => {
  const ground = (): number => 100;

  it('finds the nearest of ONE species, which is how a tour rotates', () => {
    // Aphids clump on a stem, so the next-nearest animal to an aphid is
    // another aphid a centimetre away: a tour by distance photographs
    // one plant ten times. Asking per species is what shows the three.
    const list = [
      creature('a1', 'aphid', 1000 + 100, 2000, 130),
      creature('a2', 'aphid', 1000 + 101, 2000, 130),
      creature('f1', 'housefly', 1000 + 600, 2000, 160),
      creature('w1', 'earthworm', 1000 + 900, 2000, 100),
    ];
    const per = (id: CreatureId): string | null =>
      nearestSighting(list, FOCUS, { groundAt: ground, preferVisible: true, species: new Set([id]) })?.id ?? null;
    expect(per('aphid')).toBe('a1');
    expect(per('housefly')).toBe('f1');
    expect(per('earthworm')).toBe('w1');
  });

  it('answers null for a species with nothing in reach, so the rotation can pass it over', () => {
    const list = [creature('a1', 'aphid', 1000 + 100, 2000, 130)];
    expect(nearestSighting(list, FOCUS, { species: new Set<CreatureId>(['housefly']) })).toBeNull();
  });

  it('a species that is only underground is recognisable as such, and skipped by the caller', () => {
    const list = [creature('w1', 'earthworm', 1000 + 50, 2000, 100 - 5)];
    const found = nearestSighting(list, FOCUS, {
      groundAt: ground, preferVisible: true, species: new Set<CreatureId>(['earthworm']),
    });
    expect(found).not.toBeNull();
    expect(isUnderground(found!)).toBe(true);
  });
});
