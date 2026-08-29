/**
 * THE SEA IS THE SEA AND A POND IS A POND.
 *
 * Two ocean systems had leaked into fresh water, and neither was
 * caught by depth: an inland pool got the Pacific's wave table for its
 * foam, and a millimetre of film on a hillside carried her at nearly
 * four metres a second.
 *
 * The classification is TOLD, never inferred. Ground below sea level
 * is the sea; the window speaks for fresh water on land, and the
 * material is handed a flag rather than left to guess from a depth
 * that a deep lake and the ocean share.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeWaterLook } from '../src/world/waterLook';
import { resetSwell } from '../src/world/seaSwell';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

/**
 * The look loads a foam texture, which wants a DOM. The suite runs
 * without one and stubs what three.js reaches for — at module scope,
 * because these shaders compile while vitest is collecting.
 */
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElementNS: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
}

afterEach(() => { useFixedSea(); resetSwell(); });

/** The fragment source three.js would compile for this water. */
function fragmentOf(ocean: boolean): string {
  const look = makeWaterLook({
    green: ocean ? 0 : 1, surf: ocean ? 1 : 0.15, sink: ocean, ocean,
    edgeLo: 35, edgeHi: 95, midAt: 700, deepAt: 2600,
    texAmp: 0.4, anisotropy: 1,
  });
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\n#include <map_fragment>\n'
      + '#include <normal_fragment_maps>\n#include <lights_fragment_end>',
    defines: {},
  };
  (look.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
  return shader.fragmentShader;
}

describe('the swell belongs to the ocean', () => {
  it('drives the sea\'s breakers from the wave table', () => {
    const sea = fragmentOf(true);
    // The foam rides the wave that made it, which is why it travels at
    // the wave's own speed — the swell is summed right here.
    expect(sea).toContain('float breaker');
    expect(sea).toContain('swSlope');
  });

  it('and does not reach a pond', () => {
    // THE REGRESSION. This block was never gated, so a pool on a
    // hillside was given breakers off the Pacific's table — and when
    // the generated sea raised the swell's reach from 48 units to 210,
    // the inland water started reading like open ocean.
    const fresh = fragmentOf(false);
    expect(fresh).not.toContain('float breaker');
    expect(fresh).not.toContain('swSlope');
  });

  it('leaves fresh water the SAME whatever the sea is doing', () => {
    // The test with teeth: a pond must not change character because a
    // buoy reported. Two very different seas, one unchanged shader.
    resetSwell(); useFixedSea();
    const shipped = fragmentOf(false);
    resetSwell(); useProceduralSea({ worldSeed: 20260829, nowMs: 0 });
    expect(fragmentOf(false)).toBe(shipped);
    // …while the OCEAN's does follow the sea it is drawing.
    resetSwell(); useFixedSea();
    const seaShipped = fragmentOf(true);
    resetSwell(); useProceduralSea({ worldSeed: 20260829, nowMs: 0 });
    expect(fragmentOf(true)).not.toBe(seaShipped);
  });

  it('keeps the ordinary waterline foam a lake bank has', () => {
    // Gating the breakers must not take the shoreline with it.
    expect(fragmentOf(false)).toContain('float surf = smoothstep');
  });
});

describe('fresh water does not carry her', () => {
  it('answers a still current inland', () => {
    // Read at the source rather than through a scene: the freshwater
    // branch of the query is the one place a pond's flow is decided.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8');
    const spot = src.slice(src.indexOf('spotAt(wx: number'));
    const body = spot.slice(0, spot.indexOf('\n  }'));
    expect(body).toContain('flowX: 0, flowZ: 0');
    expect(body).not.toContain('v.vx');
  });

  it('because flux over depth is a singularity, not a current', () => {
    // WHY, so the next reader does not "fix" it back. The solver's
    // velocity is flux divided by depth, and depth goes to zero at the
    // edge of every pool — 368 cm/s over 1.5 mm of water on Joshua's
    // device, and worse elsewhere. A cap would hide the same nonsense
    // at a smaller number; a real stream wants its own model.
    const src = readFileSync('src/world/waterSim.ts', 'utf8');
    expect(src).toContain('velocity(');
    // The division that does it, still there and still honest.
    expect(src).toContain('/ (2 * face)');
  });

  it('and the OCEAN still carries her, which is the whole point', () => {
    // Not a global nerf: the sea's current comes from the wave table
    // and the surf, on the other branch of the query entirely.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8');
    expect(src).toContain('surfFlowAt(wx, wz, depth, surface)');
    expect(src).toContain('salt: true');
  });

  it('classifies by the ground, not by how deep the water is', () => {
    // A deep lake is not the sea. Ground below zero IS.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('const g = groundHeight(wx, wz);');
    expect(src).toContain('if (g < 0)');
  });
});
