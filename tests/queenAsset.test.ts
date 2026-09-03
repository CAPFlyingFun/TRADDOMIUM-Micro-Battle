import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { standingFloor } from '../src/ant/queenModel';
import { readFileSync } from 'node:fs';

/**
 * THE SHIPPED QUEEN, checked as a file.
 *
 * The wing split happens at bake time, which means the thing that can
 * go wrong is a re-bake — and it can go wrong quietly. The first
 * attempt produced a file where the wings mesh existed, was correctly
 * built, and was not reachable from the scene: the loader simply never
 * made it, and what shipped was a wingless queen with no error
 * anywhere. That is the failure this guards.
 */
function readGlb(path: string) {
  const file = readFileSync(path);
  expect(file.readUInt32LE(0)).toBe(0x46546C67);
  let at = 12;
  let json: any = null;
  while (at < file.length) {
    const len = file.readUInt32LE(at);
    if (file.readUInt32LE(at + 4) === 0x4E4F534A) {
      json = JSON.parse(file.subarray(at + 8, at + 8 + len).toString('utf8'));
    }
    at += 8 + len;
  }
  return { json, bytes: file.length };
}

const QUEEN = 'public/models/queen-winged.glb';

describe('the winged queen asset', () => {
  const { json, bytes } = readGlb(QUEEN);

  it('stays small enough to send to a phone', () => {
    // The wingless model it replaces was 1.4 MB. A full rig with wings
    // for half as much again is a fair trade; ten times would not be.
    expect(bytes).toBeLessThan(3.5 * 1024 * 1024);
  });

  it('is two meshes: a body and a set of wings', () => {
    const names = json.meshes.map((m: any) => m.name).sort();
    expect(names).toEqual(['queen_body', 'queen_wings']);
  });

  /** The one that would have shipped a wingless queen in silence. */
  it('has both meshes reachable from the scene', () => {
    const seen: string[] = [];
    const walk = (i: number) => {
      const node = json.nodes[i];
      if (node.mesh != null) seen.push(json.meshes[node.mesh].name);
      (node.children ?? []).forEach(walk);
    };
    json.scenes[json.scene ?? 0].nodes.forEach(walk);
    expect(seen.sort()).toEqual(['queen_body', 'queen_wings']);
  });

  it('drives both halves from the same bones', () => {
    const nodes = json.nodes.filter((n: any) => n.mesh != null);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) expect(node.skin).toBeTypeOf('number');
    // Two skins are allowed — the compressor makes one per mesh — but
    // they must list the SAME joints in the SAME order, or the wings
    // would drift away from the thorax they are attached to.
    const joints = json.skins.map((s: any) => JSON.stringify(s.joints));
    expect(new Set(joints).size).toBe(1);
  });

  it('keeps every triangle, and shares them out', () => {
    const tris = Object.fromEntries(json.meshes.map((m: any) => [
      m.name, json.accessors[m.primitives[0].indices].count / 3,
    ]));
    // Nothing lost and nothing drawn twice: the two halves add up to
    // the model as it arrived.
    expect(tris.queen_body + tris.queen_wings).toBe(103_491);
    // And the wings really are a third of her, which is the reason
    // hiding them is worth doing at all.
    const share = tris.queen_wings / (tris.queen_body + tris.queen_wings);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.45);
  });

  it('has both mandibles on the rig', () => {
    // 74 bones from the auto-rig: legs, antennae, gaster, wings and
    // the mandibles. The count is the guard — a re-rig that loses
    // limbs shows up here rather than in someone's face.
    expect(json.skins[0].joints.length).toBeGreaterThanOrEqual(70);
  });

  it('carries the textures compressed rather than as raw PNG', () => {
    expect(json.extensionsRequired).toContain('EXT_texture_webp');
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
  });
});

describe('she stands on her feet, not her wingtips', () => {
  /**
   * Joshua, v0.0.160: "still floating… (height is maybe 10-12mm too
   * tall)". Her seat was measured in-game at 0.01 cm off the bark, so
   * the gap was never her position — it was her BODY sitting above its
   * own origin.
   *
   * The cause is the same trap the scaling above is explicitly written
   * to avoid, one step later: a box over the whole model is bounded
   * below by whatever hangs lowest, and on a winged queen at rest that
   * is a wingtip. Stand THAT box on zero and she is balanced on her
   * wings with her feet in the air.
   */
  function limb(name: string, y: number, drop: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, drop, 1));
    mesh.name = name;
    mesh.position.y = y;
    return mesh;
  }

  it('ignores anything under the wings when finding her floor', () => {
    const model = new THREE.Object3D();
    const feet = limb('body', 0.5, 1); // spans 0 .. 1
    const wings = limb('wings', -0.5, 1); // spans -1 .. 0 — below her feet
    model.add(feet, wings);
    model.updateMatrixWorld(true);
    // The naive answer is the wingtip at -1; her feet are at 0.
    expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(-1, 6);
    expect(standingFloor(model, wings)).toBeCloseTo(0, 6);
  });

  it('skips a wing mesh nested any depth down', () => {
    const model = new THREE.Object3D();
    const feet = limb('body', 0.5, 1);
    const wings = new THREE.Object3D();
    wings.add(limb('wing-l', -0.5, 1));
    model.add(feet, wings);
    model.updateMatrixWorld(true);
    expect(standingFloor(model, wings)).toBeCloseTo(0, 6);
  });

  it('falls back on the whole model for a wingless caste', () => {
    const model = new THREE.Object3D();
    model.add(limb('body', 0.5, 1));
    model.updateMatrixWorld(true);
    expect(standingFloor(model, null)).toBeCloseTo(0, 6);
  });
});

describe('and the call site actually uses it', () => {
  /**
   * A SOURCE PIN, and it is here because the tests above are not
   * enough. They passed with the call site still taking a box over the
   * whole model — a true statement about a helper sitting next to code
   * that does not call it, which is the exact shape of hole that let
   * three broken builds through this week.
   *
   * The honest behavioural test would load the queen GLB and measure
   * her, which needs a GL context and a network fetch. Until there is
   * a rig for that, this reads the source.
   */
  it('stands the model on standingFloor, not on a whole-model box', () => {
    const src = readFileSync('src/ant/queenModel.ts', 'utf8');
    expect(src).toContain('model.position.y -= standingFloor(model, wings);');
    // And the naive version is not lurking anywhere else in the file.
    expect(src).not.toContain('setFromObject(model).min.y;\n  model.position');
  });
});
