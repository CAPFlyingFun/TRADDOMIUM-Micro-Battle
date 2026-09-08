import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SoilClip } from '../src/terrain/SoilClip';
import { local, world } from '../src/world/coords';
import { SOIL_TILE } from '../src/world/soilTypes';

describe('mesh-before-clip', () => {
  it('clips exactly the completed columns and tracks a rebased origin', () => {
    let origin = world(1_000_000, -1_000_000);
    const clip = new SoilClip(at => local(at.wx - origin.wx, at.wz - origin.wz));
    const tile = { tx: 312500, tz: -312500, revision: 1, minHeight: 0 };
    clip.setTiles([tile]);
    expect(clip.covers(world(1_000_001, -999_999))).toBe(true);
    expect(clip.covers(world(1_000_001 + SOIL_TILE, -999_999))).toBe(false);
    const before = clip.origin.value.clone();
    origin = world(1_000_100, -1_000_000);
    clip.setTiles([tile]);
    expect(clip.origin.value.x).toBeCloseTo(before.x - 100);
    expect(clip.covers(world(1_000_001, -999_999))).toBe(true);
    clip.setTiles([]);
    expect(clip.covers(world(1_000_001, -999_999))).toBe(false);
    clip.dispose();
  });

  it('patches three\'s real Lambert shader without replacing its lighting', () => {
    const clip = new SoilClip();
    const shader = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} };
    clip.patch(shader);
    expect(shader.fragmentShader).toContain('texture2D(uSoilMask');
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(shader.vertexShader).toContain('modelMatrix * vec4(position, 1.0)');
    clip.dispose();
  });
});
