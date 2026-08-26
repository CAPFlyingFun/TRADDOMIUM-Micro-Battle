/**
 * THE FAR WATER — the terrain's half of the island's water.
 *
 * Past FAR_WATER the water is paint on the terrain, from a baked
 * wet-fraction mask, because the slab geometry out there is clipped by
 * 31-metre triangles into shards: measured at Joshua's own aerial fix,
 * 99.7% of the wet points within draw range lay beyond the 200 m
 * transition reach. The near half stays geometry. These tests hold the
 * three joints of that split: the mask agrees with the flow it was
 * baked from, the shader composition actually lands (a missed
 * `.replace` is silent — twice-learned lesson), and the two owners
 * fade on the SAME constants so no distance has both or neither.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeWet, farWaterShader, FAR_WATER, NEAR_WATER, type WetMask,
} from '../src/world/farWater';
import { decodeFlow, useFlow, waterLevelAt, type Flow } from '../src/world/flow';
import {
  setRelief, setSmoothing, terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeGrid, SPAN } from '../src/world/kauai';
import { DEFAULTS } from '../src/ui/settings';
import { TRANSITION_REACH } from '../src/world/TerrainStream';
import { REACH } from '../src/world/FlowWater';

const WET = fileURLToPath(new URL('../public/kauai-wet.bin', import.meta.url));
let mask: WetMask;
let flow: Flow;

beforeAll(() => {
  const g = readFileSync(fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url)));
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  setSmoothing(DEFAULTS.terrainSmoothing);
  setRelief(1);
  const f = readFileSync(fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url)));
  flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  useFlow(flow);
  const w = readFileSync(WET);
  mask = decodeWet(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer);
});

/** The mask byte covering a world point, exactly as the bake laid it. */
function wetAt(wx: number, wz: number): number {
  const i = Math.min(mask.size - 1, Math.max(0, Math.floor(((wx + SPAN / 2) / SPAN) * mask.size)));
  const j = Math.min(mask.size - 1, Math.max(0, Math.floor(((wz + SPAN / 2) / SPAN) * mask.size)));
  return mask.data[j * mask.size + i];
}

