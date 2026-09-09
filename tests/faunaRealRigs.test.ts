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
 *
 * ─── the ants (Creature Lab, 2026-09-09) ────────────────────────────
 *
 * Two more files, pinned BY PATH rather than through the species table:
 * `queen-winged.glb` is v0's alate (`legacy/v0-main`, commit a1ff8fc,
 * Meshy auto-rig split into body and wings by `scripts/bakeQueen.mjs`)
 * and `worker.glb` is TCS's worker (Thronemound `39f95d3`, the same
 * Meshy/UniRig pipeline that made the aphid and the fly). Their species
 * entries belong to another module and may land before or after this
 * test; what THIS file owns is the fact about the files, and the entry
 * is checked against it only when one names the path. The full reading
 * — every chain, what it is, which way it faces, what 1 unit is in
 * millimetres — is `docs/research/creature-lab/rigs.md`; the numbers
 * below are that reading's pins.
 *
 * BOTH ANT FILES REQUIRE `EXT_meshopt_compression` (the three wild rigs
 * do not), so the loader here carries three's own meshopt decoder. The
 * game's loader (`assets.loadModel`) does not yet, and that is named in
 * rigs.md rather than worked around: a rig this test can open and the
 * game cannot is exactly the kind of gap a test exists to expose.
 *
 * Two of the finders in `fauna/rig.ts` used to answer these files
 * imperfectly and were pinned as they stood with the right answer
 * beside them: `findWings` returned one pair of the queen's two (the
 * hind, whose tips sit highest), and on the worker `findAntennae`
 * returned the MANDIBLES, because the worker's antennae droop to the
 * jaws' height and the midline mouth chain outranked them. Both were
 * corrected in the ant-rig pass (2026-09-09) — the antennae are the
 * LONGEST mirrored pair on a head hub, the wings are EVERY mirrored
 * pair hung above the thorax — and the pins moved to the true bones,
 * which had been listed here all along. The same pass added finders
 * for the mandibles, the head and the gaster, whose bones rigs.md §6.4
 * named; they are pinned below too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../src/assets/assets';
import {
  APHID, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, LAB_CREATURE_IDS, newCreature, rigScale, unitsOfMm,
  type Behaviour, type CreatureId, type CreatureSpecies, type CreatureState,
} from '../src/creatures';
import { FaunaView, SPINE_TOLERANCE } from '../src/fauna/FaunaView';
import {
  JAW_OPEN, LEG_LIFT, newMotion, poseAntennae, poseGaster, poseHead, poseJaws, poseLegs, stepMotion,
  type BoundAntenna, type BoundJaw, type BoundJoint, type BoundLeg,
} from '../src/fauna/motion';
import { bonesOf, dressRig, hubOf, isBone, measureRig, type RigAnatomy } from '../src/fauna/rig';
import { HIND_FOLD_FAN, WING_FOLDED_YAW, WING_SPREAD_YAW, poseWings, wingbeatHzOf, type BoundWing } from '../src/fauna/wings';
import { world } from '../src/world/coords';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A GLB's two chunks, as the file holds them. */
function chunksOf(file: string): { json: Record<string, unknown>; bin: Buffer } {
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
  return { json, bin };
}

/** The GLB with its images, textures and samplers removed: the rig and the mesh, nothing that needs a browser to decode. */
function withoutTextures(file: string): ArrayBuffer {
  const { json, bin } = chunksOf(file);
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
// The ant rigs are meshopt-compressed; the decoder is three's own and is idle for a file that does not need it.
loader.setMeshoptDecoder(MeshoptDecoder);
function parse(file: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    loader.parse(withoutTextures(file), '', (gltf) => {
      // The clips ride the gltf, not the scene; hung on the scene here so one object carries the whole answer.
      gltf.scene.animations = gltf.animations;
      resolve(gltf.scene);
    }, reject);
  });
}

/** The three wild rigs, the ones whose species entries are already in the table. */
const WILD = ['earthworm', 'aphid', 'housefly'] as const;
type WildId = (typeof WILD)[number];

