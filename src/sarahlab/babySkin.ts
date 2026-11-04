/**
 * HER BABY'S SKIN SHOWS WHEN ITS BIRTH STARTS (Joshua, 2026-11-03, of the second Meshy newborn: "Still hide the texture
 * in the womb, but have it show when birthing starts"): in her womb it is drawn in one plain colour, as it always was;
 * from the moment her birth begins its own skin (the model's texture) comes in over it, over `fadeS` -- and goes back
 * to the plain colour if the birth is put back.
 *
 * A fragment patch on its material: its texture's colour mixed from the plain one by `show` (0 plain .. 1 its skin).
 */
import * as THREE from 'three';

/** GAME TUNING: the plain colour it is drawn in her womb (the colour it always had), and how long its skin takes to come
 * in or go (seconds) */
export const BABY_SKIN = Object.freeze({ plain: 0xe9a98f, fadeS: 1 });

export interface SkinUniforms {
  skinShow: { value: number };
  skinPlain: { value: THREE.Color };
}

export function createSkinUniforms(): SkinUniforms {
  return { skinShow: { value: 0 }, skinPlain: { value: new THREE.Color(BABY_SKIN.plain) } };
}

/** `show` eased toward `want` (0 or 1) over `dt` seconds: a straight ramp, `fadeS` end to end. */
export function stepSkin(u: SkinUniforms, want: number, dt: number): void {
  const w = Math.min(1, Math.max(0, want)), s = u.skinShow.value, step = Math.max(0, dt) / BABY_SKIN.fadeS;
  u.skinShow.value = s < w ? Math.min(w, s + step) : Math.max(w, s - step);
}

/** Its material given the fade (its own texture kept as `map`, its colour white so the texture is its own). */
export function patchSkin(material: THREE.MeshStandardMaterial, u: SkinUniforms): void {
  material.color.set(0xffffff);
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float skinShow; uniform vec3 skinPlain;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 skinTexel = texture2D( map, vMapUv );
  diffuseColor *= mix( vec4( skinPlain, 1.0 ), skinTexel, skinShow );
#else
  diffuseColor.rgb *= skinPlain;
#endif`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|babySkin`;
  material.needsUpdate = true;
}
