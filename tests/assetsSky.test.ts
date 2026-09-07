/**
 * THE SKY MANIFEST IS A FACT; THIS HOLDS IT TO THE FILES — the same
 * three ways `assetsTextureManifest.test.ts` guards the textures, plus
 * what is particular to a sky:
 *
 *  1. every file the manifest names exists under `public/sky/`, at the
 *     width the name promises and half that in height (equirectangular)
 *  2. the manifest agrees with the ladder: every rung, no rung above the
 *     master, coarsest first so the clamp walks DOWN
 *  3. what was MEASURED is plausible: a sun azimuth in 0..1 for each of
 *     the four, an exposure, a saturation fraction that is a sun disc
 *     and not a whited-out sky, and the licence line
 *  4. what a phone pays: all four skies at `medium` on the wire, and two
 *     resident on the GPU, both under a megabyte and a half; nothing
 *     wider than 2048
 *  5. the loader builds the URL under the deployed base and hands back a
 *     texture in the state the dome needs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BAKED_SKIES, SKY_DIR, SKY_IMAGE_IDS, SKY_LICENCE, bakedSky, skyUrl, skyWidthFor, type SkyImageId,
} from '../src/assets/skyManifest';
import { loadSky, prepareSkyTexture, skyLoaderFor } from '../src/assets/skySource';
import { MOBILE_TIERS, TEXTURE_QUALITY, TEXTURE_TIERS, type TextureTier } from '../src/assets/textureQuality';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MANIFEST = path.join(ROOT, 'src', 'assets', 'skyManifest.ts');
const RUNG_SIZES = TEXTURE_TIERS.map((tier) => TEXTURE_QUALITY[tier].size);
const MIB = 1024 * 1024;

const file = (id: SkyImageId, width: number): string => path.join(PUBLIC, SKY_DIR, `${id}-${width}.webp`);

/** The RIFF chunks of a WebP, by fourcc — see `assetsTextureManifest.test.ts` for the shapes. */
function webpChunks(name: string): Map<string, { offset: number; length: number }> {
  const bytes = readFileSync(name);
  expect(bytes.subarray(0, 4).toString('ascii'), `${name} is not RIFF`).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('ascii'), `${name} is not WEBP`).toBe('WEBP');
  const chunks = new Map<string, { offset: number; length: number }>();
  let at = 12;
  while (at + 8 <= bytes.length) {
    const fourcc = bytes.subarray(at, at + 4).toString('ascii');
    const length = bytes.readUInt32LE(at + 4);
    chunks.set(fourcc, { offset: at + 8, length });
    at += 8 + length + (length % 2);
  }
  return chunks;
}

/** The dimensions the file itself claims, and whether it is lossy. */
function webpFacts(name: string): { width: number; height: number; lossy: boolean } {
  const bytes = readFileSync(name);
  const chunks = webpChunks(name);
  const lossy = chunks.has('VP8 ');
  const extended = chunks.get('VP8X');
  if (extended) {
    const o = extended.offset + 4;
    return {
      width: (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) + 1,
      height: (bytes[o + 3] | (bytes[o + 4] << 8) | (bytes[o + 5] << 16)) + 1,
      lossy,
    };
  }
  const plain = chunks.get('VP8 ');
  if (plain) {
    const o = plain.offset + 6;
    return { width: bytes.readUInt16LE(o) & 0x3fff, height: bytes.readUInt16LE(o + 2) & 0x3fff, lossy };
  }
  const lossless = chunks.get('VP8L');
  if (lossless) {
    const bits = bytes.readUInt32LE(lossless.offset + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, lossy };
  }
  throw new Error(`${name}: no image chunk`);
}

