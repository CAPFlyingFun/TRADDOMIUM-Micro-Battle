/**
 * THE REAL RIGS, MEASURED — `public/models/*.glb` through the loader
 * three uses, under node, with their textures stripped from the JSON
 * chunk so nothing tries to decode an image. Everything the synthetic
 * fixtures assume about the files is pinned here against the files:
 *
 *   the bone counts, the chain's hierarchy order, the triangle counts
 *   which bones are the legs, the wings and the feelers — by name, so
 *     a re-export that renames or re-parents them fails loudly
 *   the spine each rig measures, in the GLB's own units
 *   that the view's warning about the table agrees with that
 *     measurement, whichever way the table currently stands
 *   that the pool clones and poses the real rigs without a NaN
 *
 * The GLBs are read, never written (the brief: do not modify them).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../src/assets/assets';
import {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, newCreature, rigScale, unitsOfMm, type CreatureId, type CreatureSpecies,
} from '../src/creatures';
import { FaunaView, SPINE_TOLERANCE } from '../src/fauna/FaunaView';
import { bonesOf, measureRig, type RigAnatomy } from '../src/fauna/rig';
import { world } from '../src/world/coords';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** The GLB with its images, textures and samplers removed: the rig and the mesh, nothing that needs a browser to decode. */
function withoutTextures(file: string): ArrayBuffer {
  const buf = readFileSync(join(ROOT, 'public', file));
  const length = buf.readUInt32LE(8);
  let off = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Buffer | null = null;
  while (off < length) {
    const chunkLength = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLength);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + chunkLength;
  }
  if (json === null || bin === null) throw new Error(`${file}: not a GLB`);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of (json.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
  }
  const drop = (list: unknown): string[] => ((list as string[] | undefined) ?? []).filter((e) => e !== 'EXT_texture_webp');
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  while (text.length % 4 !== 0) text = Buffer.concat([text, Buffer.from(' ')]);
  let body = bin;
  while (body.length % 4 !== 0) body = Buffer.concat([body, Buffer.from([0])]);
  const total = 12 + 8 + text.length + 8 + body.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(text.length, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  text.copy(out, 20);
  const binOff = 20 + text.length;
  out.writeUInt32LE(body.length, binOff);
  out.writeUInt32LE(BIN_CHUNK, binOff + 4);
  body.copy(out, binOff + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

const loader = new GLTFLoader();
function parse(file: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    loader.parse(withoutTextures(file), '', (gltf) => resolve(gltf.scene), reject);
  });
}

/** What each file measures. Pinned from the Phase 7 fauna inspection; a re-export changes these on purpose or not at all. */
const EXPECTED: Readonly<Record<CreatureId, {
  bones: number; triangles: number; spine: number; legs: readonly string[]; tips: readonly string[]; wings: readonly string[]; antennae: readonly string[];
}>> = {
  earthworm: { bones: 17, triangles: 3144, spine: 25.7398, legs: [], tips: [], wings: [], antennae: [] },
  aphid: {
    bones: 57, triangles: 30947, spine: 2.3071,
    legs: ['Bone_012', 'Bone_017', 'Bone_022', 'Bone_027', 'Bone_032', 'Bone_037'],
    tips: ['Bone_008', 'Bone_013', 'Bone_018', 'Bone_023', 'Bone_028', 'Bone_033'],
    wings: [],
    antennae: ['Bone_051', 'Bone_056'],
  },
  housefly: {
    bones: 55, triangles: 25635, spine: 3.7633,
    legs: ['Bone_014', 'Bone_020', 'Bone_030', 'Bone_036', 'Bone_042', 'Bone_048'],
    tips: ['Bone_009', 'Bone_015', 'Bone_025', 'Bone_031', 'Bone_037', 'Bone_043'],
    wings: ['Bone_022', 'Bone_024'],
    antennae: ['Bone_050', 'Bone_052'],
  },
};

const scenes = new Map<CreatureId, THREE.Object3D>();
const anatomies = new Map<CreatureId, RigAnatomy>();

beforeAll(async () => {
  for (const id of CREATURE_IDS) {
    const scene = await parse(CREATURE_SPECIES[id].model.path);
    scenes.set(id, scene);
    anatomies.set(id, measureRig(scene, CREATURE_SPECIES[id].model.chain));
  }
});

afterEach(() => vi.restoreAllMocks());

