/**
 * THE ANIMALS' RENDERER, without a GPU: synthetic rigs through the
 * injected loader, three's scene graph, and the creature state the
 * simulation would hand it.
 *
 *   THE RIG GOES TO THE NEAREST ANIMAL OF ANY SPECIES, inside the near
 *     line, never past the far one, never more of them than the rung's
 *     budget however many crowd in, and in the same order every frame
 *   the band is the hysteresis: crossing back and forth over the near
 *     line changes nothing until the far line is passed
 *   the swap is a crossfade — never invisible, never doubled
 *   everything else near is an impostor, never past the cap; nothing
 *     far is drawn
 *   the census closes: rigs + impostors + notDrawn is what was handed
 *     in, and hidden + pastCap + farTier is notDrawn
 *   a burrowed worm is not drawn; a surfaced one lies on the ground
 *   the soil cutaway's reveal is the ANIMAL's, not its nose tile's: a
 *     ceiling that flips every frame moves nothing, hides nothing and
 *     never lays the crawled trail straight again
 *   an airborne fly is drawn at its height, wings beating; a landed one
 *     folds them and stands still
 *   a walking creature's legs swing; the worm's chain follows its trail
 *   a species switched off vanishes and costs nothing
 *   the rig is scaled by the table and measured against it, and a rig
 *     of the wrong size is warned about, not corrected
 *   the DRAWN size is the animal's own, not its species': two worms of
 *     different lengths get different scales, spans, trail spacings,
 *     impostors and hiding depths, and a rig changing hands takes the
 *     new holder's size on the frame it changes them
 *   the trail is kept in world points: an origin shift moves the drawn
 *     body with the world
 *   a missing file is an honest box
 *   A BODY ON A WALL (Creature Lab D): the rig's local +Y is the wall's
 *     normal and local +Z the heading carried onto it; the drawn up
 *     eases onto a new up within a second and settles exactly, and
 *     snaps on lend; a climber walking straight up strides; the walk
 *     bob is along the normal; the drawn centre is off the wall by the
 *     rig's box half-extent — and on the ground nothing changed
 *   no clip is played and no die is rolled — source text
 *   dispose lets go of everything
 *   300 creatures cost what the brief allows
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../src/assets/assets';
import {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, FACE_NORMALS, HOUSEFLY, WORLD_UP, aheadOn, newCreature, rigScale, unitsOfMm,
  type Behaviour, type CreatureId, type CreatureState, type Tier, type Vec3,
} from '../src/creatures';
import {
  BODY_SAMPLES, BURROW_HIDE, BURROW_KEEP, CRUMBS_PER_LENGTH, FADE_S, FaunaView, LOOK, POOL_SIZES, REVEAL_HOLD, RIG_FAR,
  RIG_NEAR, SPINE_TOLERANCE, impostorCapFor, poolSizeFor, rigBudgetFor,
} from '../src/fauna/FaunaView';
import { UP_EASE_S } from '../src/fauna/motion';
import { WING_FLAP } from '../src/fauna/wings';
import { local, world, type LocalPoint, type WorldPoint } from '../src/world/coords';
import { SOIL_TILE } from '../src/world/soilTypes';
import { setOrigin, toLocal } from '../src/world/origin';
import { leggedRig, wormRig } from './faunaFixtures';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPECIES = CREATURE_IDS.map((id) => CREATURE_SPECIES[id]);

/** A synthetic rig sized to the TABLE for each path, so the loaded spine matches the cited length exactly. */
function rigFor(path: string, sizeFactor = 1): THREE.Object3D {
  if (path === EARTHWORM.model.path) return wormRig(EARTHWORM.model.spineUnits * sizeFactor);
  if (path === APHID.model.path) return leggedRig(APHID.model.spineUnits * sizeFactor, false);
  if (path === HOUSEFLY.model.path) return leggedRig(HOUSEFLY.model.spineUnits * sizeFactor, true);
  throw new Error(`no synthetic rig for ${path}`);
}

const loader = (sizeFactor = 1): Assets['loadModel'] => (path) => Promise.resolve(rigFor(path, sizeFactor));

/** A loader whose file is missing: what `assets.loadModel` returns after its retries. */
const missing: Assets['loadModel'] = (path, placeholderFactory) => {
  const placeholder = placeholderFactory();
  placeholder.userData.isPlaceholder = true;
  placeholder.userData.expectedUrl = path;
  return Promise.resolve(placeholder);
};

interface Over {
  readonly height?: number;
  readonly heading?: number;
  readonly tier?: Tier;
  readonly behaviour?: Behaviour;
  readonly phase?: number;
  /** This individual's body, mm. Left out, it is the species' cited length, which is what every other test here wants. */
  readonly lengthMm?: number;
}

function creature(species: CreatureId, id: string, x: number, z: number, over: Over = {}): CreatureState {
  const c = newCreature({
    id, species, cellKey: '0,0', at: world(x, z), height: over.height ?? 0, heading: over.heading ?? 0,
    phase: over.phase ?? 0.3, lengthMm: over.lengthMm ?? CREATURE_SPECIES[species].lengthMm,
  });
  c.tier = over.tier ?? 'near';
  if (over.behaviour) c.behaviour = over.behaviour;
  return c;
}

const EYE = world(0, 0);

async function view(rung = 'ultra-low', load: Assets['loadModel'] = loader(), extra: Partial<ConstructorParameters<typeof FaunaView>[0]> = {}): Promise<FaunaView> {
  const v = new FaunaView({ species: SPECIES, loadModel: load, rung, ...extra });
  await v.ready();
  return v;
}

const views: FaunaView[] = [];
afterEach(() => {
  for (const v of views) v.dispose();
  views.length = 0;
  setOrigin(world(0, 0));
  vi.restoreAllMocks();
});

const keep = async (p: Promise<FaunaView>): Promise<FaunaView> => { const v = await p; views.push(v); return v; };

function worldPosition(o: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
}

/**
 * WHO ACTUALLY HOLDS A RIG, in pool order. Every species' pool is the
 * whole rung budget now (`rigBudgetFor`), so `holders` is mostly nulls
 * and what a test means by "the rigs are with A and B" is this.
 */
function held(v: FaunaView, species: CreatureId): string[] {
  return v.holders(species).filter((h): h is string => h !== null);
}

/** Every rig this view is lending, of any species. */
function lentAll(v: FaunaView, ids: readonly CreatureId[] = CREATURE_IDS): number {
  return ids.reduce((sum, id) => sum + v.cost.rigsLent[id], 0);
}

/** Every impostor BODY this view is carrying, of any species. */
function impostorsAll(v: FaunaView, ids: readonly CreatureId[] = CREATURE_IDS): number {
  return ids.reduce((sum, id) => sum + v.cost.impostors[id], 0);
}

describe('loading and the size', () => {
  it('scales each template by rigScale so the measured spine is the cited length, and warns about none of them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = await keep(view());
    for (const s of SPECIES) {
      expect(v.template(s.id)).not.toBeNull();
      expect(v.isPlaceholder(s.id)).toBe(false);
      expect(v.scaleOf(s.id)).toBeCloseTo(rigScale(s), 12);
      const anatomy = v.anatomy(s.id)!;
      expect(anatomy.spine * v.scaleOf(s.id)).toBeCloseTo(unitsOfMm(s.lengthMm), 6);
      expect(v.template(s.id)!.scale.x).toBeCloseTo(rigScale(s), 12);
    }
    expect(warn).not.toHaveBeenCalled();
    // The worm's chain, the aphid's legs and feelers, the fly's wings.
    expect(v.anatomy('earthworm')!.chain!.bones).toHaveLength(17);
    expect(v.anatomy('aphid')!.legs).toHaveLength(6);
    expect(v.anatomy('aphid')!.antennae).toHaveLength(2);
    expect(v.anatomy('aphid')!.wings).toHaveLength(0);
    expect(v.anatomy('housefly')!.wings).toHaveLength(2);
  });

  it('warns, and does not correct, when the rig\'s spine is off the cited length by more than the tolerance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = await keep(view('ultra-low', loader(0.5)));
    expect(warn).toHaveBeenCalledTimes(3);
    for (const s of SPECIES) {
      const message = warn.mock.calls.find((call) => String(call[0]).includes(`[fauna] ${s.id}:`))?.[0] as string;
      expect(message).toBeDefined();
      expect(message).toMatch(/Not corrected here/);
      expect(message).toContain(String(s.model.spineUnits));
      // Still the table's scale — the drawn body is half the length, and the warning says so.
      expect(v.scaleOf(s.id)).toBeCloseTo(rigScale(s), 12);
      expect(message).toMatch(/50% of its length/);
    }
    // And just inside the tolerance is silent.
    warn.mockClear();
    await keep(view('ultra-low', loader(1 - SPINE_TOLERANCE + 0.01)));
    expect(warn).not.toHaveBeenCalled();
  });

  it('dresses the skin once on the template: roughness set, packed maps gone, base AND normal maps kept', async () => {
    const v = await keep(view());
    const mesh = v.template('housefly')!.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.roughness).toBe(0.72);
    expect(material.metalness).toBe(0);
    expect(material.map).not.toBeNull();
    // The normal map STAYS: it is the segment detail, and dropping it is
    // what made the worm read as a smooth tube (`fauna/rig.dressRig`).
    expect(material.normalMap).not.toBeNull();
    expect(material.roughnessMap).toBeNull();
    expect(material.metalnessMap).toBeNull();
    // EVERY CLONE WEARS ITS OWN COPY OF THAT MATERIAL, and the crossfade
    // is why: opacity is per-rig, and a shared material would fade every
    // skeleton of the species together the moment one crossed the band.
    // The GEOMETRY is still shared — that is where the triangles are —
    // and the copy carries the same maps, so dressing still happens once.
    for (const root of v.rigs('housefly')) {
      const clone = root.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
      const worn = clone.material as THREE.MeshStandardMaterial;
      expect(worn).not.toBe(material);
      expect(worn.map).toBe(material.map);
      expect(worn.normalMap).toBe(material.normalMap);
      expect(worn.roughness).toBe(material.roughness);
      expect(clone.geometry).toBe(mesh.geometry);
      expect(clone.skeleton).not.toBe(mesh.skeleton);
    }
  });

  it('stands an honest box in for a missing file: the species\' length, unscaled, still lent and drawn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = await keep(view('ultra-low', missing));
    for (const s of SPECIES) {
      expect(v.isPlaceholder(s.id)).toBe(true);
      expect(v.anatomy(s.id)).toBeNull();
      expect(v.scaleOf(s.id)).toBe(1);
      const mesh = v.template(s.id)!.children[0] as THREE.Mesh;
      expect((mesh.geometry as THREE.BoxGeometry).parameters.depth).toBeCloseTo(unitsOfMm(s.lengthMm), 9);
    }
    expect(warn).not.toHaveBeenCalled();
    const fly = creature('housefly', 'f', 10, 0, { height: 3, heading: 1, behaviour: 'fly' });
    v.update([fly], EYE, 1 / 60);
    expect(v.cost.rigsLent.housefly).toBe(1);
    const root = v.rigs('housefly')[0];
    expect(root.visible).toBe(true);
    expect(root.position.y).toBeCloseTo(3, 9);
    expect(root.rotation.y).toBeCloseTo(1, 9);
  });
});