/** What each file measures. Pinned from the Phase 7 fauna inspection; a re-export changes these on purpose or not at all. */
const EXPECTED: Readonly<Record<WildId, {
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

/**
 * THE ANT RIGS, as `docs/research/creature-lab/rigs.md` reads them. Every
 * name is a bone in the file; `spine` is `measureRig`'s median-band
 * extent in the GLB's own units — the number the species entry's
 * `model.spineUnits` must carry. Sides are the sign of X in the rig's
 * frame, which for an animal facing +Z with +Y up is its LEFT at +X.
 */
interface AntChain { readonly root: string; readonly tip: string }
interface AntRig {
  readonly bones: number;
  readonly triangles: number;
  readonly meshes: readonly string[];
  readonly spine: number;
  /** The thorax: the bone the legs (and the queen's wings) hang from. */
  readonly hub: string;
  /** Neck to antenna sockets, hub-first. */
  readonly head: readonly string[];
  /** Petiole to tip, hub-first. */
  readonly gaster: readonly string[];
  /** Coxa to foot, one per leg, in the order findLegs ranks them: −X front/mid/hind, then +X front/mid/hind. */
  readonly legs: readonly AntChain[];
  /** Root on the head to tip. −X first. */
  readonly antennae: readonly AntChain[];
  /** Root on the head (or the face) to tip. −X first. */
  readonly mandibles: readonly AntChain[];
  /** The four wings in the file's own `extras.wingRoots` order; null for a wingless rig. */
  readonly wings: Readonly<Record<string, AntChain>> | null;
}

const ANT_RIGS: Readonly<Record<string, AntRig>> = {
  'models/queen-winged.glb': {
    bones: 74, triangles: 103491, meshes: ['queen_body', 'queen_wings'], spine: 2.3718,
    hub: 'Bone_001',
    head: ['Bone_004', 'Bone_003', 'Bone_002'],
    gaster: ['Bone_007', 'Bone_006', 'Bone_005'],
    legs: [
      { root: 'Bone_013', tip: 'Bone_008' }, { root: 'Bone_025', tip: 'Bone_020' }, { root: 'Bone_037', tip: 'Bone_032' },
      { root: 'Bone_019', tip: 'Bone_014' }, { root: 'Bone_031', tip: 'Bone_026' }, { root: 'Bone_043', tip: 'Bone_038' },
    ],
    antennae: [{ root: 'Bone_068', tip: 'Bone_064' }, { root: 'Bone_073', tip: 'Bone_069' }],
    mandibles: [{ root: 'Bone_059', tip: 'Bone_056' }, { root: 'Bone_063', tip: 'Bone_060' }],
    // The file's keys: v0's bake named the −X wings "left". Facing +Z, −X is her RIGHT — rigs.md, "which side is her left".
    wings: {
      leftFore: { root: 'Bone_046', tip: 'Bone_044' },
      leftHind: { root: 'Bone_052', tip: 'Bone_050' },
      rightFore: { root: 'Bone_049', tip: 'Bone_047' },
      rightHind: { root: 'Bone_055', tip: 'Bone_053' },
    },
  },
  'models/worker.glb': {
    bones: 61, triangles: 56442, meshes: ['Mesh_0'], spine: 3.7917,
    hub: 'Bone_001',
    head: ['Bone_004', 'Bone_003', 'Bone_002'],
    gaster: ['Bone_008', 'Bone_007', 'Bone_006', 'Bone_005'],
    legs: [
      { root: 'Bone_032', tip: 'Bone_027' }, { root: 'Bone_014', tip: 'Bone_009' }, { root: 'Bone_044', tip: 'Bone_039' },
      { root: 'Bone_026', tip: 'Bone_021' }, { root: 'Bone_020', tip: 'Bone_015' }, { root: 'Bone_038', tip: 'Bone_033' },
    ],
    antennae: [{ root: 'Bone_050', tip: 'Bone_047' }, { root: 'Bone_054', tip: 'Bone_051' }],
    // Under the face bone Bone_045 (Bone_046 → Bone_045 is the face, off Bone_002), not under the head hub itself.
    mandibles: [{ root: 'Bone_057', tip: 'Bone_055' }, { root: 'Bone_060', tip: 'Bone_058' }],
    wings: null,
  },
};
const ANT_FILES = Object.keys(ANT_RIGS);

const scenes = new Map<string, THREE.Object3D>();
const anatomies = new Map<string, RigAnatomy>();
const sceneOf = (id: WildId): THREE.Object3D => scenes.get(CREATURE_SPECIES[id].model.path)!;
const anatomyOf = (id: WildId): RigAnatomy => anatomies.get(CREATURE_SPECIES[id].model.path)!;

beforeAll(async () => {
  for (const id of WILD) {
    const { path, chain } = CREATURE_SPECIES[id].model;
    const scene = await parse(path);
    scenes.set(path, scene);
    anatomies.set(path, measureRig(scene, chain));
  }
  for (const file of ANT_FILES) {
    const scene = await parse(file);
    scenes.set(file, scene);
    anatomies.set(file, measureRig(scene, null));
  }
});

afterEach(() => vi.restoreAllMocks());

const _p = new THREE.Vector3();
/** A bone's position in the rig's frame; the scene is at the identity. */
function at(scene: THREE.Object3D, name: string): THREE.Vector3 {
  const bone = scene.getObjectByName(name);
  if (bone === undefined) throw new Error(`${name} is not in the rig`);
  return _p.setFromMatrixPosition(bone.matrixWorld).clone();
}
/** Follow single bone children from a root to the end of its chain. */
function chainFrom(scene: THREE.Object3D, root: string): THREE.Bone[] {
  const out: THREE.Bone[] = [scene.getObjectByName(root) as THREE.Bone];
  for (;;) {
    const kids = out[out.length - 1].children.filter(isBone);
    if (kids.length !== 1) return out;
    out.push(kids[0]);
  }
}

describe('the files', () => {
  it('carry the bones and triangles they were inspected with, one skinned mesh each, and no clip', () => {
    for (const id of WILD) {
      const scene = sceneOf(id);
      expect(bonesOf(scene), id).toHaveLength(EXPECTED[id].bones);
      expect(anatomyOf(id).triangles, id).toBe(EXPECTED[id].triangles);
      let skinned = 0;
      scene.traverse((n) => { if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1; });
      expect(skinned, id).toBe(1);
      expect(scene.getObjectByName('output_unwrapped')).toBeDefined();
      expect(scene.animations).toHaveLength(0);
    }
  });

  it('the worm is one chain, in the file\'s hierarchy order — Bone_000, then Bone_016 down to Bone_001', () => {
    const chain = anatomyOf('earthworm').chain!;
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
      const a = anatomyOf(id);
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
    expect(anatomyOf('earthworm').legs).toEqual([]);
    expect(anatomyOf('earthworm').wings).toEqual([]);
  });

  it('measure the spines the inspection found, in the GLB\'s own units', () => {
    for (const id of WILD) expect(anatomyOf(id).spine, id).toBeCloseTo(EXPECTED[id].spine, 3);
  });

  it('the three wild rigs need no meshopt decoder; the two ant rigs require one', () => {
    const required = (file: string): string[] => (chunksOf(file).json.extensionsRequired as string[] | undefined) ?? [];
    for (const id of WILD) expect(required(CREATURE_SPECIES[id].model.path), id).not.toContain('EXT_meshopt_compression');
    for (const file of ANT_FILES) expect(required(file), file).toContain('EXT_meshopt_compression');
  });
});

describe('the ant rigs', () => {
  it('load through the meshopt decoder with the bones, triangles and meshes they were read with, and no clip', () => {
    for (const file of ANT_FILES) {
      const rig = ANT_RIGS[file];
      const scene = scenes.get(file)!;
      expect(bonesOf(scene), file).toHaveLength(rig.bones);
      expect(anatomies.get(file)!.triangles, file).toBe(rig.triangles);
      const skinned: THREE.SkinnedMesh[] = [];
      scene.traverse((n) => { if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(n as THREE.SkinnedMesh); });
      expect(skinned.map((m) => m.name).sort(), file).toEqual([...rig.meshes].sort());
      expect(scene.animations, file).toHaveLength(0);
      // Every skinned mesh wears the same material — the queen's wings are a second index buffer over the
      // body's skin, not a second material — so dressing touches exactly one.
      expect(dressRig(cloneSkinned(scene)), file).toBe(1);
    }
  });

  it('measure the spines rigs.md recorded, and any species entry that names the file agrees with them', () => {
    for (const file of ANT_FILES) {
      expect(anatomies.get(file)!.spine, file).toBeCloseTo(ANT_RIGS[file].spine, 3);
      // The table is another module's; when an entry points at this file and carries a NUMBER, that number is
      // this measurement to 1e-3 — otherwise the animal is drawn at the wrong length in silence. The table's own
      // placeholder for an unmeasured rig is zero, which its validator refuses at boot; that refusal is the
      // table's to make, so a zero is left to it and only a typed number is held to the file here.
      const species = Object.values(CREATURE_SPECIES).find((s: CreatureSpecies) => s.model.path === file);
      if (species !== undefined && species.model.spineUnits > 0) {
        expect(species.model.spineUnits, `${species.id} spineUnits`).toBeCloseTo(ANT_RIGS[file].spine, 3);
        expect(species.model.chain, `${species.id} is posed by its legs, not a chain`).toBeNull();
      }
    }
  });

  it('hang six legs off the thorax hub, feet on the ground, three a side, the tripod alternating', () => {
    for (const file of ANT_FILES) {
      const rig = ANT_RIGS[file];
      const scene = scenes.get(file)!;
      const a = anatomies.get(file)!;
      const bones = bonesOf(scene);
      expect(hubOf(bones)!.name, file).toBe(rig.hub);
      expect(a.legs.map((l) => l.coxa).sort(), `${file} coxae`).toEqual(rig.legs.map((l) => l.root).sort());
      expect(a.legs.map((l) => l.tip).sort(), `${file} feet`).toEqual(rig.legs.map((l) => l.tip).sort());
      for (const side of [1, -1]) expect(a.legs.filter((l) => l.side === side).map((l) => l.rank).sort()).toEqual([0, 1, 2]);
      for (let rank = 0; rank < 3; rank += 1) {
        const pair = a.legs.filter((l) => l.rank === rank);
        expect(pair[0].phase).not.toBe(pair[1].phase);
      }
      // The order rigs.md lists them: −X front, mid, hind, then +X front, mid, hind.
      const ordered = [...a.legs].sort((x, y) => x.side - y.side || x.rank - y.rank).map((l) => l.coxa);
      expect(ordered, file).toEqual(rig.legs.map((l) => l.root));
      // Each coxa is the hub's child and each chain runs single-file to its foot.
      for (const leg of rig.legs) {
        const coxa = scene.getObjectByName(leg.root) as THREE.Bone;
        expect(coxa.parent!.name, leg.root).toBe(rig.hub);
        const chain = chainFrom(scene, leg.root);
        expect(chain[chain.length - 1].name, leg.root).toBe(leg.tip);
        expect(chain.length, leg.root).toBe(6);
      }
      // The feet stand on y = 0: the skin's underside is the ground and the foot bones sit a skin's thickness above it.
      expect(a.box.min.y, `${file} underside`).toBeCloseTo(0, 2);
      for (const leg of rig.legs) expect(at(scene, leg.tip).y, `${leg.tip} height`).toBeLessThan(0.07);
      // Front feet ahead of the hind feet along +Z, which is where the head is.
      const front = a.legs.filter((l) => l.rank === 0).map((l) => at(scene, l.tip).z);
      const hind = a.legs.filter((l) => l.rank === 2).map((l) => at(scene, l.tip).z);
      expect(Math.min(...front), file).toBeGreaterThan(Math.max(...hind) + 1);
      // The gait's axis is the body's vertical in the coxa's parent frame: a unit vector on every leg.
      for (const l of a.legs) expect(l.axis.length()).toBeCloseTo(1, 6);
    }
  });

  it('face +Z: the head chain runs forward from the hub to the antenna sockets, the gaster back to its tip', () => {
    for (const file of ANT_FILES) {
      const rig = ANT_RIGS[file];
      const scene = scenes.get(file)!;
      const hub = at(scene, rig.hub);
      expect((scene.getObjectByName(rig.head[0]) as THREE.Bone).parent!.name).toBe(rig.hub);
      expect((scene.getObjectByName(rig.gaster[0]) as THREE.Bone).parent!.name).toBe(rig.hub);
      for (let i = 1; i < rig.head.length; i += 1) expect((scene.getObjectByName(rig.head[i]) as THREE.Bone).parent!.name).toBe(rig.head[i - 1]);
      for (let i = 1; i < rig.gaster.length; i += 1) expect((scene.getObjectByName(rig.gaster[i]) as THREE.Bone).parent!.name).toBe(rig.gaster[i - 1]);
      const sockets = at(scene, rig.head[rig.head.length - 1]);
      const tail = at(scene, rig.gaster[rig.gaster.length - 1]);
      expect(sockets.z, `${file} head`).toBeGreaterThan(hub.z + 0.5);
      expect(tail.z, `${file} gaster`).toBeLessThan(hub.z - 1);
      // The antennae root on the last head bone; the mandibles on the head or its face; every chain reaches its tip.
      for (const antenna of rig.antennae) {
        expect((scene.getObjectByName(antenna.root) as THREE.Bone).parent!.name, antenna.root).toBe(rig.head[rig.head.length - 1]);
        const chain = chainFrom(scene, antenna.root);
        expect(chain[chain.length - 1].name, antenna.root).toBe(antenna.tip);
      }
      for (const mandible of rig.mandibles) {
        const chain = chainFrom(scene, mandible.root);
        expect(chain[chain.length - 1].name, mandible.root).toBe(mandible.tip);
        expect(at(scene, mandible.tip).z, `${mandible.tip} is at the front`).toBeGreaterThan(sockets.z);
      }
      // −X first in every pair, so "the first of the pair" means the same side on both rigs.
      expect(at(scene, rig.antennae[0].tip).x).toBeLessThan(0);
      expect(at(scene, rig.antennae[1].tip).x).toBeGreaterThan(0);
      expect(at(scene, rig.mandibles[0].tip).x).toBeLessThan(at(scene, rig.mandibles[1].tip).x);
    }
  });

  it('the antennae are the LONGEST mirrored pair on the head, and the finder names them on both rigs', () => {
    for (const file of ANT_FILES) {
      const rig = ANT_RIGS[file];
      const scene = scenes.get(file)!;
      const restLength = (root: string): number => chainFrom(scene, root).slice(1).reduce((sum, b) => sum + b.position.length(), 0);
      const antennae = rig.antennae.map((c) => restLength(c.root));
      const mandibles = rig.mandibles.map((c) => restLength(c.root));
      expect(Math.min(...antennae), `${file} antennae outreach the jaws`).toBeGreaterThan(Math.max(...mandibles) * 2);
      const found = anatomies.get(file)!.antennae;
      expect(found.map((a) => a.bone).sort(), file).toEqual(rig.antennae.map((c) => c.root).sort());
      expect(found.map((a) => a.tip).sort(), file).toEqual(rig.antennae.map((c) => c.tip).sort());
      expect(found.map((a) => a.side).sort()).toEqual([-1, 1]);
    }
    // The rule did not break the wild two: their feelers are still their feelers.
    for (const id of ['aphid', 'housefly'] as const) {
      expect(anatomyOf(id).antennae.map((a) => a.bone).sort()).toEqual([...EXPECTED[id].antennae].sort());
    }
  });

  it('the mandibles are the mirrored pair at the FRONT of the head that is not the antennae; the head and the gaster are the trunk chains', () => {
    for (const file of ANT_FILES) {
      const rig = ANT_RIGS[file];
      const scene = scenes.get(file)!;
      const a = anatomies.get(file)!;
      expect(a.mandibles.map((j) => j.bone), file).toEqual(rig.mandibles.map((c) => c.root));
      expect(a.mandibles.map((j) => j.tip), file).toEqual(rig.mandibles.map((c) => c.tip));
      expect(a.mandibles.map((j) => j.side)).toEqual([-1, 1]);
      for (const j of a.mandibles) expect(j.hinge.length()).toBeCloseTo(1, 6);
      expect(a.head?.bone, `${file} head`).toBe(rig.head[0]);
      expect(a.head?.tip, `${file} head tip`).toBe(rig.head[rig.head.length - 1]);
      expect(a.gaster?.bone, `${file} gaster`).toBe(rig.gaster[0]);
      expect(a.gaster?.tip, `${file} gaster tip`).toBe(rig.gaster[rig.gaster.length - 1]);
      // The hinge is the body's up made perpendicular to the jaw's own rest direction: read back in the rig's
      // frame it is at right angles to the jaw and points upward — the queen's jaws hang down-forward, so
      // hers tilt well off the vertical, which is the point of reading the hinge from the bone.
      for (const j of a.mandibles) {
        const bone = scene.getObjectByName(j.bone) as THREE.Bone;
        const q = new THREE.Quaternion();
        bone.parent!.getWorldQuaternion(q);
        const hingeRig = j.hinge.clone().applyQuaternion(q);
        const dir = at(scene, j.tip).sub(at(scene, j.bone)).normalize();
        expect(Math.abs(hingeRig.dot(dir)), `${j.bone} hinge is square to the jaw`).toBeLessThan(1e-3);
        expect(hingeRig.y, `${j.bone} hinge points up`).toBeGreaterThan(0.3);
      }
    }
    // The fly's proboscis is one midline chain and pairs with nothing; the aphid's short labial pair is found.
    expect(anatomyOf('housefly').mandibles).toEqual([]);
    expect(anatomyOf('aphid').mandibles.map((j) => j.bone)).toEqual(['Bone_043', 'Bone_046']);
    expect(anatomyOf('housefly').head?.bone).toBe('Bone_004');
    expect(anatomyOf('housefly').gaster?.bone).toBe('Bone_008');
    expect(anatomyOf('aphid').head?.bone).toBe('Bone_007');
    expect(anatomyOf('aphid').gaster?.bone).toBe('Bone_004');
    expect(anatomyOf('earthworm').head).toBeNull();
    expect(anatomyOf('earthworm').mandibles).toEqual([]);
  });

  it('the queen\'s four wings are the file\'s own extras, hung on the hub, three bones each, baked SPREAD', () => {
    const file = 'models/queen-winged.glb';
    const rig = ANT_RIGS[file];
    const scene = scenes.get(file)!;
    const extras = chunksOf(file).json.extras as { wingRoots: Record<string, string>; wingBones: string[] };
    expect(extras.wingRoots).toEqual(Object.fromEntries(Object.entries(rig.wings!).map(([k, c]) => [k, c.root])));
    expect(extras.wingBones).toHaveLength(12);
    for (const [key, wing] of Object.entries(rig.wings!)) {
      const root = scene.getObjectByName(wing.root) as THREE.Bone;
      expect(root.parent!.name, key).toBe(rig.hub);
      const chain = chainFrom(scene, wing.root);
      expect(chain.map((b) => b.name), key).toHaveLength(3);
      expect(chain[2].name, key).toBe(wing.tip);
      for (const b of chain) expect(extras.wingBones).toContain(b.name);
      // At rest the wing points straight out to its side, not back along the abdomen: the yaw from −Z is
      // near 90°, where the housefly's folded pair rests within 8° of −Z. That is why the fly's "spread by
      // the air lever" cannot be applied to her as it stands — rigs.md, "the wings".
      const dir = at(scene, wing.tip).sub(at(scene, wing.root)).normalize();
      const yaw = Math.abs(Math.atan2(dir.x, -dir.z)) * (180 / Math.PI);
      expect(yaw, `${key} rests spread`).toBeGreaterThan(80);
      expect(yaw, `${key} rests spread`).toBeLessThan(100);
      expect(Math.sign(dir.x), `${key} is on the side its name's X says`).toBe(key.startsWith('left') ? -1 : 1);
    }
    // The finder returns BOTH mirrored pairs, fore ranked 0 and hind ranked 1, each with the yaw it was baked at.
    const found = anatomies.get(file)!.wings;
    expect(found.map((w) => w.bone).sort()).toEqual(Object.values(rig.wings!).map((c) => c.root).sort());
    expect(found.filter((w) => w.rank === 0).map((w) => w.bone).sort()).toEqual([rig.wings!.leftFore.root, rig.wings!.rightFore.root].sort());
    expect(found.filter((w) => w.rank === 1).map((w) => w.bone).sort()).toEqual([rig.wings!.leftHind.root, rig.wings!.rightHind.root].sort());
    for (const w of found) {
      expect(Math.abs(w.restYaw) * (180 / Math.PI), `${w.bone} rest yaw`).toBeGreaterThan(80);
      expect(Math.abs(w.restYaw) * (180 / Math.PI), `${w.bone} rest yaw`).toBeLessThan(100);
      expect(Math.sign(w.restYaw), `${w.bone} yaw sign is its side`).toBe(w.side);
    }
    // The fly's one pair rests folded, and reads so.
    for (const w of anatomyOf('housefly').wings) {
      expect(Math.abs(w.restYaw) * (180 / Math.PI)).toBeLessThan(12);
      expect(w.rank).toBe(0);
    }
    expect(anatomies.get('models/worker.glb')!.wings).toEqual([]);
  });

  it('carry a colour, a normal and a packed map; the worker\'s emission is a factor of 1 behind a map', () => {
    for (const file of ANT_FILES) {
      const json = chunksOf(file).json;
      const materials = json.materials as { pbrMetallicRoughness: Record<string, unknown>; normalTexture?: unknown; emissiveFactor?: number[]; emissiveTexture?: unknown }[];
      expect(materials, file).toHaveLength(1);
      expect(materials[0].pbrMetallicRoughness.baseColorTexture, file).toBeDefined();
      expect(materials[0].pbrMetallicRoughness.metallicRoughnessTexture, file).toBeDefined();
      expect(materials[0].normalTexture, file).toBeDefined();
    }
    // Pinned because it bites: three multiplies the factor by the (black) map, so the file renders dark — but a
    // dressing that drops the map and keeps the factor lights the whole ant white. rigs.md names it.
    const worker = (chunksOf('models/worker.glb').json.materials as { emissiveFactor?: number[]; emissiveTexture?: unknown }[])[0];
    expect(worker.emissiveFactor).toEqual([1, 1, 1]);
    expect(worker.emissiveTexture).toBeDefined();
    const queen = (chunksOf('models/queen-winged.glb').json.materials as { emissiveFactor?: number[] }[])[0];
    expect(queen.emissiveFactor).toBeUndefined();
  });

  it('dressRig puts the worker\'s emissive factor out with its map, so the ant is not a white light', () => {
    // The texture-stripped scene has no emissive map, so the factor is planted with a map to dress off, as the game's loader would hand it over.
    const clone = cloneSkinned(scenes.get('models/worker.glb')!);
    let material: THREE.MeshStandardMaterial | null = null;
    clone.traverse((n) => { const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && m.isMeshStandardMaterial) material = m; });
    expect(material).not.toBeNull();
    const std = material!;
    std.emissive.setScalar(1);
    std.emissiveMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dressRig(clone);
    expect(std.emissiveMap).toBeNull();
    expect(std.emissive.r).toBe(0);
    expect(std.emissive.g).toBe(0);
    expect(std.emissive.b).toBe(0);
  });

  it('clone and take thirty frames of the procedural legs, wings and feelers without a NaN', () => {
    for (const file of ANT_FILES) {
      const a = anatomies.get(file)!;
      const clone = cloneSkinned(scenes.get(file)!);
      const { legs, wings, antennae } = bind(clone, a);
      const m = newMotion();
      for (let frame = 0; frame < 30; frame += 1) {
        stepMotion(m, { dt: 1 / 60, moved: 0.05, climbed: 0.01, turned: 0.02, airborne: frame > 10, bodyLength: 0.8, phase: 0.3 });
        poseLegs(legs, m, a.spine, 0.3);
        poseWings(wings, m, 0.3, 96);
        poseAntennae(antennae, m, 0.3, a.spine);
      }
      clone.updateMatrixWorld(true);
      clone.traverse((n) => {
        for (const value of [...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]) {
          expect(Number.isFinite(value), `${file} ${n.name}`).toBe(true);
        }
      });
    }
  });
});

