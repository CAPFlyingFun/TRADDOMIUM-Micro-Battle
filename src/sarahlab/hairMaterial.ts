/**
 * HER HAIR'S MATERIAL (Joshua, 2026-10-24: one hairstyle for Sarah v2, `scripts/sarahV2Recovery/hair-bake.mjs`).
 *
 * Her hair is cards: strips of strands with alpha, drawn from both sides. three lights a double-sided triangle seen
 * from behind with its normal turned round, which is right for a sheet of paper and wrong for a lock of hair: the bake
 * gives every card the normal of the VOLUME it belongs to (out from her ponytail's axis, out from her head), so a lock
 * shades as one round thing, and seen from its far side it went dark against the strands beside it. This keeps the
 * baked normal on both sides of every card. Nothing else of the material changes.
 *
 * Follows the room's patch pattern (`clothNeckline.ts`): chained `onBeforeCompile` and cache key, the hooked
 * `#include` kept, applied once per material.
 */
import * as THREE from 'three';

const patched = new WeakSet<THREE.Material>();
/** The fragment line added after three's `normal_fragment_begin`: the interpolated normal, never turned for the back face. */
export const HAIR_NORMAL_LINE = '\n#ifndef FLAT_SHADED\n\tnormal = normalize( vNormal );\n#endif';

export function patchHairMaterial(material: THREE.Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', () => `#include <normal_fragment_begin>${HAIR_NORMAL_LINE}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|sarah-hair-v1`; };
  material.needsUpdate = true;
}
