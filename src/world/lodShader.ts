/**
 * THE MASTER LOD'S SHADER BRIDGE — the sphere, as the GPU sees it.
 *
 * The core (lod.ts) answers in WORLD coordinates, which is the frame
 * that survives an origin rebase and the only honest place to keep a
 * position. A shader cannot use those: float32 resolves a quarter of
 * a unit at five million, so every fragment comparison must happen in
 * RENDERED coordinates, near zero. This file is that conversion and
 * nothing else.
 *
 * It is one file rather than a habit because the alternative already
 * happened: the terrain grew its own queen uniform and its own radius,
 * and when the water wanted the same sphere the obvious move was to
 * grow a second pair. Two uniforms holding "the same" number is how
 * two systems quietly stop agreeing. There is one pair, every wearer
 * binds THESE objects, and the scene syncs them once a frame.
 *
 * WHY RENDERED COORDINATES ARE STILL FLOATING-ORIGIN CORRECT. Both
 * ends of the subtraction are rebased by the same delta each time the
 * origin moves, so their difference — the only thing the sphere cares
 * about — is invariant. Her rendered y IS her world y, because the
 * origin rebases in x and z alone.
 *
 * THE TWO GATES ARE NOT BOTH HERE. This bridge carries the master's
 * gate only: how much detail the player's distance ALLOWS. Each
 * consumer keeps its own screen-space resolvability safeguard, and
 * combines the two so that whichever wants LESS detail wins.
 */
import * as THREE from 'three';
import { DETAIL_FEATHER, detailRadius, forcedState } from './lod';

/**
 * Where the queen is, in RENDERED coordinates and in all three of
 * them — the same frame every consumer's fragment position is in,
 * which is the only reason the distance can be a subtraction.
 */
export const LOD_QUEEN_UNIFORM = { value: new THREE.Vector3() };

/** The Detail radius, world units. The dial's whole meaning. */
export const LOD_RADIUS_UNIFORM = { value: 1_000 };

/**
 * The debug pin, as the GPU sees it: negative means "no hand on the
 * scale", anything in 0..1 replaces the computed fraction outright.
 * A uniform rather than a recompile, so a person can sweep it live.
 */
export const LOD_MICRO_FORCE_UNIFORM = { value: -1 };

/**
 * Once a frame, from the scene: her rendered position, the master's
 * radius, and whatever the debug forces currently say.
 *
 * The position is optional because the scene also syncs at BUILD
 * time, before there is an ant to ask — the radius has to be right
 * from the first drawn frame, and her position arrives one update
 * later.
 */
export function syncLodUniforms(queenRender?: THREE.Vector3): void {
  if (queenRender) LOD_QUEEN_UNIFORM.value.copy(queenRender);
  LOD_RADIUS_UNIFORM.value = detailRadius();
  const forced = forcedState().micro;
  LOD_MICRO_FORCE_UNIFORM.value = forced === null ? -1 : forced;
}

/** The uniform declarations a wearer must paste into its fragment
 *  shader before using microChunk. */
export function lodUniformsChunk(): string {
  return `
        uniform vec3 uLodQueen;
        uniform float uLodRadius;
        uniform float uLodMicroForce;`;
}

/**
 * THE MICRO GATE AS GLSL — the exact arithmetic `lod.detailFraction`
 * performs on the CPU, from a RENDERED position in scope into the
 * float named by `out`.
 *
 * The feather constant is baked from the core's own export, so the
 * two cannot drift: if DETAIL_FEATHER moves, this moves with it and
 * tests/foamSphere.test.ts checks that the emitted source says so.
 */
export function microChunk(renderPos: string, out = 'micro'): string {
  return `
        float ${out} = 1.0 - smoothstep(
          uLodRadius * ${DETAIL_FEATHER.toFixed(3)}, uLodRadius,
          distance(${renderPos}, uLodQueen));
        if (uLodMicroForce >= 0.0) ${out} = uLodMicroForce;`;
}

/** Bind the bridge's uniforms onto a compiled shader. */
export function bindLodUniforms(
  uniforms: Record<string, { value: unknown }>,
): void {
  uniforms.uLodQueen = LOD_QUEEN_UNIFORM as { value: unknown };
  uniforms.uLodRadius = LOD_RADIUS_UNIFORM;
  uniforms.uLodMicroForce = LOD_MICRO_FORCE_UNIFORM;
}
