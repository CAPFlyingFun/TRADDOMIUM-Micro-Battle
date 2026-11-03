/**
 * HER BABY GIVES A LITTLE WHERE IT CROSSES HER OPENING (Joshua, 2026-11-03, of a hybrid soft body for the baby): a real
 * newborn's shoulders and chest are soft -- its collarbones flex, its sides squeeze -- so where its body passes through
 * her opening it is drawn in toward the middle of it, no further out than the oval her opening is held to
 * (vulvaMesh `passMostAlong` x `passMostAcross`, less her skin's thickness), its head never (a head does not squeeze).
 *
 * A vertex pass after its skinning, in the world: a point within `slab` of her opening's plane, further out than `knee`
 * of the way to the oval's edge, is eased in toward it -- never past the edge, and never by more than `most` of its
 * distance from the middle -- fading out to nothing over the slab, so the squeeze has no edge of its own.
 */
import * as THREE from 'three';

/** GAME TUNING: how near her opening's plane it gives (world metres either side), from how far out toward the oval's
 * edge (a share of the way), and by how much of its distance at the most */
export const BABY_SQUEEZE = Object.freeze({ slab: 0.03, knee: 0.85, most: 0.22 });

export interface SqueezeUniforms {
  sqOn: { value: number };
  sqC: { value: THREE.Vector3 };
  sqN: { value: THREE.Vector3 };
  sqUp: { value: THREE.Vector3 };
  sqAcross: { value: THREE.Vector3 };
  sqRa: { value: number };
  sqRb: { value: number };
  sqSlab: { value: number };
  sqHead: { value: THREE.Vector4 };
  sqKnee: { value: number };
  sqMost: { value: number };
}

export function createSqueezeUniforms(): SqueezeUniforms {
  return {
    sqOn: { value: 0 }, sqC: { value: new THREE.Vector3() }, sqN: { value: new THREE.Vector3(0, 0, 1) }, sqUp: { value: new THREE.Vector3(0, 1, 0) }, sqAcross: { value: new THREE.Vector3(1, 0, 0) },
    sqRa: { value: 1 }, sqRb: { value: 1 }, sqSlab: { value: 1 }, sqHead: { value: new THREE.Vector4(0, 0, 0, 0) }, sqKnee: { value: BABY_SQUEEZE.knee }, sqMost: { value: BABY_SQUEEZE.most },
  };
}

/** Where it gives, from her opening as it is now (vulvaMesh `passFrame`), or not at all (null); `perMetre` world units. */
export function setSqueeze(u: SqueezeUniforms, f: { centre: THREE.Vector3; axis: THREE.Vector3; up: THREE.Vector3; across: THREE.Vector3; ra: number; rb: number; head: THREE.Vector3 | null; headR: number } | null, perMetre: number): void {
  if (!f || !(f.ra > 0) || !(f.rb > 0)) { u.sqOn.value = 0; return; }
  u.sqOn.value = 1;
  u.sqC.value.copy(f.centre); u.sqN.value.copy(f.axis).normalize(); u.sqUp.value.copy(f.up).normalize(); u.sqAcross.value.copy(f.across).normalize();
  u.sqRa.value = f.ra; u.sqRb.value = f.rb; u.sqSlab.value = BABY_SQUEEZE.slab * perMetre;
  if (f.head && f.headR > 0) u.sqHead.value.set(f.head.x, f.head.y, f.head.z, f.headR); else u.sqHead.value.set(0, 0, 0, 0);
}

const SQUEEZE_GLSL = /* glsl */ `
{
  vec4 sqW = modelMatrix * vec4( transformed, 1.0 );
  vec3 sqD = sqW.xyz - sqC;
  float sqH = dot( sqD, sqN );
  vec3 sqP = sqD - sqH * sqN;
  float sqK = length( vec2( dot( sqP, sqUp ) / sqRa, dot( sqP, sqAcross ) / sqRb ) );
  float sqWt = sqOn * ( 1.0 - smoothstep( 0.5 * sqSlab, sqSlab, abs( sqH ) ) );
  if ( sqHead.w > 0.0 ) sqWt *= smoothstep( sqHead.w, sqHead.w * 1.2, distance( sqW.xyz, sqHead.xyz ) );
  if ( sqWt > 0.0 && sqK > sqKnee ) {
    float sqR = 1.0 - sqKnee;
    float sqKk = sqKnee + sqR * ( 1.0 - exp( - ( sqK - sqKnee ) / sqR ) );
    sqKk = max( sqKk, sqK * ( 1.0 - sqMost ) );
    sqP *= mix( 1.0, sqKk / sqK, sqWt );
    sqW.xyz = sqC + sqH * sqN + sqP;
    transformed = ( inverse( modelMatrix ) * sqW ).xyz;
  }
}
`;

/** Its material given the squeeze (after its skinning), reading `u`. */
export function patchSqueeze(material: THREE.Material, u: SqueezeUniforms): void {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float sqOn; uniform vec3 sqC; uniform vec3 sqN; uniform vec3 sqUp; uniform vec3 sqAcross; uniform float sqRa; uniform float sqRb; uniform float sqSlab; uniform vec4 sqHead; uniform float sqKnee; uniform float sqMost;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${SQUEEZE_GLSL}`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|babySqueeze`;
  material.needsUpdate = true;
}
