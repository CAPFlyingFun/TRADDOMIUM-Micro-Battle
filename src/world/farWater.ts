/**
 * THE FAR WATER IS PAINT, NOT GEOMETRY.
 *
 * ChatGPT's architecture review said the quiet part well: the visible
 * river, the physical river, and the terrain holding it kept being
 * computed by different code, and every water bug of this project has
 * been two of those disagreeing. The v0.0.52 coverage work closed the
 * gaps between the slab and the collision index — and the AERIAL
 * screenshots stayed broken, because from two hundred metres up the
 * slabs sit over the MIDDLE terrain tier, whose 31-metre triangles
 * clip a flat sheet into turquoise shards. No amount of slab tuning
 * fixes that: the ground under the water simply is not resolved out
 * there, by design, and never will be.
 *
 * So ownership is split by DISTANCE, which is the one axis the two
 * failure modes never share:
 *
 *   within NEAR_WATER   the slabs draw, clipped by terrain fine
 *                       enough to clip them — walking, drinking,
 *                       swimming, diving all live here
 *   past FAR_WATER      the TERRAIN wears the water as colour, from a
 *                       baked wet-fraction mask, one texel per 54.7 m
 *                       — which is the right resolution for a view
 *                       where a texel is smaller than a pixel
 *   between             the two crossfade on one shared pair of
 *                       constants, so there is no distance at which
 *                       both or neither own a pixel
 *
 * A texture was the WRONG answer for near depth (a 12 m trench is a
 * quarter of a texel — see FlowWater's history) and is the RIGHT one
 * for far presence. Same tool, opposite verdicts, decided by what a
 * texel spans on screen.
 *
 * The mask rides the terrain's own fragment shader, so it cannot
 * z-fight, cannot shard, and costs no geometry. And it reaches the
 * BACKDROP tier, so rivers now read to the horizon — water used to
 * stop existing entirely two kilometres out, which was "spots look
 * like land but turn into water when I try to land on it".
 */
import * as THREE from 'three';
import { SPAN } from './kauai';
import { pullBuffer } from './fetchBytes';
import { assetBytes } from '../ui/assetSizes';
import type { LoadReport } from '../ui/loadPlan';

export const WET_URL = 'kauai-wet.bin';

/** Inside this eye distance the water is geometry, full strength. */
export const NEAR_WATER = 12_000;
/**
 * Past this it is terrain paint, full strength.
 *
 * STRICTLY INSIDE THE TRANSITION TIER'S 20,000-unit reach, and that is
 * the review catch that mattered: the first draft put this at 25,000,
 * which left a 50-metre ring where half-faded slabs still drew over
 * the MIDDLE tier's 31-metre triangles — the exact shard zone this
 * whole split exists to retire. The geometry must be GONE while the
 * ground under it can still clip a channel. tests/farWater.test.ts
 * holds this against TRANSITION_REACH itself.
 */
export const FAR_WATER = 19_000;

/**
 * The wet-fraction mask, flat zero until the real one arrives — a
 * 1x1 black texel is "no water anywhere", so the terrain simply has
 * no far water for the first second rather than a recompile later.
 */
export const wetMaskUniform: { value: THREE.Texture } = (() => {
  const flat = new THREE.DataTexture(
    new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
  );
  flat.needsUpdate = true;
  return { value: flat };
})();

/**
 * The floating origin's CURRENT seat, un-folded.
 *
 * The band offset next to this in terrainMaterial is a per-tile
 * remainder, which is right for tiling and useless for the mask: the
 * mask is one picture of the whole island, so it needs the whole
 * origin. Float32 at 2.8 million units is exact to a quarter of a
 * unit, and a texel is 5,470 of them.
 */
export const wetSeatUniform = { value: new THREE.Vector2() };

/** Decoded mask: side length and row-major wet fractions, 0-255. */
export interface WetMask { readonly size: number; readonly data: Uint8Array; }

