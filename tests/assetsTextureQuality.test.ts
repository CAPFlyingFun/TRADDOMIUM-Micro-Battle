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
  MAX_MOBILE_TIER, MOBILE_TIERS, TEXTURE_QUALITY, TEXTURE_TIERS, TIER_FOR_QUALITY, TIER_QUERY_PARAM,
  isTextureTier, resolveTier, textureBytes, textureSize, tierFor, tierToUse, type TextureTier,
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

/**
 * THE ADDRESS-BAR OVERRIDE — how ultra-low becomes testable on a phone.
 *
 * CLAUDE.md carries a standing requirement from Joshua for the ocean:
 * "testable at medium, low and ultra-low on his phone". The player's
 * setting names three levels and none of them is ultra-low, by the
 * deliberate design at the top of this module — so without a way in by
 * address, that requirement is simply unmet, and a rung nobody can select
 * is a rung nobody can test.
 */
describe('the tier override', () => {
  it('names the parameter once, so the reader and the writer cannot disagree', () => {
    expect(TIER_QUERY_PARAM).toBe('tier');
  });

  it('REACHES ULTRA-LOW, which is the whole reason it exists', () => {
    // The requirement, as a test. `tierFor` cannot return this rung from
    // any of the player's three levels; the override can.
    expect(resolveTier('ultra-low', tierFor('medium'))).toBe('ultra-low');
    expect(Object.values(TIER_FOR_QUALITY)).not.toContain('ultra-low');
  });

  it('reaches every rung on the ladder, so one build can sweep all five', () => {
    for (const tier of TEXTURE_TIERS) {
      expect(resolveTier(tier, 'medium')).toBe(tier);
    }
  });

  it('falls back to the player’s choice when the address bar says nothing', () => {
    expect(resolveTier(null, 'low')).toBe('low');
    expect(resolveTier(null, tierFor('high'))).toBe('high');
  });

  it('IGNORES a value that is not a rung rather than refusing to start', () => {
    // It arrives from an address bar, where a typo is ordinary, and the
    // HUD prints the rung actually in use — so a typo shows up as the
    // wrong word on screen rather than as a phone that will not open.
    for (const junk of ['ULTRA-LOW', 'ultralow', 'potato', '', '512', 'ultra_low']) {
      expect(resolveTier(junk, 'medium'), junk).toBe('medium');
    }
  });

  it('narrows rather than casts, so a caller gets a TextureTier or nothing', () => {
    expect(isTextureTier('ultra-high')).toBe(true);
    expect(isTextureTier('medium')).toBe(true);
    expect(isTextureTier('potato')).toBe(false);
    expect(isTextureTier(null)).toBe(false);
    expect(isTextureTier(512)).toBe(false);
    expect(isTextureTier(undefined)).toBe(false);
  });

  it('offers a phone every rung the ladder says a phone may have', () => {
    // The override is a testing door, not a way past the honesty rule:
    // ULTRA_HIGH is still not something a phone build offers a player.
    expect(MOBILE_TIERS).not.toContain('ultra-high');
    expect(MOBILE_TIERS).toContain('ultra-low');
  });
});
