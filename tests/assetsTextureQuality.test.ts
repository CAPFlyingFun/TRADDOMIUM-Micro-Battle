/**
 * THE TEXTURE LADDER, AND THE TWO THINGS THAT WOULD QUIETLY ROT.
 *
 * The ladder is a decision recorded before there is any content to bake
 * (`src/assets/textureQuality.ts`), so nothing exercises it yet and
 * nothing would notice if it drifted. Two drifts are worth a test:
 *
 *  1. The rungs stop being powers of two, a quarter apart. The whole
 *     point of the ladder is that each step down is a quarter of the
 *     memory; a rung of 640 would be neither, and mipmapping is not
 *     guaranteed for a non-power-of-two texture on older mobile GPUs.
 *  2. The player's quality setting and this file stop agreeing. The map
 *     is written with plain string keys on purpose (assets/ may not
 *     import a screen's document), which is exactly the kind of thing
 *     that goes stale when a fourth quality level is added.
 *
 * And the one that matters most on a phone: ULTRA HIGH IS NOT OFFERED
 * THERE. That is not a preference, it is a tab the OS kills.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_MOBILE_TIER, MOBILE_TIERS, TEXTURE_QUALITY, TEXTURE_TIERS, TIER_FOR_QUALITY,
  textureBytes, textureSize, tierFor, tierToUse, type TextureTier,
} from '../src/assets/textureQuality';
import { QUALITY_LEVELS, isQuality } from '../src/ui/settingsStore';

const MIB = 1024 * 1024;

describe('the ladder', () => {
  it('is Joshua’s five rungs, coarsest first, at the sizes he set', () => {
    expect(TEXTURE_TIERS).toEqual(['ultra-low', 'low', 'medium', 'high', 'ultra-high']);
    expect(TEXTURE_TIERS.map(textureSize)).toEqual([128, 256, 512, 1024, 2048]);
  });

  it('is powers of two, each rung double the side and a quarter of the memory of the next', () => {
    for (const tier of TEXTURE_TIERS) {
      const size = textureSize(tier);
      // A power of two: mipmaps and wrap modes are not guaranteed otherwise on older mobile GPUs.
      expect(Number.isInteger(Math.log2(size))).toBe(true);
    }
    for (let i = 1; i < TEXTURE_TIERS.length; i += 1) {
      const below = TEXTURE_TIERS[i - 1];
      const above = TEXTURE_TIERS[i];
      expect(textureSize(above)).toBe(textureSize(below) * 2);
      expect(textureBytes(above)).toBeCloseTo(textureBytes(below) * 4, -2);
    }
  });

  it('every rung says what it is for, and names itself', () => {
    for (const tier of TEXTURE_TIERS) {
      const spec = TEXTURE_QUALITY[tier];
      expect(spec.tier).toBe(tier);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.note.length).toBeGreaterThan(20);
    }
  });
});

describe('what a texture costs', () => {
  it('counts RGBA bytes, and the mip chain by default', () => {
    // 2048 x 2048 x 4 = 16 MiB flat; the mip chain sums to 4/3 of that.
    expect(textureBytes('ultra-high', false)).toBe(16 * MIB);
    expect(textureBytes('ultra-high')).toBe(Math.round((16 * MIB * 4) / 3));
    expect(textureBytes('high', false)).toBe(4 * MIB);
    expect(textureBytes('ultra-low', false)).toBe(64 * 1024);
  });

  it('makes the reason ultra high is desktop-only a number, not an opinion', () => {
    // About 21 MiB each: four of them is most of a mid-range phone's
    // texture budget, and the tab is killed rather than slowed.
    expect(textureBytes('ultra-high') / MIB).toBeGreaterThan(20);
    expect(textureBytes('high') / MIB).toBeLessThan(6);
  });
});

describe('what a phone may be offered', () => {
  it('offers every rung but ultra high', () => {
    expect(MOBILE_TIERS).toEqual(['ultra-low', 'low', 'medium', 'high']);
    expect(MOBILE_TIERS).not.toContain('ultra-high');
    expect(TEXTURE_QUALITY['ultra-high'].mobile).toBe(false);
  });

  it('names the ceiling, and the ceiling is one of the rungs a phone may have', () => {
    expect(MAX_MOBILE_TIER).toBe('high');
    expect(MOBILE_TIERS).toContain(MAX_MOBILE_TIER);
    expect(MOBILE_TIERS[MOBILE_TIERS.length - 1]).toBe(MAX_MOBILE_TIER);
  });

  it('holds a setting carried over from a desktop down to what the phone can hold', () => {
    // It clamps rather than refusing: a preference synced from another
    // device must not leave a player with a black screen and no way back.
    expect(tierToUse('ultra-high', true)).toBe('high');
    expect(tierToUse('ultra-high', false)).toBe('ultra-high');
    for (const tier of MOBILE_TIERS) {
      expect(tierToUse(tier, true)).toBe(tier);
      expect(tierToUse(tier, false)).toBe(tier);
    }
  });
});

describe('the player’s setting and the ladder agree', () => {
  it('maps every quality level the settings document offers, and invents none', () => {
    // The map is keyed by plain strings because assets/ may not import a
    // screen's document; this is what keeps the two lists honest.
    expect(Object.keys(TIER_FOR_QUALITY).sort()).toEqual([...QUALITY_LEVELS].sort());
    for (const level of QUALITY_LEVELS) {
      expect(isQuality(level)).toBe(true);
      const tier: TextureTier = tierFor(level);
      expect(TEXTURE_TIERS).toContain(tier);
      // A level the player can choose must be one a phone may be offered.
      expect(TEXTURE_QUALITY[tier].mobile).toBe(true);
    }
  });

  it('rises with the setting, so HIGH is never coarser than LOW', () => {
    const rung = (level: (typeof QUALITY_LEVELS)[number]): number => TEXTURE_TIERS.indexOf(tierFor(level));
    expect(rung('low')).toBeLessThan(rung('medium'));
    expect(rung('medium')).toBeLessThan(rung('high'));
  });

  it('leaves the two outer rungs outside the player’s three', () => {
    const chosen = QUALITY_LEVELS.map(tierFor);
    expect(chosen).not.toContain('ultra-low');
    expect(chosen).not.toContain('ultra-high');
  });
});