/** Everything a clone's posers need, bound the way `FaunaView.buildPool` binds them. */
interface Bound {
  legs: BoundLeg[]; wings: BoundWing[]; antennae: BoundAntenna[]; jaws: BoundJaw[]; head: BoundJoint | null; gaster: BoundJoint | null;
}
function bind(clone: THREE.Object3D, a: RigAnatomy): Bound {
  const bone = (name: string): THREE.Bone => clone.getObjectByName(name) as THREE.Bone;
  return {
    legs: a.legs.map((spec) => ({ bone: bone(spec.coxa), spec, femur: spec.femur === null ? null : bone(spec.femur) })),
    wings: a.wings.map((spec) => ({ bone: bone(spec.bone), spec })),
    antennae: a.antennae.map((spec) => ({ bone: bone(spec.bone), spec })),
    jaws: a.mandibles.map((spec) => ({ bone: bone(spec.bone), spec, angle: 0 })),
    head: a.head === null ? null : { bone: bone(a.head.bone), spec: a.head },
    gaster: a.gaster === null ? null : { bone: bone(a.gaster.bone), spec: a.gaster },
  };
}
function worldOf(clone: THREE.Object3D, name: string): THREE.Vector3 {
  clone.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(clone.getObjectByName(name)!.matrixWorld);
}
function finiteEverywhere(clone: THREE.Object3D, label: string): void {
  clone.updateMatrixWorld(true);
  clone.traverse((n) => {
    for (const value of [...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]) {
      if (!Number.isFinite(value)) throw new Error(`${label}: ${n.name} is not finite`);
    }
  });
}

