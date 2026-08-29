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
import { FRESH_EDGE_HI, FRESH_EDGE_LO } from '../src/world/IslandWater';
import { DRAUGHT, FOOTING, wadeAt } from '../src/ant/wading';
import { useWaterQuery } from '../src/world/waterQuery';

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

describe('and its skin does not drift either', () => {
  it('writes a still flow into every vertex', () => {
    // THE OTHER HALF OF THE SAME FAULT. Gameplay flow was zeroed in
    // `spotAt` while `update` went on feeding the vertex attribute the
    // raw solver velocity, so the pond still LOOKED like it was
    // running at the very numbers that had been rejected as a current.
    // Water that does not move her must not look like it is moving.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const up = src.slice(src.indexOf('update('));
    const body = up.slice(0, up.indexOf('\n  }'));
    expect(body).toContain('this.flowAttr[i * 2] = 0;');
    expect(body).toContain('this.flowAttr[i * 2 + 1] = 0;');
    expect(body).not.toContain('this.sim.velocity(');
  });

  it('and is not quietly given the wind instead', () => {
    // No current means NO current. A pond's skin drifting on a breeze
    // would be a second invented current wearing a better hat, and the
    // instruction was explicit that it must not be tied to wind.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/\bwind\b/i);
  });

  it('while the sim still runs, because it says where water IS', () => {
    // Not a deletion of the hydrology — a refusal to let its velocity
    // move anything until there is a stream model worth the name.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8');
    expect(src).toContain('this.sim.step(');
    expect(src).toContain('this.sim.depth');
  });
});

describe('the drawn film is never thinner than the bed is accurate', () => {
  /**
   * HOW FAR THE MESH'S BED CAN STAND ABOVE THE GROUND SHE IS ON.
   *
   * The two are different computations and neither is wrong. The query
   * adds the water column to `groundHeight` at her exact position — the
   * 8-unit triangle she stands on. The mesh adds the same column to a
   * bed sampled every 100 units and interpolated across the quad, and
   * the chord across twelve intervening terrain vertices is not the
   * ground. Measured over a real order-5 valley, 20,736 points: more
   * than FOOTING of disagreement at 32% of them, 2.03 units at p95,
   * 6.19 at worst.
   */
  const BED_ERROR_P95 = 2.03;

  it('does not paint water it cannot place', () => {
    // THE REGRESSION THIS EXISTS FOR. v0.0.113 pulled the feather down
    // to 0.02..FOOTING so the drawn shore would meet the float line.
    // What it actually did was paint fully opaque water at depths
    // smaller than the bed's own error, so at nearly a third of
    // positions a surface stood over a queen the query correctly had
    // floating on top of it — float for a few seconds, then be under
    // it. A film thinner than the bed is accurate cannot be drawn
    // truthfully, and the honest answer is not to draw it.
    expect(FRESH_EDGE_LO).toBeGreaterThanOrEqual(BED_ERROR_P95 * 0.7);
    expect(FRESH_EDGE_HI).toBeGreaterThan(BED_ERROR_P95 * 2);
  });

  it('is v0.0.90\'s feather — the last build Joshua called good', () => {
    expect(FRESH_EDGE_LO).toBe(1.5);
    expect(FRESH_EDGE_HI).toBe(8);
  });

  it('is what the material is actually built with', () => {
    const src = readFileSync('src/world/IslandWater.ts', 'utf8');
    expect(src).toContain('edgeLo: FRESH_EDGE_LO, edgeHi: FRESH_EDGE_HI');
  });

  it('reaches the shader at full precision either way', () => {
    // Kept from the failed attempt because it is right on its own
    // terms: a feather constant rounded to one decimal is a shoreline
    // moved without changing a number.
    const look = makeWaterLook({
      green: 1, surf: 0.15, sink: false, ocean: false,
      edgeLo: FRESH_EDGE_LO, edgeHi: FRESH_EDGE_HI, midAt: 70, deepAt: 260,
      texAmp: 0.2, anisotropy: 1,
    });
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\n#include <map_fragment>\n'
        + '#include <normal_fragment_maps>\n#include <lights_fragment_end>',
      defines: {},
    };
    (look.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.fragmentShader)
      .toContain(`smoothstep(${FRESH_EDGE_LO.toFixed(3)}, ${FRESH_EDGE_HI.toFixed(3)}, depth)`);
  });

  it('leaves the OCEAN\'s feather alone — a beach shelves fast', () => {
    const src = readFileSync('src/world/Ocean.ts', 'utf8');
    expect(src).toContain('edgeLo: 35');
    expect(src).toContain('edgeHi: 95');
  });

  it('and the mesh can be asked where it is drawing, so this stays checkable', () => {
    // The instrument the audit needed and the device line reads: the
    // drawn surface out of the vertex buffer, not recomputed.
    const src = readFileSync('src/world/IslandWater.ts', 'utf8');
    expect(src).toContain('drawnSurfaceAt(wx: number, wz: number): number | null');
    expect(src).toContain('this.pos[(iy * N + ix) * 3 + 1]');
  });
});

describe('she can cross the shoreline without a wall in it', () => {
  const ramp = (depth: number) =>
    useWaterQuery(() => ({ depth, flowX: 0, flowZ: 0 }));
  afterEach(() => useWaterQuery(null));

  it('keeps her walking, slower, through the whole film', () => {
    // The rule Joshua set: a shallow visible film is fine to WADE
    // rather than float, but she must still be able to MOVE through
    // it. Pace is a ceiling, never zero, and she stays on the bed.
    let last = 1;
    for (const d of [0.02, 0.05, 0.1, 0.2, 0.3, 0.39]) {
      ramp(d);
      const w = wadeAt(0, 0);
      expect(w.afloat).toBe(false);
      expect(w.above).toBe(0);
      expect(w.pace).toBeGreaterThan(0.4);
      expect(w.pace).toBeLessThanOrEqual(last);
      last = w.pace;
    }
  });

  it('lifts her onto the surface without a jump', () => {
    // Continuity at the float line is what makes it a transition
    // rather than a step: at FOOTING she is a millimetre and a half
    // under the surface, so `above` opens from a quarter of a
    // millimetre, not from a leap.
    ramp(FOOTING - 1e-6);
    expect(wadeAt(0, 0).afloat).toBe(false);
    ramp(FOOTING);
    const on = wadeAt(0, 0);
    expect(on.afloat).toBe(true);
    expect(on.above).toBeCloseTo(FOOTING - DRAUGHT, 9);
    expect(on.above).toBeLessThan(0.3);
    expect(on.pace).toBeGreaterThan(0);
  });

});
