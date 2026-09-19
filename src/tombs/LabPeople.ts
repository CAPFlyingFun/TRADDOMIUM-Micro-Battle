/**
 * JACK AND SARAH, STANDING IN THE LABORATORY — the two human masters in
 * `public/models/`, loaded and put where the plan says they stand.
 *
 * The building has been drawn since the plan landed and nobody has ever
 * been in it (Joshua: "I don't see any Jack or Sarah in the Lab"). The
 * models were baked, shipped and never referenced by a line in `src/`.
 * This file is that line, and it is deliberately the whole of it: TWO
 * BODIES AT TWO DESKS. No animation, no dialogue, no walking, no
 * interaction, no gaze — a person here is a mesh with a position and a
 * yaw, and the interaction points the player touches are still the
 * plan's, not theirs.
 *
 * It sits beside `LabView` rather than inside it because the two have
 * different lifetimes and different failure modes. The building is built
 * synchronously from arithmetic that cannot fail; a person is a file over
 * a network that can be slow, can 404 on a deploy path and can land after
 * the player has already walked out. Folding an await into `LabView.build`
 * would make the building's arrival wait on a download, and the building
 * is what the room IS.
 *
 * ─── metres in, world units out — TWICE, and the second one is a scale ─
 *
 * The scene is in centimetres (`UNITS_PER_METRE`, 100 units to the
 * metre) and the plan is in metres; `LabView`'s header explains why the
 * conversion is done PER PLACEMENT and why that view refuses to scale its
 * own group. The placements here follow that rule exactly — `at` is
 * multiplied by `M` as the body is positioned.
 *
 * THE MODEL ITSELF IS ALSO SCALED BY `M`, and that is the one place this
 * file departs from "no scaled parent", because it has no choice and the
 * departure is bounded:
 *
 *   - both masters are authored AT HUMAN SCALE IN METRES, 1.700 m from
 *     the soles to the crown with the feet on y = 0 (the same figures
 *     `scripts/probe-humans.mjs` frames them by), and a GLB's vertices
 *     cannot be re-authored at load time without rewriting every buffer
 *     AND the skin's inverse bind matrices with them;
 *   - the scale is UNIFORM, which is the reason the objection does not
 *     bite: a uniform scale needs no inverse transpose for its normals,
 *     and there is no shear for a lit surface to read wrong;
 *   - it is ONE node deep, on a named object, with nothing under it that
 *     anything else in the scene reads a world position out of.
 *
 * A body added WITHOUT that scale is 1.7 world units — seventeen
 * millimetres, a body an ant could carry — sitting exactly where it
 * should be. It does not look like a bug; it looks like nothing loaded.
 * That is the failure this file exists to end, so it is worth naming.
 *
 * ─── which way they face ─────────────────────────────────────────────
 *
 * BOTH MASTERS ARE MODELLED FACING +Z. `Person.yaw` is therefore
 * `atan2(dx, dz)` (`world/tombs/plan.ts`'s `stand`), which is three's own
 * `rotation.y` with no negation and no half turn added. Verified by
 * rendering both from +z: you get Jack's polo shirt and Sarah's front.
 *
 * ─── the materials are the baker's, not ours ─────────────────────────
 *
 * Nothing here recolours a human, forces a roughness or swaps a
 * material. The clothing, the skin and Sarah's badge were authored at
 * bake time on purpose (`scripts/bakeHumans.mjs`, `scripts/authorSarah.mjs`,
 * and the roughness question was settled against a rendered comparison in
 * `scripts/probe-humans.mjs`). A renderer that "fixed" any of it here
 * would be throwing that work away one frame after it loaded, and the
 * fix would live in the wrong file.
 *
 * The two things that ARE set on a loaded mesh are both about the
 * renderer rather than the look: the shadow flags, and `frustumCulled`
 * (see `wear`).
 */
import * as THREE from 'three';
import { HUMAN_POSE_TURNS, poseHuman } from '../actor/humanPose';
import { newJointTurn, type HumanGait, type HumanMeasure, type HumanStance, type MutableJointTurn } from '../actor/humanRig';
import { measureHuman } from '../actor/humanSkeleton';
import { assets, type Assets } from '../assets/assets';
import { HumanRig } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import { TOMBS_GROUND_UNITS } from '../world/tombs/site';
import type { LabLayout, Person } from '../world/tombs/types';