describe('the ant rigs, posed', () => {
  it('open each jaw about its own hinge so the tips move APART and stay level, within the open limit, on both rigs', () => {
    for (const file of ANT_FILES) {
      const a = anatomies.get(file)!;
      const clone = cloneSkinned(scenes.get(file)!);
      const { jaws } = bind(clone, a);
      expect(jaws).toHaveLength(2);
      const restTips = jaws.map((j) => worldOf(clone, j.spec.tip));
      const restGap = restTips[1].x - restTips[0].x;
      // Force each jaw fully open on its own hinge, the way the poser does at the limit.
      for (const j of jaws) {
        j.angle = JAW_OPEN;
        j.bone.quaternion.setFromAxisAngle(j.spec.hinge, j.spec.side * JAW_OPEN).multiply(j.spec.rest);
      }
      const openTips = jaws.map((j) => worldOf(clone, j.spec.tip));
      const openGap = openTips[1].x - openTips[0].x;
      expect(openGap, `${file} tips apart`).toBeGreaterThan(restGap + 0.05);
      for (let i = 0; i < 2; i += 1) {
        // The −X jaw's tip goes to −X, the +X jaw's to +X: apart, each on its own side.
        expect(Math.sign(openTips[i].x - restTips[i].x), `${file} jaw ${i} moves to its side`).toBe(jaws[i].spec.side);
        // In the jaw's own plane: the tip's height barely changes against how far it swung.
        const swung = openTips[i].distanceTo(restTips[i]);
        expect(Math.abs(openTips[i].y - restTips[i].y), `${file} jaw ${i} stays level`).toBeLessThan(swung * 0.35);
      }
      finiteEverywhere(clone, file);
    }
  });

  it('bite with two DIFFERENT jaw angles, rest both while walking, and never pass the limit — driven through the posers', () => {
    for (const file of ANT_FILES) {
      const a = anatomies.get(file)!;
      const clone = cloneSkinned(scenes.get(file)!);
      const { jaws } = bind(clone, a);
      const m = newMotion();
      let differ = 0;
      let widest = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        stepMotion(m, { dt: 1 / 60, moved: 0, climbed: 0, turned: 0, airborne: false, biting: true, bodyLength: 0.8, phase: 0.3 });
        poseJaws(jaws, m, 0.3, 1 / 60);
        if (Math.abs(jaws[0].angle - jaws[1].angle) > 0.02) differ += 1;
        widest = Math.max(widest, jaws[0].angle, jaws[1].angle);
        for (const j of jaws) expect(j.angle, file).toBeLessThanOrEqual(JAW_OPEN + 1e-9);
      }
      expect(differ, `${file} frames the jaws differ on`).toBeGreaterThan(5);
      expect(widest, file).toBeGreaterThan(JAW_OPEN * 0.6);
      for (let frame = 0; frame < 120; frame += 1) {
        stepMotion(m, { dt: 1 / 60, moved: 0.05, climbed: 0, turned: 0, airborne: false, bodyLength: 0.8, phase: 0.3 });
        poseJaws(jaws, m, 0.3, 1 / 60);
      }
      for (const j of jaws) {
        expect(j.angle, `${file} at rest walking`).toBeLessThan(1e-3);
        expect(j.bone.quaternion.angleTo(j.spec.rest)).toBeLessThan(1e-3);
      }
    }
  });

  it('LIFT a swinging foot: mid-swing the foot is above its rest height on every leg of both ants', () => {
    for (const file of ANT_FILES) {
      const a = anatomies.get(file)!;
      const clone = cloneSkinned(scenes.get(file)!);
      const { legs } = bind(clone, a);
      const rest = new Map(legs.map((l) => [l.spec.tip, worldOf(clone, l.spec.tip)]));
      const m = newMotion();
      m.moving = 1;
      for (const l of legs) {
        expect(l.femur, `${file} ${l.spec.coxa} has a femur`).not.toBeNull();
        let highest = -Infinity;
        let lowest = Infinity;
        for (let k = 0; k < 40; k += 1) {
          m.gone = (k / 40) * 0.4 * a.spine;
          poseLegs(legs, m, a.spine, 0);
          const y = worldOf(clone, l.spec.tip).y - rest.get(l.spec.tip)!.y;
          highest = Math.max(highest, y);
          lowest = Math.min(lowest, y);
        }
        expect(highest, `${file} ${l.spec.tip} lifts`).toBeGreaterThan(0.02);
        expect(lowest, `${file} ${l.spec.tip} stays off the floor`).toBeGreaterThan(-0.02);
      }
      expect(LEG_LIFT).toBeGreaterThan(0);
    }
  });

  it('fold the queen\'s wings back along the body on the ground and open them to the side in the air, beating only up', () => {
    const file = 'models/queen-winged.glb';
    const a = anatomies.get(file)!;
    const clone = cloneSkinned(scenes.get(file)!);
    const { wings } = bind(clone, a);
    expect(wings).toHaveLength(4);
    const hub = worldOf(clone, 'Bone_001');
    const yawOf = (w: BoundWing): number => {
      const dir = worldOf(clone, w.spec.tip).sub(worldOf(clone, w.spec.bone));
      return Math.abs(Math.atan2(dir.x, -dir.z)) * (180 / Math.PI);
    };
    const m = newMotion();
    m.air = 0;
    poseWings(wings, m, 0.3, wingbeatHzOf('queen'));
    for (const w of wings) {
      expect(yawOf(w), `${w.spec.bone} folded`).toBeCloseTo((WING_FOLDED_YAW + w.spec.rank * HIND_FOLD_FAN) * (180 / Math.PI), 0);
      // Folded wings reach back over the gaster, a little past its tip (z −1.24), and clear the ground.
      const tip = worldOf(clone, w.spec.tip);
      expect(tip.z).toBeLessThan(-1.2);
      expect(tip.y).toBeGreaterThan(0.5);
      expect(tip.y).toBeGreaterThan(hub.y - 0.6);
    }
    const folded = wings.map((w) => w.bone.quaternion.clone());
    m.alive += 1 / 60;
    poseWings(wings, m, 0.3, wingbeatHzOf('queen'));
    for (let i = 0; i < 4; i += 1) expect(wings[i].bone.quaternion.equals(folded[i]), `${wings[i].spec.bone} still`).toBe(true);
    // In the air: out to the side at the spread yaw, and the stroke moves them frame to frame.
    m.air = 1;
    m.alive = 0;
    poseWings(wings, m, 0, wingbeatHzOf('queen'));
    for (const w of wings) expect(yawOf(w), `${w.spec.bone} spread`).toBeCloseTo(WING_SPREAD_YAW * (180 / Math.PI), 0);
    let changed = 0;
    let previous = wings[0].bone.quaternion.clone();
    for (let k = 0; k < 8; k += 1) {
      m.alive += 1 / 60;
      poseWings(wings, m, 0, wingbeatHzOf('queen'));
      if (wings[0].bone.quaternion.angleTo(previous) > 1e-3) changed += 1;
      previous = wings[0].bone.quaternion.clone();
    }
    expect(changed).toBeGreaterThan(5);
    finiteEverywhere(clone, file);
  });

  it('take 600 frames of EVERY behaviour word on both ants without a NaN, every joint inside its range', () => {
    const words: { word: string; moved: number; airborne: boolean; biting: boolean; feeding: boolean }[] = [
      { word: 'idle', moved: 0, airborne: false, biting: false, feeding: false },
      { word: 'wander', moved: 0.02, airborne: false, biting: false, feeding: false },
      { word: 'feed', moved: 0, airborne: false, biting: false, feeding: true },
      { word: 'rest', moved: 0, airborne: false, biting: false, feeding: false },
      { word: 'flee', moved: 0.06, airborne: false, biting: false, feeding: false },
      { word: 'defend', moved: 0, airborne: false, biting: true, feeding: false },
      { word: 'attack', moved: 0.06, airborne: false, biting: true, feeding: false },
      { word: 'takeoff', moved: 0.02, airborne: true, biting: false, feeding: false },
      { word: 'fly', moved: 0.1, airborne: true, biting: false, feeding: false },
      { word: 'hover', moved: 0, airborne: true, biting: false, feeding: false },
      { word: 'land', moved: 0.02, airborne: true, biting: false, feeding: false },
    ];
    for (const file of ANT_FILES) {
      const a = anatomies.get(file)!;
      const clone = cloneSkinned(scenes.get(file)!);
      const b = bind(clone, a);
      const m = newMotion();
      const body = a.spine;
      for (const w of words) {
        for (let frame = 0; frame < 600; frame += 1) {
          stepMotion(m, { dt: 1 / 60, moved: w.moved * body, climbed: w.airborne ? 0.01 : 0, turned: 0.03, airborne: w.airborne, biting: w.biting, feeding: w.feeding, bodyLength: body, phase: 0.3 });
          poseLegs(b.legs, m, body, 0.3);
          poseWings(b.wings, m, 0.3, 96);
          poseAntennae(b.antennae, m, 0.3, body);
          poseJaws(b.jaws, m, 0.3, 1 / 60);
          poseHead(b.head, m, 0.3);
          poseGaster(b.gaster, m, body, 0.3);
          for (const j of b.jaws) if (j.angle < 0 || j.angle > JAW_OPEN + 1e-9) throw new Error(`${file} ${w.word}: jaw at ${j.angle}`);
        }
        finiteEverywhere(clone, `${file} ${w.word}`);
        // Every posed joint stays inside a plausible angle of its rest: nothing has wound up.
        for (const l of b.legs) expect(l.bone.quaternion.angleTo(l.spec.rest), `${file} ${w.word} coxa`).toBeLessThan(0.5);
        for (const j of b.jaws) expect(j.bone.quaternion.angleTo(j.spec.rest), `${file} ${w.word} jaw`).toBeLessThan(JAW_OPEN + 1e-6);
        if (b.head) expect(b.head.bone.quaternion.angleTo(b.head.spec.rest), `${file} ${w.word} head`).toBeLessThan(0.5);
        if (b.gaster) expect(b.gaster.bone.quaternion.angleTo(b.gaster.spec.rest), `${file} ${w.word} gaster`).toBeLessThan(0.5);
        for (const wing of b.wings) expect(wing.bone.quaternion.angleTo(wing.spec.rest), `${file} ${w.word} wing`).toBeLessThan(Math.PI / 2 + 0.7);
      }
    }
  });
});