describe('the pool', () => {
  it('is sized by the rung, and the impostor capped by the species\' own cap', () => {
    expect(POOL_SIZES.high).toEqual({ earthworm: 4, aphid: 8, housefly: 6, queen: 1, worker: 1 });
    for (const rung of ['ultra-low', 'low', 'medium', 'high', 'ultra-high']) {
      for (const id of CREATURE_IDS) expect(poolSizeFor(rung, id)).toBeGreaterThan(0);
      for (const s of SPECIES) expect(impostorCapFor(s, rung)).toBe(s.population.caps[rung as 'high']);
    }
    let last = { earthworm: 0, aphid: 0, housefly: 0, queen: 0, worker: 0 };
    for (const rung of ['ultra-low', 'low', 'medium', 'high', 'ultra-high']) {
      for (const id of CREATURE_IDS) expect(POOL_SIZES[rung][id]).toBeGreaterThanOrEqual(last[id]);
      last = { ...POOL_SIZES[rung] };
    }
    expect(poolSizeFor('nonsense', 'aphid')).toBe(POOL_SIZES.medium.aphid);
  });

  it('BUDGETS THE RIGS AS THE SUM OF THE RUNG\'S TABLE, and gives every species a pool of that size', async () => {
    // The table is where the number comes from and why it stays: moving
    // the decision from "the nearest five aphids" to "the nearest
    // thirteen animals" must not change what thirteen rigs cost.
    expect(rigBudgetFor('medium')).toBe(2 + 5 + 4 + 1 + 1);
    for (const rung of ['ultra-low', 'low', 'medium', 'high', 'ultra-high']) {
      let sum = 0;
      for (const count of Object.values(POOL_SIZES[rung])) sum += count;
      expect(rigBudgetFor(rung)).toBe(sum);
    }
    expect(rigBudgetFor('nonsense')).toBe(rigBudgetFor('medium'));
    // And a pool serves ANY MIX: if the nearest thirteen are all aphids,
    // thirteen aphid rigs are what is needed.
    const v = await keep(view('medium'));
    for (const id of CREATURE_IDS) expect(v.poolSize(id)).toBe(rigBudgetFor('medium'));
  });

  it('SAYS WHAT THE BUDGET-SIZED POOLS COST TO BUILD, against the rung table\'s own', async () => {
    // Per-species pools sized to the whole budget means five times the
    // clones at every rung. Cheap in theory — `SkeletonUtils.clone`
    // shares the template's geometry and a clone is bones and scene
    // nodes — and this is the measurement rather than the theory.
    const v = await keep(view('medium'));
    const bones: Record<string, number> = {};
    for (const s of SPECIES) {
      let n = 0;
      v.template(s.id)!.traverse((o) => { if ((o as THREE.Bone).isBone) n += 1; });
      bones[s.id] = n;
    }
    const buildTo = (count: (id: CreatureId) => number): number => {
      for (const id of CREATURE_IDS) v.setPoolSize(id, 0);
      const began = performance.now();
      for (const id of CREATURE_IDS) v.setPoolSize(id, count(id));
      return performance.now() - began;
    };
    // Warm the paths first — the first clone of a template pays for
    // everything V8 has not seen yet, and that is not what is being
    // compared here.
    buildTo((id) => poolSizeFor('medium', id));
    const wasMs = buildTo((id) => poolSizeFor('medium', id));
    const nowMs = buildTo(() => rigBudgetFor('medium'));
    const wasClones = CREATURE_IDS.reduce((sum, id) => sum + poolSizeFor('medium', id), 0);
    const nowClones = CREATURE_IDS.length * rigBudgetFor('medium');
    // eslint-disable-next-line no-console
    console.info(
      `[fauna pools] medium, the wild three (bones: worm ${bones.earthworm}, aphid ${bones.aphid}, fly ${bones.housefly}): `
      + `${wasClones} clones in ${wasMs.toFixed(2)} ms by the rung table, ${nowClones} clones in ${nowMs.toFixed(2)} ms at the budget `
      + `(${(nowMs / Math.max(wasMs, 1e-6)).toFixed(1)}x for ${(nowClones / wasClones).toFixed(1)}x the clones)`,
    );
    v.clearPoolSizes();
    for (const id of CREATURE_IDS) expect(v.poolSize(id)).toBe(rigBudgetFor('medium'));
    // It is a load-time cost and it stays one: the clones past the first
    // few are never posed and never drawn until one is lent.
    expect(nowMs).toBeLessThan(250);
  });

  it('lends rigs to the nearest non-far creatures, impostors for the rest, nothing for the far, never past the cap', async () => {
    const v = await keep(view('ultra-low'));
    const n = rigBudgetFor('ultra-low');
    const cap = impostorCapFor(APHID, 'ultra-low');
    const near: CreatureState[] = [];
    // Two units apart from the eye outwards, so the first n are inside
    // the near line and the rest trail out past the far one.
    for (let i = 0; i < 40; i += 1) near.push(creature('aphid', `a${i}`, 4 + i * 2, 0, { tier: i % 2 === 0 ? 'full' : 'near' }));
    const far = [creature('aphid', 'far', 1, 0, { tier: 'far' }), creature('aphid', 'far2', 2, 0, { tier: 'far' })];
    v.update([...far, ...near], EYE, 1 / 60);
    expect(v.cost.rigsLent.aphid).toBe(n);
    // The nearest N drawn creatures hold the rigs — never the far ones, however near they are.
    const holders = new Set(v.holders('aphid'));
    for (let i = 0; i < n; i += 1) expect(holders.has(`a${i}`)).toBe(true);
    expect(holders.has('far')).toBe(false);
    expect(v.cost.impostors.aphid).toBe(Math.min(cap, 40 - n));
    expect(v.cost.impostors.aphid).toBeLessThanOrEqual(cap);
    expect(v.impostor('aphid')!.count).toBe(v.cost.impostors.aphid);
    // And the impostor sits where its creature is, turned to its heading, on the ground.
    const m = new THREE.Matrix4();
    v.impostor('aphid')!.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const first = toLocal(near[n].at);
    expect(p.x).toBeCloseTo(first.lx, 5);
    expect(p.z).toBeCloseTo(first.lz, 5);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(unitsOfMm(APHID.lengthMm));
  });

  it('keeps a rig with its creature across frames, and hands it to the nearer one when the pool is the constraint', async () => {
    const v = await keep(view('ultra-low'));
    // One clone, so nearness has to be settled rather than accommodated.
    v.setPoolSize('earthworm', 1);
    const a = creature('earthworm', 'A', 10, 0, { behaviour: 'surface' });
    const b = creature('earthworm', 'B', 11, 0, { behaviour: 'surface' });
    v.update([a, b], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['A']);
    // B edges nearer: the one clone follows the nearest animal, and
    // there is no margin to hide behind when there is only one.
    b.at = world(9.5, 0);
    for (let f = 0; f < 5; f += 1) v.update([a, b], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['B']);
    expect(v.cost.impostors.earthworm).toBe(1);
    // A creature that stops being drawn releases its rig.
    b.behaviour = 'burrow';
    v.update([a, b], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['A']);
    // A creature that leaves the list releases it too.
    v.update([b], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual([]);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    expect(v.rigs('earthworm')[0].visible).toBe(false);
  });

  it('measures distance in 3D when the eye\'s height is given', async () => {
    const v = await keep(view('ultra-low'));
    // Flat, `high` is much the nearer; in 3D it is the further, and both
    // are inside the near line either way so only the ORDER tells.
    const low = creature('aphid', 'low', 50, 0, { height: 0 });
    const high = creature('aphid', 'high', 20, 0, { height: 48 });
    v.update([low, high], EYE, 1 / 60, 0);
    expect(held(v, 'aphid')).toEqual(['low', 'high']);
    // Flat distance: the high one is nearer and sorts first when the pool is rebuilt from free.
    v.setEnabled('aphid', false);
    v.setEnabled('aphid', true);
    v.update([low, high], EYE, 1 / 60);
    expect(held(v, 'aphid')).toEqual(['high', 'low']);
  });

  it('rebuilds the pools and the caps on a new rung, and switches a species off entirely', async () => {
    const v = await keep(view('ultra-low'));
    expect(v.rigs('aphid')).toHaveLength(rigBudgetFor('ultra-low'));
    v.setRung('high');
    expect(v.detail).toBe('high');
    expect(v.rigs('aphid')).toHaveLength(rigBudgetFor('high'));
    expect(v.impostor('aphid')!.instanceMatrix.count).toBe(impostorCapFor(APHID, 'high'));
    const aphids = Array.from({ length: 10 }, (_, i) => creature('aphid', `a${i}`, 10 + i, 0));
    v.update(aphids, EYE, 1 / 60);
    // Ten aphids inside the near line and twenty rigs budgeted at high: all ten wear one.
    expect(v.cost.rigsLent.aphid).toBe(Math.min(10, rigBudgetFor('high')));
    v.setEnabled('aphid', false);
    expect(v.isEnabled('aphid')).toBe(false);
    expect(v.group.getObjectByName('fauna:aphid')!.visible).toBe(false);
    expect(v.cost.rigsLent.aphid).toBe(0);
    expect(v.cost.impostors.aphid).toBe(0);
    v.update(aphids, EYE, 1 / 60);
    expect(v.cost.rigsLent.aphid).toBe(0);
    expect(v.holders('aphid').every((h) => h === null)).toBe(true);
    // A species switched off is drawn in no form, and the census says which.
    expect(v.cost.hidden).toBe(10);
    expect(v.cost.notDrawn).toBe(10);
    v.setEnabled('aphid', true);
    v.update(aphids, EYE, 1 / 60);
    expect(v.group.getObjectByName('fauna:aphid')!.visible).toBe(true);
    expect(v.cost.rigsLent.aphid).toBe(Math.min(10, rigBudgetFor('high')));
  });

  it('shrugs off a non-finite eye and a bad dt', async () => {
    const v = await keep(view('ultra-low'));
    const a = creature('aphid', 'a', 10, 0);
    v.update([a], EYE, 1 / 60);
    expect(v.cost.rigsLent.aphid).toBe(1);
    expect(() => v.update([a], world(Number.NaN, 0), 1 / 60)).not.toThrow();
    expect(() => v.update([a], EYE, Number.NaN)).not.toThrow();
    expect(() => v.update([a], EYE, -1)).not.toThrow();
    expect(v.cost.rigsLent.aphid).toBe(1);
    expect(Number.isFinite(v.rigs('aphid')[0].position.x)).toBe(true);
  });
});

describe('the size is the animal\'s, not the species\'', () => {
  // Joshua, 2026-09-08: "about the Earthworm it should be based on size
  // and dynamic". Every worm was 150 mm and every worm was drawn the
  // same. These are the two lengths the table itself cites as the ends
  // of a real night crawler (`EARTHWORM.lengthRangeMm`), so nothing here
  // is an invented size.
  const [SMALL_MM, BIG_MM] = EARTHWORM.lengthRangeMm;
  const SMALL = unitsOfMm(SMALL_MM);
  const BIG = unitsOfMm(BIG_MM);

  /** The head-to-tail distance of a drawn chain, world units. */
  function spanOf(v: FaunaView, k: number): number {
    const root = v.rigs('earthworm')[k];
    v.group.updateMatrixWorld(true);
    const names = v.anatomy('earthworm')!.chain!.bones;
    const head = worldPosition(root.getObjectByName(names[0])!);
    const tail = worldPosition(root.getObjectByName(names[names.length - 1])!);
    return head.distanceTo(tail);
  }

  it('draws two worms of different lengths at their own scales, spans and trail spacings', async () => {
    const v = await keep(view('medium'));
    const small = creature('earthworm', 'small', 5, 0, { behaviour: 'surface', heading: Math.PI / 2, lengthMm: SMALL_MM });
    const big = creature('earthworm', 'big', 9, 0, { behaviour: 'surface', heading: Math.PI / 2, lengthMm: BIG_MM });
    v.update([small, big], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['small', 'big']);

    // THE ROOT SCALE. The template's is the species'; each lent rig wears
    // it through its holder's ratio, so the two differ by exactly the
    // ratio of the two bodies and neither is the species' own number.
    const template = v.scaleOf('earthworm');
    expect(template).toBeCloseTo(rigScale(EARTHWORM), 12);
    const scales = v.rigs('earthworm').map((r) => r.scale.x);
    expect(scales[0]).toBeCloseTo(template * (SMALL_MM / EARTHWORM.lengthMm), 12);
    expect(scales[1]).toBeCloseTo(template * (BIG_MM / EARTHWORM.lengthMm), 12);
    expect(scales[1] / scales[0]).toBeCloseTo(BIG_MM / SMALL_MM, 12);
    for (const r of v.rigs('earthworm')) {
      expect(r.scale.y).toBeCloseTo(r.scale.x, 12);
      expect(r.scale.z).toBeCloseTo(r.scale.x, 12);
    }

    // THE BONES SPAN THEIR OWN BODY. `layChain` lands each station at its
    // rest total times the root scale, so the drawn spine is the animal's
    // length and not the table's — which is the half a root scale alone
    // would get wrong if the stations were still the species'.
    expect(spanOf(v, 0)).toBeCloseTo(SMALL, 3);
    expect(spanOf(v, 1)).toBeCloseTo(BIG, 3);

    // THE TRAIL. Sixteen crumbs to each animal's own body.
    const spacings = v.trailSpacings('earthworm');
    expect(spacings[0]).toBeCloseTo(SMALL / CRUMBS_PER_LENGTH, 12);
    expect(spacings[1]).toBeCloseTo(BIG / CRUMBS_PER_LENGTH, 12);
  });

  it('TAKES THE NEW HOLDER\'S SIZE ON THE FRAME A RIG CHANGES HANDS', async () => {
    // The pool is built per species and its clones all wear the
    // template's scale, so a rig that only took a size when it was BUILT
    // would draw this big worm at the small one's length for as long as
    // it held the rig — and the pool is only rebuilt by a rung change,
    // which need never come.
    const v = await keep(view('ultra-low'));
    v.setPoolSize('earthworm', 1);
    const small = creature('earthworm', 'small', 50, 0, { behaviour: 'surface', heading: Math.PI / 2, lengthMm: SMALL_MM });
    const big = creature('earthworm', 'big', 10, 0, { behaviour: 'surface', heading: Math.PI / 2, lengthMm: BIG_MM });
    v.update([small], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['small']);
    expect(v.rigs('earthworm')[0].scale.x).toBeCloseTo(rigScale(EARTHWORM) * (SMALL_MM / EARTHWORM.lengthMm), 12);
    expect(spanOf(v, 0)).toBeCloseTo(SMALL, 3);

    // The big one arrives four times nearer — well past the hysteresis
    // margin — and the one rig goes to it. ONE frame; nothing after it.
    v.update([small, big], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['big']);
    expect(v.rigs('earthworm')[0].scale.x).toBeCloseTo(rigScale(EARTHWORM) * (BIG_MM / EARTHWORM.lengthMm), 12);
    expect(spanOf(v, 0)).toBeCloseTo(BIG, 3);
    expect(v.trailSpacings('earthworm')[0]).toBeCloseTo(BIG / CRUMBS_PER_LENGTH, 12);
    // And the small one it dropped is now an impostor at ITS length.
    const m = v.impostor('earthworm')!.instanceMatrix.array as Float32Array;
    expect(v.cost.impostors.earthworm).toBe(1);
    expect(Math.hypot(m[8], m[10]) * 2).toBeCloseTo(SMALL, 4);
  });

  it('gives every impostor past the pool its own length and girth', async () => {
    const v = await keep(view('ultra-low'));
    v.setPoolSize('earthworm', 1);
    const one = creature('earthworm', 'held', 4, 0, { behaviour: 'surface', lengthMm: EARTHWORM.lengthMm });
    const s = creature('earthworm', 's', 20, 0, { behaviour: 'surface', lengthMm: SMALL_MM });
    const b = creature('earthworm', 'b', 30, 0, { behaviour: 'surface', lengthMm: BIG_MM });
    v.update([one, s, b], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['held']);
    expect(v.cost.impostors.earthworm).toBe(2);
    const m = v.impostor('earthworm')!.instanceMatrix.array as Float32Array;
    // Nearest first: the ellipsoid's long half-axis is its third column,
    // its girth radius the first, both in the species' colour and neither
    // in the species' size.
    for (const [k, mm] of [[0, SMALL_MM], [1, BIG_MM]] as const) {
      const o = k * 16;
      const length = unitsOfMm(mm);
      expect(Math.hypot(m[o + 8], m[o + 10]) * 2).toBeCloseTo(length, 4);
      expect(Math.hypot(m[o], m[o + 2]) * 2).toBeCloseTo(length * LOOK.earthworm.girth, 5);
    }
  });

  it('hides a burrower at ITS OWN depth: the soil that swallows a small worm still shows a big one', async () => {
    // `BURROW_HIDE` measures when a body has gone out of sight, and a
    // body goes out of sight at its own girth. At the same depth under
    // the same ground the small worm is under the soil and the big one
    // is still showing, so one is drawn and the other is not.
    const GROUND = 10;
    const v = await keep(view('medium', loader(), { groundAt: () => GROUND }));
    // Both are met for the first time, so both are judged at the line
    // itself rather than at `BURROW_KEEP` past it.
    const smallLine = BURROW_HIDE * (SMALL_MM / EARTHWORM.lengthMm);
    const bigLine = BURROW_HIDE * (BIG_MM / EARTHWORM.lengthMm);
    const depth = (smallLine + bigLine) / 2;
    expect(depth).toBeGreaterThan(smallLine);
    expect(depth).toBeLessThan(bigLine);
    const small = creature('earthworm', 'small', 5, 0, { behaviour: 'burrow', height: GROUND - depth, lengthMm: SMALL_MM });
    const big = creature('earthworm', 'big', 6, 0, { behaviour: 'burrow', height: GROUND - depth, lengthMm: BIG_MM });
    v.update([small, big], EYE, 1 / 60, GROUND + 50);
    expect(held(v, 'earthworm')).toEqual(['big']);
    expect(v.cost.impostors.earthworm).toBe(0);
  });
});

describe('the worm', () => {
  it('is not drawn while burrowed, and lies on the ground when surfaced', async () => {
    const v = await keep(view('ultra-low'));
    const under = creature('earthworm', 'under', 5, 0, { behaviour: 'burrow', height: -1.2 });
    v.update([under], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    expect(v.cost.impostors.earthworm).toBe(0);
    const up = creature('earthworm', 'up', 5, 3, { behaviour: 'surface', height: 12, heading: 0.4 });
    v.update([up], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(1);
    const root = v.rigs('earthworm')[0];
    expect(root.visible).toBe(true);
    v.group.updateMatrixWorld(true);
    const head = root.getObjectByName('Bone_000')!;
    const p = worldPosition(head);
    const here = toLocal(up.at);
    expect(p.x).toBeCloseTo(here.lx, 4);
    expect(p.z).toBeCloseTo(here.lz, 4);
    // The chain's axis is lifted one skin radius so the belly rests on the ground.
    const lift = v.anatomy('earthworm')!.chain!.lift * v.scaleOf('earthworm');
    expect(p.y).toBeCloseTo(12 + lift, 4);
    expect(lift).toBeGreaterThan(0);
    expect(lift).toBeLessThan(unitsOfMm(EARTHWORM.lengthMm) * 0.1);
  });

  it('reveals a buried worm at its real height when the soil ceiling is cut away', async () => {
    let ceiling = 10;
    const v = await keep(view('ultra-low', loader(), { groundAt: () => 10, ceilingAt: () => ceiling }));
    const worm = creature('earthworm', 'buried-section', 0, 0, { height: 8.8, behaviour: 'burrow' });
    v.update([worm], world(0, 0), 0, 12);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    ceiling = 8.8;
    v.update([worm], world(0, 0), 0, 12);
    expect(v.cost.rigsLent.earthworm).toBe(1);
    const bones: THREE.Bone[] = [];
    v.group.traverse(o => { if (o instanceof THREE.Bone) bones.push(o); });
    v.group.updateMatrixWorld(true);
    expect(bones.length).toBeGreaterThan(0);
    expect(bones.some(b => b.getWorldPosition(new THREE.Vector3()).y < 9.5)).toBe(true);
    expect(worm.height).toBe(8.8);
  });

  it('LIES ON THE GROUND on a slope, dragging no part of itself through the hill', async () => {
    // Joshua, 2026-09-08, with the finder on: the worm is "halfway on the
    // surface and ground like it's swimming".
    //
    // THE CAUSE IS THE SEEDED TRAIL. A worm gets a rig the moment it is
    // near enough and shallow enough to draw, and `lend` seeds its whole
    // trail as a STRAIGHT LINE of crumbs behind it AT ITS OWN HEIGHT —
    // there is no history to use, the simulation keeps a point and not a
    // body. The ground is not a straight line, so on any slope the far
    // half of the body is inside the hill, and it stays there until the
    // worm has crawled a whole body length: 150 mm at the 3 mm/s wander
    // pace is fifty seconds, which is most of a surfacing.
    const BASE = 100;
    const SLOPE = 0.3;
    // Rising towards -X, which is where the crumbs are laid: heading π/2
    // is ahead = +X, so the body trails uphill behind the head.
    const groundAt = (at: WorldPoint): number => BASE - at.wx * SLOPE;
    const v = await keep(view('ultra-low', loader(), { groundAt }));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'surface', heading: Math.PI / 2, height: BASE });
    v.update([w], EYE, 1 / 60);
    v.group.updateMatrixWorld(true);

    const root = v.rigs('earthworm')[0];
    expect(root.visible).toBe(true);
    const lift = v.anatomy('earthworm')!.chain!.lift * v.scaleOf('earthworm');
    const body = unitsOfMm(EARTHWORM.lengthMm);
    // NOT ONE BONE of the drawn body is under the ground beneath it, and
    // none of it is hovering a body length over it either.
    const names = EARTHWORM.model.chain ?? [];
    const bones = names.map((name) => root.getObjectByName(name));
    expect(bones.filter((b) => b !== undefined).length).toBe(names.length);
    expect(names.length).toBeGreaterThan(2);
    let buried = 0;
    for (const bone of bones) {
      const p = worldPosition(bone!);
      const ground = groundAt(world(p.x, p.z));
      if (p.y < ground - 1e-3) buried += 1;
      expect(p.y, `${bone!.name} is ${(ground - p.y).toFixed(2)} units under the ground`).toBeGreaterThanOrEqual(ground - 1e-3);
      expect(p.y).toBeLessThan(ground + lift + body * 0.25);
    }
    expect(buried).toBe(0);
  });

  it('GOES WITH A GROUND THAT MOVES: an HD tile landing under it does not stand the body on end', async () => {
    // Joshua, 2026-09-08, with a screenshot: "The worm was doing a weird
    // thing and also teleporting randomly." The weird thing is an L — a
    // vertical column of worm rising out of the ground with the rest of
    // the body lying horizontally at the top of it.
    //
    // THE GROUND HERE MOVES. `Heightfield.heightAt` answers from the
    // coarse lattice until an HD tile lands and from the tile after, and
    // the two differ by whatever detail the tile adds. alpha.26 stored
    // each crumb's ABSOLUTE height and raised it to the ground at draw
    // time, which is one-sided: when the ground drops, the creature goes
    // down with it (`locomotion.burrow` re-clamps it into the band the
    // same tick) and every crumb stays pinned at the height the old
    // lattice had. The chain is then laid up the gap. Measured against
    // the real rig before the fix: a 2 m drop stood all 15 cm of body
    // vertical, and a 10 cm drop drew 10 of vertical and 5 of
    // horizontal — the photograph. A worm wanders 3 mm a second, so it
    // drops a crumb every six seconds and the shape stands for over a
    // minute; a `surface` worm's pace is zero and it never drops one.
    //
    // A crumb remembers a DEPTH now, so the body moves with the ground.
    let ground = 100;
    const v = await keep(view('ultra-low', loader(), { groundAt: () => ground }));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'surface', heading: Math.PI / 2, height: ground });
    const body = unitsOfMm(EARTHWORM.lengthMm);
    const lift = () => v.anatomy('earthworm')!.chain!.lift * v.scaleOf('earthworm');
    const names = EARTHWORM.model.chain ?? [];
    const extent = (): { high: number; low: number } => {
      v.group.updateMatrixWorld(true);
      const root = v.rigs('earthworm')[0];
      expect(root.visible).toBe(true);
      let high = -Infinity;
      let low = Infinity;
      for (const name of names) {
        const p = worldPosition(root.getObjectByName(name)!);
        if (p.y > high) high = p.y;
        if (p.y < low) low = p.y;
      }
      return { high, low };
    };
    // A real trail first: a whole body length of crawling, so nothing
    // that follows is answered by the seeded straight line.
    for (let f = 0; f < 200; f += 1) {
      w.at = world(w.at.wx + body / 100, w.at.wz);
      v.update([w], EYE, 1 / 60);
    }
    expect(extent().high - extent().low).toBeLessThan(1e-6);

    // THE TILE LANDS and the ground drops two metres. The worm follows it.
    ground -= 200;
    w.height = ground;
    v.update([w], EYE, 1 / 60);
    const after = extent();
    expect(after.high - after.low).toBeLessThan(1e-6);
    expect(after.high).toBeCloseTo(ground + lift(), 6);
    // And the same for a drop the size of the one in the photograph.
    ground += 190;
    w.height = ground;
    v.update([w], EYE, 1 / 60);
    expect(extent().high).toBeCloseTo(ground + lift(), 6);
  });

  it('LAYS A FRESH TRAIL when its creature is moved rather than crawls, instead of reaching back to where it was', async () => {
    // A creature is streamed out and generated again at the spot its
    // cell's hash puts it, and a rig held across that would draw the
    // body between where the animal is and where it was. A trail is a
    // record of a crawl; a broken crawl is not a record of anything.
    const v = await keep(view('ultra-low', loader(), { groundAt: () => 10 }));
    // A NAMED POOL HAS NO BAND: this is about the trail's world points,
    // not about the distance policy, and the worm walks metres from the eye.
    v.setPoolSize('earthworm', 1);
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'surface', heading: Math.PI / 2, height: 10 });
    const body = unitsOfMm(EARTHWORM.lengthMm);
    for (let f = 0; f < 200; f += 1) {
      w.at = world(w.at.wx + body / 100, w.at.wz);
      v.update([w], EYE, 1 / 60);
    }
    w.at = world(w.at.wx, w.at.wz + 500);
    v.update([w], EYE, 1 / 60);
    v.group.updateMatrixWorld(true);
    const root = v.rigs('earthworm')[0];
    const here = toLocal(w.at);
    const names = EARTHWORM.model.chain ?? [];
    const head = worldPosition(root.getObjectByName(names[0])!);
    expect(head.x).toBeCloseTo(here.lx, 4);
    expect(head.z).toBeCloseTo(here.lz, 4);
    let behind = 0;
    for (const name of names) {
      const p = worldPosition(root.getObjectByName(name)!);
      // Every bone is within a body length of where the animal now is,
      // and on the head's own line: heading π/2 is ahead = +X, so the
      // body lies BEHIND the head along −X, not stretched back down −Z
      // toward the place it was moved from.
      expect(Math.hypot(p.x - here.lx, p.z - here.lz), name).toBeLessThanOrEqual(body + 1e-6);
      expect(Math.abs(p.z - head.z), name).toBeLessThan(body * 0.05);
      behind = Math.max(behind, head.x - p.x);
    }
    expect(behind).toBeGreaterThan(body * 0.9);
  });

  it('is hidden by DEPTH when the ground is known: within the margin of the surface it is drawn, whatever it is doing', async () => {
    const v = await keep(view('ultra-low', loader(), { groundAt: () => 10 }));
    const nosing = creature('earthworm', 'nosing', 5, 0, { behaviour: 'burrow', height: 10 - BURROW_HIDE + 0.01 });
    const deep = creature('earthworm', 'deep', 6, 0, { behaviour: 'surface', height: 10 - BURROW_HIDE - 0.01 });
    v.update([nosing, deep], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['nosing']);
    expect(v.cost.impostors.earthworm).toBe(0);
  });

  it('lays its chain along the trail: after a straight walk every bone points down the path, head on the creature, tail behind', async () => {
    const v = await keep(view('ultra-low'));
    // Heading π/2: ahead is +X.
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'surface', heading: Math.PI / 2, height: 0 });
    const body = unitsOfMm(EARTHWORM.lengthMm);
    const step = body / 30;
    for (let f = 0; f < 90; f += 1) {
      w.at = world(w.at.wx + step, w.at.wz);
      v.update([w], EYE, 1 / 60);
    }
    v.group.updateMatrixWorld(true);
    const root = v.rigs('earthworm')[0];
    const chain = v.anatomy('earthworm')!.chain!.bones.map((name) => root.getObjectByName(name)!);
    const points = chain.map(worldPosition);
    const here = toLocal(w.at);
    expect(points[0].x).toBeCloseTo(here.lx, 3);
    expect(points[0].z).toBeCloseTo(here.lz, 3);
    // The chain runs BACK from the head down the path it walked: each
    // bone lies further along −X than the one before it.
    for (let i = 1; i < points.length; i += 1) {
      const d = points[i].clone().sub(points[i - 1]);
      const along = -d.x / d.length();
      expect(along, `bone ${i} lies along the walk`).toBeGreaterThan(0.995);
      expect(Math.abs(d.z)).toBeLessThan(1e-3);
      expect(Math.abs(d.y)).toBeLessThan(1e-3);
    }
    // The tail is one drawn body behind the head, and every segment is
    // its OWN rest length: the stations are the running totals of the
    // rest pose and nothing else, so along a straight walk no bone is
    // anywhere but where its bone lengths put it. Nothing stretches —
    // `tests/faunaMotion.test.ts` pins the rule itself.
    const drawn = v.anatomy('earthworm')!.spine * v.scaleOf('earthworm');
    expect(here.lx - points[points.length - 1].x).toBeCloseTo(drawn, 3);
    const lengths = v.anatomy('earthworm')!.chain!.lengths;
    for (let i = 1; i < points.length; i += 1) {
      const rest = lengths[i - 1] * v.scaleOf('earthworm');
      expect(points[i].distanceTo(points[i - 1]) / rest, `segment ${i} is its rest length`).toBeCloseTo(1, 6);
    }
  });

  it('bends along a turn: after a corner the head points the new way and the tail still lies along the old', async () => {
    const v = await keep(view('ultra-low'));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'surface', heading: Math.PI / 2 });
    const body = unitsOfMm(EARTHWORM.lengthMm);
    const step = body / 30;
    for (let f = 0; f < 60; f += 1) { w.at = world(w.at.wx + step, w.at.wz); v.update([w], EYE, 1 / 60); }
    // Turn to +Z and walk a quarter body.
    w.heading = 0;
    for (let f = 0; f < 8; f += 1) { w.at = world(w.at.wx, w.at.wz + step); v.update([w], EYE, 1 / 60); }
    v.group.updateMatrixWorld(true);
    const root = v.rigs('earthworm')[0];
    const chain = v.anatomy('earthworm')!.chain!.bones.map((name) => root.getObjectByName(name)!);
    const points = chain.map(worldPosition);
    const headDir = points[1].clone().sub(points[0]).normalize();
    const tailDir = points[points.length - 1].clone().sub(points[points.length - 2]).normalize();
    // The head has turned to +Z (it walks toward +Z; the chain runs back from it, so the direction is −Z).
    expect(headDir.z).toBeLessThan(-0.9);
    // The tail still lies along the earlier walk (−X, running back).
    expect(tailDir.x).toBeLessThan(-0.9);
  });

  it('keeps its trail in world points: an origin shift moves the drawn body with the world', async () => {
    let shift = 0;
    const origin = { toLocal: (at: WorldPoint): LocalPoint => local(at.wx - shift, at.wz) };
    const v = await keep(view('ultra-low', loader(), { origin }));
    // A NAMED POOL HAS NO BAND: this is about the trail's world points,
    // not about the distance policy, and the worm walks metres from the eye.
    v.setPoolSize('earthworm', 1);
    const w = creature('earthworm', 'w', 100, 0, { behaviour: 'surface', heading: Math.PI / 2 });
    for (let f = 0; f < 40; f += 1) { w.at = world(w.at.wx + 0.5, w.at.wz); v.update([w], EYE, 1 / 60); }
    v.group.updateMatrixWorld(true);
    const root = v.rigs('earthworm')[0];
    const head = root.getObjectByName('Bone_000')!;
    const tail = root.getObjectByName('Bone_001')!;
    const headBefore = worldPosition(head);
    const tailBefore = worldPosition(tail);
    // The origin jumps; the creature does not move and no time passes,
    // so the pose is the same pose drawn from the new origin.
    shift = 1024;
    v.update([w], EYE, 0);
    v.group.updateMatrixWorld(true);
    const headAfter = worldPosition(head);
    const tailAfter = worldPosition(tail);
    expect(headAfter.x).toBeCloseTo(headBefore.x - 1024, 3);
    expect(headAfter.z).toBeCloseTo(headBefore.z, 6);
    expect(tailAfter.x).toBeCloseTo(tailBefore.x - 1024, 3);
    expect(tailAfter.z).toBeCloseTo(tailBefore.z, 6);
  });

  it('DECIDES THE REVEAL ONCE FOR THE WHOLE BODY: a ceiling that flips every frame moves nothing and hides nothing', async () => {
    // Joshua, 2026-09-08, from the phone, on the soil cutaway: it "still
    // randomly throws the worm above and below ground", and "for a
    // moment saw the worm rotate around like a straight log".
    //
    // THE CUTAWAY IS MESHED A TILE AT A TIME, and a soil tile is 3.2
    // units — a fifth of this animal. The ready set grows two tiles a
    // frame and shrinks as the section moves, so the point under a
    // worm's head answers "the roof is off here" one frame and "it is
    // not" the next. Taken from the HEAD and applied to every crumb of
    // the body, that one boolean moved the whole animal by the belly
    // lift and the depth clamp, and hid it on the same flip — and a
    // hidden animal loses its rig, while a rig lent again lays its trail
    // STRAIGHT along the current heading, which is the log.
    //
    // Here the ceiling flips every single frame, which is the worst the
    // tiles can do, and the drawn body must not notice.
    const GROUND = 100;
    const DEPTH = 1.2;
    let open = true;
    const v = await keep(view('ultra-low', loader(), {
      groundAt: () => GROUND,
      ceilingAt: () => (open ? GROUND - 20 : GROUND),
    }));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'burrow', heading: Math.PI / 2, height: GROUND - DEPTH });
    const names = EARTHWORM.model.chain ?? [];
    const extent = (): { high: number; low: number } => {
      v.group.updateMatrixWorld(true);
      const root = v.rigs('earthworm')[0];
      let high = -Infinity;
      let low = Infinity;
      for (const name of names) {
        const p = worldPosition(root.getObjectByName(name)!);
        if (p.y > high) high = p.y;
        if (p.y < low) low = p.y;
      }
      return { high, low };
    };
    const seen: { high: number; low: number }[] = [];
    // Twice the hold, so this pins that an alternating fact never
    // accumulates a run rather than that it is merely slow to be
    // believed.
    for (let f = 0; f < REVEAL_HOLD * 2; f += 1) {
      v.update([w], EYE, 1 / 60);
      expect(v.cost.rigsLent.earthworm, `frame ${f}`).toBe(1);
      expect(held(v, 'earthworm'), `frame ${f}`).toEqual(['w']);
      expect(v.rigs('earthworm')[0].visible, `frame ${f}`).toBe(true);
      seen.push(extent());
      open = !open;
    }
    const high = seen.map((e) => e.high);
    const low = seen.map((e) => e.low);
    expect(Math.max(...high) - Math.min(...high)).toBeLessThan(1e-9);
    expect(Math.max(...low) - Math.min(...low)).toBeLessThan(1e-9);
    // And it is drawn IN ITS BURROW throughout — at its own height, not
    // clamped up onto the surface and lifted by the belly radius, which
    // is the jump the flip used to make.
    expect(high[0]).toBeCloseTo(GROUND - DEPTH, 6);
    expect(w.height).toBe(GROUND - DEPTH);
  });

  it('ASKS THE WHOLE BODY, NOT THE NOSE: an unmeshed tile under the head does not shut the reveal, nor one open tile open it', async () => {
    const GROUND = 100;
    const DEPTH = 1.2;
    // Heading π/2 is ahead = +X, so the body trails back along −X and
    // the five samples land at 0, −3.75, −7.5, −11.25 and −15 — a sample
    // every 1.2 soil tiles.
    const head = (at: WorldPoint): boolean => at.wx > -SOIL_TILE;
    const bodyOpen = await keep(view('ultra-low', loader(), {
      groundAt: () => GROUND,
      ceilingAt: (at) => (head(at) ? GROUND : GROUND - 20),
    }));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'burrow', heading: Math.PI / 2, height: GROUND - DEPTH });
    bodyOpen.update([w], EYE, 1 / 60);
    expect(bodyOpen.cost.rigsLent.earthworm).toBe(1);
    bodyOpen.group.updateMatrixWorld(true);
    const names = EARTHWORM.model.chain ?? [];
    for (const name of names) {
      const p = worldPosition(bodyOpen.rigs('earthworm')[0].getObjectByName(name)!);
      expect(p.y, name).toBeCloseTo(GROUND - DEPTH, 6);
    }
    // The mirror: the roof off under the nose alone is one sample in
    // five, which is not a cutaway over this body.
    const noseOnly = await keep(view('ultra-low', loader(), {
      groundAt: () => GROUND,
      ceilingAt: (at) => (head(at) ? GROUND - 20 : GROUND),
    }));
    noseOnly.update([w], EYE, 1 / 60);
    expect(noseOnly.cost.rigsLent.earthworm).toBe(0);
    expect(noseOnly.cost.impostors.earthworm).toBe(0);
    expect(BODY_SAMPLES).toBeGreaterThan(2);
  });

  it('SHUTS when the cutaway genuinely goes — after the hold, and not before', async () => {
    const GROUND = 100;
    let open = true;
    const v = await keep(view('ultra-low', loader(), {
      groundAt: () => GROUND,
      ceilingAt: () => (open ? GROUND - 20 : GROUND),
    }));
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'burrow', heading: Math.PI / 2, height: GROUND - 1.2 });
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(1);
    // The section is closed and stays closed. The body is held for the
    // hold — nothing is urgent about hiding a worm — and then it goes.
    open = false;
    for (let f = 1; f < REVEAL_HOLD; f += 1) {
      v.update([w], EYE, 1 / 60);
      expect(v.cost.rigsLent.earthworm, `frame ${f}`).toBe(1);
    }
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    expect(v.cost.impostors.earthworm).toBe(0);
    // And it comes back the frame the roof comes off, without waiting.
    open = true;
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(1);
  });

  it('KEEPS A DRAWN BURROWER DRAWN across the depth line, and hides one first met below it', async () => {
    // The rig pool keeps a rig with a margin; a body keeps its reveal
    // the same way. A worm nosing about at the surface sits on the line
    // for many seconds, and a line with no band is a line to blink on.
    const v = await keep(view('ultra-low', loader(), { groundAt: () => 10 }));
    const w = creature('earthworm', 'w', 5, 0, { behaviour: 'burrow', height: 10 - BURROW_HIDE + 0.01 });
    v.update([w], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['w']);
    // Past the line, still within the margin: it does not blink out.
    w.height = 10 - BURROW_HIDE * BURROW_KEEP + 0.01;
    v.update([w], EYE, 1 / 60);
    expect(held(v, 'earthworm')).toEqual(['w']);
    // Past the margin it goes, and it does not come back until it is
    // above the line itself rather than merely above the margin.
    w.height = 10 - BURROW_HIDE * BURROW_KEEP - 0.01;
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    w.height = 10 - BURROW_HIDE - 0.01;
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(0);
    w.height = 10 - BURROW_HIDE + 0.01;
    v.update([w], EYE, 1 / 60);
    expect(v.cost.rigsLent.earthworm).toBe(1);
  });

  it('NEVER LAYS THE TRAIL STRAIGHT AGAIN while the ceiling chatters: the body keeps the corner it crawled', async () => {
    // The log. A blink costs the animal its rig, and `lend` seeds a
    // straight trail along the current heading because there is no
    // history to use — so a body that blinks is a body redrawn as a
    // stick pointing wherever the head happens to face, over and over.
    // With the reveal decided for the whole animal the rig is never
    // released, and the record of the crawl survives.
    const GROUND = 100;
    let open = true;
    const v = await keep(view('ultra-low', loader(), {
      groundAt: () => GROUND,
      ceilingAt: () => (open ? GROUND - 20 : GROUND),
    }));
    const body = unitsOfMm(EARTHWORM.lengthMm);
    const w = creature('earthworm', 'w', 0, 0, { behaviour: 'burrow', heading: Math.PI / 2, height: GROUND - 1.2 });
    // A body length and a half up +X, then the corner, then half a body
    // up +Z, with the ceiling flipping every frame throughout.
    for (let f = 0; f < 150; f += 1) {
      w.at = world(w.at.wx + body / 100, w.at.wz);
      v.update([w], EYE, 1 / 60);
      open = !open;
    }
    w.heading = 0;
    for (let f = 0; f < 60; f += 1) {
      w.at = world(w.at.wx, w.at.wz + body / 100);
      v.update([w], EYE, 1 / 60);
      open = !open;
    }
    expect(held(v, 'earthworm')).toEqual(['w']);
    v.group.updateMatrixWorld(true);
    const root = v.rigs('earthworm')[0];
    const names = EARTHWORM.model.chain ?? [];
    const nose = worldPosition(root.getObjectByName(names[0])!);
    const here = toLocal(w.at);
    expect(nose.x).toBeCloseTo(here.lx, 4);
    expect(nose.z).toBeCloseTo(here.lz, 4);
    // A re-seeded trail lies straight behind the head along −Z, so every
    // bone would share the head's x. The crawled one turns the corner.
    let spread = 0;
    for (const name of names) spread = Math.max(spread, Math.abs(worldPosition(root.getObjectByName(name)!).x - nose.x));
    expect(spread).toBeGreaterThan(body * 0.2);
  });
});

