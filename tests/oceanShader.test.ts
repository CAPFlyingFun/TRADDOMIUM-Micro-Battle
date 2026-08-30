/**
 * THE OCEAN'S SHADER IS PINNED, because the fresh window shares it.
 *
 * `waterLook.makeWaterLook` builds one material for a hillside pool
 * and for the Pacific. Every inland fix therefore edits the file the
 * ocean compiles, and the project has already shipped a build where
 * "this only moves the fresh path" was a claim nobody could check —
 * v0.0.113's three-decimal emission was motivated purely by a
 * freshwater constant and rewrote the ocean's source text too (values
 * identical, by luck of the numbers rather than by design).
 *
 * So the ocean's two sheets are emitted here exactly as Ocean.ts
 * builds them and held against committed fixtures, byte for byte.
 * CLAUDE.md's standing rule is that the ocean's look is accepted and
 * protected; this is that rule with teeth. If you changed waterLook
 * and this fails, you changed the ocean — decide whether you meant to
 * before you update the fixture.
 *
 * The fixtures hold BOTH STAGES and nothing else, because that is
 * what decides pixels. The cache key and the uniform list are
 * identity rather than pixels and are asserted separately.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emitShader, oceanFar, oceanNear, FRESH_SKIN } from './support/waterShader';

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}.glsl`, 'utf8');

describe('the ocean compiles what it compiled', () => {
  it('draws the far sheet with the same shader, byte for byte', () => {
    expect(oceanFar().source).toBe(fixture('ocean-far'));
  });

  it('draws the near sheet with the same shader, byte for byte', () => {
    expect(oceanNear().source).toBe(fixture('ocean-near'));
  });

  it('and the sea keeps the swell it is drawn from', () => {
    // The ocean's breakers ride the wave table — that is the whole
    // point of them, and no inland gate may take it away.
    for (const sheet of [oceanFar(), oceanNear()]) {
      expect(sheet.uniforms).toContain('uWaveAmp');
      expect(sheet.source).toContain('float breaker');
      expect(sheet.source).toContain('swSlope');
    }
    // The near sheet is the one that RIDES the swell in its vertices.
    expect(oceanNear().source).toContain('uWaveAmp[');
  });

  it('never shares a compiled program with fresh water', () => {
    // The cache key must separate every material whose SOURCE differs,
    // or three.js hands one wearer the other's program.
    const fresh = emitShader(FRESH_SKIN);
    const keys = [oceanFar().key, oceanNear().key, fresh.key];
    expect(new Set(keys).size).toBe(3);
    expect(fresh.source).not.toBe(oceanFar().source);
  });
});