describe('the shipped wet mask', () => {
  it('decodes to the size the bake wrote', () => {
    expect(mask.size).toBe(1024);
    expect(mask.data.length).toBe(1024 * 1024);
  });

  it('refuses a file that is not a mask', () => {
    expect(() => decodeWet(new ArrayBuffer(4))).toThrow();
    const wrong = new Uint8Array(8 + 4 * 4);
    const view = new DataView(wrong.buffer);
    view.setUint32(0, 0x544d574d, false);
    view.setUint16(4, 9, true);                       // unknown version
    view.setUint16(6, 4, true);
    expect(() => decodeWet(wrong.buffer)).toThrow();
  });

  it('is wet where the flow is wet', () => {
    // Every 41st station that is genuinely underwater at its own
    // centreline must land in a texel that knows about it. The bake
    // supersamples 4x4, so a wet centreline can be as little as one
    // sixteenth of its texel — the byte just has to be nonzero.
    let checked = 0, missed = 0;
    for (let p = 0; p < flow.x.length; p += 41) {
      const level = waterLevelAt(flow.x[p], flow.z[p]);
      if (level === null || level - terrainHeight(flow.x[p], flow.z[p]) <= 10) continue;
      checked++;
      if (wetAt(flow.x[p], flow.z[p]) === 0) missed++;
    }
    expect(checked).toBeGreaterThan(300);
    // A station can straddle a texel boundary and wet the neighbour
    // instead; a few per cent of edge cases is the supersampling grid,
    // not a hole.
    expect(missed / checked).toBeLessThan(0.05);
  });

  it('is dry where the island is dry', () => {
    // A sweep of texels that are dry ACROSS THEIR WHOLE FOOTPRINT —
    // centre and all four corners out of reach of any channel — must
    // come back zero. A mask that paints dry ridges is the "floating
    // highways" bug reborn as paint. (Testing only the CENTRE was the
    // first version, and it flagged legitimate texels whose corner
    // clips a channel the centre cannot see.)
    const texel = SPAN / 1024;
    let dry = 0, painted = 0;
    for (let j = 100; j < 924; j += 7) {
      for (let i = 100; i < 924; i += 7) {
        const wx = ((i + 0.5) / 1024) * SPAN - SPAN / 2;
        const wz = ((j + 0.5) / 1024) * SPAN - SPAN / 2;
        if (terrainHeight(wx, wz) <= 0) continue;      // sea
        let touched = false;
        for (const [ox, oz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (waterLevelAt(wx + ox * texel / 2, wz + oz * texel / 2) !== null) {
            touched = true; break;
          }
        }
        if (touched) continue;
        dry++;
        if (mask.data[j * 1024 + i] > 0) painted++;
      }
    }
    expect(dry).toBeGreaterThan(5_000);
    expect(painted / dry).toBeLessThan(0.005);
  });

  it('holds no water out at sea', () => {
    for (const [i, j] of [[5, 5], [1018, 5], [5, 1018], [1018, 1018]]) {
      expect(mask.data[j * 1024 + i]).toBe(0);
    }
  });
});

describe('the far-water paint, as the terrain compiles it', () => {
  async function composed() {
    const THREE = await import('three');
    const { groundShader } = await import('../src/world/terrainMaterial');
    const ground = groundShader(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
    );
    return farWaterShader(ground.vertexShader, ground.fragmentShader);
  }

  it('lands on the real composed shader', async () => {
    const { fragmentShader } = await composed();
    // The injection, its anchor still present, and its inputs declared.
    expect(fragmentShader).toContain('texture2D(wetMask');
    expect(fragmentShader).toContain('#include <color_fragment>');
    expect(fragmentShader).toMatch(/uniform sampler2D wetMask;/);
    expect(fragmentShader).toMatch(/uniform vec2 wetSeat;/);
    // And it reads varyings the ground shader actually provides.
    expect(fragmentShader).toMatch(/varying vec3 vGround;/);
    // Painted AFTER the vertex colours multiply in (color_fragment
    // follows map_fragment in the standard shader), or the far water
    // wears the hillside's soil shading and the crossfade changes
    // colour mid-band. Order is the whole assertion.
    expect(fragmentShader.indexOf('texture2D(wetMask'))
      .toBeGreaterThan(fragmentShader.indexOf('diffuseColor.rgb *= ground;'));
    expect(fragmentShader.indexOf('texture2D(wetMask'))
      .toBeGreaterThan(fragmentShader.indexOf('#include <color_fragment>'));
  });

  it('fades in on exactly the constants the geometry fades out on', async () => {
    const { fragmentShader } = await composed();
    expect(fragmentShader).toContain(
      `smoothstep(${NEAR_WATER}.0, ${FAR_WATER}.0, length(vViewPosition))`);
    // The other half, read out of FlowWater's COMPOSED shader — a
    // source substring was the first version of this check and a
    // reviewer rightly refused it: the water's fade lives in a template
    // literal, so only the built string proves what the GPU gets.
    const THREE = await import('three');
    const { waterShader } = await import('../src/world/FlowWater');
    const water = waterShader(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
    );
    expect(water.fragmentShader).toContain(
      `1.0 - smoothstep(${NEAR_WATER}.0, ${FAR_WATER}.0, length(vViewPosition))`);
  });

  it('keeps the crossfade a genuine handoff', () => {
    // The contract in one inequality: geometry alpha share plus paint
    // share is exactly 1 at every distance, because both are the same
    // smoothstep. If someone retunes one side's constants alone, the
    // source checks above fail before this can quietly become a band
    // of doubled or missing water.
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (const d of [0, NEAR_WATER, (NEAR_WATER + FAR_WATER) / 2, FAR_WATER, 10 * FAR_WATER]) {
      const paint = smooth(NEAR_WATER, FAR_WATER, d);
      const geometry = 1 - smooth(NEAR_WATER, FAR_WATER, d);
      expect(paint + geometry).toBeCloseTo(1, 12);
    }
    // The geometry's build box must outlast the walk between rebuilds:
    // follow() only rebuilds on a 50,000-unit decision-cell crossing,
    // so slabs can be built around a spot up to 50,000 units behind
    // her, and the box has to still cover everything the crossfade can
    // show from where she now stands. 40,000 shipped for about an hour
    // and meant water missing at her feet at a cell edge.
    expect(REACH).toBeGreaterThanOrEqual(50_000 + FAR_WATER);
    // And the band finishes INSIDE the transition tier's reach, where
    // the ground can still clip a channel — the first draft ended it
    // 50 m past that, over the middle tier's 31-metre triangles, which
    // would have kept a ring of exactly the shards this split retires.
    expect(FAR_WATER).toBeGreaterThan(NEAR_WATER);
    expect(FAR_WATER).toBeLessThan(TRANSITION_REACH);
  });
});
