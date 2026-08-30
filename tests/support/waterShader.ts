/**
 * THE SHADER waterLook WOULD HAND THREE.JS, as text.
 *
 * `makeWaterLook` builds ONE material for fresh water and for the sea,
 * so any change to an ocean-only feature necessarily edits the code
 * the ocean compiles. "I only touched the fresh path" is a claim; this
 * turns it into a diff. See tests/oceanShader.test.ts.
 */
import { makeWaterLook } from '../../src/world/waterLook';

/** The look loads a foam texture, which wants a DOM the suite lacks. */
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElementNS: () => ({
        addEventListener: () => {}, removeEventListener: () => {},
      }),
    },
  });
}

/** Ocean.ts's own constants and skin, copied verbatim (Ocean.ts:66-71, 133-141). */
export const RIM_LO = 6_000;
export const RIM_HI = 7_800;
export const HAND_LO = 6_800;
export const HAND_HI = 8_200;
export const OCEAN_SKIN = {
  green: 0, surf: 1, sink: true,
  edgeLo: 35, edgeHi: 95, midAt: 700, deepAt: 2600,
  texAmp: 0.40, anisotropy: 4,
} as const;

/** And IslandWater.material()'s options (IslandWater.ts:234) — the
 *  `ocean: false` is the fresh window's whole claim on the shared
 *  look, so it belongs in the mirror. */
export const FRESH_SKIN = {
  green: 1, surf: 0.15, sink: false, ocean: false,
  edgeLo: 1.5, edgeHi: 8, midAt: 70, deepAt: 260,
  texAmp: 0.20, anisotropy: 4,
} as const;

/** What three.js would actually be handed for one water material. */
export interface Emitted {
  /** The program cache key — identity, not pixels. */
  readonly key: string;
  /** The uniform names the material binds, sorted. */
  readonly uniforms: readonly string[];
  /** BOTH STAGES, verbatim. This is the part that decides pixels. */
  readonly source: string;
}

/** Emit what three.js would compile, after onBeforeCompile has run. */
export function emitShader(opts: Parameters<typeof makeWaterLook>[0]): Emitted {
  const look = makeWaterLook(opts);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\n#include <map_fragment>\n'
      + '#include <normal_fragment_maps>\n#include <lights_fragment_end>',
    defines: {},
  };
  (look.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
  return {
    key: (look.material.customProgramCacheKey as () => string)(),
    uniforms: Object.keys(shader.uniforms).sort(),
    source: `//// VERTEX\n${shader.vertexShader}\n//// FRAGMENT\n${shader.fragmentShader}\n`,
  };
}

/** The ocean's far sheet, exactly as Ocean.ts:148 builds it. */
export const oceanFar = (): Emitted =>
  emitShader({ ...OCEAN_SKIN, hole: { lo: HAND_LO, hi: HAND_HI } });

/** The ocean's near sheet, exactly as Ocean.ts:155 builds it. */
export const oceanNear = (): Emitted => emitShader({
  ...OCEAN_SKIN,
  swell: { rimLo: RIM_LO, rimHi: RIM_HI, alphaLo: HAND_LO, alphaHi: HAND_HI },
});