describe('the view on the real rigs', () => {
  const realLoader: Assets['loadModel'] = (path) => parse(path);

  it('warns about a species exactly when its measured spine, scaled by the table, is off the cited length', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = new FaunaView({ species: WILD.map((id) => CREATURE_SPECIES[id]), loadModel: realLoader, rung: 'ultra-low' });
    await v.ready();
    for (const id of WILD) {
      const species: CreatureSpecies = CREATURE_SPECIES[id];
      const body = unitsOfMm(species.lengthMm);
      const drawn = anatomyOf(id).spine * rigScale(species);
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
    const make = (id: WildId, n: string, x: number, behaviour: 'surface' | 'wander' | 'fly', height: number) => {
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
    for (const id of WILD) {
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
    expect(p.y).toBeCloseTo(anatomyOf('earthworm').chain!.lift * rigScale(EARTHWORM), 3);
    v.dispose();
  });

  it('loads the queen and the worker through the same path as the wild three, lends one rig each, warns about neither, and answers the pick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const five = LAB_CREATURE_IDS.map((id) => CREATURE_SPECIES[id]);
    const v = new FaunaView({ species: five, loadModel: realLoader, rung: 'ultra-low' });
    await v.ready();
    for (const id of ['queen', 'worker'] as const) {
      expect(v.isPlaceholder(id), id).toBe(false);
      expect(v.scaleOf(id), id).toBeCloseTo(rigScale(CREATURE_SPECIES[id]), 12);
      const a = v.anatomy(id)!;
      expect(a.legs).toHaveLength(6);
      expect(a.mandibles).toHaveLength(2);
      expect(a.head).not.toBeNull();
      expect(a.gaster).not.toBeNull();
      expect(warn.mock.calls.some((call) => String(call[0]).startsWith(`[fauna] ${id}:`)), `${id} warned`).toBe(false);
    }
    expect(v.anatomy('queen')!.wings).toHaveLength(4);
    expect(v.anatomy('worker')!.wings).toHaveLength(0);
    const make = (id: CreatureId, n: string, x: number, behaviour: Behaviour, height: number): CreatureState => {
      const c = newCreature({ id: n, species: id, cellKey: '0,0', at: world(x, 0), height, heading: 0.7, phase: 0.2 });
      c.tier = 'full';
      c.behaviour = behaviour;
      return c;
    };
    const creatures = [make('queen', 'q', 1, 'wander', 0), make('worker', 'k', 2, 'attack', 0), make('earthworm', 'w', 3, 'surface', 0), make('aphid', 'a', 4, 'wander', 5), make('housefly', 'f', 5, 'fly', 12)];
    for (let f = 0; f < 5; f += 1) {
      for (const c of creatures) c.at = world(c.at.wx + 0.05, c.at.wz + 0.02);
      v.update(creatures, world(0, 0), 1 / 60, 1);
    }
    expect(v.cost.rigsLent).toEqual({ earthworm: 1, aphid: 1, housefly: 1, queen: 1, worker: 1 });
    expect(v.drawnIds().slice().sort()).toEqual(['a', 'f', 'k', 'q', 'w']);
    v.group.updateMatrixWorld(true);
    for (const id of ['queen', 'worker'] as const) {
      const root = v.rigs(id)[0];
      expect(root.visible).toBe(true);
      root.traverse((n) => {
        for (const value of [...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]) {
          expect(Number.isFinite(value), `${id} ${n.name}`).toBe(true);
        }
      });
    }
    // The queen's drawn centre is on her body, a few millimetres up: the pick lands on the ant.
    const q = v.positionOf('q')!;
    expect(q.x).toBeCloseTo(creatures[0].at.wx, 0);
    expect(q.z).toBeCloseTo(creatures[0].at.wz, 0);
    expect(q.y).toBeGreaterThan(0);
    expect(q.y).toBeLessThan(unitsOfMm(CREATURE_SPECIES.queen.lengthMm));
    // Worker attacking: a third of a second in, its jaws are open on the drawn rig.
    for (let f = 0; f < 15; f += 1) v.update(creatures, world(0, 0), 1 / 60, 1);
    const worker = v.rigs('worker')[0];
    const jaws = v.anatomy('worker')!.mandibles.map((j) => ({ spec: j, bone: worker.getObjectByName(j.bone) as THREE.Bone }));
    expect(Math.max(...jaws.map((j) => j.bone.quaternion.angleTo(j.spec.rest)))).toBeGreaterThan(0.05);
    v.dispose();
  });

  it('measures the animation cost of five real rigs posed every frame, and reports it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const five = LAB_CREATURE_IDS.map((id) => CREATURE_SPECIES[id]);
    const v = new FaunaView({ species: five, loadModel: realLoader, rung: 'ultra-low' });
    await v.ready();
    const make = (id: CreatureId, n: string, x: number, behaviour: Behaviour, height: number): CreatureState => {
      const c = newCreature({ id: n, species: id, cellKey: '0,0', at: world(x, 0), height, heading: 0.7, phase: 0.2 });
      c.tier = 'full';
      c.behaviour = behaviour;
      return c;
    };
    const creatures = [make('queen', 'q', 1, 'fly', 20), make('worker', 'k', 2, 'attack', 0), make('earthworm', 'w', 3, 'surface', 0), make('aphid', 'a', 4, 'feed', 5), make('housefly', 'f', 5, 'fly', 12)];
    for (let f = 0; f < 30; f += 1) v.update(creatures, world(0, 0), 1 / 60, 1);
    v.resetCost();
    const frames = 300;
    for (let f = 0; f < frames; f += 1) {
      for (const c of creatures) { c.at = world(c.at.wx + Math.sin(c.heading) * 0.02, c.at.wz + Math.cos(c.heading) * 0.02); c.heading += 0.01; }
      v.update(creatures, world(0, 0), 1 / 60, 1);
    }
    const cost = v.cost;
    // eslint-disable-next-line no-console
    console.info(`[fauna ants] five real rigs posed every frame: mean ${cost.meanMs.toFixed(3)} ms, peak ${cost.peakMs.toFixed(3)} ms a frame (node, ${frames} frames)`);
    expect(cost.meanMs).toBeLessThan(2.5);
    v.dispose();
  });
});