/** 100 world units to the metre, as everywhere. The plan is in metres; the scene is in units. */
const M = UNITS_PER_METRE;

/**
 * Both masters measure 1.700 m from the floor to the crown with their
 * feet at y = 0. Used only by the placeholder, so a missing file stands
 * the same height as the body it is standing in for — a stand-in that is
 * the wrong size is a second bug on top of the first.
 */
const BODY_HEIGHT_M = 1.70;

/**
 * The placeholder's half-width. 0.15 m gives a 0.30 m column: narrower
 * than a pair of shoulders, wider than a waist, and 0.11 m³ of volume
 * against the ~0.08 m³ of an 80 kg person. "Roughly a person's size and
 * volume" is all it has to be — it is not a body, it is a marker that
 * something should have been here.
 */
const PLACEHOLDER_RADIUS_M = 0.15;

/**
 * Magenta, and chosen BECAUSE the building has nothing like it. The
 * laboratory's palette (`labLook.ts`) is greys, a green-grey wall, a
 * cyan readout and the gold accent; nothing in it is pink. So a magenta
 * column in the room cannot be mistaken for something that was meant to
 * be there, which is the entire job of a placeholder. `loadModel` also
 * tags it `userData.isPlaceholder` and logs the URL it wanted — this is
 * the half of that report you can see from inside the room.
 */
const PLACEHOLDER_COLOUR = 0xd81b8f;

/** Segments around and along the placeholder's capsule. A marker; it does not need to be round. */
const PLACEHOLDER_CAPS = 4;
const PLACEHOLDER_SIDES = 10;

export interface LabPeopleOptions {
  /**
   * The ground under the site, in WORLD UNITS — the SAME number
   * `LabViewOptions.groundUnits` is given, because these bodies stand on
   * that view's floor and a second opinion about where the floor is would
   * show up as two people sunk into it or hovering over it.
   *
   * This group owns its Y and nothing else, exactly as `LabView`'s does:
   * the plan's y = 0 is the floor's top face, so the group's Y *is* the
   * ground and every height under it stays a depth against the floor
   * (CLAUDE.md: "anything remembered against [the ground] is remembered
   * as a DEPTH"). X and Z belong to whoever holds the floating origin.
   * The surveyed figure is the default so a bare probe with no
   * heightfield still stands them on the recorded ground, which is the
   * same default and the same reason as `LabView`'s.
   */
  readonly groundUnits?: number;
  /**
   * Whether the bodies cast and take the sun's shadow. True by default,
   * matching `LabViewOptions.shadows`; the dev-tool scene runs with
   * shadows off and passes false.
   */
  readonly shadows?: boolean;
  /**
   * The one loader (`assets.loadModel`), injectable so a test can hand in
   * a synthetic body without a network — the same seam `FaunaView` and
   * `CreatureLabScene` already use. Defaults to the real one; nothing
   * here ever constructs a `GLTFLoader` of its own (ARCHITECTURE §2.5).
   */
  readonly loadModel?: Assets['loadModel'];
}

/**
 * NO `detail` OPTION, on purpose. The rung is a real knob in `LabView`
 * because a light cap and a segment count are real decisions there. Two
 * standing bodies are not a budget problem at any rung, an authored GLB
 * has no segment count to lower, and there is no second mesh to fall back
 * to. A `detail` here would be a dial wired to nothing, which CLAUDE.md
 * asks this file not to grow. If a phone ever cannot afford two people,
 * the answer is a measurement and then a real tier, not a parameter added
 * in advance of one.
 */
export class LabPeople {
  /** Every body, under one named group. The owner adds it to the scene. */
  readonly group = new THREE.Group();

  private readonly loadModel: Assets['loadModel'];
  private readonly shadows: boolean;
  private readonly bodies: THREE.Object3D[] = [];

  /**
   * THE RIGS, AND WHY THERE IS ONE AT ALL.
   *
   * Neither master carries an animation clip, so both ship in their BIND
   * POSE — a T, arms straight out at shoulder height. It reads as broken
   * rather than as unfinished, which is worse than an empty room: an
   * empty room looks unbuilt, and a man standing with his arms out looks
   * like a bug.
   *
   * So every body that turns out to have a skeleton is posed here.
   * `measureHuman` finds the joints (the bones are called `Bone_000`; see
   * `actor/humanRig.ts` for why nothing can be looked up by name),
   * `poseHuman` says how to turn them, and `HumanRig` applies it.
   *
   * A body with NO skeleton keeps its bind pose and is not an error: that
   * is the magenta placeholder, which has no bones to turn.
   */
  private readonly rigs: Array<{ readonly rig: HumanRig; readonly measure: HumanMeasure }> = [];

