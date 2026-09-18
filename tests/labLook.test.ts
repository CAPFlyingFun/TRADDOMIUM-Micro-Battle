/**
 * THE LABORATORY'S PALETTE, CHECKED WITHOUT A GPU.
 *
 * `labLook.ts` imports no three on purpose, so everything the building's
 * look PROMISES can be asserted here in plain node: that every surface
 * the contract names has one, that the glass is the only thing you can
 * see through, that the readouts light themselves and the monitors do
 * not, that the rings are the building's one warm metal, and that the
 * emergency state is DARKER than the normal one rather than merely
 * redder.
 *
 * There is no `LabView` test and there should not be: this repo runs no
 * WebGL in vitest, and a test that constructed meshes would only be
 * asserting that three's constructors return objects. The assembly is
 * verified by a render probe.
 */
import { describe, expect, it } from 'vitest';
import type { Surface } from '../src/world/tombs/types';
import {
  FITTING, FITTING_DARK, FITTING_LIT, LIGHTING, LIGHT_MODES, LOOK, METALLIC, RING_LOOK, SURFACES,
  ambientLevel, lookFor, luminance,
} from '../src/tombs/labLook';

/** Every surface the CONTRACT names, written out by hand — so the union growing fails this file rather than sliding past it. */
const CONTRACT: readonly Surface[] = [
  'floor', 'wall', 'ceiling', 'glass', 'metal', 'desk', 'panel', 'screen', 'readout', 'accent',
];

const channels = (colour: number): { r: number; g: number; b: number } => ({
  r: (colour >> 16) & 0xff,
  g: (colour >> 8) & 0xff,
  b: colour & 0xff,
});

describe('the laboratory has a look for everything it is made of', () => {
  it('covers every surface in the contract, and invents none', () => {
    expect([...SURFACES].sort()).toEqual([...CONTRACT].sort());
  });

  it('gives every surface finite, in-range numbers', () => {
    for (const surface of CONTRACT) {
      const look = lookFor(surface);
      expect(Number.isInteger(look.colour), surface).toBe(true);
      expect(look.colour, surface).toBeGreaterThanOrEqual(0);
      expect(look.colour, surface).toBeLessThanOrEqual(0xffffff);
      expect(look.roughness, surface).toBeGreaterThanOrEqual(0);
      expect(look.roughness, surface).toBeLessThanOrEqual(1);
      expect(look.metalness, surface).toBeGreaterThanOrEqual(0);
      expect(look.metalness, surface).toBeLessThanOrEqual(1);
      expect(look.opacity, surface).toBeGreaterThan(0);
      expect(look.opacity, surface).toBeLessThanOrEqual(1);
      expect(look.emissiveIntensity, surface).toBeGreaterThanOrEqual(0);
    }
  });

  it('never answers undefined — and answers a surface it has never heard of with a neutral casing', () => {
    for (const surface of CONTRACT) expect(lookFor(surface)).toBe(LOOK[surface]);
    // The plan and the renderer ship as separate modules; a surface this
    // build does not know must draw grey, not throw on `.colour`.
    expect(lookFor('flumox' as Surface)).toBe(LOOK.panel);
  });

  it('is frozen, table and entries', () => {
    expect(Object.isFrozen(LOOK)).toBe(true);
    for (const surface of CONTRACT) expect(Object.isFrozen(LOOK[surface]), surface).toBe(true);
    expect(Object.isFrozen(LIGHTING)).toBe(true);
    expect(Object.isFrozen(RING_LOOK)).toBe(true);
  });
});

describe('the glass is the only thing you can see through', () => {
  it('leaves every other surface fully opaque', () => {
    const seeThrough = CONTRACT.filter((surface) => LOOK[surface].opacity < 1);
    expect(seeThrough).toEqual(['glass']);
  });

  it('keeps the port glass rather than a hole', () => {
    expect(LOOK.glass.opacity).toBeGreaterThan(0.1);
    expect(LOOK.glass.opacity).toBeLessThan(0.5);
  });
});

describe('what lights itself, and what does not', () => {
  it('lights the readouts', () => {
    expect(LOOK.readout.emissive).not.toBe(0x000000);
    expect(LOOK.readout.emissiveIntensity).toBeGreaterThan(0);
  });

  it('leaves the monitors dark — a building whose every screen glows is a set, not a workplace', () => {
    expect(LOOK.screen.emissive).toBe(0x000000);
    expect(LOOK.screen.emissiveIntensity).toBe(0);
  });

  it('emits from nothing else, and never disagrees with itself about emitting', () => {
    const emitting = CONTRACT.filter((surface) => LOOK[surface].emissiveIntensity > 0);
    expect(emitting).toEqual(['readout']);
    for (const surface of CONTRACT) {
      const look = LOOK[surface];
      expect(look.emissive === 0x000000, surface).toBe(look.emissiveIntensity === 0);
    }
  });

  it('keeps the one glow restrained', () => {
    expect(LOOK.readout.emissiveIntensity).toBeLessThanOrEqual(2);
  });
});