describe('the fly and the aphid', () => {
  it('draws an airborne fly at its height, pitched and banked by what it did, wings beating', async () => {
    const v = await keep(view('ultra-low'));
    const f = creature('housefly', 'f', 20, 0, { behaviour: 'fly', height: 30, heading: 0 });
    v.update([f], EYE, 1 / 60);
    const root = v.rigs('housefly')[0];
    expect(root.visible).toBe(true);
    expect(root.position.y).toBeCloseTo(30, 9);
    const wings = v.anatomy('housefly')!.wings;
    const bones = wings.map((w) => root.getObjectByName(w.bone) as THREE.Bone);
    const first = bones.map((b) => b.quaternion.clone());
    // Spread, not at rest.
    for (let i = 0; i < wings.length; i += 1) expect(first[i].angleTo(wings[i].rest)).toBeGreaterThan(0.1);
    // Beating: a different angle next frame, and over a few frames a spread of them.
    let changed = 0;
    for (let k = 0; k < 6; k += 1) {
      v.update([f], EYE, 1 / 60);
      if (bones[0].quaternion.angleTo(first[0]) > 1e-3) changed += 1;
      first[0].copy(bones[0].quaternion);
    }
    expect(changed).toBeGreaterThan(3);
    // Climbing and turning: nose up, banked into the turn (a left turn drops the +X side: negative roll).
    for (let k = 0; k < 30; k += 1) {
      f.at = world(f.at.wx + Math.sin(f.heading) * 1.5, f.at.wz + Math.cos(f.heading) * 1.5);
      f.height += 0.5;
      f.heading += 0.05;
      v.update([f], EYE, 1 / 60);
    }
    expect(root.rotation.y).toBeCloseTo(f.heading, 9);
    expect(root.rotation.x).toBeLessThan(-0.05);
    expect(root.rotation.z).toBeLessThan(-0.05);
    expect(root.rotation.order).toBe('YXZ');
  });

  it('folds the wings and stands still when landed; walking swings the legs more than standing stirs them', async () => {
    const v = await keep(view('ultra-low'));
    const f = creature('housefly', 'f', 20, 0, { behaviour: 'idle', height: 0 });
    for (let k = 0; k < 30; k += 1) v.update([f], EYE, 1 / 60);
    const root = v.rigs('housefly')[0];
    const anatomy = v.anatomy('housefly')!;
    for (const w of anatomy.wings) {
      const bone = root.getObjectByName(w.bone) as THREE.Bone;
      expect(bone.quaternion.angleTo(w.rest)).toBeLessThan(1e-6);
    }
    expect(root.position.y).toBeCloseTo(0, 9);
    // The standing stir is small.
    const legs = anatomy.legs.map((l) => ({ bone: root.getObjectByName(l.coxa) as THREE.Bone, rest: l.rest }));
    let stir = 0;
    for (let k = 0; k < 30; k += 1) {
      v.update([f], EYE, 1 / 60);
      for (const l of legs) stir = Math.max(stir, l.bone.quaternion.angleTo(l.rest));
    }
    expect(stir).toBeGreaterThan(0);
    expect(stir).toBeLessThan(0.05);
    // Walking: the swing is the gait's amplitude, and the two halves of the tripod are out of phase.
    f.behaviour = 'wander';
    let swing = 0;
    for (let k = 0; k < 60; k += 1) {
      f.at = world(f.at.wx, f.at.wz + 0.05);
      v.update([f], EYE, 1 / 60);
      for (const l of legs) swing = Math.max(swing, l.bone.quaternion.angleTo(l.rest));
    }
    expect(swing).toBeGreaterThan(0.15);
    expect(swing).toBeLessThan(WING_FLAP);
    const half0 = anatomy.legs.filter((l) => l.phase === 0);
    const half1 = anatomy.legs.filter((l) => l.phase === 1);
    expect(half0).toHaveLength(3);
    expect(half1).toHaveLength(3);
  });

  it('sits an aphid at its host\'s height, breathing at rest, feelers swaying', async () => {
    const v = await keep(view('ultra-low'));
    const a = creature('aphid', 'a', 8, 0, { behaviour: 'feed', height: 25.5, heading: 2 });
    const ys: number[] = [];
    const root = v.rigs('aphid')[0];
    const feelers = v.anatomy('aphid')!.antennae.map((s) => ({ bone: root.getObjectByName(s.bone) as THREE.Bone, rest: s.rest }));
    let sway = 0;
    for (let k = 0; k < 90; k += 1) {
      v.update([a], EYE, 1 / 60);
      ys.push(root.position.y);
      for (const f of feelers) sway = Math.max(sway, f.bone.quaternion.angleTo(f.rest));
    }
    expect(root.rotation.y).toBeCloseTo(2, 9);
    const body = unitsOfMm(APHID.lengthMm);
    for (const y of ys) expect(Math.abs(y - 25.5)).toBeLessThanOrEqual(body * LOOK.aphid.restBob + 1e-9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
    expect(sway).toBeGreaterThan(0.01);
  });
});

describe('a body on a wall', () => {
  const EAST: Vec3 = FACE_NORMALS[0];
  const CEILING: Vec3 = FACE_NORMALS[3];

  function axis(root: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyQuaternion(root.quaternion);
  }

  it('turns the rig so local +Y is the wall\'s normal and local +Z the heading carried onto it, from the first frame', async () => {
    const v = await keep(view('ultra-low'));
    for (const [up, heading] of [[EAST, 0.7], [EAST, -2.1], [CEILING, 0.3], [FACE_NORMALS[5], 1.9]] as const) {
      const a = creature('aphid', 'a', 8, 0, { behaviour: 'wander', height: 110, heading });
      a.up = up;
      v.update([a], EYE, 1 / 60);
      const root = v.rigs('aphid')[0];
      expect(root.visible).toBe(true);
      const y = axis(root, 0, 1, 0);
      const z = axis(root, 0, 0, 1);
      const ahead = aheadOn(up, heading, { x: 0, y: 0, z: 0 });
      expect(y.x).toBeCloseTo(up.x, 9); expect(y.y).toBeCloseTo(up.y, 9); expect(y.z).toBeCloseTo(up.z, 9);
      expect(z.x).toBeCloseTo(ahead.x, 9); expect(z.y).toBeCloseTo(ahead.y, 9); expect(z.z).toBeCloseTo(ahead.z, 9);
      // Lent with this up: the drawn up IS the state's, no ease.
      const drawn = v.drawnUps('aphid')[0];
      expect(drawn.x).toBe(up.x); expect(drawn.y).toBe(up.y); expect(drawn.z).toBe(up.z);
      // Placed on the body's point, and the aphid's resting breath (`LOOK.aphid.restBob`) is ALONG THE NORMAL:
      // exact on the two axes across the face, within the breath along it.
      const breath = unitsOfMm(APHID.lengthMm) * LOOK.aphid.restBob + 1e-9;
      for (const [axisName, want, n] of [['x', 8, up.x], ['y', 110, up.y], ['z', 0, up.z]] as const) {
        const got = root.position[axisName];
        if (n === 0) expect(got, axisName).toBeCloseTo(want, 9);
        else expect(Math.abs(got - want), axisName).toBeLessThanOrEqual(breath);
      }
      v.update([], EYE, 1 / 60);
    }
    // And on the ground the frame is the old yaw: rotation.y the heading, x and z zero.
    const g = creature('aphid', 'g', 8, 0, { behaviour: 'wander', height: 0, heading: 1.3 });
    v.update([g], EYE, 1 / 60);
    const root = v.rigs('aphid')[0];
    expect(root.rotation.y).toBeCloseTo(1.3, 9);
    expect(root.rotation.x).toBeCloseTo(0, 9);
    expect(root.rotation.z).toBeCloseTo(0, 9);
    expect(v.drawnUps('aphid')[0].y).toBe(1);
  });

  it('EASES THE UP round an edge — within a second, settling exactly — with the heading never eased, and SNAPS it on lend', async () => {
    const v = await keep(view('ultra-low'));
    const a = creature('aphid', 'a', 8, 0, { behaviour: 'wander', height: 100, heading: 0.4 });
    // On the ground first, so the rig holds it with WORLD_UP drawn.
    v.update([a], EYE, 1 / 60);
    const root = v.rigs('aphid')[0];
    const drawn = v.drawnUps('aphid')[0];
    expect(drawn.y).toBe(1);
    // The edge: the state's up becomes the east wall's in one frame, and the heading turns too.
    a.up = EAST;
    a.heading = -1.2;
    v.update([a], EYE, 1 / 60);
    // Not a cut: after one frame the drawn up has barely left +y...
    expect(axis(root, 0, 1, 0).y).toBeGreaterThan(0.9);
    expect(drawn.x).toBeGreaterThan(0);
    // ...but the HEADING is the state's already: the ahead is aheadOn(EAST, −1.2) carried onto the drawn up, so it is
    // the state's ahead turned by the small rotation between the two ups — within that angle of it.
    const ahead = aheadOn(EAST, -1.2, { x: 0, y: 0, z: 0 });
    const z = axis(root, 0, 0, 1);
    const upAngle = Math.acos(Math.min(1, drawn.dot(new THREE.Vector3(1, 0, 0))));
    expect(Math.acos(Math.min(1, z.dot(new THREE.Vector3(ahead.x, ahead.y, ahead.z))))).toBeLessThanOrEqual(upAngle + 1e-9);
    // Within a second: within a degree of the wall's normal; by one and a half, exactly it.
    for (let k = 0; k < 59; k += 1) v.update([a], EYE, 1 / 60);
    expect(axis(root, 0, 1, 0).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(Math.PI / 180);
    for (let k = 0; k < 30; k += 1) v.update([a], EYE, 1 / 60);
    expect(drawn.x).toBe(1); expect(drawn.y).toBe(0); expect(drawn.z).toBe(0);
    const zSettled = axis(root, 0, 0, 1);
    expect(zSettled.x).toBeCloseTo(ahead.x, 9); expect(zSettled.y).toBeCloseTo(ahead.y, 9); expect(zSettled.z).toBeCloseTo(ahead.z, 9);
    expect(UP_EASE_S).toBeLessThan(0.5);
    // A rig handed over snaps: release it, lend it to a body on the ceiling — the first frame is exact.
    v.update([], EYE, 1 / 60);
    expect(held(v, 'aphid')).toEqual([]);
    const c = creature('aphid', 'c', 8, 0, { behaviour: 'wander', height: 112, heading: 2 });
    c.up = CEILING;
    v.update([c], EYE, 1 / 60);
    const holderIndex = v.holders('aphid').indexOf('c');
    expect(holderIndex).toBeGreaterThanOrEqual(0);
    const d = v.drawnUps('aphid')[holderIndex];
    expect(d.x).toBe(0); expect(d.y).toBe(-1); expect(d.z).toBe(0);
    expect(axis(v.rigs('aphid')[holderIndex], 0, 1, 0).y).toBeCloseTo(-1, 9);
  });

  it('STRIDES when walking straight up a wall — the measured motion is 3-D — and bobs along the normal, not up', async () => {
    const v = await keep(view('ultra-low'));
    const a = creature('aphid', 'a', 8, 0, { behaviour: 'wander', height: 100, heading: 0 });
    a.up = EAST;
    v.update([a], EYE, 1 / 60);
    const root = v.rigs('aphid')[0];
    const legs = v.anatomy('aphid')!.legs.map((l) => ({ bone: root.getObjectByName(l.coxa) as THREE.Bone, rest: l.rest }));
    // Straight up the wall at the wander pace: the point on the plane never moves.
    const body = unitsOfMm(APHID.lengthMm);
    const step = unitsOfMm(APHID.pace.wanderMmS) / 60;
    let swing = 0;
    let bobOut = 0;
    for (let k = 0; k < 120; k += 1) {
      a.height += step;
      v.update([a], EYE, 1 / 60);
      for (const l of legs) swing = Math.max(swing, l.bone.quaternion.angleTo(l.rest));
      // The bob is along +x, the wall's normal: the drawn y is the body's height exactly, x is out from the wall.
      expect(root.position.y).toBe(a.height);
      expect(root.position.z).toBeCloseTo(0, 12);
      expect(root.position.x).toBeGreaterThanOrEqual(8);
      bobOut = Math.max(bobOut, root.position.x - 8);
    }
    const m = v.motionOf('aphid', 0)!;
    expect(m.moving).toBeGreaterThan(0.9);
    expect(m.gone).toBeCloseTo(step * 120, 9);
    // Two seconds at 4.1 strides a second: about eight strides.
    expect(m.strides).toBeGreaterThan(7.5);
    expect(m.strides).toBeLessThan(8.7);
    expect(swing).toBeGreaterThan(0.15);
    expect(bobOut).toBeGreaterThan(0);
    expect(bobOut).toBeLessThan(body * 0.1);
    // And on the ground the same walk bobs UP, and the drawn x is the body's exactly.
    v.update([], EYE, 1 / 60);
    const g = creature('aphid', 'g', 8, 0, { behaviour: 'wander', height: 0, heading: 0 });
    let bobUp = 0;
    for (let k = 0; k < 120; k += 1) {
      g.at = world(8, g.at.wz + step);
      v.update([g], EYE, 1 / 60);
      const r = v.rigs('aphid')[v.holders('aphid').indexOf('g')];
      expect(r.position.x).toBe(toLocal(g.at).lx);
      bobUp = Math.max(bobUp, r.position.y);
    }
    expect(bobUp).toBeGreaterThan(0);
    expect(bobUp).toBeCloseTo(bobOut, 6);
  });

  it('draws the centre off the wall by the rig\'s box half-extent along the normal, where the pick ray finds it', async () => {
    const v = await keep(view('ultra-low'));
    const a = creature('aphid', 'a', 8, 0, { behaviour: 'idle', height: 100, heading: 1 });
    a.up = EAST;
    v.update([a], EYE, 1 / 60);
    const root = v.rigs('aphid')[0];
    const box = v.anatomy('aphid')!.box;
    const scale = root.scale.x;
    const p = v.positionOf('a')!.clone();
    const off = p.clone().sub(root.position);
    // Along the normal: the box centre's y (the synthetic rig's feet are at y = 0, so half its height), scaled.
    expect(off.x).toBeCloseTo(((box.min.y + box.max.y) / 2) * scale, 9);
    expect(off.x).toBeGreaterThan(0);
    // Along the heading: the box centre's z, scaled — the same number a body on the ground shows in its heading.
    const ahead = aheadOn(EAST, 1, { x: 0, y: 0, z: 0 });
    expect(off.dot(new THREE.Vector3(ahead.x, ahead.y, ahead.z))).toBeCloseTo(((box.min.z + box.max.z) / 2) * scale, 9);
    // The same animal on the ground: the same offsets, in the ground's frame.
    v.update([], EYE, 1 / 60);
    const g = creature('aphid', 'g', 8, 0, { behaviour: 'idle', height: 0, heading: 1 });
    v.update([g], EYE, 1 / 60);
    const rg = v.rigs('aphid')[v.holders('aphid').indexOf('g')];
    const offG = v.positionOf('g')!.clone().sub(rg.position);
    expect(offG.y).toBeCloseTo(off.x, 9);
    expect(offG.dot(new THREE.Vector3(Math.sin(1), 0, Math.cos(1)))).toBeCloseTo(((box.min.z + box.max.z) / 2) * scale, 9);
    expect(WORLD_UP.y).toBe(1);
  });
});

describe('the pick surface', () => {
  it('answers positionOf for a drawn rig, a drawn impostor and a chain, in local coordinates, and null for the undrawn', async () => {
    const v = await keep(view('ultra-low'));
    const f = creature('housefly', 'f', 20, 0, { behaviour: 'fly', height: 30, heading: 0.4 });
    const a = creature('aphid', 'a', 8, 0, { behaviour: 'feed', height: 25.5 });
    const w = creature('earthworm', 'w', -12, 3, { behaviour: 'surface', height: 0, heading: 1 });
    const far = creature('aphid', 'far', 900, 0, { tier: 'far' });
    // A third aphid past the pool of two: an impostor.
    const b = creature('aphid', 'b', 9, 1, { behaviour: 'wander', height: 0 });
    const c = creature('aphid', 'c', 10, 2, { behaviour: 'wander', height: 0 });
    // A NAMED POOL HAS NO BAND. This is about WHERE a body is drawn — the
    // rig's box centre, the chain's middle, the ellipsoid's — so the forms
    // are pinned by the pool's size rather than left to the distance
    // policy: two aphids rigged and the third an impostor, as before.
    v.setPoolSize('aphid', 2);
    for (let k = 0; k < 5; k += 1) v.update([f, a, w, far, b, c], EYE, 1 / 60);
    expect(v.drawnIds().slice().sort()).toEqual(['a', 'b', 'c', 'f', 'w']);
    expect(v.positionOf('far')).toBeNull();
    expect(v.positionOf('nobody')).toBeNull();
    // The fly: its rig's box centre, placed on the body's height.
    const p = v.positionOf('f')!;
    expect(p.x).toBeCloseTo(20, 0);
    expect(p.z).toBeCloseTo(0, 0);
    expect(Math.abs(p.y - 30)).toBeLessThan(unitsOfMm(HOUSEFLY.lengthMm));
    // The vector is the view's: the next call rewrites it.
    const kept = p.clone();
    const q = v.positionOf('a')!;
    expect(q).toBe(p);
    expect(q.equals(kept)).toBe(false);
    expect(Math.abs(q.y - 25.5)).toBeLessThan(unitsOfMm(APHID.lengthMm));
    // The worm: the middle of its laid chain, half a body behind the head along its heading.
    const wormMid = v.positionOf('w')!;
    const body = unitsOfMm(EARTHWORM.lengthMm);
    expect(wormMid.x).toBeCloseTo(-12 - Math.sin(1) * body / 2, 0);
    expect(wormMid.z).toBeCloseTo(3 - Math.cos(1) * body / 2, 0);
    // An impostor: whichever of the three aphids has none, its ellipsoid's centre sits a girth-radius up.
    const impostored = ['a', 'b', 'c'].filter((id) => !held(v, 'aphid').includes(id));
    expect(impostored).toHaveLength(1);
    const r = (unitsOfMm(APHID.lengthMm) * LOOK.aphid.girth) / 2;
    const heightOf = { a: 25.5, b: 0, c: 0 }[impostored[0] as 'a' | 'b' | 'c'];
    expect(v.positionOf(impostored[0])!.y).toBeCloseTo(heightOf + r, 6);
    // Local, not world: an origin shift (the origin snaps to its 1024 lattice) moves every answer with it.
    setOrigin(world(1024, 0));
    v.update([f, a, w, far, b, c], EYE, 1 / 60);
    expect(v.positionOf('f')!.x).toBeCloseTo(20 - 1024, 0);
    // Switched off: gone from the list.
    v.setEnabled('housefly', false);
    v.update([f, a, w, far, b, c], EYE, 1 / 60);
    expect(v.positionOf('f')).toBeNull();
    expect(v.drawnIds()).not.toContain('f');
  });

  it('allocates nothing per call: the same list and the same vector come back', async () => {
    const v = await keep(view('ultra-low'));
    const f = creature('housefly', 'f', 20, 0, { behaviour: 'fly', height: 30 });
    v.update([f], EYE, 1 / 60);
    const list = v.drawnIds();
    const vec = v.positionOf('f');
    v.update([f], EYE, 1 / 60);
    expect(v.drawnIds()).toBe(list);
    expect(v.positionOf('f')).toBe(vec);
  });
});

describe('what the source must not do', () => {
  it('plays no clip and rolls no dice: no AnimationMixer, no Math.random, no loader of its own in src/fauna', () => {
    const dir = join(ROOT, 'src', 'fauna');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files).toEqual(expect.arrayContaining(['FaunaView.ts', 'motion.ts', 'rig.ts']));
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(source, `${file} plays a clip`).not.toMatch(/AnimationMixer|AnimationClip|AnimationAction/);
      expect(source, `${file} rolls a die`).not.toMatch(/Math\.random/);
      expect(source, `${file} loads for itself`).not.toMatch(/GLTFLoader|TextureLoader/);
    }
  });
});