  /** One turn buffer for every body: `poseHuman` writes into it and nothing outlives the call. */
  private readonly turns: MutableJointTurn[] = Array.from({ length: HUMAN_POSE_TURNS }, newJointTurn);

  /**
   * The gait, rewritten in place each update. Mutable so a frame
   * allocates nothing, and `stance` stays `stand` because nobody in this
   * room walks yet — the walking body is the player's, not theirs.
   */
  private readonly gait: { stance: HumanStance; phase: number; seconds: number; lean: number } = {
    stance: 'stand', phase: 0, seconds: 0, lean: 0,
  };

  /**
   * A free-running clock for the breath and the sway, in seconds.
   *
   * RAW time, not simulation time — the same call `TombsLabScene` makes
   * for its camera and its HUD. A body breathing is not the world
   * advancing, and a paused room with two people frozen mid-breath would
   * read as the renderer having died.
   */
  private clock = 0;

  /** How many of `bodies` came back as `loadModel`'s placeholder rather than a file. */
  private missing = 0;

  /**
   * WHICH BUILD THE BODIES BELONG TO — the disposed flag, generalised,
   * and the one piece of state that makes this class safe to use.
   *
   * A model is a download. The player can open the laboratory, see it and
   * leave again in well under a second, and `dispose()` can therefore run
   * while two GLBs are still in flight. Whatever lands afterwards must
   * NOT be added to a group that has already been emptied and handed
   * back: it would be a body nothing draws, holding geometry, materials
   * and textures that nothing will ever release.
   *
   * A boolean `disposed` catches that case. A counter catches it AND the
   * one wearing a different hat — `build()` called again while the first
   * build is still loading, whose late arrivals would otherwise be added
   * on top of the second build's, leaving two Jacks in one room. Both are
   * "these bodies belong to a state that no longer exists", so they get
   * one mechanism rather than two fields that can disagree. `clear()`
   * bumps it; every load snapshots it before its await and checks it
   * after (`place`).
   */
  private epoch = 0;

  constructor(options: LabPeopleOptions = {}) {
    this.loadModel = options.loadModel ?? assets.loadModel;
    this.shadows = options.shadows ?? true;
    this.group.name = 'tombs-people';
    this.group.position.y = options.groundUnits ?? TOMBS_GROUND_UNITS;
  }

  /**
   * Load and stand everyone the layout names. Safe to call once per scene
   * entry and safe to call again: whatever was standing is released
   * first, and any load still in flight from the previous call is
   * abandoned by the epoch rather than allowed to land on top.
   *
   * Resolves when every person has been placed OR has failed and been
   * replaced by their placeholder. It NEVER rejects: one unreachable file
   * must not take the other body down with it, and a scene that forgot a
   * `.catch` must not lose its whole entry to a 404.
   */
  async build(layout: LabLayout): Promise<void> {
    this.clear();
    const mine = this.epoch;
    await Promise.all(layout.people.map((person) => this.place(person, mine)));
  }

  /**
   * BREATHE. Every frame, with RAW dt (see `clock`).
   *
   * Two bodies and fifteen joint turns each is not a cost worth tiering:
   * this project's own measurement says posing 198 skinned rigs costs
   * 1.3 ms of a 31 ms frame (`docs/PERFORMANCE.md`, Baseline C-ALL), so
   * two is under twenty microseconds. What it buys is the difference
   * between two people and two mannequins.
   */
  update(rawDt: number): void {
    if (!Number.isFinite(rawDt) || rawDt <= 0 || this.rigs.length === 0) return;
    this.clock += rawDt;
    this.gait.seconds = this.clock;
    for (const { rig, measure } of this.rigs) {
      rig.apply(poseHuman(measure, rig.bind, this.gait as HumanGait, this.turns));
    }
  }