describe('the manifest describes files that exist', () => {
  it('bakes the four skies the look chooses among, each at every rung', () => {
    expect([...SKY_IMAGE_IDS].sort()).toEqual(['clear', 'dusk', 'night', 'partly']);
    expect(BAKED_SKIES.map((s) => s.id)).toEqual([...SKY_IMAGE_IDS]);
    for (const sky of BAKED_SKIES) {
      expect(sky.widths.length, sky.id).toBeGreaterThan(0);
      for (const tier of TEXTURE_TIERS) expect(sky.widths, `${sky.id} at ${tier}`).toContain(skyWidthFor(sky.id, tier));
    }
  });

  it('has every file it claims, equirectangular at the width the name promises, encoded lossy', () => {
    for (const sky of BAKED_SKIES) {
      for (const width of sky.widths) {
        const name = file(sky.id, width);
        expect(existsSync(name), `missing ${path.relative(ROOT, name)} — run npm run bake:sky`).toBe(true);
        expect(statSync(name).size).toBeGreaterThan(0);
        expect(webpFacts(name), path.relative(ROOT, name)).toEqual({ width, height: width / 2, lossy: true });
      }
    }
  });
});

describe('the manifest agrees with the ladder', () => {
  it('bakes only rungs the ladder defines, never above the master, never skipping one below it', () => {
    for (const sky of BAKED_SKIES) {
      for (const width of sky.widths) expect(RUNG_SIZES, `${sky.id} has a ${width} that is not a rung`).toContain(width);
      const reachable = RUNG_SIZES.filter((size) => size <= sky.masterWidth).sort((a, b) => a - b);
      expect([...sky.widths], sky.id).toEqual(reachable);
    }
  });

  it('starts at the coarsest rung, which is what makes the clamp downward, and never goes down as the tier goes up', () => {
    const coarsest = Math.min(...RUNG_SIZES);
    for (const sky of BAKED_SKIES) {
      expect(sky.widths[0], sky.id).toBe(coarsest);
      let last = 0;
      for (const tier of TEXTURE_TIERS) {
        const width = skyWidthFor(sky.id, tier);
        expect(width).toBeGreaterThanOrEqual(last);
        expect(width).toBeLessThanOrEqual(TEXTURE_QUALITY[tier].size);
        last = width;
      }
    }
  });

  it('is nowhere wider than 2048', () => {
    for (const sky of BAKED_SKIES) expect(Math.max(...sky.widths), sky.id).toBeLessThanOrEqual(2048);
  });
});

describe('what was measured at bake', () => {
  it('found a sun in each sky: an azimuth as a fraction of the width, an elevation, an exposure', () => {
    for (const sky of BAKED_SKIES) {
      expect(sky.sunAzimuth, sky.id).toBeGreaterThanOrEqual(0);
      expect(sky.sunAzimuth, sky.id).toBeLessThan(1);
      expect(Math.abs(sky.sunElevation), sky.id).toBeLessThan(Math.PI / 2);
      expect(sky.exposure, sky.id).toBeGreaterThan(0);
      expect(Number.isFinite(sky.exposure), sky.id).toBe(true);
    }
    // The two day skies were photographed with the sun high and low
    // respectively; the manifest must say so, or the finder found cloud.
    expect(bakedSky('clear').sunElevation).toBeGreaterThan(60 * (Math.PI / 180));
    expect(bakedSky('partly').sunElevation).toBeLessThan(15 * (Math.PI / 180));
    expect(bakedSky('partly').sunElevation).toBeGreaterThan(0);
  });

  it('saturated a sun disc and not a sky: under a tenth of a percent of any image', () => {
    for (const sky of BAKED_SKIES) {
      expect(sky.clipped, sky.id).toBeGreaterThanOrEqual(0);
      expect(sky.clipped, sky.id).toBeLessThan(0.001);
    }
  });

  it('exposed the night darker than the day, in the manifest’s own numbers', () => {
    expect(bakedSky('night').exposure).toBeLessThan(bakedSky('dusk').exposure);
    expect(bakedSky('dusk').exposure).toBeLessThan(bakedSky('clear').exposure);
  });

  it('carries the licence, in the generated header and as a constant', () => {
    expect(SKY_LICENCE).toBe('Poly Haven, CC0');
    const source = readFileSync(MANIFEST, 'utf8');
    expect(source).toMatch(/LICENSES/);
    expect(source).toMatch(/CC0/);
    expect(source).toMatch(/DO NOT EDIT/);
    // The per-tier cost table the brief asked for, by name.
    for (const tier of TEXTURE_TIERS) expect(source).toMatch(new RegExp(`^ \\*   ${tier}\\s+\\d+ ×\\s+\\d+`, 'm'));
  });
});