describe('dispose', () => {
  it('releases the templates\' geometries, materials and textures, the impostors and the shared body', async () => {
    const v = await keep(view('ultra-low'));
    const counts = { geometry: 0, material: 0, texture: 0, impostorGeometry: 0, impostorMaterial: 0 };
    for (const s of SPECIES) {
      const mesh = v.template(s.id)!.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
      const material = mesh.material as THREE.MeshStandardMaterial;
      mesh.geometry.addEventListener('dispose', () => { counts.geometry += 1; });
      material.addEventListener('dispose', () => { counts.material += 1; });
      material.map!.addEventListener('dispose', () => { counts.texture += 1; });
      const impostor = v.impostor(s.id)!;
      impostor.geometry.addEventListener('dispose', () => { counts.impostorGeometry += 1; });
      (impostor.material as THREE.Material).addEventListener('dispose', () => { counts.impostorMaterial += 1; });
    }
    v.update([creature('aphid', 'a', 5, 0)], EYE, 1 / 60);
    v.dispose();
    v.dispose();
    expect(counts.geometry).toBe(3);
    expect(counts.material).toBe(3);
    expect(counts.texture).toBe(3);
    // One shared body, three listeners on it.
    expect(counts.impostorGeometry).toBe(3);
    expect(counts.impostorMaterial).toBe(3);
    expect(v.group.children).toHaveLength(0);
    expect(v.rigs('aphid')).toHaveLength(0);
    // A frame after disposal is a no-op.
    expect(() => v.update([creature('aphid', 'a', 5, 0)], EYE, 1 / 60)).not.toThrow();
  });

  it('lets go of a template that lands after disposal', async () => {
    let resolve: ((o: THREE.Object3D) => void) | null = null;
    const late: Assets['loadModel'] = (path) => (path === EARTHWORM.model.path
      ? new Promise<THREE.Object3D>((r) => { resolve = r; })
      : Promise.resolve(rigFor(path)));
    const v = new FaunaView({ species: SPECIES, loadModel: late, rung: 'ultra-low' });
    v.dispose();
    const rig = rigFor(EARTHWORM.model.path);
    const mesh = rig.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => { disposed += 1; });
    resolve!(rig);
    await v.ready();
    expect(disposed).toBe(1);
    expect(v.template('earthworm')).toBeNull();
  });
});