  /**
   * Re-seat the bodies on a ground that has moved — an HD tile landing
   * under the site, a heightfield revision. One number, for the same
   * reason `LabView.setGround` is one number: every height under this
   * group is a depth against the floor, not an absolute. Give it the same
   * value the view was given on the same frame.
   */
  setGround(groundUnits: number): void {
    if (!Number.isFinite(groundUnits)) return;
    this.group.position.y = groundUnits;
  }

  /**
   * Take one person out of the room, or put them back.
   *
   * Exists for exactly one case: in chapter 1 the player IS Jack, so the
   * walking body wears his model — and a room containing the player AND
   * an idle copy of him at the next desk is a bug the moment you look at
   * it. The scene hides the double while the player is walking and
   * restores him the instant the camera goes back to flying, because in
   * FLY mode there is no player body and the room should be as the plan
   * describes it.
   *
   * Unknown ids are ignored rather than refused: the plan owns who is in
   * the building, and a scene asking after somebody who is not here has
   * asked a reasonable question and got a truthful nothing.
   */
  hide(id: string, hidden: boolean): void {
    const name = `tombs-person:${id}`;
    for (const body of this.bodies) if (body.name === name) body.visible = !hidden;
  }

  /** How many bodies are actually standing in the room, for a HUD line or a probe. */
  get standing(): number {
    return this.bodies.length;
  }

  /**
   * How many of those are placeholders — bodies whose file did not load.
   * `standing` alone would read 2 with two magenta columns in the room,
   * and a count that cannot distinguish the two is not a reading: the
   * honest line is "2 standing, 1 missing".
   */
  get placeholders(): number {
    return this.missing;
  }

  /** Every body released and the group emptied. A later `build` works; this is not terminal. */
  dispose(): void {
    this.clear();
    this.group.clear();
  }

  // -------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------

  /**
   * One person: load, check we are still wanted, place, dress, add.
   *
   * `loadModel` does not throw — it retries, then returns the placeholder
   * tagged `isPlaceholder` — so the catch below is for the impossible
   * rather than the expected. It is here because the alternative is a
   * rejected promise inside `build`'s `Promise.all`, which would turn one
   * body's surprise into the whole room's.
   */
  private async place(person: Person, mine: number): Promise<void> {
    let model: THREE.Object3D;
    try {
      model = await this.loadModel(person.model, () => placeholderBody());
    } catch (error) {
      console.error(`[tombs] ${person.id}: the loader rejected outright; ${person.who} will not be in the room`, error);
      return;
    }
    // THE CHECK THE EPOCH EXISTS FOR. `dispose()` (or a second `build`)
    // may have run while this file was in flight; this body belongs to a
    // state that is gone, so it is released here and never added — a
    // group that has been handed back cannot release it later.
    if (mine !== this.epoch) {
      release(model);
      return;
    }

    model.name = `tombs-person:${person.id}`;
    // The plan is in metres and the scene is in centimetres: the PLACEMENT
    // is multiplied here, per `LabView`'s rule...
    model.position.set(person.at.x * M, person.at.y * M, person.at.z * M);
    // ...and so is the BODY, because the GLB is authored in metres and its
    // vertices are not ours to rewrite (see the header).
    model.scale.setScalar(M);
    // Straight to `rotation.y`: both masters face +Z and `yaw` is already
    // three's convention. Nothing negated, nothing offset by π.
    model.rotation.y = person.yaw;

    this.wear(model);
    this.stand(model, person);
    if (model.userData.isPlaceholder === true) this.missing += 1;
    this.group.add(model);
    this.bodies.push(model);
  }

  /**
   * The two renderer flags a loaded body gets. Its MATERIALS are left
   * exactly as the baker authored them (see the header).
   *
   * `frustumCulled = false` on every mesh, for the reason `fauna/rig.ts`
   * turns it off on the animals: a skinned mesh is culled against the
   * bounds it was EXPORTED with, and those are the bind pose's, not the
   * body's. These two files make that sharper still — both are
   * meshopt-compressed with `KHR_mesh_quantization`, so the vertex data
   * is normalised into a unit box and the real metres live in the skin's
   * inverse bind matrices, which a geometry bounding sphere never sees.
   * `scripts/probe-humans.mjs` turns it off for the same reason. There is
   * nothing to lose: two bodies in a windowless room are not what a
   * frustum test is for.
   */
  /**
   * Out of the T and onto their feet.
   *
   * IT NEVER THROWS, deliberately. A body that cannot be posed is still a
   * body: the placeholder has no skeleton, and a future master could be
   * rigged in a way `measureHuman` refuses (it throws rather than return
   * a plausible wrong index — see its header). Either way the right
   * outcome is a person standing in their bind pose with a line in the
   * console, not a laboratory with nobody in it.
   */
  private stand(model: THREE.Object3D, person: Person): void {
    if (model.userData.isPlaceholder === true) return;
    try {
      const rig = new HumanRig(model);
      const measure = measureHuman(rig.bind);
      this.rigs.push({ rig, measure });
      this.gait.seconds = this.clock;
      rig.apply(poseHuman(measure, rig.bind, this.gait as HumanGait, this.turns));
    } catch (error) {
      console.error(`[tombs] ${person.id}: could not be posed, so ${person.who} keeps the bind pose`, error);
    }
  }

