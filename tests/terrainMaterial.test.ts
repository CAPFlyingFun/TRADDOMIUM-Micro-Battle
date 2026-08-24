import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BAND_FILES, BAND_OFFSET_UNIFORM, BAND_ROTATION, BAND_TILE,
  BAND_WARP_FREQUENCIES, BAND_WARP_PHASE_UNIFORM,
  GRAIN_OFFSET_UNIFORM, GRAIN_ROTATION, GRAIN_TILE,
  GRAIN_WARP_FREQUENCIES, GRAIN_WARP_PHASE_UNIFORM,
  setTextureOrigin, terrainMaterial,
} from '../src/world/terrainMaterial';

describe('terrain material detail tiers', () => {
  it('keeps independent, bounded floating-origin offsets', () => {
    setTextureOrigin(-2.25, 3.75);
    expect(BAND_TILE).toBeGreaterThan(0);
    expect(GRAIN_TILE).toBeGreaterThan(0);
    expect(BAND_OFFSET_UNIFORM.value.x).toBeGreaterThanOrEqual(0);
    expect(BAND_OFFSET_UNIFORM.value.x).toBeLessThan(1);
    expect(GRAIN_OFFSET_UNIFORM.value.y).toBeGreaterThanOrEqual(0);
    expect(GRAIN_OFFSET_UNIFORM.value.y).toBeLessThan(1);
  });

  it('keeps rotated texture and world-warp phases invariant across a 1024-unit rebase', () => {
    const global = [2_234_567.25, -1_345_678.75] as const;
    const origins = [
      [2_200_000, -1_400_000],
      [2_201_024, -1_398_976],
    ] as const;
    const fold = (value: number, period: number) => ((value % period) + period) % period;
    const texturePhase = (
      origin: readonly [number, number],
      matrix: readonly [number, number, number, number],
      tile: number,
      offset: THREE.Vector2,
    ) => {
      const x = global[0] - origin[0];
      const z = global[1] - origin[1];
      return [
        fold((matrix[0] * x + matrix[1] * z) / tile + offset.x, 1),
        fold((matrix[2] * x + matrix[3] * z) / tile + offset.y, 1),
      ];
    };
    const warpPhase = (
      origin: readonly [number, number],
      frequencies: readonly [number, number, number, number],
      phase: THREE.Vector2,
    ) => {
      const x = global[0] - origin[0];
      const z = global[1] - origin[1];
      return [
        fold(x * frequencies[0] + z * frequencies[1] + phase.x, Math.PI * 2),
        fold(x * frequencies[2] + z * frequencies[3] + phase.y, Math.PI * 2),
      ];
    };
    const evaluate = (origin: readonly [number, number]) => {
      setTextureOrigin(origin[0], origin[1]);
      return {
        band: texturePhase(origin, BAND_ROTATION, BAND_TILE, BAND_OFFSET_UNIFORM.value),
        grain: texturePhase(origin, GRAIN_ROTATION, GRAIN_TILE, GRAIN_OFFSET_UNIFORM.value),
        bandWarp: warpPhase(origin, BAND_WARP_FREQUENCIES, BAND_WARP_PHASE_UNIFORM.value),
        grainWarp: warpPhase(origin, GRAIN_WARP_FREQUENCIES, GRAIN_WARP_PHASE_UNIFORM.value),
      };
    };
    const before = evaluate(origins[0]);
    const after = evaluate(origins[1]);
    for (const key of ['band', 'grain', 'bandWarp', 'grainWarp'] as const) {
      expect(after[key][0]).toBeCloseTo(before[key][0], 8);
      expect(after[key][1]).toBeCloseTo(before[key][1], 8);
    }
  });

  it('uses rotated multi-scale detail and derivative fades, not one square repeat', () => {
    const textures = Object.fromEntries(BAND_FILES.map((name) => [name, new THREE.Texture()]));
    const material = terrainMaterial(textures, new THREE.Texture());
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    (material.onBeforeCompile as unknown as (value: typeof shader) => void)(shader);

    expect(shader.fragmentShader).toContain('bandTurn');
    expect(shader.fragmentShader).toContain('bandUv +=');
    expect(shader.fragmentShader).toContain('grainTurn');
    expect(shader.fragmentShader).toContain('grainFootprint');
    expect(shader.fragmentShader).toContain('dot(vGround.xz');
    expect(shader.fragmentShader).toContain('bandWarpPhase');
    expect(shader.fragmentShader).not.toMatch(/sin\s*\(\s*(?:bandUv|grainUv)/);
    const farBranch = shader.fragmentShader.indexOf('if (far < 0.999)');
    const firstTexture = shader.fragmentShader.indexOf('texture2D(');
    expect(farBranch).toBeGreaterThan(-1);
    expect(firstTexture).toBeGreaterThan(farBranch);
    expect(shader.fragmentShader.match(/texture2D\(/g)).toHaveLength(8);
  });
});