export function decodeWet(buffer: ArrayBuffer): WetMask {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, false) !== 0x544d574d) {
    throw new Error('not a TMWM wet mask');
  }
  if (view.getUint16(4, true) !== 1) throw new Error('unknown wet mask version');
  const size = view.getUint16(6, true);
  if (buffer.byteLength !== 8 + size * size) throw new Error('wet mask truncated');
  return { size, data: new Uint8Array(buffer, 8, size * size) };
}

/** The plan's name for the mask's download. */
export const WET_JOB = 'far-water';

export function planFarWater(report: LoadReport): void {
  const baked = assetBytes(WET_URL);
  report.add(WET_JOB, 'Far water', baked ?? 1_048_584, true, baked !== null);
}

/** Fetch the mask and swap it in. Failure leaves the far water dry. */
export function loadWetMask(report?: LoadReport): void {
  void pullBuffer(
    `${import.meta.env.BASE_URL}${WET_URL}`,
    (size) => report?.resize(WET_JOB, size),
    (got) => report?.advance(WET_JOB, got),
  ).then((buffer) => {
    const mask = decodeWet(buffer);
    const tex = new THREE.DataTexture(
      mask.data, mask.size, mask.size, THREE.RedFormat, THREE.UnsignedByteType,
    );
    // MIPPED, which is why the bake is 1024 and not the grid's 1025:
    // a power of two is what lets the far rivers average down instead
    // of shimmering at grazing angles. Clamped so the sea beyond the
    // island's edge can never wrap a river back in from the far side.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    wetMaskUniform.value = tex;
    report?.finish(WET_JOB);
  }).catch((why) => {
    console.warn('the far-water mask did not load', why);
    report?.finish(WET_JOB);
  });
}

/**
 * The far-water injection, on its own where a test can reach it.
 *
 * Composes AFTER terrainMaterial's ground shader: the anchor is the
 * last line of that injection, so a rename there is a missed replace
 * here — and a missed replace is silent, which is why
 * tests/farWater.test.ts runs the real composition and checks this
 * landed. (The water shader has already been through that lesson
 * twice; see FlowWater.)
 */
export function farWaterShader(
  vert: string, frag: string,
): { vertexShader: string; fragmentShader: string } {
  const fragmentShader =
    'uniform sampler2D wetMask;\nuniform vec2 wetSeat;\n'
    + frag.replace('#include <color_fragment>', `#include <color_fragment>
        {
          // AFTER color_fragment ON PURPOSE: that include multiplies
          // the terrain's vertex colours in — soil tint, relief mottle
          // — and painting before it left the far water wearing the
          // hillside's shading. The slab water never does, so the
          // handoff changed colour mid-crossfade. Here the tone is the
          // water's own, and the 8% of ground still showing through
          // matches the slab's own 0.92 ceiling.
          //
          // One picture of the whole island: world position over SPAN.
          vec2 wuv = (vGround.xz + wetSeat) / ${SPAN}.0 + 0.5;
          float wet = texture2D(wetMask, wuv).r;
          // The mask's HALF of the crossfade; FlowWater's alpha holds
          // the complement of the same smoothstep, so at every eye
          // distance exactly one owner is at full strength.
          float owns = smoothstep(${NEAR_WATER}.0, ${FAR_WATER}.0, length(vViewPosition));
          // Wet FRACTION shapes both tone and strength: a thin stream
          // is a faint light-teal line, the Wailua a strong dark one,
          // a pond solid — which is what drainage looks like from the
          // air. The tones are FlowWater's own shallow and deep, so
          // the handoff does not change the water's colour.
          vec3 tone = mix(vec3(0.13, 0.34, 0.25), vec3(0.020, 0.105, 0.080), wet);
          diffuseColor.rgb = mix(diffuseColor.rgb, tone, min(0.92, wet * 1.8) * owns);
        }`);
  return { vertexShader: vert, fragmentShader };
}
