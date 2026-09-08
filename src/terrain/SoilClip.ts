/** The coarse sheet yields only to completed voxel columns. */
import * as THREE from 'three';
import { world, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as defaultToLocal } from '../world/origin';
import type { SoilTile } from '../world/SparseSoil';
import { SOIL_TILE, soilTileAt } from '../world/soilTypes';

const SIZE = 32;
export class SoilClip {
  readonly origin = { value: new THREE.Vector2() };
  private readonly data = new Uint8Array(SIZE * SIZE);
  private readonly texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RedFormat);
  private signature = '';
  private tx = 0;
  private tz = 0;

  constructor(private readonly toLocal: (at: WorldPoint) => LocalPoint = defaultToLocal) {
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  setTiles(tiles: readonly SoilTile[]): void {
    const signature = tiles.map(t => `${t.tx},${t.tz}`).sort().join(';');
    if (signature !== this.signature) {
      this.signature = signature;
      this.data.fill(0);
      if (tiles.length) {
        this.tx = Math.min(...tiles.map(t => t.tx));
        this.tz = Math.min(...tiles.map(t => t.tz));
        for (const tile of tiles) {
          const x = tile.tx - this.tx, z = tile.tz - this.tz;
          if (x >= 0 && z >= 0 && x < SIZE && z < SIZE) this.data[z * SIZE + x] = 255;
        }
      }
      this.texture.needsUpdate = true;
    }
    const p = this.toLocal(world(this.tx * SOIL_TILE, this.tz * SOIL_TILE));
    this.origin.value.set(p.lx, p.lz);
  }

  covers(at: WorldPoint): boolean {
    const tile = soilTileAt(at);
    const x = tile.tx - this.tx, z = tile.tz - this.tz;
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE && this.data[z * SIZE + x] > 0;
  }

  patch(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }): void {
    shader.uniforms.uSoilMask = { value: this.texture };
    shader.uniforms.uSoilOrigin = this.origin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSoilXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSoilXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSoilMask;\nuniform vec2 uSoilOrigin;\nvarying vec2 vSoilXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 soilUV = (vSoilXZ - uSoilOrigin) / ${(SIZE * SOIL_TILE).toFixed(1)};
        if (all(greaterThanEqual(soilUV, vec2(0.0))) && all(lessThan(soilUV, vec2(1.0)))) {
          if (texture2D(uSoilMask, soilUV).r > 0.5) {
            discard;
          }
        }`);
  }

  dispose(): void { this.texture.dispose(); }
}
