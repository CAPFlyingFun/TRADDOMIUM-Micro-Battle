import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCell, MAX_SEAM_DROP, TerrainStream,
} from '../src/world/TerrainStream';
import { world } from '../src/world/coords';

describe('streamed terrain cell seams', () => {
  it('adds no perimeter curtain to a same-LOD cell', () => {
    const verts = 65;
    const geometry = buildCell(world(0, 0), 512, verts);
    expect(geometry.getAttribute('position').count).toBe(verts * verts);
    expect(geometry.getIndex()!.count).toBe((verts - 1) * (verts - 1) * 6);
  });

  it.each(['north', 'south', 'west', 'east'] as const)(
    'limits the %s LOD bridge to local, bounded geometry',
    (edge) => {
    const verts = 65;
    const geometry = buildCell(
      world(0, 0), 512, verts, false, [{ edge, neighbourStep: 32 }],
    );
    const positions = geometry.getAttribute('position');
    const surfaceVertices = verts * verts;

    // One seam gets one bridge ring, rather than four 250-unit curtains.
    expect(positions.count).toBe(surfaceVertices + verts);
    let offset = 0;
    for (let i = 0; i < verts; i++) {
      const top = edge === 'north' ? i
        : edge === 'south' ? (verts - 1) * verts + i
          : edge === 'west' ? i * verts
            : i * verts + (verts - 1);
      const lower = surfaceVertices + i;
      offset = Math.max(offset, Math.abs(positions.getY(top) - positions.getY(lower)));
    }
    expect(offset).toBeLessThanOrEqual(MAX_SEAM_DROP);
    expect(offset).toBeLessThan(10);
  });

  it('makes the fine side the sole owner of each streamed LOD bridge', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    const stream = new TerrainStream(scene, material, material, material, material);
    stream.follow(world(0, 0));
    const counts = stream.tiers.cells.map((mesh) => mesh.geometry.getAttribute('position').count);
    const fineSurface = 65 * 65;

    // Four fine corners own two bridges, four fine edge cells own one,
    // and neither the centre fine cell nor any coarse neighbour duplicates them.
    expect(counts.filter((count) => count === fineSurface + 65 * 2)).toHaveLength(4);
    expect(counts.filter((count) => count === fineSurface + 65)).toHaveLength(4);
    expect(counts.filter((count) => count === fineSurface)).toHaveLength(1);
    expect(counts.filter((count) => count === 17 * 17)).toHaveLength(72);
    stream.dispose();
  });
});