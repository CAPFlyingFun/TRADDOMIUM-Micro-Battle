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
import { emitShader, oceanFar, FRESH_SKIN } from './support/waterShader';
import { resetSwell } from '../src/world/seaSwell';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

afterEach(() => { useFixedSea(); resetSwell(); });

const fresh = () => emitShader(FRESH_SKIN);

describe('the swell belongs to the ocean', () => {
  it('does not reach a pond', () => {
    // THE REGRESSION. This block was never gated (it dates to v0.0.88,
    // 5cf3a99, so it predates every build anyone called good), and it
    // sums seaSwell's table at the fragment's own world position — so
    // a pool on a hillside wore breakers off the Pacific, marching at
    // ~237 cm/s on the sea's beat. Live on the bare URL too: with the
    // shipped table crest reaches ±0.91 and the face smoothstep
    // saturates every beat.
    expect(fresh().source).not.toContain('float breaker');
    expect(fresh().source).not.toContain('swSlope');
  });

  it('and does not carry the sea\'s amplitudes it never reads', () => {
    // Binding a live ocean uniform to a material whose shader never
    // declares it is how the table and the program drift apart.
    expect(fresh().uniforms).not.toContain('uWaveAmp');
    expect(fresh().source).not.toContain('uWaveAmp');
  });

  it('leaves fresh water the SAME whatever the sea is doing', () => {
    // The test with teeth: a pond must not change character because a
    // buoy reported. Two very different seas, one unchanged shader.
    resetSwell(); useFixedSea();
    const shipped = fresh().source;
    resetSwell(); useProceduralSea({ worldSeed: 20260829, nowMs: 0 });
    expect(fresh().source).toBe(shipped);
    // …while the OCEAN's does follow the sea it is drawing.
    resetSwell(); useFixedSea();
    const seaShipped = oceanFar().source;
    resetSwell(); useProceduralSea({ worldSeed: 20260829, nowMs: 0 });
    expect(oceanFar().source).not.toBe(seaShipped);
  });

  it('keeps the ordinary waterline foam a lake bank has', () => {
    // Gating the breakers must not take the shoreline with it.
    expect(fresh().source).toContain('float surf = smoothstep');
  });
});

describe('fresh water does not carry her', () => {
  const source = () => readFileSync('src/world/IslandWater.ts', 'utf8');

  it('answers a still current inland', () => {
    // Read at the source rather than through a scene: the freshwater
    // branch of the query is the one place a pond's flow is decided.
    const src = source();
    const spot = src.slice(src.indexOf('spotAt(wx: number'));
    const body = spot.slice(0, spot.indexOf('\n  }'));
    expect(body).toContain('flowX: 0, flowZ: 0');
    expect(body).not.toContain('sim.velocity');
  });

  it('and its skin does not drift either', () => {
    // THE OTHER HALF OF THE SAME FAULT. Zeroing gameplay flow while
    // update() went on writing the raw solver velocity into the vertex
    // attribute would leave the surface advecting at exactly the
    // numbers just rejected as a current.
    const src = source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const up = src.slice(src.indexOf('update('));
    const body = up.slice(0, up.indexOf('\n  }'));
    expect(body).toContain('this.flowAttr[i * 2] = 0;');
    expect(body).toContain('this.flowAttr[i * 2 + 1] = 0;');
    expect(body).not.toContain('sim.velocity');
  });

  it('is not quietly given the wind instead', () => {
    // No current means NO current. A pond's skin drifting on a breeze
    // would be a second invented current in a better hat.
    const src = source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/\bwind\b/i);
  });

  it('because flux over depth is a singularity, not a current', () => {
    // WHY, so the next reader does not "fix" it back. The solver's
    // velocity is flux divided by depth, and depth goes to zero at the
    // edge of every pool — 368 cm/s over 1.5 mm on Joshua's device. A
    // cap would hide the same nonsense at a smaller number; a real
    // stream wants its own model.
    const src = readFileSync('src/world/waterSim.ts', 'utf8');
    expect(src).toContain('velocity(');
    expect(src).toContain('/ (2 * face)');
  });

  it('while the hydrology still runs, because it says where water IS', () => {
    // Not a deletion of the simulation — a refusal to let its velocity
    // move anything until there is a stream model worth the name.
    const src = source();
    expect(src).toContain('this.sim.step(');
    expect(src).toContain('this.sim.depth[i] += BASEFLOW * step;');
  });

  it('and the OCEAN still carries her, which is the whole point', () => {
    // Not a global nerf: the sea's current comes from the wave table
    // and the surf, on the other branch of the query entirely.
    const src = source();
    expect(src).toContain('surfFlowAt(wx, wz, depth, surface)');
    expect(src).toContain('salt: true');
  });

  it('classifies by the ground, not by how deep the water is', () => {
    // A deep lake is not the sea. Ground below zero IS.
    const src = source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('const g = groundHeight(wx, wz);');
    expect(src).toContain('if (g < 0)');
  });
});
