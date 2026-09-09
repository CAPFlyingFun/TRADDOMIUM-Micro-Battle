/**
 * The bench drawn as what the bench IS (Creature Lab D, item 3a — the
 * z-fighting Joshua saw on the block's top): the floor is the floor,
 * flat under the block, and the block is its two solids — the slab on
 * its pillar — each the `Climbable` the feet feel, sized and placed
 * from the box and not from a second set of numbers. three's geometry
 * builds without WebGL, so this runs in node.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCK, LAB_FLOOR, PILLAR, PILLAR_BOX, SLAB_BOX, labFloorAt } from '../src/creatures/labWorld';
import { FLOOR_STEP, buildLabMeshes, type LabMeshes } from '../src/lab/labMeshes';
import { world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';

const built: LabMeshes[] = [];

function bench(): LabMeshes {
  const meshes = buildLabMeshes();
  built.push(meshes);
  return meshes;
}

afterEach(() => {
  for (const m of built.splice(0)) m.dispose();
  setOrigin(world(0, 0));
});

/** A mesh's box geometry in the bench frame: the geometry's own bounds carried by the mesh's position. */
function boundsOf(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone();
  box.min.add(mesh.position);
  box.max.add(mesh.position);
  return box;
}

describe('labMeshes: the block as two solids', () => {
  it('holds a pillar and a slab, each with its gold edges, and no lone block', () => {
    const m = bench();
    const pillar = m.group.getObjectByName('lab:pillar');
    const slab = m.group.getObjectByName('lab:slab');
    expect(pillar).toBeInstanceOf(THREE.Mesh);
    expect(slab).toBeInstanceOf(THREE.Mesh);
    expect(m.group.getObjectByName('lab:pillar-edges')).toBeInstanceOf(THREE.LineSegments);
    expect(m.group.getObjectByName('lab:slab-edges')).toBeInstanceOf(THREE.LineSegments);
    expect(m.group.getObjectByName('lab:block')).toBeUndefined();
    // The fields name the same meshes: `block` is the slab, as it always meant the thing whose top is the block's top.
    expect(m.block).toBe(slab);
    expect(m.pillar).toBe(pillar);
    expect(m.block.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(m.pillar.geometry).toBeInstanceOf(THREE.BoxGeometry);
  });

  it("the slab's top is the block's top, and the slab is exactly SLAB_BOX", () => {
    const m = bench();
    const slab = boundsOf(m.block);
    expect(slab.max.y).toBeCloseTo(LAB_FLOOR + BLOCK.height, 9);
    expect(slab.min.y).toBeCloseTo(SLAB_BOX.min.y, 9);
    expect(slab.min.x).toBeCloseTo(SLAB_BOX.min.x, 9);
    expect(slab.max.x).toBeCloseTo(SLAB_BOX.max.x, 9);
    expect(slab.min.z).toBeCloseTo(SLAB_BOX.min.z, 9);
    expect(slab.max.z).toBeCloseTo(SLAB_BOX.max.z, 9);
  });

  it("the pillar's foot is below the floor and the pillar is exactly PILLAR_BOX", () => {
    const m = bench();
    const pillar = boundsOf(m.pillar);
    expect(pillar.min.y).toBeLessThan(LAB_FLOOR);
    expect(pillar.min.y).toBeCloseTo(LAB_FLOOR - PILLAR.sink, 9);
    expect(pillar.max.y).toBeCloseTo(PILLAR_BOX.max.y, 9);
    expect(pillar.min.x).toBeCloseTo(PILLAR_BOX.min.x, 9);
    expect(pillar.max.x).toBeCloseTo(PILLAR_BOX.max.x, 9);
    expect(pillar.min.z).toBeCloseTo(PILLAR_BOX.min.z, 9);
    expect(pillar.max.z).toBeCloseTo(PILLAR_BOX.max.z, 9);
    // The pillar's top meets the slab's bottom: one solid the feet walk up, drawn as two.
    expect(pillar.max.y).toBeCloseTo(boundsOf(m.block).min.y, 9);
  });
});

describe('labMeshes: the floor does not carry the block', () => {
  it('runs at the FLOOR height over the whole footprint — no plateau to fight the slab', () => {
    const m = bench();
    const position = m.floor.geometry.getAttribute('position');
    let over = 0;
    const half = BLOCK.size / 2;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      over += 1;
      expect(position.getY(i), `floor vertex at (${x}, ${z})`).toBe(LAB_FLOOR);
    }
    // 41 × 41 half-centimetre samples across a 20 cm footprint.
    expect(over).toBe((BLOCK.size / FLOOR_STEP + 1) ** 2);
  });

  it('is sampled from labFloorAt everywhere: the dish and the bumps are in it, the block is not', () => {
    const m = bench();
    const position = m.floor.geometry.getAttribute('position');
    let dipped = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = position.getY(i);
      // To float32: the attribute holds a height near 100 to about 8 µm, and that is the only difference allowed.
      expect(y, `floor vertex at (${x}, ${z})`).toBeCloseTo(labFloorAt(world(x, z)), 4);
      if (y < LAB_FLOOR - 1e-9) dipped += 1;
      // Nothing in the sheet reaches the slab: the block's top used to be here.
      expect(y).toBeLessThan(LAB_FLOOR + 1);
    }
    expect(dipped).toBeGreaterThan(0);
  });
});
