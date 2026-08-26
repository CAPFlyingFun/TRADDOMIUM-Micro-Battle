/**
 * THE SHADER THE WATER ACTUALLY COMPILES.
 *
 * Seven `.replace` calls against three.js's own source, and a replace
 * that misses is not an error — it is silence, and the water comes back
 * subtly wrong from a clean build. Both silent misses this project has
 * shipped were of exactly this shape: a varying three.js only declares
 * when the material has a map, which failed to link and drew every
 * stream black; and an `#ifdef` on a macro that no longer existed,
 * which compiled perfectly and left the water fighting the land for the
 * same pixels for three releases.
 *
 * Nothing here compiles GLSL — that needs a GPU. What it checks is the
 * two things a missed replace breaks: that the injection is there at
 * all, and that every name the injected code reads is declared ahead of
 * it.
 */
import { describe, expect, it } from 'vitest';
import {
  EDGE_FADE, RIPPLE_SCALES, SURFACE_ALPHA, waterShader,
} from '../src/world/waterLook';

async function built() {
  const THREE = await import('three');
  return waterShader(
    THREE.ShaderLib.standard.vertexShader,
    THREE.ShaderLib.standard.fragmentShader,
  );
}

describe('the water shader', () => {
  it('still has the include points it replaces', async () => {
    const THREE = await import('three');
    // If three.js renames one of these, every injection hanging off it
    // vanishes without a word.
    for (const chunk of ['common', 'normal_fragment_begin', 'color_fragment']) {
      expect(THREE.ShaderLib.standard.fragmentShader).toContain(`#include <${chunk}>`);
    }
    for (const chunk of ['common', 'begin_vertex']) {
      expect(THREE.ShaderLib.standard.vertexShader).toContain(`#include <${chunk}>`);
    }
  });

  it('landed every injection', async () => {
    const { vertexShader, fragmentShader } = await built();
    expect(fragmentShader).toContain('texture2D(ripple');
    expect(fragmentShader).toContain('discard;');
    expect(fragmentShader).toContain('diffuseColor.a =');
    expect(vertexShader).toContain('v_rise = rise;');
    expect(vertexShader).toContain('v_world =');
    // Each injection sits AFTER the chunk it replaced, never instead of
    // it: dropping three.js's own code breaks the material in ways that
    // have nothing to do with water.
    for (const chunk of ['common', 'normal_fragment_begin']) {
      expect(fragmentShader).toContain(`#include <${chunk}>`);
    }
    expect(vertexShader).toContain('#include <begin_vertex>');
  });

  it('reads `normal` only after three.js has declared it', async () => {
    // THE ONE THIS FILE COULD NOT CATCH, AND NOW CAN. The colour work
    // first sat on `color_fragment`, which three.js reads EARLIER in
    // its standard shader than `normal_fragment_begin` — where `normal`
    // comes into existence. Every string assertion above passed while
    // the driver rejected the program outright with "'normal' :
    // undeclared identifier", and every river on the island drew
    // nothing. A GLSL scope error needs a compiler to see properly, but
    // the ORDER is checkable here for nothing.
    const { fragmentShader } = await built();
    const declared = fragmentShader.indexOf('#include <normal_fragment_begin>');
    expect(declared).toBeGreaterThan(-1);
    const reads = fragmentShader.indexOf('dot(normalize(-v_eye), normal)');
    expect(reads).toBeGreaterThan(declared);
    // And nothing we inject may read it before that point.
    expect(fragmentShader.slice(0, declared)).not.toContain('v_eye), normal');
  });

  it('declares every name the injected code reads', async () => {
    const { vertexShader, fragmentShader } = await built();
    for (const name of ['v_rise', 'v_flow', 'v_world', 'v_eye', 'clock', 'ripple']) {
      expect(fragmentShader).toMatch(new RegExp(`(varying|uniform)[^;]*\\b${name}\\b`));
    }
    // A varying has to be declared AND WRITTEN on the vertex side, or
    // it reads as zero and the failure is a look rather than an error.
    // This is the exact shape of the vUv bug.
    for (const name of ['v_rise', 'v_flow', 'v_world', 'v_eye']) {
      expect(vertexShader).toMatch(new RegExp(`varying[^;]*\\b${name}\\b`));
      expect(vertexShader).toMatch(new RegExp(`\\b${name}\\s*=`));
    }
    // And every attribute it reads must be one the geometry supplies.
    const asked = [...vertexShader.matchAll(/attribute float (\w+);/g)].map((m) => m[1]);
    expect(new Set(asked)).toEqual(new Set(['rise', 'flowx', 'flowz']));
  });

  it('asks for the attributes the geometry actually builds', async () => {
    // THE CROSS-CHECK NOTHING ELSE MAKES. The shader names its
    // attributes in a string and WaterSurface names them in another,
    // and nothing has ever compared the two. A typo in either is a dead
    // ripple or a black stream, with a clean build either way.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../src/world/WaterSurface.ts', import.meta.url)), 'utf8');
    const { vertexShader } = await built();
    for (const m of vertexShader.matchAll(/attribute float (\w+);/g)) {
      expect(src).toContain(`setAttribute('${m[1]}'`);
    }
  });
});

describe("the ripple's octaves", () => {
  it('samples the map at four scales', () => {
    expect(RIPPLE_SCALES).toHaveLength(4);
  });

  it('shares no factor between any two of them', () => {
    // Beyond Extinction shipped a cosine version of this whose own
    // comment records it beating "into a hard diamond grid/moiré
    // (playtest)". Coprime scales are what stop the repeats coming into
    // register — and rounding 263 and 127 to 250 and 125 would hand the
    // water its grid back while looking fine in a still.
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (let i = 0; i < RIPPLE_SCALES.length; i++) {
      for (let j = i + 1; j < RIPPLE_SCALES.length; j++) {
        expect(Number.isInteger(RIPPLE_SCALES[i])).toBe(true);
        expect(gcd(RIPPLE_SCALES[i], RIPPLE_SCALES[j])).toBe(1);
      }
    }
  });

  it('turns each one by a different angle', async () => {
    const { fragmentShader } = await built();
    const turns = [...fragmentShader.matchAll(/tmbSpin\(([\d.]+),/g)].map((m) => m[1]);
    expect(turns).toHaveLength(4);
    expect(new Set(turns).size).toBe(4);
  });

  it('keeps every wavelength something she could see', () => {
    // She is one unit long. Finer than a few units is noise she can
    // never resolve and that aliases in the distance; coarser than a
    // stream is wide stops reading as a ripple at all.
    for (const scale of RIPPLE_SCALES) {
      expect(scale).toBeGreaterThan(10);
      expect(scale).toBeLessThan(480);
    }
  });
});

describe('the shoreline fade', () => {
  it('goes to nothing at nothing, and is opaque by a body length', () => {
    const alphaAt = (d: number) => {
      const t = Math.min(1, Math.max(0, d / EDGE_FADE));
      return SURFACE_ALPHA * (t * t * (3 - 2 * t));
    };
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(EDGE_FADE)).toBeCloseTo(SURFACE_ALPHA, 6);
    // IT WAS 45 cm ONCE, on an island whose median stream is 50 deep —
    // so the ramp covered the entire depth range the water had and the
    // shallow rim came out at a mean alpha of 0.11. Joshua, both halves
    // in one sentence: the edges look almost clear, and the water does
    // not appear to reach the land.
    expect(EDGE_FADE).toBeLessThan(15);
    expect(alphaAt(EDGE_FADE / 2)).toBeGreaterThan(0.3);
  });
});