describe('the budget', () => {
  it('draws 300 creatures at high in well under a millisecond a frame, and reports the measurement', async () => {
    const v = await keep(view('high'));
    const creatures: CreatureState[] = [];
    // A deterministic scatter: no dice in a test either.
    let seed = 12345;
    const next = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const tiers: Tier[] = ['full', 'near', 'far'];
    for (let i = 0; i < 300; i += 1) {
      const id = CREATURE_IDS[i % 3];
      const r = 5 + next() * 800;
      const a = next() * Math.PI * 2;
      const behaviour: Behaviour = id === 'housefly' ? (i % 4 === 0 ? 'fly' : 'wander') : id === 'earthworm' ? (i % 5 === 0 ? 'burrow' : 'surface') : 'wander';
      // The tier is keyed apart from the species, so every species has creatures in every tier.
      creatures.push(creature(id, `${id}:${i}`, Math.sin(a) * r, Math.cos(a) * r, {
        tier: tiers[Math.floor(i / 3) % 3], behaviour, height: id === 'housefly' && behaviour === 'fly' ? 20 : 0, heading: next() * Math.PI * 2, phase: next(),
      }));
    }
    // Warm up: pools lent, trails seeded, scratch grown.
    for (let f = 0; f < 10; f += 1) v.update(creatures, EYE, 1 / 60, 1);
    v.resetCost();
    const frames = 240;
    for (let f = 0; f < frames; f += 1) {
      for (const c of creatures) {
        const pace = c.species === 'housefly' ? 1.5 : c.species === 'earthworm' ? 0.3 : 0.06;
        c.at = world(c.at.wx + Math.sin(c.heading) * pace / 60, c.at.wz + Math.cos(c.heading) * pace / 60);
        c.heading += 0.01;
      }
      v.update(creatures, EYE, 1 / 60, 1);
    }
    const cost = v.cost;
    const lent = cost.rigsLent.earthworm + cost.rigsLent.aphid + cost.rigsLent.housefly;
    // eslint-disable-next-line no-console
    console.info(`[fauna budget] 300 creatures at high: mean ${cost.meanMs.toFixed(3)} ms, peak ${cost.peakMs.toFixed(3)} ms, rigs lent ${lent} (worm ${cost.rigsLent.earthworm}, aphid ${cost.rigsLent.aphid}, fly ${cost.rigsLent.housefly}), impostors ${cost.impostors.earthworm + cost.impostors.aphid + cost.impostors.housefly}`);
    // THE BAND CAPS THIS NOW, not the pool. The 300 are scattered over
    // metres, so only what is inside RIG_FAR can hold a skeleton at all —
    // fewer than the rung's budget, and that is the optimisation working
    // rather than a shortfall. What must hold is that it never EXCEEDS the
    // budget, and that every body is still accounted for.
    expect(lent).toBeGreaterThan(0);
    expect(lent).toBeLessThanOrEqual(rigBudgetFor('high'));
    expect(lent + impostorsAll(v) + cost.notDrawn).toBe(creatures.length);
    // The brief's budget is 0.6 ms; the assertion is looser so a slow CI box does not fail it, and the line above is the measurement.
    expect(cost.meanMs).toBeLessThan(2.5);
    expect(CRUMBS_PER_LENGTH).toBeGreaterThan(0);
  });
});

