/**
 * The underground look is a colour and two distances, and the pins are
 * the promises the scene builds on: nothing at or above the soil, the
 * soil's own colour once in it, a fog that starts at the eye and closes
 * within centimetres, and a closing that only tightens with burial.
 */
import { describe, expect, it } from 'vitest';
import {
  BURIAL_EFOLD, FAR_DEEP, FAR_SHALLOW, SHADE_DEPTH, soilAlbedoAt, undergroundLook,
} from '../src/terrain/undergroundLook';

const BROWN = { r: 0.32, g: 0.17, b: 0.078 } as const;
const GREY = { r: 0.3, g: 0.3, b: 0.3 } as const;

describe('undergroundLook', () => {
  it('is null at or above the soil, and for a reading that failed', () => {
    expect(undergroundLook(0, BROWN)).toBeNull();
    expect(undergroundLook(-0.5, BROWN)).toBeNull();
    expect(undergroundLook(-100, BROWN)).toBeNull();
    expect(undergroundLook(Number.NaN, BROWN)).toBeNull();
    expect(undergroundLook(Number.NEGATIVE_INFINITY, BROWN)).toBeNull();
  });

  it('closes to exactly the albedo it is handed — the soil\'s colour is the caller\'s, grey for rock included', () => {
    for (const albedo of [BROWN, GREY]) {
      for (const burial of [0.01, 1.2, 4, 30]) {
        const look = undergroundLook(burial, albedo);
        expect(look).not.toBeNull();
        expect(look!.r).toBe(albedo.r);
        expect(look!.g).toBe(albedo.g);
        expect(look!.b).toBe(albedo.b);
      }
    }
  });

  it('starts at the eye and closes within a few centimetres: you are in dirt', () => {
    for (const burial of [0.001, 0.5, 3, 10, 1000]) {
      const look = undergroundLook(burial, BROWN)!;
      expect(look.near).toBe(0);
      expect(look.far).toBeGreaterThan(look.near);
      expect(look.far).toBeLessThanOrEqual(FAR_SHALLOW);
      expect(look.far).toBeGreaterThanOrEqual(FAR_DEEP);
      // A few centimetres, in world units of a centimetre each.
      expect(look.far).toBeLessThanOrEqual(10);
      expect(look.far).toBeGreaterThanOrEqual(1);
    }
  });

  it('only tightens with burial: a hair under the floor sees the most, a slope flown into the least', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let burial = 0.05; burial <= 40; burial += 0.05) {
      const look = undergroundLook(burial, BROWN)!;
      expect(look.far).toBeLessThan(previous);
      expect(look.near).toBe(0);
      previous = look.far;
    }
    // Just inside: the shallow distance. Deep: the deep one, as an e-fold approaches it.
    expect(undergroundLook(1e-9, BROWN)!.far).toBeCloseTo(FAR_SHALLOW, 6);
    expect(undergroundLook(BURIAL_EFOLD * 20, BROWN)!.far).toBeCloseTo(FAR_DEEP, 6);
  });
});

describe('soilAlbedoAt', () => {
  it('is the cut face\'s ramp: the surface colour at the ground, the dark one four centimetres down and deeper', () => {
    // These are soilMesh.ts's numbers; the two files change together.
    expect(soilAlbedoAt(0)).toEqual({ r: 0.32, g: 0.17, b: 0.078 });
    const deep = soilAlbedoAt(SHADE_DEPTH);
    expect(deep.r).toBeCloseTo(0.32 - 0.225, 9);
    expect(deep.g).toBeCloseTo(0.17 - 0.127, 9);
    expect(deep.b).toBeCloseTo(0.078 - 0.06, 9);
    expect(soilAlbedoAt(SHADE_DEPTH * 25)).toEqual(deep);
    // Half way down the ramp is half way between, in every channel.
    const half = soilAlbedoAt(SHADE_DEPTH / 2);
    expect(half.r).toBeCloseTo((0.32 + deep.r) / 2, 9);
    expect(half.g).toBeCloseTo((0.17 + deep.g) / 2, 9);
    expect(half.b).toBeCloseTo((0.078 + deep.b) / 2, 9);
  });

  it('only darkens with depth, and never below zero', () => {
    let previous = soilAlbedoAt(0);
    for (let depth = 0.1; depth <= SHADE_DEPTH * 2; depth += 0.1) {
      const albedo = soilAlbedoAt(depth);
      expect(albedo.r).toBeLessThanOrEqual(previous.r);
      expect(albedo.g).toBeLessThanOrEqual(previous.g);
      expect(albedo.b).toBeLessThanOrEqual(previous.b);
      expect(albedo.r).toBeGreaterThan(0);
      expect(albedo.g).toBeGreaterThan(0);
      expect(albedo.b).toBeGreaterThan(0);
      previous = albedo;
    }
  });

  it('reads above the ground, and a failed height, as the surface', () => {
    expect(soilAlbedoAt(-3)).toEqual(soilAlbedoAt(0));
    expect(soilAlbedoAt(Number.NaN)).toEqual(soilAlbedoAt(0));
  });
});