describe('the files', () => {
  it('carry the bones and triangles they were inspected with, one skinned mesh each, and no clip', () => {
    for (const id of CREATURE_IDS) {
      const scene = scenes.get(id)!;
      expect(bonesOf(scene), id).toHaveLength(EXPECTED[id].bones);
      expect(anatomies.get(id)!.triangles, id).toBe(EXPECTED[id].triangles);
      let skinned = 0;
      scene.traverse((n) => { if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1; });
      expect(skinned, id).toBe(1);
      expect(scene.getObjectByName('output_unwrapped')).toBeDefined();
      expect((scene as unknown as { animations?: unknown[] }).animations ?? []).toHaveLength(0);
    }
  });

  it('the worm is one chain, in the file\'s hierarchy order — Bone_000, then Bone_016 down to Bone_001', () => {
    const chain = anatomies.get('earthworm')!.chain!;
    expect(chain.bones[0]).toBe('Bone_000');
    expect(chain.bones[1]).toBe('Bone_016');
    expect(chain.bones[16]).toBe('Bone_001');
    expect(chain.bones).toHaveLength(17);
    // Every child hangs on its parent's +Y, so identity below the root is a straight worm.
    for (const d of chain.dirs) expect(d.y).toBeCloseTo(1, 3);
    expect(chain.lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(EXPECTED.earthworm.spine, 3);
    expect(chain.lift).toBeGreaterThan(0.3);
    expect(chain.lift).toBeLessThan(1.2);
  });

  it('the legs, wings and feelers are the bones the inspection named', () => {
    for (const id of ['aphid', 'housefly'] as const) {
      const a = anatomies.get(id)!;
      expect(a.legs.map((l) => l.coxa).sort(), `${id} coxae`).toEqual([...EXPECTED[id].legs].sort());
      expect(a.legs.map((l) => l.tip).sort(), `${id} feet`).toEqual([...EXPECTED[id].tips].sort());
      expect(a.wings.map((w) => w.bone).sort(), `${id} wings`).toEqual([...EXPECTED[id].wings].sort());
      expect(a.antennae.map((w) => w.bone).sort(), `${id} feelers`).toEqual([...EXPECTED[id].antennae].sort());
      // Three legs a side, ranks 0..2 on each, the tripod halves alternating across every pair.
      for (const side of [1, -1]) expect(a.legs.filter((l) => l.side === side).map((l) => l.rank).sort()).toEqual([0, 1, 2]);
      for (let rank = 0; rank < 3; rank += 1) {
        const pair = a.legs.filter((l) => l.rank === rank);
        expect(pair[0].phase).not.toBe(pair[1].phase);
      }
      expect(a.chain).toBeNull();
    }
    expect(anatomies.get('earthworm')!.legs).toEqual([]);
    expect(anatomies.get('earthworm')!.wings).toEqual([]);
  });

  it('measure the spines the inspection found, in the GLB\'s own units', () => {
    for (const id of CREATURE_IDS) expect(anatomies.get(id)!.spine, id).toBeCloseTo(EXPECTED[id].spine, 3);
  });
});

describe('the view on the real rigs', () => {
  const realLoader: Assets['loadModel'] = (path) => parse(path);

  it('warns about a species exactly when its measured spine, scaled by the table, is off the cited length', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = new FaunaView({ species: CREATURE_IDS.map((id) => CREATURE_SPECIES[id]), loadModel: realLoader, rung: 'ultra-low' });
    await v.ready();
    for (const id of CREATURE_IDS) {
      const species: CreatureSpecies = CREATURE_SPECIES[id];
      const body = unitsOfMm(species.lengthMm);
      const drawn = anatomies.get(id)!.spine * rigScale(species);
      const off = Math.abs(drawn - body) > body * SPINE_TOLERANCE;
      const warned = warn.mock.calls.some((call) => String(call[0]).startsWith(`[fauna] ${id}:`));
      expect(warned, `${id}: drawn ${drawn.toFixed(3)} of ${body} units`).toBe(off);
      // The root wears the table's scale either way: the warning is the correction's messenger, not its author.
      expect(v.scaleOf(id)).toBeCloseTo(rigScale(species), 12);
    }
    v.dispose();
  });

  it('clones and poses every real rig for one frame without a NaN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = new FaunaView({ species: [EARTHWORM, APHID, HOUSEFLY], loadModel: realLoader, rung: 'ultra-low' });
    await v.ready();
    const make = (id: CreatureId, n: string, x: number, behaviour: 'surface' | 'wander' | 'fly', height: number) => {
      const c = newCreature({ id: n, species: id, cellKey: '0,0', at: world(x, 0), height, heading: 0.7, phase: 0.2 });
      c.tier = 'full';
      c.behaviour = behaviour;
      return c;
    };
    const creatures = [make('earthworm', 'w', 3, 'surface', 0), make('aphid', 'a', 4, 'wander', 5), make('housefly', 'f', 5, 'fly', 12)];
    for (let f = 0; f < 5; f += 1) {
      for (const c of creatures) c.at = world(c.at.wx + 0.1, c.at.wz + 0.05);
      v.update(creatures, world(0, 0), 1 / 60, 1);
    }
    expect(v.cost.rigsLent).toEqual({ earthworm: 1, aphid: 1, housefly: 1 });
    v.group.updateMatrixWorld(true);
    for (const id of CREATURE_IDS) {
      const root = v.rigs(id)[0];
      expect(root.visible).toBe(true);
      root.traverse((n) => {
        for (const value of [...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]) {
          expect(Number.isFinite(value), `${id} ${n.name}`).toBe(true);
        }
      });
    }
    // The worm's head bone sits on its creature, lifted by the skin's radius.
    const head = v.rigs('earthworm')[0].getObjectByName('Bone_000')!;
    const p = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    expect(p.x).toBeCloseTo(creatures[0].at.wx, 3);
    expect(p.z).toBeCloseTo(creatures[0].at.wz, 3);
    expect(p.y).toBeCloseTo(anatomies.get('earthworm')!.chain!.lift * rigScale(EARTHWORM), 3);
    v.dispose();
  });
});