describe('a pool the Lab can grow: one rig per creature', () => {
  it('starts at the rung\'s budget and takes a named size instead', async () => {
    const v = await keep(view('medium'));
    // Every species' pool is the whole RUNG BUDGET now, not its own slice:
    // the allocation is by distance across species, so if the nearest
    // thirteen bodies happen all to be aphids, thirteen aphid clones are
    // what serving them honestly takes (`rigBudgetFor`).
    expect(v.poolSize('aphid')).toBe(rigBudgetFor('medium'));
    v.setPoolSize('aphid', 40);
    expect(v.poolSize('aphid')).toBe(40);
    // The others are untouched: a named pool is one species' own.
    expect(v.poolSize('housefly')).toBe(rigBudgetFor('medium'));
  });

  it('grows ONE at a time without rebuilding the rest — the stress test lends a skeleton a second', async () => {
    const v = await view('medium');
    v.setPoolSize('housefly', 1);
    const first = v.group.getObjectByName('housefly:rig:0');
    expect(first).toBeDefined();
    for (let n = 2; n <= 12; n += 1) {
      v.setPoolSize('housefly', n);
      expect(v.poolSize('housefly')).toBe(n);
      // The rig that was already there is the SAME object: nothing was re-cloned.
      expect(v.group.getObjectByName('housefly:rig:0')).toBe(first);
    }
    expect(v.group.getObjectByName('housefly:rig:11')).toBeDefined();
  });

  it('shrinks by letting go of the rigs it drops, and gives the rung its budget back', async () => {
    const v = await view('medium');
    v.setPoolSize('aphid', 12);
    const creatures = Array.from({ length: 12 }, (_, i) => creature('aphid', `a${i}`, i * 3, 0));
    v.update(creatures, EYE, 1 / 60, 1);
    expect(v.cost.rigsLent.aphid).toBe(12);
    v.setPoolSize('aphid', 3);
    expect(v.poolSize('aphid')).toBe(3);
    v.update(creatures, EYE, 1 / 60, 1);
    expect(v.cost.rigsLent.aphid).toBe(3);
    // Nine bodies still drawn, as impostors — nothing vanished with the rigs.
    expect(v.cost.impostors.aphid).toBe(9);
    v.clearPoolSizes();
    expect(v.poolSize('aphid')).toBe(rigBudgetFor('medium'));
  });

  it('lends every creature a rig when the pool is the crowd\'s size', async () => {
    const v = await view('medium');
    const creatures = Array.from({ length: 30 }, (_, i) => creature('housefly', `f${i}`, i, 0, { behaviour: 'fly', height: 20 }));
    v.setPoolSize('housefly', creatures.length);
    v.update(creatures, EYE, 1 / 60, 1);
    expect(v.cost.rigsLent.housefly).toBe(30);
    expect(v.cost.impostors.housefly).toBe(0);
  });

  it('remembers a size named before the model has loaded, and applies it when it lands', async () => {
    const v = new FaunaView({ species: SPECIES, loadModel: loader(), rung: 'medium' });
    v.setPoolSize('earthworm', 9);
    await v.ready();
    expect(v.poolSize('earthworm')).toBe(9);
    views.push(v);
  });
});