describe('what this actually costs a phone', () => {
  const wire = (tier: TextureTier): number => BAKED_SKIES.reduce((sum, sky) => sum + statSync(file(sky.id, skyWidthFor(sky.id, tier))).size, 0);
  /** One resident sky: width × height × 4, no mip chain — the dome is only magnified. */
  const gpu = (tier: TextureTier): number => {
    const w = skyWidthFor('clear', tier);
    return w * (w / 2) * 4;
  };

  it('keeps all four skies at medium under a megabyte and a half on the wire, and two resident under it on the GPU', () => {
    expect(wire('medium')).toBeLessThan(1.5 * MIB);
    expect(2 * gpu('medium')).toBeLessThan(1.5 * MIB);
    // And much less than that: a sky is gradients, and WebP eats gradients.
    expect(wire('medium')).toBeLessThan(256 * 1024);
    for (const tier of MOBILE_TIERS) expect(wire(tier), tier).toBeLessThan(1.5 * MIB);
  });

  it('is a quarter the GPU bytes a rung down, so the dial has the range the ladder promises', () => {
    expect(gpu('medium') / gpu('low')).toBe(4);
    expect(gpu('high') / gpu('medium')).toBe(4);
    expect(gpu('ultra-low')).toBe(128 * 64 * 4);
  });
});

describe('the loader', () => {
  it('builds the URL in one place, honouring the deployed base', () => {
    expect(skyUrl('clear', 'medium')).toBe('/sky/clear-512.webp');
    expect(skyUrl('night', 'ultra-low')).toBe('/sky/night-128.webp');
    expect(skyUrl('dusk', 'high', '/v1/')).toBe('/v1/sky/dusk-1024.webp');
  });

  it('asks the injected loader for that URL and hands back a texture in the dome’s state', async () => {
    const asked: string[] = [];
    const texture = new THREE.Texture();
    const loader = {
      loadAsync: (url: string) => {
        asked.push(url);
        return Promise.resolve(texture);
      },
    } as unknown as THREE.TextureLoader;
    const got = await loadSky('partly', 'low', { loader, base: '/v1/' });
    expect(asked).toEqual(['/v1/sky/partly-256.webp']);
    expect(got).toBe(texture);
    expect(got.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(got.generateMipmaps).toBe(false);
    expect(got.minFilter).toBe(THREE.LinearFilter);
    expect(got.magFilter).toBe(THREE.LinearFilter);
    expect(got.wrapS).toBe(THREE.RepeatWrapping);
    expect(got.wrapT).toBe(THREE.ClampToEdgeWrapping);
    // The bound form the view takes.
    const bound = skyLoaderFor({ loader, base: '/v1/' });
    await bound('night', 'medium');
    expect(asked).toEqual(['/v1/sky/partly-256.webp', '/v1/sky/night-512.webp']);
  });

  it('rejects rather than inventing a sky when the file does not arrive', async () => {
    const loader = { loadAsync: () => Promise.reject(new Error('404')) } as unknown as THREE.TextureLoader;
    await expect(loadSky('clear', 'medium', { loader })).rejects.toThrow('404');
  });

  it('prepares idempotently', () => {
    const texture = new THREE.Texture();
    expect(prepareSkyTexture(prepareSkyTexture(texture))).toBe(texture);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
  });
});
