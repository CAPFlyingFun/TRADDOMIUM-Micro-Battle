import { describe, expect, it } from 'vitest';
import {
  CREATURE_LOD_DEFAULTS,
  CreatureLodAdaptive,
  creatureLodIsOrdered,
  creatureLodSnapshot,
  creatureLodTextureBlend,
  creatureLodTier,
  effectiveCreatureLod,
  sanitizeCreatureLodSettings,
} from '../src/fauna/creatureLod';
import { sanitizeSettings } from '../src/ui/settingsStore';

describe('creature LOD settings', () => {
  it('sanitizes every distance in order and at one-centimetre steps', () => {
    const lod = sanitizeCreatureLodSettings({
      textureEnd: 0.367,
      solidEnd: 0.12,
      proceduralStart: -2,
      proceduralOnly: 0.101,
      mode: 'auto',
    });

    expect(lod).toEqual({
      textureEnd: 0.37,
      solidEnd: 0.38,
      proceduralStart: 0.39,
      proceduralOnly: 0.40,
      mode: 'auto',
    });
    expect(creatureLodIsOrdered(lod)).toBe(true);
    expect(effectiveCreatureLod(lod, 0.5)).toEqual({
      textureEnd: 0.185,
      solidEnd: 0.19,
      proceduralStart: 0.195,
      proceduralOnly: 0.2,
    });
  });

  it('fills the nested default when an old settings document has no LOD field', () => {
    const settings = sanitizeSettings({ fov: 70 });
    expect(settings.creatureLod).toEqual(CREATURE_LOD_DEFAULTS);
  });

  it('classifies the approved texture, solid and procedural boundaries', () => {
    expect(creatureLodTier(0.20)).toBe('textured');
    expect(creatureLodTier(0.21)).toBe('solid');
    expect(creatureLodTier(0.45)).toBe('solid');
    expect(creatureLodTier(0.46)).toBe('procedural');
  });

  it('blends texture to matching solid colour continuously at ordered endpoints', () => {
    const custom = sanitizeCreatureLodSettings({
      textureEnd: 0.10,
      solidEnd: 0.30,
      proceduralStart: 0.50,
      proceduralOnly: 0.70,
    });
    expect(creatureLodTextureBlend(0.10, custom)).toBe(0);
    expect(creatureLodTextureBlend(0.20, custom)).toBeCloseTo(0.5);
    expect(creatureLodTextureBlend(0.30, custom)).toBe(1);
    expect(creatureLodTextureBlend(0.40, custom)).toBe(1);
  });
});

describe('creature LOD adaptation', () => {
  it('degrades only after sustained poor frame times and recovers more slowly', () => {
    const adaptive = new CreatureLodAdaptive();
    for (let i = 0; i < 180; i += 1) adaptive.update(40, 1 / 60);
    const degraded = adaptive.state();
    expect(degraded.level).toBeGreaterThan(0);
    expect(degraded.multiplier).toBeLessThan(1);

    const acceptedBefore = degraded.acceptedFrames;
    const ignoredBefore = degraded.ignoredFrames;
    adaptive.update(1000, 1, { loading: true });
    adaptive.update(40, 1, { hidden: true });
    expect(adaptive.state().acceptedFrames).toBe(acceptedBefore);
    expect(adaptive.state().ignoredFrames).toBe(ignoredBefore + 2);

    for (let i = 0; i < 1200; i += 1) adaptive.update(1000 / 60, 1 / 60);
    expect(adaptive.state().level).toBeLessThan(degraded.level);
  });

  it('keeps ALL/raw mode as an explicit adaptation bypass', () => {
    const adaptive = new CreatureLodAdaptive();
    for (let i = 0; i < 180; i += 1) adaptive.update(45, 1 / 60);
    const bypassed = adaptive.state(true);
    expect(bypassed.bypassed).toBe(true);
    expect(bypassed.level).toBeGreaterThan(0);
    expect(creatureLodSnapshot({ ...CREATURE_LOD_DEFAULTS, mode: 'auto' }, bypassed).effective)
      .toEqual({
        textureEnd: CREATURE_LOD_DEFAULTS.textureEnd,
        solidEnd: CREATURE_LOD_DEFAULTS.solidEnd,
        proceduralStart: CREATURE_LOD_DEFAULTS.proceduralStart,
        proceduralOnly: CREATURE_LOD_DEFAULTS.proceduralOnly,
      });
  });

  it('can observe Manual FPS without changing its adaptive level', () => {
    const adaptive = new CreatureLodAdaptive();
    for (let i = 0; i < 240; i += 1) adaptive.observe(40, 1 / 60);
    expect(adaptive.state().fps).toBeLessThan(45);
    expect(adaptive.state().level).toBe(0);
  });
});