/**
 * THE RIG GOES TO THE NEAREST BODY, WHATEVER SPECIES IT IS — Joshua's
 * complaint from the phone, and the whole reason the allocation moved.
 *
 * "we need to try render at 0.6m away and it fades as right now, it's
 * random. Some close up change while others don't." It was not random:
 * the pool was PER SPECIES and lending was by rank inside it, so at the
 * medium rung's worm 2 / aphid 5 / fly 4 / queen 1 / worker 1 the single
 * nearest queen kept a skeleton three metres out while an aphid thirty
 * centimetres away was the sixth-nearest aphid and drew as an ellipsoid.
 *
 * The band is what stops a body at the line flickering: it WINS a rig by
 * getting inside RIG_NEAR and KEEPS it until it passes RIG_FAR.
 */
describe('the rig goes to the nearest, and the band stops it flickering', () => {
  const near = (n: number, from: number, step: number): CreatureState[] =>
    Array.from({ length: n }, (_, i) => creature('aphid', `a${i}`, from + i * step, 0));

  it('prefers a near aphid over a far fly — the per-species rank that made it look random is gone', async () => {
    const v = await keep(view('medium'));
    // Six aphids inside 0.6 m, and one fly farther out than all of them.
    const crowd = [...near(6, 5, 5), creature('housefly', 'f0', 50, 0, { behaviour: 'fly', height: 20 })];
    v.update(crowd, EYE, 1 / 60, 0);
    // Every one of the seven is inside the near line and the budget is 13,
    // so all seven hold rigs — including six aphids, which the old
    // per-species pool of five could not have done.
    expect(v.cost.rigsLent.aphid).toBe(6);
    expect(v.cost.rigsLent.housefly).toBe(1);

    // Now the budget is the pressure, and the fly is the far one.
    const tight = await keep(view('ultra-low'));
    const budget = rigBudgetFor('ultra-low');
    const many = [...near(budget + 2, 4, 4), creature('housefly', 'f0', 58, 0, { behaviour: 'fly', height: 20 })];
    tight.update(many, EYE, 1 / 60, 0);
    expect(lentAll(tight)).toBe(budget);
    // The fly is the FARTHEST body inside the line, so it is the one that
    // goes without — under the old rule its own pool would have kept it a
    // skeleton ahead of every aphid nearer than it.
    expect(tight.cost.rigsLent.housefly).toBe(0);
    expect(tight.cost.rigsLent.aphid).toBe(budget);
    expect(held(tight, 'aphid')).toEqual(many.slice(0, budget).map((c) => c.id));
  });

  it('lends nothing beyond RIG_FAR, however free the budget is', async () => {
    const v = await keep(view('medium'));
    // One body, nothing competing for the thirteen rigs, just too far.
    const far = [creature('aphid', 'far', RIG_FAR + 2, 0)];
    v.update(far, EYE, 1 / 60, 0);
    expect(lentAll(v)).toBe(0);
    expect(v.cost.impostors.aphid).toBe(1);
    // And one just inside the near line does get one.
    v.update([creature('aphid', 'in', RIG_NEAR - 2, 0)], EYE, 1 / 60, 0);
    expect(lentAll(v)).toBe(1);
  });

  it('never lends past the budget however many crowd inside 0.6 m — the RUNG optimisation survives a swarm', async () => {
    // Joshua's own constraint: "I don't want unlimited full rigs inside
    // 0.6 m because that could defeat RUNG optimization." 150 ants piling
    // into the radius must not put the phone back at Baseline A's 52.
    const v = await keep(view('medium'));
    const swarm = Array.from({ length: 150 }, (_, i) => creature('aphid', `a${i}`, 1 + (i % 50), (i / 50) | 0));
    v.update(swarm, EYE, 1 / 60, 0);
    expect(lentAll(v)).toBe(rigBudgetFor('medium'));
    // Nobody is unaccounted for: the rest are impostors up to the species'
    // own cap, and the overflow is COUNTED rather than quietly dropped.
    expect(lentAll(v) + impostorsAll(v) + v.cost.notDrawn).toBe(swarm.length);
    expect(v.cost.pastCap).toBe(v.cost.notDrawn);
  });

  it('KEEPS a rig across RIG_NEAR and only gives it up past RIG_FAR: a body at the line does not flicker', async () => {
    const v = await keep(view('medium'));
    const walk = (x: number): number => {
      v.update([creature('aphid', 'one', x, 0)], EYE, 1 / 60, 0);
      return v.cost.rigsLent.aphid;
    };
    expect(walk(RIG_NEAR - 5)).toBe(1);
    // Out through the band, a step at a time: it holds what it won.
    for (let x = RIG_NEAR - 1; x < RIG_FAR - 1; x += 2) {
      expect(walk(x), `holding at ${x}`).toBe(1);
    }
    expect(walk(RIG_FAR + 1)).toBe(0);
    // And coming back it must reach RIG_NEAR again, not merely RIG_FAR —
    // otherwise the band would be a line with extra steps.
    expect(walk(RIG_FAR - 5)).toBe(0);
    expect(walk(RIG_NEAR - 1)).toBe(1);
  });

  it('crossfades when a body ARRIVES, and is never invisible nor two whole bodies at once', async () => {
    const v = await keep(view('medium'));
    const bodyAt = (x: number): CreatureState => creature('aphid', 'one', x, 0);
    // Met OUTSIDE the far line: an impostor, and nothing to fade from.
    for (let i = 0; i < 3; i += 1) v.update([bodyAt(RIG_FAR + 20)], EYE, 1 / 60, 0);
    expect(v.cost.rigsLent.aphid).toBe(0);

    // Now it walks inside the near line and the rig fades UP over FADE_S.
    const opacity = (): number => {
      let o = 0;
      v.group.getObjectByName('aphid:rig:0')?.traverse((x) => {
        const material = (x as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material && 'opacity' in material) o = Math.max(o, material.opacity);
      });
      return o;
    };
    const impostorScale = (): number => {
      const mesh = v.impostor('aphid');
      if (mesh === null || mesh.count === 0) return 0;
      const scale = new THREE.Vector3();
      new THREE.Matrix4()
        .fromArray(mesh.instanceMatrix.array as Float32Array, 0)
        .decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      return scale.length();
    };
    const seen: number[] = [];
    for (let i = 0; i < Math.ceil(FADE_S * 60) + 4; i += 1) {
      v.update([bodyAt(RIG_NEAR - 20)], EYE, 1 / 60, 0);
      // SOMETHING of the animal is on screen every single frame — the whole
      // point of crossfading rather than swapping.
      expect(opacity() + impostorScale(), `frame ${i}`).toBeGreaterThan(0.05);
      seen.push(opacity());
    }
    // It climbed rather than popped, never went backwards, and arrived.
    expect(seen[0]).toBeLessThan(0.5);
    expect(seen.some((o) => o > 0.05 && o < 0.95)).toBe(true);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1e-9);
    expect(seen[seen.length - 1]).toBeCloseTo(1, 2);
    // And once arrived it STAYS arrived: the settled case must not decay
    // one step and climb back, which is a shimmer on every rigged body.
    for (let i = 0; i < 6; i += 1) {
      v.update([bodyAt(RIG_NEAR - 20)], EYE, 1 / 60, 0);
      expect(opacity()).toBeCloseTo(1, 6);
    }
  });

  it('accounts for every creature it is handed, and the two identities hold', async () => {
    // The 55 of Baseline B: 400 placed, 13 rigs + 332 impostors, and the
    // rest earthworms under the ground that the view refuses to draw.
    const v = await keep(view('medium', loader(), { groundAt: () => 0 }));
    const crowd = [
      ...Array.from({ length: 12 }, (_, i) => creature('aphid', `a${i}`, 2 + i * 3, 0)),
      // Burrowers well under the ground with no cutaway: drawn in no form.
      ...Array.from({ length: 7 }, (_, i) => creature('earthworm', `e${i}`, 2 + i * 3, 4, { behaviour: 'burrow', height: -unitsOfMm(400) })),
      // The simulation's own cut, which the view only obeys.
      creature('housefly', 'f-far', 10, 0, { tier: 'far', behaviour: 'fly', height: 20 }),
    ];
    v.update(crowd, EYE, 1 / 60, 0);
    const cost = v.cost;
    expect(lentAll(v) + impostorsAll(v) + cost.notDrawn).toBe(crowd.length);
    expect(cost.hidden + cost.pastCap + cost.farTier).toBe(cost.notDrawn);
    expect(cost.farTier).toBe(1);
    expect(cost.hidden).toBe(7);
  });

  it('a NAMED pool has no band: the Lab measuring a one-metre room keeps its skeletons', async () => {
    // `setPoolSize` is the Creature Lab asking "how many fully active
    // insects can this room hold". A bench answering that cannot have its
    // rigs taken away at 0.8 m, so a named pool is not distance-gated.
    const v = await keep(view('medium'));
    v.setPoolSize('aphid', 4);
    const spread = [
      creature('aphid', 'a0', 10, 0),
      creature('aphid', 'a1', RIG_FAR + 40, 0),
      creature('aphid', 'a2', RIG_FAR + 90, 0),
    ];
    v.update(spread, EYE, 1 / 60, 0);
    expect(v.cost.rigsLent.aphid).toBe(3);
  });
});