  private wear(model: THREE.Object3D): void {
    const shadows = this.shadows;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
    });
  }

  /** Everything standing, released; the epoch moved on so nothing in flight can land. */
  private clear(): void {
    this.epoch += 1;
    for (const { rig } of this.rigs) rig.dispose();
    this.rigs.length = 0;
    for (const body of this.bodies) {
      this.group.remove(body);
      release(body);
    }
    this.bodies.length = 0;
    this.missing = 0;
  }
}

/**
 * The honest body a missing GLB gets: a magenta capsule a person's height
 * and roughly a person's volume, standing on the floor.
 *
 * IN METRES, like the masters it stands in for, so that `place` applies
 * ONE rule to whatever comes back from the loader. `FaunaView`'s
 * placeholder is built in world units instead, because there the scale is
 * a per-species measured number that a placeholder has no business
 * borrowing; here it is the constant 100, and a second code path that
 * skips the scale is a second thing that can go out of step.
 *
 * A capsule and not a box because a box the size of a person, standing in
 * a room of boxes, reads as a cabinet. And never nothing: a placeholder
 * that cannot be seen is the exact bug this module was written to fix.
 */
function placeholderBody(): THREE.Object3D {
  const group = new THREE.Group();
  // CapsuleGeometry's `height` is the CYLINDER between the two caps, so
  // the drawn height is height + 2r and the length has to come off it.
  const straight = Math.max(0, BODY_HEIGHT_M - 2 * PLACEHOLDER_RADIUS_M);
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLACEHOLDER_RADIUS_M, straight, PLACEHOLDER_CAPS, PLACEHOLDER_SIDES),
    new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOUR, roughness: 0.7, metalness: 0 }),
  );
  // The capsule is built about its own middle; the plan stands people on
  // their FEET, so it rises half its height above the floor.
  mesh.position.y = BODY_HEIGHT_M / 2;
  group.add(mesh);
  return group;
}

/**
 * Release every geometry, material, texture and skeleton under a root.
 * A model that came back from `loadModel` is ours, and these are the
 * allocations nothing else will ever free.
 *
 * Written here rather than imported from `fauna/rig.ts`'s `disposeRig`,
 * which does the same walk: `src/tombs/` reads `world/tombs`, `assets`
 * and `perf`, and a renderer reaching sideways into another renderer for
 * a fifteen-line utility is how those directions stop meaning anything.
 *
 * THE TEXTURE SCAN IS GENERIC — every own property that is a texture —
 * rather than a list of named map slots. The humans are baked by
 * `scripts/bakeHumans.mjs` and the maps they carry are the BAKER's
 * decision; a slot list written here would silently leak the day it adds
 * one, and a leak that only ever shows up as memory is the kind nobody
 * finds.
 */
export function release(root: THREE.Object3D): void {
  const done = new Set<object>();
  root.traverse((node) => {
    const skinned = node as THREE.SkinnedMesh;
    // The bone texture is the renderer's allocation for a skeleton — not a
    // geometry and not a material, so nothing else in this walk reaches it.
    if (skinned.isSkinnedMesh === true && skinned.skeleton && !done.has(skinned.skeleton)) {
      done.add(skinned.skeleton);
      skinned.skeleton.dispose();
    }
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    if (mesh.geometry && !done.has(mesh.geometry)) {
      done.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || done.has(material)) continue;
      done.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const texture = value as THREE.Texture;
        if (texture.isTexture !== true || done.has(texture)) continue;
        done.add(texture);
        texture.dispose();
      }
      material.dispose();
    }
  });
}