describe('the array\'s rings are the building\'s one warm metal', () => {
  it('reads as metal', () => {
    expect(RING_LOOK.metalness).toBeGreaterThanOrEqual(METALLIC);
  });

  it('is warm where every metallic SURFACE is cool', () => {
    const ring = channels(RING_LOOK.colour);
    expect(ring.r).toBeGreaterThan(ring.b);
    const metals = CONTRACT.filter((surface) => LOOK[surface].metalness >= METALLIC);
    expect(metals.length).toBeGreaterThan(0);
    for (const surface of metals) {
      const c = channels(LOOK[surface].colour);
      expect(c.r, surface).toBeLessThanOrEqual(c.b);
    }
  });

  it('does not light itself — a ring is lit by the room', () => {
    expect(RING_LOOK.emissive).toBe(0x000000);
    expect(RING_LOOK.opacity).toBe(1);
  });
});

describe('the room went dark', () => {
  it('has exactly the two states the contract names', () => {
    expect([...LIGHT_MODES].sort()).toEqual(['emergency', 'normal']);
  });

  it('delivers strictly less light on emergency power', () => {
    expect(ambientLevel('emergency')).toBeLessThan(ambientLevel('normal'));
    // Not marginally: the lever is a room going dark, not a colour grade.
    expect(ambientLevel('emergency')).toBeLessThan(ambientLevel('normal') / 4);
  });

  it('fades the far end of the corridor to something strictly darker too', () => {
    expect(luminance(LIGHTING.emergency.fog)).toBeLessThan(luminance(LIGHTING.normal.fog));
  });

  it('switches to red, and the normal state is not red', () => {
    const emergency = channels(LIGHTING.emergency.ambient);
    expect(emergency.r).toBeGreaterThan(emergency.g);
    expect(emergency.r).toBeGreaterThan(emergency.b);
    const normal = channels(LIGHTING.normal.ambient);
    expect(normal.r).toBeLessThan(normal.b);
  });

  /**
   * THE CEILING IS 4, AND IT USED TO BE 1 — which was an assumption about
   * three rather than a fact about it. `AmbientLight.intensity` has no
   * upper bound; 1 only reads as "sane" if you also assume the surfaces
   * are bright enough to do the rest of the work.
   *
   * They are not, and `probe:tombs` measured it: a pixel of this palette's
   * floor came back RGB(3, 6, 8) and a pixel of its wall RGB(36, 48, 46).
   * The reason is that a material's colour is sRGB and its albedo is
   * LINEAR — the floor's 0x4e5459 is 0.31 as a hex and 0.08 as an albedo —
   * so an interior with no sky in it, lit to 1, is a black room whatever
   * its palette says. Raising the floor's own colour was tried first and
   * moved the pixel by three levels; the light is the lever, not the paint.
   *
   * 4 is a bound on carelessness, not a target: what the two states have
   * to keep is the RELATIONSHIP the tests above pin, and this one only
   * stops either of them running away.
   */
  it('keeps both intensities inside a sane range', () => {
    for (const mode of LIGHT_MODES) {
      expect(LIGHTING[mode].ambientIntensity, mode).toBeGreaterThan(0);
      expect(LIGHTING[mode].ambientIntensity, mode).toBeLessThanOrEqual(4);
    }
  });
});

describe('the fittings', () => {
  it('measure a strip light and a bulkhead unit, in metres', () => {
    for (const mode of LIGHT_MODES) {
      const fitting = FITTING[mode];
      for (const side of [fitting.width, fitting.height, fitting.depth]) {
        expect(side, mode).toBeGreaterThan(0);
        expect(side, mode).toBeLessThan(2);
      }
    }
    expect(FITTING.emergency.width).toBeLessThan(FITTING.normal.width);
  });

  it('goes dark without vanishing', () => {
    expect(luminance(FITTING_DARK)).toBeLessThan(luminance(FITTING_LIT));
    expect(luminance(FITTING_DARK)).toBeGreaterThan(0);
    expect(FITTING_LIT).toBe(0xffffff);
  });
});

describe('luminance', () => {
  it('reads black, white and the Rec. 709 weights', () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBeCloseTo(1, 6);
    expect(luminance(0x00ff00)).toBeCloseTo(0.7152, 6);
    expect(luminance(0x0000ff)).toBeCloseTo(0.0722, 6);
  });

  /**
   * The two exemptions are DISPLAY FACES, not room surfaces, and both are
   * dark by design: a monitor is dark glass, and a readout's colour is
   * the BEZEL its emissive sits in. `readout` joined `screen` here when
   * `probe:tombs` photographed a floor that came back pure black in every
   * shot — the rule below had been holding the floor under a bezel rather
   * than under the building, which is not what it is for. The rule itself
   * is unchanged: of the things a room is MADE of, the floor is the
   * darkest, so light falling on it reads as light.
   */
  it('puts the floor below every surface the room is made of — a lit room reads as light falling on something', () => {
    const floor = luminance(LOOK.floor.colour);
    const faces: readonly Surface[] = ['screen', 'readout'];
    for (const surface of CONTRACT) {
      if (surface === 'floor' || faces.includes(surface)) continue;
      expect(luminance(LOOK[surface].colour), surface).toBeGreaterThan(floor);
    }
  });

  it('keeps the floor dark enough to be a floor — it is still the darkest thing underfoot', () => {
    expect(luminance(LOOK.floor.colour)).toBeLessThan(luminance(LOOK.wall.colour) / 2);
  });
});
