/**
 * THE ISLAND'S ANIMALS, DRAWN — one loaded rig per species, a small
 * pool of clones lent to the nearest creatures and posed procedurally,
 * an instanced impostor for everything else in reach, and nothing at
 * all for the far tier.
 *
 * Joshua, 2026-09-07 (the ecology brief): "Three creatures from the
 * rigged-but-unanimated GLBs. Size by spine, not bounding box.
 * Procedural rig motion. Don't modify GLBs. Instancing. Protect the
 * mobile baseline. Far/near/very-near tiers. Performance toggles per
 * category." What `flora/` is to `world/objects`, this is to
 * `creatures/` (ARCHITECTURE §3): it reads `CreatureState` every frame
 * and writes meshes, and it decides nothing about where an animal is or
 * what it is doing.
 *
 * ─── why a pool, and why it is small ────────────────────────────────
 *
 * A rig is expensive twice over: the aphid is 30,947 triangles and the
 * housefly 25,635 (the worm a modest 3,144), and a skinned mesh cannot
 * be instanced — every animal that shows its legs needs its own bones,
 * which is what `SkeletonUtils.clone` gives it. The Creature Lab put a
 * number on the difference: 0.52 ms of frame time per full-rig creature,
 * 52 of them at 30 fps on Joshua's phone (Baseline A), against 400 at a
 * locked 60.1 fps when all but thirteen were impostors and the drawing
 * of 345 bodies came to 0.8 ms (Baseline B, 2026-09-10). A rig is some
 * 250 impostors. So the rigs go to the few NEAREST animals and
 * everything else in the near tiers is an impostor: a twenty-triangle
 * ellipsoid in the species' colour, its length, turned to its heading,
 * one draw call a species. The far tier is not drawn: at the distances
 * the simulation calls far, a 2.5 mm aphid is under a pixel.
 *
 * ─── the rig goes to the NEAREST ANIMAL, whatever species it is ──────
 *
 * Joshua, 2026-09-10, from the phone, looking at a crowd: "we need to
 * try render at 0.6m away and it fades as right now, it's random. Some
 * close up change while others don't. Needs to be more consistent."
 *
 * He is right, and the cause was that the pool was PER SPECIES and the
 * lending was by rank WITHIN a species. At the medium rung that is two
 * worms, five aphids, four flies, one queen and one worker, so the
 * single nearest queen wore a skeleton at three metres while an aphid at
 * thirty centimetres was the sixth-nearest aphid and drew as an
 * ellipsoid. Nearness only ever competed inside a species, which is
 * exactly why it read as random.
 *
 * The decision is GLOBAL and distance-first now (`allocate`, the pass
 * between the census and the drawing): every candidate of every species
 * goes into one list, sorted by the distance pass 1 already measured,
 * and the nearest `rigBudgetFor(rung)` of them are MARKED. The pools
 * serve the marks and decide nothing themselves. A tie falls back to the
 * creature's id, so two animals at the same distance cannot trade forms
 * every frame on the sort's whim.
 *
 * THE BUDGET IS A HARD CAP; THE RADIUS IS ONLY A PREFERENCE. Joshua's
 * own constraint, in the same breath: "I don't want unlimited full rigs
 * inside 0.6 m because that could defeat RUNG optimization." A hundred
 * and fifty ants piling into arm's reach must not become a hundred and
 * fifty skeletons and put the phone back at Baseline A's 52. So the
 * budget is the SUM of the rung's `POOL_SIZES` — thirteen at medium,
 * the same thirteen skeletons that table has always paid for — and being
 * nearer is how an animal spends one of them, never a licence to add
 * another. Each species' pool is sized to the WHOLE budget, since the
 * nearest thirteen may all be aphids; the clones past the first few are
 * bones and a scene node over shared geometry, and cost their build time
 * and nothing else until one is lent.
 *
 * ─── the band, and the crossfade ────────────────────────────────────
 *
 * Inside `RIG_NEAR` an animal prefers a rig; past `RIG_FAR` it cannot
 * hold one; between the two it keeps whatever it has. THAT BAND IS THE
 * HYSTERESIS — winning needs 0.6 m and losing needs 0.8, so one standing
 * at 0.6001 m and taking a step cannot swap form every frame — and it
 * replaces the rank margin this file used to keep for the job.
 *
 * The swap itself is a CROSSFADE over `FADE_S`, and its two properties
 * are the whole point: at no instant is an animal invisible, and at no
 * instant are two full-strength bodies drawn for one animal. The rig
 * fades on its MATERIAL and the impostor fades by SCALE in its instance
 * matrix — which is how one instance of a shared `InstancedMesh` fades
 * without a per-instance alpha the shader would have to be taught. Each
 * rig carries its own material clone, so a fading body does not fade its
 * species, and `transparent` is set only WHILE a fade runs: a skinned
 * mesh left transparent sorts against the opaque terrain for the rest of
 * the session.
 *
 * A body MET FOR THE FIRST TIME snaps to whichever form it wins. There
 * is nothing to cross-fade from — the same reason `lend` snaps a rig's
 * drawn up and `reveal` judges a burrower at the line itself.
 *
 * ─── the census closes ──────────────────────────────────────────────
 *
 * alpha.42's stress report read 400 creatures, 13 rigs and 332
 * impostors, and Joshua asked where the other 55 had gone. They were
 * earthworms underground: `drawn()` refuses a burrower deeper than
 * `BURROW_HIDE` with no cutaway over it, which is correct behaviour and
 * was invisible in the numbers, which is the defect. `FaunaCost` now
 * accounts for every body handed in — `rigs + impostors + notDrawn` is
 * the list's length and `hidden + pastCap + farTier` is `notDrawn` — so
 * a missing animal is a number and not a question.
 *
 * ─── the size is the table's, and the file is checked against it ───
 *
 * The TEMPLATE is scaled by `rigScale(species)` — the cited length over
 * the table's `spineUnits` — and then the loaded rig's own spine is
 * MEASURED (`rig.measureSpine`). If the two disagree by more than
 * `SPINE_TOLERANCE` a warning names the species, the measurement, and
 * the number the table would need. It is not corrected here: a renderer
 * that quietly resized a creature would hide exactly the drift the
 * table's docblock says the arithmetic exists to expose. That warning is
 * about the FILE and stays about the file: it compares the template with
 * the species' cited length and knows nothing about any one animal.
 *
 * ─── but the DRAWN size is the ANIMAL'S ─────────────────────────────
 *
 * Joshua, 2026-09-08, having read a source on how far an earthworm
 * travels: "about the Earthworm it should be based on size and dynamic".
 * Every worm in a forest was 150 mm and every worm was therefore drawn,
 * trailed and impostored identically. `CreatureState.lengthMm` now
 * carries the body a particular animal grew, and `sizeRatio(state,
 * species)` is the ONE place a length is compared with its species'
 * cited one (`creatures/species.ts`). Every length this file draws with
 * goes through it:
 *
 *   the lent rig's root scale, so a 300 mm worm is twice the rig;
 *   the crumb spacing and the break distance on a worm's trail, so a
 *     long body's polyline is no coarser against its own bones;
 *   the span the reveal samples over, since what a cutaway shows of a
 *     body is a fact about how far that body reaches;
 *   the depth at which a burrower stops being drawn (`BURROW_HIDE`);
 *   the stations `layChain` lands along the path and the belly lift,
 *     which must match the skin the root scale just resized;
 *   the stride the legs and the bobs are measured in;
 *   and the impostor's own length and girth.
 *
 * ─── the pool is the species', the SCALE is the holder's ────────────
 *
 * One template and one set of clones per species: a rig is expensive and
 * the pool exists to be lent around, so it cannot be built at any one
 * animal's size. It takes its holder's size in `lend`, on the frame it
 * changes hands, and `pose` writes the same scale again every frame — a
 * drawn size is derived from the animal in front of it, never latched
 * from whoever held the rig last.
 *
 * ─── the crossing ───────────────────────────────────────────────────
 *
 * `toLocal(state.at)` is the ONLY place a world position becomes a
 * rendered one; every distance is a world-minus-world through
 * `coords.distanceSquared`, and heights are absolute — the origin
 * carries no y. The worm's trail is kept in WORLD points and converted
 * every frame, so a rebase under a crawling worm moves the drawn body
 * with the world and never leaves a tail behind.
 *
 * ─── what is read, and how ──────────────────────────────────────────
 *
 * Position, height, heading and phase — and, as booleans rather than
 * modes, whether the body is in the air (`AIRBORNE`, the set the state
 * module publishes for renderers) and, for a burrower, whether it is
 * under the ground: by height against the ground when the owner hands
 * in `groundAt`, by the burrow behaviour when it does not. Motion comes
 * from deltas each rig keeps for itself (`motion.ts`): the simulation
 * never says "walk"; the body walks because it moved.
 *
 * That last answer is a LATCH, one per animal, and `BODY_SAMPLES` below
 * says why: what the soil cutaway is showing of a 15 cm body is a fact
 * about the body, not about the 3.2 cm tile under its nose, and it is
 * measured once a frame over the whole animal so that neither the drawn
 * body nor its visibility can chatter with the tiles.
 *
 * ─── the ants, and the words that become booleans ───────────────────
 *
 * The Creature Lab's queen and worker (2026-09-09) load through the
 * same path as the wild three — dressed, scaled by `rigScale` through
 * the animal's `sizeRatio`, measured, pooled — and are posed by the
 * same posers plus three the ants were the reason for: the jaws, the
 * head and the gaster (`motion.ts`), and the wings in `wings.ts` whose
 * beat is per species. The jaws have no lever on the state yet, so
 * this view turns the behaviour word into two BOOLEANS before the
 * poser sees anything — `BITING` (the attack and the defend stand) and
 * `FEEDING` — exactly as `AIRBORNE` already turns four air words into
 * one; the poser reads a boolean and an envelope, never a mode. When
 * the grab mechanic puts a per-jaw lever on `CreatureState`, these two
 * lists are what it replaces.
 *
 * ─── a body on a wall ───────────────────────────────────────────────
 *
 * Joshua, 2026-09-09: "All the insects besides the worm need to be able
 * to climb vertical and upside down while sticking to the surface."
 * The state carries `up`, the normal of what the body stands on
 * (`CreatureState.up`, `creatures/surface.ts`), and a lent rig's root
 * is placed and turned by it: the root quaternion is the basis (up,
 * heading-on-that-up) with the flight attitude applied after it as
 * local turns (`motion.rootQuaternion`), the walk bob is along the up
 * — a body on the ceiling bobs DOWN — and the distance handed to the
 * gait is the 3-D distance along the surface, so an ant walking
 * straight up a wall, with no planar travel at all, still strides. The
 * up the root is built on is the rig's own `drawnUp`, eased toward the
 * state's (`motion.easeUp`, `UP_EASE_S`) so an edge is a turn and not
 * a cut, with the heading carried into it and never eased; on the
 * ground the two never differ and the frame is the old yaw to 1e-12.
 * `lend` snaps the drawn up to the holder's, since a rig changing hands
 * has nothing to ease from. The worm's chain keeps its planar trail and
 * `layChain`'s own frame — the worm does not climb.
 *
 * THE IMPOSTORS KEEP THE HORIZONTAL MATRIX. The Lab lends a rig to every
 * one of its five animals, so no impostor is ever drawn where there is
 * a wall, and the island has no walls until it has a rock worth
 * climbing; an impostor turned to a wall's frame would be twenty
 * triangles of arithmetic for a case that cannot be seen. When the
 * island grows a climbable, this is the line to revisit.
 *
 * ─── the pick surface ───────────────────────────────────────────────
 *
 * Tap-to-possess needs to know where each animal is DRAWN, in the
 * frame the camera's ray is cast in. `positionOf(id)` answers with the
 * drawn body's centre in LOCAL render coordinates — a rig's box centre
 * placed and turned as the rig is, the middle of a worm's laid chain,
 * an impostor's ellipsoid centre — and `drawnIds()` lists who has one
 * this frame. Both are allocation-free per call: the vector and the
 * list are the view's own scratch, rewritten every `update`, so a
 * caller that wants to keep an answer copies it.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets/assets';
import { AIRBORNE, CREATURE_IDS, rigScale, sizeRatio, unitsOfMetres, unitsOfMm } from '../creatures';
import type { Behaviour, CreatureId, CreatureSpecies, CreatureState, MutableVec3 } from '../creatures';
import { distance, distanceSquared, translate, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';
import {
  drawnAhead, easeUp, layChain, newMotion, pointAlongPath, poseAntennae, poseGaster, poseHead, poseJaws, poseLegs, resetMotion, restBob,
  rootQuaternion, stepMotion, walkBob,
  type BoundAntenna, type BoundJaw, type BoundJoint, type BoundLeg, type RigMotion,
} from './motion';
import { disposeRig, dressRig, measureRig, placeholderFor, type RigAnatomy } from './rig';
import { poseWings, wingbeatHzOf, type BoundWing } from './wings';
import {
  CREATURE_LOD_DEFAULTS, CreatureLodAdaptive, creatureLodSnapshot,
  creatureLodTextureBlend, effectiveCreatureLod, sanitizeCreatureLodSettings,
  type CreatureLodSettings, type CreatureLodSnapshot,
} from './creatureLod';
export {
  CREATURE_LOD_DEFAULTS, CREATURE_LOD_LIMITS, DEFAULT_CREATURE_LOD_SETTINGS,
  sanitizeCreatureLodSettings, sanitizeCreatureLod, creatureLodTier, creatureLodTextureBlend, creatureLodIsOrdered,
  CreatureLodAdaptive,
  type CreatureLodMode, type CreatureLodDistances, type CreatureLodSettings,
  type CreatureLodAdaptiveState, type CreatureLodSnapshot,
} from './creatureLod';

/**
 * The words that ask the jaws for a bite and for a feed — booleans for
 * the poser, the way `AIRBORNE` is for the wings (see the header). The
 * defend stand opens the jaws too: a fire ant facing a threat gapes
 * before it closes, and a stand with closed jaws reads as standing.
 */
export const BITING: readonly Behaviour[] = Object.freeze(['attack', 'defend']);
export const FEEDING: readonly Behaviour[] = Object.freeze(['feed']);

/**
 * Rigs per species at each detail rung. GAME TUNING: `high` is the
 * brief's (worm 6, aphid 24, fly 12); the lower rungs are about a half,
 * a quarter and an eighth of that, rounded so nothing is zero. The
 * triangle cost of a full pool is the number to weigh on the phone:
 * at `high`, 6·3,144 + 24·30,947 + 12·25,635 ≈ 1.07 M triangles of
 * skinned geometry when every rig is lent.
 */
export const POOL_SIZES: Readonly<Record<string, Readonly<Record<CreatureId, number>>>> = Object.freeze({
  // THE RIGS ARE THE COST, and the aphid's is the heaviest: 30,947
  // triangles a rig against the worm's 3,144 and the fly's 25,635, all
  // skinned. At `high` this table is about 414 k triangles if every rig
  // is lent (4 worms, 8 aphids, 6 flies) — of the order of the 25,000
  // grass blades already on screen — and Joshua's rule for the phone is
  // that graphics give way before frame rate does. Everything past the
  // pool is a twenty-triangle impostor, which at ant scale a few metres
  // off is what the eye sees anyway. GAME TUNING until his phone says.
  // The two ants are not in the wild yet: the Creature Lab draws one of
  // each, so one rig apiece at every rung is the whole of their pool.
  'ultra-low': Object.freeze({ earthworm: 1, aphid: 2, housefly: 1, queen: 1, worker: 1 }),
  low: Object.freeze({ earthworm: 1, aphid: 3, housefly: 2, queen: 1, worker: 1 }),
  medium: Object.freeze({ earthworm: 2, aphid: 5, housefly: 4, queen: 1, worker: 1 }),
  high: Object.freeze({ earthworm: 4, aphid: 8, housefly: 6, queen: 1, worker: 1 }),
  'ultra-high': Object.freeze({ earthworm: 6, aphid: 16, housefly: 10, queen: 1, worker: 1 }),
});

/** The pool for a rung named by the detail ladder; an unknown name is `medium`. */
export function poolSizeFor(rung: string, id: CreatureId): number {
  return (POOL_SIZES[rung] ?? POOL_SIZES.medium)[id];
}

/**
 * HOW MANY RIGS THE WHOLE VIEW MAY LEND AT A RUNG — the sum of that
 * rung's `POOL_SIZES`, which is where the number comes from and why
 * `POOL_SIZES` stays.
 *
 * The lending is global and distance-first now (the header), so the
 * per-species split above no longer decides who wears a skeleton. What
 * it still decides is the TOTAL, and deliberately: thirteen at medium is
 * exactly what that rung paid for when the pools were separate, so
 * moving the decision changes WHO gets a rig and not what rigs cost.
 * Read the table's own docblock for how each rung's numbers were
 * arrived at and what a full pool weighs in triangles.
 */
export function rigBudgetFor(rung: string): number {
  const table = POOL_SIZES[rung] ?? POOL_SIZES.medium;
  let sum = 0;
  for (const count of Object.values(table)) sum += count;
  return sum;
}

/**
 * THE LADDER, AS JOSHUA SPECIFIED IT ON 2026-09-11 — and the measurement
 * that made him respecify it.
 *
 *   0 – 0.3 m    the full model: its own textures, animated every frame
 *   0.3 – 0.5 m  THE SAME MODEL, STILL ANIMATED, in a solid matching
 *                colour — the texture is what goes, not the motion
 *   0.5 – 0.6 m  that flat model crossfades to the impostor, by DISTANCE
 *   over 0.6 m   the twenty-triangle impostor, in the same solid colour
 *
 * His words: "do full model and everything from 0-0.3m, from 0.3-0.5m,
 * the texture will be a solid matching color but model still there and
 * animated… from 0.5-0.6 it will fade to procedural and over 0.6m is
 * procedural same solid color, no model or animation."
 *
 * WHY THE MIDDLE TIER CHANGED SIDES. It used to keep the textures and
 * FREEZE THE BONES, re-posing four times a second — a CPU saving. His
 * own uncapped run (Baseline C-ALL, `docs/PERFORMANCE.md`) priced that:
 * posing 198 skinned rigs cost 1.3 ms of a 31 ms frame. The frame is not
 * the posing. It is the GPU submitting and shading those meshes, so the
 * lever that matters is the MATERIAL, not the skeleton — and a flat
 * colour drops the texture fetch on every fragment of every one of them
 * while the animation, which is nearly free and is what makes an ant
 * read as alive, stays. The old tier's ceiling was about 4% of the
 * frame; this one is aimed where the other 96% is.
 *
 * THE COLOUR IS `LOOK[species].colour`, the same number the impostor is
 * built from, which is what makes "same solid color" true by
 * construction rather than by two tables agreeing.
 *
 * THE TEXTURE TRANSITION IS TWO NUMBERS: the textured shader blends to the
 * matching solid colour between them. There is no latch or history-dependent
 * band: at the first endpoint the texture is whole, at the second it is
 * fully solid, and every step between is a fraction of each.
 *
 * GAME TUNING, his numbers, ±7% on the one boundary that latches.
 */
export const TEXTURED_IN = unitsOfMetres(CREATURE_LOD_DEFAULTS.textureEnd);
export const TEXTURED_OUT = unitsOfMetres(CREATURE_LOD_DEFAULTS.solidEnd);

/** Where the flat model begins to give way to the impostor, and where it has finished. */
export const FADE_FROM = unitsOfMetres(CREATURE_LOD_DEFAULTS.proceduralStart);
export const FADE_TO = unitsOfMetres(CREATURE_LOD_DEFAULTS.proceduralOnly);

/**
 * WHO MAY HOLD A CLONE AT ALL. A body claims one at `MESH_IN` — the far
 * end of the fade, where it is drawn at nothing and grows in as it
 * approaches — and keeps it to `MESH_OUT`, which is the hysteresis. In
 * the slack between them it is drawn at zero and therefore not drawn:
 * `drawSpecies` skips a rig whose fade has reached zero, so the hold
 * costs a clone and never a draw call.
 */
export const MESH_IN = FADE_TO;
export const MESH_OUT = unitsOfMetres(CREATURE_LOD_DEFAULTS.proceduralOnly + 0.02);

/**
 * HOW MUCH OF THE BODY IS THE MESH at a distance: 1 at `FADE_FROM` and
 * nearer, 0 at `FADE_TO` and beyond, a straight ramp between. The
 * impostor draws `1 - fade` of itself, so the two always sum to one
 * animal.
 *
 * It is a function of DISTANCE and not of time, which is the change from
 * the fade this replaces. A timed crossfade has to be started, held and
 * finished, and it runs at the wrong moment whenever a body crosses the
 * line while something else is deciding tiers. A distance ramp is simply
 * true every frame: no latch, no clock, nothing to get out of step.
 */
export function meshShare(d2: number, fadeFrom: number = FADE_FROM, fadeTo: number = FADE_TO): number {
  if (d2 <= fadeFrom * fadeFrom) return 1;
  if (d2 >= fadeTo * fadeTo) return 0;
  return (fadeTo - Math.sqrt(Math.max(0, d2))) / (fadeTo - fadeFrom);
}

/**
 * What a REDUCED body costs against a full one, as a share of the full
 * budget. GAME TUNING and A GUESS UNTIL THE BENCH SAYS: a frozen rig
 * still costs its draw call and its skinned geometry on the GPU, and
 * saves the per-frame CPU posing, so it is cheaper but not free. Two
 * middle bodies per full one is a deliberately cautious opening bid —
 * the Creature Lab exists to replace it with a measurement.
 */
export const REDUCED_PER_FULL = 2;

/** The full-rig budget for a rung: the same total the pools paid for before the tiers. */
export function fullBudgetFor(rung: string): number {
  return rigBudgetFor(rung);
}

/** How many bodies may hold the real mesh with their bones held still. */
export function reducedBudgetFor(rung: string): number {
  return rigBudgetFor(rung) * REDUCED_PER_FULL;
}

/**
 * Kept as the names the first band shipped under, so nothing that reads
 * "the radius a rig is won at" has to be hunted down. They are the outer
 * edges of the two things a body can lose: its TEXTURE and its MESH.
 */
export const RIG_NEAR = TEXTURED_OUT;
export const RIG_FAR = MESH_OUT;

/**
 * WHAT A BODY THAT ALREADY HOLDS A MESH IS WORTH IN THE QUEUE — its
 * distance, multiplied by this, when the nearest-first order is decided.
 * A holder at 30 cm sorts as though it stood at 24, so a challenger has
 * to be a fifth nearer to take its place.
 *
 * The outer MESH radii are hysteretic (`MESH_IN` / `MESH_OUT`), and that is
 * the right cure for a body wandering across the procedural line. The
 * texture endpoints are not latches: they are a shader blend. The other way
 * a tier is lost is RANK: when four
 * hundred animals stand inside `LOD0_IN` and thirteen may wear a rig,
 * nobody crosses a radius at all and the nearest thirteen are simply a
 * different thirteen every frame. Each swap is a fade out and a fade in,
 * so a crowd shimmers between mesh and ellipsoid while every distance in
 * it is perfectly stable.
 *
 * GAME TUNING. A fifth is enough that ordinary milling cannot displace a
 * holder and small enough that walking past one still does.
 */
export const HOLD_ADVANTAGE = 0.8;

/**
 * HOW MANY CLONES ONE FRAME MAY BUILD. The pool grows on demand rather
 * than being cut to its ceiling up front (`poolTarget`), because the
 * ceiling is per species and the budget is global: five species each
 * sized for the whole ladder is five times the skeletons any one frame
 * can lend. Building one costs about 0.2 ms, so four a frame warms a
 * cold pool in a sixth of a second and never lands as a hitch.
 */
export const POOL_GROWTH_PER_FRAME = 4;

/** The pool a species starts with, before any animal has asked for one. */
export const POOL_WARM = 2;

/** The impostor cap for a rung: the species' own population cap, since the simulation never holds more than that. */
export function impostorCapFor(species: CreatureSpecies, rung: string): number {
  const caps = species.population.caps as Readonly<Record<string, number>>;
  return caps[rung] ?? caps.medium;
}

/** The spine may be off the cited length by this fraction before the load warns. From the brief. */
export const SPINE_TOLERANCE = 0.35;

/**
 * A burrower more than this far under the ground it stands on is not
 * drawn — world units AT THE SPECIES' CITED LENGTH, an individual's line
 * being this through its own `sizeRatio`. From the brief.
 *
 * It scales with the animal because what it measures is when a body has
 * gone out of sight, and a body goes out of sight at its own GIRTH: the
 * impostor's is `LOOK.girth` of its length and the rig's skin is drawn
 * around a spine the root scale has just resized, so a worm twice as
 * long is twice as thick and still shows above the soil twice as far
 * down. One absolute for every size would hide a 250 mm worm with a
 * centimetre of it lying in the open.
 */
export const BURROW_HIDE = 0.3;

/**
 * A BODY'S REVEAL IS A PROPERTY OF THE ANIMAL, NOT OF WHICHEVER 3.2 cm
 * TILE ITS NOSE IS OVER — and it may not change faster than the animal
 * does.
 *
 * Joshua, 2026-09-08, from the phone, on the soil cutaway: it "still
 * randomly throws the worm above and below ground", and "for a moment
 * saw the worm rotate around like a straight log". That is one defect,
 * and the arithmetic says so. The cutaway is meshed a TILE at a time —
 * `SOIL_TILE` is 3.2 units, 3.2 cm — and the owner's `ceilingAt` can
 * only answer "the roof is off here" where a tile has finished. A worm
 * is 15 cm long, so it lies across about five of those tiles. Asking the
 * single point under its HEAD and applying that answer to every crumb of
 * the body ties the whole animal to a fact that changes as tiles finish
 * (two a frame) and as the head crosses a 3.2 cm boundary. Each flip
 * moved the drawn body by the belly lift (3.4 mm) and the depth clamp,
 * and flipped `drawn()` with it — and a rig released and lent again is a
 * trail laid STRAIGHT along the current heading, which is the log the
 * eye saw rotating.
 *
 * So the reveal is decided ONCE per creature per frame, from the whole
 * body, with hysteresis in both axes:
 *
 *   `BODY_SAMPLES` points, head to tail along the heading and one of
 *   THAT ANIMAL'S body lengths end to end — five points 3.75 units apart
 *   on the cited 150 mm worm is a sample every 1.2 soil tiles, so no
 *   single tile can carry the answer. A longer worm spaces them further
 *   apart, which is the right direction: it is the body that lies across
 *   more tiles, so it is the body that must be asked about more widely.
 *
 *   The cutaway is taken as OPEN at `REVEAL_OPEN` of those samples and
 *   SHUT at `REVEAL_SHUT`; between the two nothing changes. Crossing
 *   that band takes two fifths of a body length of crawling — 60 mm on
 *   the cited worm — and the same number of SECONDS whatever the animal's
 *   size, because a pace scales with the body it belongs to just as this
 *   span does.
 *
 *   And a SHUT reading must hold for `REVEAL_HOLD` frames before it is
 *   believed, while an OPEN one is believed at once. Showing what the
 *   player has just cut open must never wait; hiding is never urgent;
 *   and holding one direction is enough to make a flip-flop impossible,
 *   because an alternating fact never accumulates a run.
 *
 * GAME TUNING, all four. The hold is counted in FRAMES rather than
 * seconds deliberately: the chattering fact is per-frame by construction
 * — tiles mesh at a frame rate, not at a clock rate — so a phone drawing
 * twenty frames a second, where tiles arrive further apart in time, gets
 * a proportionally longer hold, which is the direction that helps.
 */
export const BODY_SAMPLES = 5;
export const REVEAL_OPEN = 0.6;
export const REVEAL_SHUT = 0.2;
export const REVEAL_HOLD = 12;

/**
 * A burrower already drawn stays drawn until it is this factor deeper
 * than `BURROW_HIDE`; one met for the first time is judged at the line
 * itself.
 *
 * GAME TUNING — the rig band (`RIG_NEAR`/`RIG_FAR`) in the other axis,
 * and for the same reason:
 * the band is 3 to 4.5 mm under the surface for the cited 150 mm worm
 * and scales with the animal, as `BURROW_HIDE` does. A worm nosing up at
 * its own pace takes the same fraction of a second to cross it at any
 * size — band and pace scale together — and cannot jitter across it
 * between two frames, and it sits well clear of the band the animal
 * travels in (`species.burrow.underMm`), so one working near the surface
 * settles on one side of the line instead of blinking on it.
 */
export const BURROW_KEEP = 1.5;

/**
 * Crumbs per body length on a worm's trail, and the crumbs kept beyond
 * one body. GAME TUNING, TCS's lesson: its trail is 56 points 3 mm apart
 * for a 150 mm worm, and `WormBody` says why — "the body is laid on the
 * POLYLINE through these points, so a coarse trail cuts the" curve. At
 * eight a length the crumbs were 1.875 units apart and the seventeen
 * bones 0.94, so two bones shared a straight segment and the animal read
 * as a chain of sticks. Sixteen puts a crumb between every pair of
 * bones. The trail still remembers about a body and a half.
 *
 * PER LENGTH, and the length is the individual's: sixteen crumbs to
 * whatever body the animal grew. The cited worm drops one every 0.9375
 * units and a 300 mm one every 1.875, which keeps the same crumb between
 * the same pair of bones on both — the ratio the constant is named for,
 * rather than an absolute spacing that would leave a long body a chain
 * of sticks and a short one over-sampled.
 */
export const CRUMBS_PER_LENGTH = 16;
const TRAIL_MARGIN = 8;
const TRAIL_CAPACITY = CRUMBS_PER_LENGTH + TRAIL_MARGIN;

/**
 * A head this far from its newest crumb has not crawled there — the
 * creature has been moved. Body lengths of the animal itself, so it
 * means the same thing at every size: a pace scales with the body
 * (`species.pace` through `sizeRatio`), so half a body length is the
 * same stretch of seconds of full flight for a 30 mm worm as for a
 * 250 mm one, and nothing a crawl reaches between two frames.
 * GAME TUNING.
 */
const TRAIL_BREAK_LENGTHS = 0.5;

/** How the impostor and the placeholder look, per species. GAME TUNING, from the rigs' own proportions. */
export interface SpeciesLook {
  /** Body girth over body length. */
  readonly girth: number;
  /** sRGB. */
  readonly colour: number;
  /** A resting bob: amplitude as a fraction of the body length, and cycles a second. Zero for an animal that sits still. */
  readonly restBob: number;
  readonly restBobRate: number;
}

export const LOOK: Readonly<Record<CreatureId, SpeciesLook>> = Object.freeze({
  earthworm: Object.freeze({ girth: 0.045, colour: 0x9a6e62, restBob: 0, restBobRate: 0 }),
  // An aphid on a stem breathes: a slow, small bob so a colony is not a row of beads.
  aphid: Object.freeze({ girth: 0.42, colour: 0x86b04a, restBob: 0.012, restBobRate: 0.4 }),
  housefly: Object.freeze({ girth: 0.34, colour: 0x3a3a40, restBob: 0, restBobRate: 0 }),
  // The fire ants: girth from the rigs' thorax height over their length
  // (queen 4.67 mm at 8, worker 1.29 mm at 3.0 — rigs.md); the reddish
  // brown of S. invicta, the queen darker. Placeholders for the fauna
  // pass to refine against the drawn rig.
  queen: Object.freeze({ girth: 0.58, colour: 0x6e2f16, restBob: 0, restBobRate: 0 }),
  worker: Object.freeze({ girth: 0.43, colour: 0x9a4a22, restBob: 0, restBobRate: 0 }),
});

/** Where a world position is drawn. `world/origin.toLocal` is the default; a test may hand in its own. */
export interface FaunaOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

export interface FaunaViewOptions {
  /** The species to draw, in the table's order. */
  readonly species: readonly CreatureSpecies[];
  /** `assets.loadModel`, injected so a test can hand in a synthetic rig. The only loader. */
  readonly loadModel: Assets['loadModel'];
  /** The detail rung's name: pool sizes and impostor caps. */
  readonly rung: string;
  readonly origin?: FaunaOrigin;
  /** The ground's height at a point, world units — lets a burrower be hidden by DEPTH. Without it, by the burrow behaviour. */
  readonly groundAt?: (at: WorldPoint) => number;
  /** Visible soil ceiling, including a prepared observer section; does not move the animal. */
  readonly ceilingAt?: (at: WorldPoint) => number;
  /** Player-facing distance bands, in metres. */
  readonly lod?: CreatureLodSettings;
  /** Descriptive alias for callers that prefer the full setting name. */
  readonly lodSettings?: CreatureLodSettings;
}

/**
 * What the HUD is told. Plain numbers, and they ACCOUNT FOR EVERY
 * CREATURE HANDED TO `update` — see the header's last section for the
 * report that did not:
 *
 *   rigs + impostors + notDrawn      = the creatures handed in
 *   hidden + pastCap + farTier       = notDrawn
 *
 * The counts are of BODIES, one per animal, which is what makes those
 * two identities true: a body crossing between its two forms is counted
 * where its RIG is, though a shrinking impostor is drawn for it as well.
 * So an impostor mesh's `count` may exceed `impostors` by the crossfades
 * in flight, and `impostors` remains the number of animals the ellipsoid
 * is carrying rather than the number of instances the GPU is handed.
 */
export interface FaunaCost {
  readonly meanMs: number;
  readonly peakMs: number;
  /** FULL rigs lent this frame — the real mesh, posed every frame — per species. */
  readonly rigsLent: Readonly<Record<CreatureId, number>>;
  /**
   * REDUCED bodies this frame, per species: the real mesh, moved through
   * the world every frame, with its bones re-posed only every
   * `REDUCED_POSE_S`. The middle tier (LOD1).
   */
  readonly reduced: Readonly<Record<CreatureId, number>>;
  /** Impostors drawn this frame, per species. */
  readonly impostors: Readonly<Record<CreatureId, number>>;
  /** Handed in, drawn in no form. */
  readonly notDrawn: number;
  /**
   * Of those: the view is showing nothing of it on purpose — a burrower
   * deeper than `BURROW_HIDE` with no cutaway over it (the 55 of
   * alpha.42), a species switched off with `setEnabled`, or one this
   * view was never given a slot for.
   */
  readonly hidden: number;
  /** Of those: drawable, but the species' impostor cap was already full. */
  readonly pastCap: number;
  /** Of those: tier `far`, the simulation's own cut, which this view only obeys. */
  readonly farTier: number;
  /**
   * THE CAPS THE COUNTS ABOVE ARE UP AGAINST — how many bodies may wear
   * a full rig and the frozen mesh at all this frame.
   *
   * Printed beside the counts because the pair is the only way to tell
   * the two reasons a near animal is an ellipsoid apart. `4 / 13` says
   * the ladder ran out of ANIMALS inside its radius; `13 / 13` says it
   * ran out of BUDGET, and the next nearest body is an impostor however
   * close it stands. Joshua, 2026-09-10, looking at 1,077 insects in a
   * one-metre room: "LOD still not correct and rendering as a procedural
   * too close" — it was `13 / 13`, and the HUD did not say so.
   */
  readonly fullBudget: number;
  readonly reducedBudget: number;
  /**
   * HOW MANY WANTED EACH TIER, by distance alone and before any budget:
   * candidates inside `LOD0_IN` and inside `LOD1_IN` of the eye. The
   * demand against the capacity above.
   */
  readonly withinFull: number;
  readonly withinReduced: number;
  /** Aggregate body counts, useful to player-facing HUDs and reports. */
  readonly textured: number;
  readonly solid: number;
  readonly procedural: number;
  /** Baseline and effective distance bands, plus the Auto controller state. */
  readonly lod: CreatureLodSnapshot;
}

/**
 * A worm's recent positions, newest at `head`, as a ring of WORLD points.
 *
 * A crumb remembers its DEPTH under the ground, not its height above the
 * sea — see `crumbHeight`. `heights` is the absolute it was dropped at,
 * kept only for a view with no ground to ask.
 */
interface Trail {
  readonly points: WorldPoint[];
  readonly heights: Float64Array;
  /** Ground minus the body, world units, positive downward. */
  readonly depths: Float64Array;
  /** The holder's body length over `CRUMBS_PER_LENGTH`. Rewritten when the rig changes hands, since the new animal is a new size. */
  spacing: number;
  head: number;
  count: number;
  /** The creature whose crawl this is a record of. A record of somebody else's crawl is worthless. */
  owner: string;
}

/**
 * WHAT ONE ANIMAL'S BODY IS SHOWING, AND HOW LONG THAT STANDS.
 *
 * The latch the constants above describe: one named object per creature
 * rather than loose fields (ARCHITECTURE §2.3), measured once a frame in
 * `reveal` and read — never written — by `pose`. Both facts it holds are
 * about the WHOLE body, and the two derived answers come out of them
 * together, so the body cannot be drawn on the surface in the same frame
 * a cutaway is showing its burrow:
 *
 *   drawn at all   = it is not deep, or the cutaway is open over it
 *   burrow on show = it is deep AND the cutaway is open over it
 */
interface Reveal {
  /** The cutaway has the roof off most of this body. */
  cut: boolean;
  /** The body is further under the ground than the surface band. */
  deep: boolean;
  /** Consecutive frames the samples have read shut while `cut` still stands. */
  shutFor: number;
  /** The frame it was last measured on; one not measured this frame is forgotten. */
  frame: number;
}

/** One clone of a species' template, and what it remembers. */
interface Rig {
  readonly root: THREE.Object3D;
  readonly legs: BoundLeg[];
  readonly wings: BoundWing[];
  readonly antennae: BoundAntenna[];
  /** The two jaws, −X first, each with its own angle; empty on a rig without a mirrored mouthpart pair. */
  readonly jaws: BoundJaw[];
  readonly head: BoundJoint | null;
  readonly gaster: BoundJoint | null;
  readonly chain: THREE.Bone[];
  /** The head bone's rest position in the root's (unscaled) frame, and its parent's orientation there. */
  readonly headOffset: THREE.Vector3;
  readonly headFrame: THREE.Quaternion;
  readonly motion: RigMotion;
  /**
   * The up the root is BUILT on: the holder's `up` eased after an edge
   * (`motion.easeUp`), the holder's exactly on the ground and once
   * settled. Snapped to the holder's in `lend`. The rig's own scratch.
   */
  readonly drawnUp: THREE.Vector3;
  /**
   * THIS CLONE'S OWN MATERIALS, cloned off the template's when the rig
   * was built. A crossfade is written on them, and a pool that shared
   * one material would fade every rig of the species at once. The clones
   * share the template's MAPS — a material clone copies texture
   * references, not textures — so the cost is a small uniform block
   * apiece and no texture memory.
   */
  readonly materials: THREE.Material[];
  /** Every mesh of this clone with both of its material sets (`skinsOf`). */
  readonly skins: Skin[];
  /** Only the SOLID ones: the crossfade is the flat tier's, since the textured tier never reaches the fade band. */
  readonly flat: THREE.Material[];
  /** Which set is bound right now, so `skin` writes nothing on a frame that changes nothing. */
  wearing: 'textured' | 'solid';
  /** What `transparent` currently reads on those materials, so a fade only sets it (and `needsUpdate`) when it changes. */
  transparent: boolean;
  trail: Trail | null;
  /** The creature's id, or null when free. */
  holder: string | null;
  /** The holder's index in this frame's creature list. */
  creature: number;
  lastAt: WorldPoint | null;
  lastHeight: number;
  lastHeading: number;
}

/** One species: its template, its pool, its impostor. */
interface Slot {
  readonly species: CreatureSpecies;
  readonly group: THREE.Group;
  /** The species' CITED length, world units. One animal's is this through its own `sizeRatio`. */
  readonly bodyLength: number;
  readonly look: SpeciesLook;
  /** The species' wingbeat, cycles a second (`wings.ts`); read by every wing the pool finds. */
  readonly hz: number;
  enabled: boolean;
  template: THREE.Object3D | null;
  placeholder: boolean;
  anatomy: RigAnatomy | null;
  /** The TEMPLATE's uniform scale: `rigScale(species)`, or 1 for a placeholder. A LENT rig wears this through its holder's ratio. */
  scale: number;
  rigs: Rig[];
  impostor: THREE.InstancedMesh | null;
  cap: number;
  /** Indices into this frame's creature list, nearest first once sorted. Scratch. */
  readonly candidates: number[];
}

const now = (): number => performance.now();

function zeroCounts(): Record<CreatureId, number> {
  const out = {} as Record<CreatureId, number>;
  for (const id of CREATURE_IDS) out[id] = 0;
  return out;
}

/**
 * GIVE ONE CLONE ITS OWN MATERIALS, and hand them back for the fade to
 * write on and the pool to dispose.
 *
 * `SkeletonUtils.clone` shares the template's, which is right for
 * everything except a crossfade: an opacity written on a shared material
 * fades every rig of the species at once. A material clone copies the
 * settings and the texture REFERENCES — the skin, the normal map and the
 * compiled program are still the template's — so what is actually new
 * per body is a uniform block, which is the smallest thing a fade of one
 * body can be made of.
 */
function skinsOf(root: THREE.Object3D, colour: number): { skins: Skin[]; materials: THREE.Material[]; flat: THREE.Material[] } {
  const skins: Skin[] = [];
  const materials: THREE.Material[] = [];
  const flat: THREE.Material[] = [];
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const own = source.map((material) => material.clone());
    const plain = source.map((material) => flatLike(material, colour));
    for (const m of own) materials.push(m);
    for (const m of plain) { materials.push(m); flat.push(m); }
    const textured = Array.isArray(mesh.material) ? own : own[0];
    const solid = Array.isArray(mesh.material) ? plain : plain[0];
    const textureBlends = own.map((material) => installTextureBlend(material, colour));
    mesh.material = textured;
    skins.push({ mesh, textured, solid, textureBlends });
  });
  return { skins, materials, flat };
}

/**
 * THE SOLID-COLOUR TWIN of one of a model's materials — "the texture
 * will be a solid matching color but model still there and animated"
 * (Joshua, 2026-09-11).
 *
 * The colour is `LOOK[species].colour`, which is the same number the
 * impostor is built from, so the two tiers match by construction rather
 * than by two tables being kept in step. `MeshLambertMaterial` is the
 * impostor's class too: lit, so it still obeys "light decides what
 * shows", and cheap, because the whole point is the fragment that no
 * longer fetches a texture.
 *
 * TWO THINGS ARE CARRIED ACROSS, and only two. `side`, because a
 * single-sided wing turned double-sided would gain faces. And a CUTOUT:
 * where the original alpha-tests (a fly's wing is a quad with a shaped
 * alpha channel), the same map drives the same cutout, or the wings
 * would become cardboard. A material with no cutout gets no map at all,
 * which is the saving.
 */
function flatLike(source: THREE.Material, colour: number): THREE.Material {
  const cut = (source as THREE.MeshStandardMaterial).alphaTest ?? 0;
  const map = cut > 0 ? (source as THREE.MeshStandardMaterial).map ?? null : null;
  return new THREE.MeshLambertMaterial({
    color: colour, fog: true, side: source.side, alphaTest: cut, alphaMap: map,
  });
}

/**
 * Keep the transition in one draw. The textured material remains bound while
 * the shader mixes its sampled colour with the same lit solid colour used by
 * the reduced material. Once the amount reaches one, `skin` binds the solid
 * material and the texture fetch disappears altogether.
 */
function installTextureBlend(material: THREE.Material, colour: number): { value: number } {
  const amount = { value: 0 };
  const solid = new THREE.Color(colour);
  const previous = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.userData.faunaLodTextureBlend = amount;
  material.userData.faunaLodSolidColor = solid;
  material.customProgramCacheKey = () => `${previousCacheKey()}:fauna-lod-texture-blend-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.faunaLodTextureBlend = amount;
    shader.uniforms.faunaLodSolidColor = { value: solid };
    const declarations = 'uniform float faunaLodTextureBlend;\nuniform vec3 faunaLodSolidColor;\n';
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${declarations}void main() {`);
    const mix = 'diffuseColor.rgb = mix(diffuseColor.rgb, faunaLodSolidColor, faunaLodTextureBlend);';
    if (shader.fragmentShader.includes('#include <map_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${mix}`);
    } else if (shader.fragmentShader.includes('#include <color_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${mix}`);
    }
  };
  return amount;
}

/** One mesh of a clone and its two coats: the model's own, and the species' solid colour. */
interface Skin {
  readonly mesh: THREE.Mesh;
  readonly textured: THREE.Material | THREE.Material[];
  readonly solid: THREE.Material | THREE.Material[];
  readonly textureBlends: { value: number }[];
}

function wrapAngle(a: number): number {
  let w = (a + Math.PI) % (Math.PI * 2);
  if (w < 0) w += Math.PI * 2;
  return w - Math.PI;
}

export class FaunaView {
  /** One group; a layer toggle is one `visible`. Each species is a child group, so a species toggle is one too. */
  readonly group = new THREE.Group();

  private readonly slots = new Map<CreatureId, Slot>();
  private readonly order: Slot[] = [];
  private readonly loadModel: Assets['loadModel'];
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private readonly groundAt: ((at: WorldPoint) => number) | null;
  private readonly ceilingAt: ((at: WorldPoint) => number) | null;
  private rung: string;
  private lodSettings: CreatureLodSettings = { ...CREATURE_LOD_DEFAULTS };
  private readonly lodAdaptive = new CreatureLodAdaptive();
  private lodState = this.lodAdaptive.state();
  private lodEffective = effectiveCreatureLod(this.lodSettings, 1);
  /** Pools the Lab has named, past the rung's budget (`setPoolSize`). Empty on the island. */
  private readonly poolOverride = new Map<CreatureId, number>();
  private readonly loads: Promise<void>[] = [];
  private disposed = false;

  /** The impostor body, shared by every species: an icosahedron, twenty triangles, scaled to an ellipsoid per instance. */
  private readonly impostorGeometry = new THREE.IcosahedronGeometry(1, 0);
  private readonly materials: THREE.Material[] = [];

  /** One latch per creature in reach, by creature id; an animal not measured this frame is dropped. */
  private readonly reveals = new Map<string, Reveal>();
  private frame = 0;

  /**
   * HOW MUCH OF EACH DRAWN BODY ITS RIG IS CARRYING, 0..1, by creature
   * id — the crossfade, kept per ANIMAL rather than per rig so that a
   * rig handed back to the same creature picks the fade up where it was
   * instead of starting again. An animal with no entry has not been
   * drawn before and snaps to whichever form it wins; one with no rig is
   * pinned at 0, which is what makes the impostor's `1 - fade` the whole
   * of its body. Entries not drawn this frame are dropped, as `reveals`
   * are.
   */
  private readonly fades = new Map<string, number>();
  /**
   * WHAT TIER EACH BODY HELD LAST FRAME — 1 full, 2 reduced, absent for
   * an impostor. Every boundary in this ladder is two numbers, and the
   * one that applies depends on which side the body is already on, so
   * the previous answer is part of this frame's question. Pruned with
   * the fades when a body stops being drawn.
   */
  private readonly tier = new Map<string, number>();
  /** Which rig holds a creature, by creature id. Written by `lend` and `release`; the allocator's only question. */
  private readonly byHolder = new Map<string, Rig>();

  // Scratch, allocated once and grown as the creature list grows.
  private d2 = new Float64Array(512);
  private rigged = new Uint8Array(512);
  /** Every drawn creature's index in this frame's list, by id. Rewritten in pass 1. */
  private readonly byIndex = new Map<string, number>();
  /** Every candidate of every species, the pass-2 sort's own list. */
  private readonly eligible: number[] = [];
  /** This frame's creature list, so the sort can reach an id for a tie. Set in `update`. */
  private frameCreatures: readonly CreatureState[] = [];
  private readonly path = new Float64Array((TRAIL_CAPACITY + 1) * 3);
  /**
   * NEAREST FIRST, AND THE SAME ORDER EVERY FRAME. Distance decides; a
   * tie falls back to the creature's id, because two animals at the same
   * distance sorted by luck would trade forms every frame — which is
   * half of what "it's random" was describing.
   *
   * A body that already holds a tier sorts from `HOLD_ADVANTAGE` of its
   * distance: the other half of "it's random" is rank, not distance, and
   * a crowd inside one radius has no radius left to be hysteretic about.
   */
  private readonly byNearest = (a: number, b: number): number => {
    const d = this.ranked(a) - this.ranked(b);
    if (d !== 0) return d;
    const ia = this.frameCreatures[a].id;
    const ib = this.frameCreatures[b].id;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  /** What this body's distance is WORTH in the queue: its own, or a holder's discount on it. */
  private ranked(i: number): number {
    const tier = this.tier.get(this.frameCreatures[i].id) ?? 0;
    return tier > 0 ? this.d2[i] * HOLD_ADVANTAGE * HOLD_ADVANTAGE : this.d2[i];
  }

  // THE PICK SURFACE's scratch: who is drawn this frame and where, in
  // local render space. The list and the positions are reused across
  // frames and grown only when a frame draws more than they have held.
  private readonly drawnList: string[] = [];
  private drawnPos = new Float64Array(512 * 3);
  private readonly drawnIndex = new Map<string, number>();
  /** The vector `positionOf` answers in. Owned here; overwritten by the next call. */
  private readonly pick = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  /** The ahead a root is built on this frame (`motion.drawnAhead`). Scratch. */
  private readonly ahead: MutableVec3 = { x: 0, y: 0, z: 0 };

  private rigsLent = zeroCounts();
  /** Bodies wearing the real mesh with their bones held still (LOD1), per species. */
  private reducedLent = zeroCounts();
  private impostors = zeroCounts();
  // The census (`FaunaCost`): everything handed in that this view drew nothing of.
  /** No budget and no pool ceiling: the Creature Lab sets it, the game never does (`setUncapped`). */
  private uncapped = false;
  /** Every drawn body wants a full rig, distance ignored: RIGS: ALL (`setAllRigs`). */
  private allRigs = false;
  private hidden = 0;
  private pastCap = 0;
  private farTier = 0;
  /** Candidates inside `LOD0_IN` / `LOD1_IN` of the eye this frame, before any budget. Pass 2 fills them. */
  private withinFull = 0;
  private withinReduced = 0;
  /** Clones built during THIS frame's allocation, against `POOL_GROWTH_PER_FRAME`. Zeroed in `update`. */
  private grewThisFrame = 0;
  private frames = 0;
  private totalMs = 0;
  private peakMs = 0;

  constructor(options: FaunaViewOptions) {
    this.loadModel = options.loadModel;
    this.toLocal = options.origin ? (at) => options.origin!.toLocal(at) : originToLocal;
    this.groundAt = options.groundAt ?? null;
    this.ceilingAt = options.ceilingAt ?? null;
    this.rung = options.rung;
    this.setLodSettings(options.lod ?? options.lodSettings ?? CREATURE_LOD_DEFAULTS);
    this.group.name = 'fauna';
    for (const species of options.species) {
      const group = new THREE.Group();
      group.name = `fauna:${species.id}`;
      this.group.add(group);
      const slot: Slot = {
        species,
        group,
        bodyLength: unitsOfMm(species.lengthMm),
        look: LOOK[species.id],
        hz: wingbeatHzOf(species.id),
        enabled: true,
        template: null,
        placeholder: false,
        anatomy: null,
        scale: 1,
        rigs: [],
        impostor: null,
        cap: 0,
        candidates: [],
      };
      this.slots.set(species.id, slot);
      this.order.push(slot);
      // A species this view was given reads 0 rather than nothing before its first frame.
      this.rigsLent[species.id] = 0;
      this.impostors[species.id] = 0;
      this.buildImpostor(slot);
      this.loads.push(this.load(slot));
    }
  }

  /** Resolves when every species has a template — the file, or the placeholder standing in for it. */
  ready(): Promise<void> {
    return Promise.all(this.loads).then(() => undefined);
  }

  /** One species on or off: hidden, and not updated, until it is on again. */
  setEnabled(species: CreatureId, on: boolean): void {
    const slot = this.slots.get(species);
    if (slot === undefined) return;
    slot.enabled = on;
    slot.group.visible = on;
    if (!on) {
      for (const rig of slot.rigs) this.release(rig);
      if (slot.impostor !== null) slot.impostor.count = 0;
      this.rigsLent[species] = 0;
      this.impostors[species] = 0;
    }
  }

  isEnabled(species: CreatureId): boolean {
    return this.slots.get(species)?.enabled ?? false;
  }

  /**
   * LEND A SPECIES A POOL OF ITS OWN, past what the detail rung budgets.
   *
   * The rung's pool is a DEVICE BUDGET for a wild population seen across
   * a forest, where everything past the nearest few is a twenty-triangle
   * impostor and the eye cannot tell (the header). The Creature Lab's
   * stress test is the other case: every animal is within a metre of the
   * camera, and "how many FULLY ACTIVE insects can this room hold"
   * (Joshua, 2026-09-10) is a question about animated skeletons, not
   * about impostors. So the Lab names the pool it wants, one rig per
   * creature, and `clearPoolSizes` gives the rung its budget back.
   *
   * An override set before the model has loaded is remembered and
   * applied when it lands.
   */
  setPoolSize(species: CreatureId, count: number): void {
    const slot = this.slots.get(species);
    if (slot === undefined || !Number.isFinite(count)) return;
    const want = Math.max(0, Math.floor(count));
    if (this.poolOverride.get(species) === want) return;
    this.poolOverride.set(species, want);
    this.sizePool(slot, want);
  }

  /** Every pool back to its rung's budget. */
  clearPoolSizes(): void {
    if (this.poolOverride.size === 0) return;
    this.poolOverride.clear();
    for (const slot of this.order) this.warmPool(slot);
  }

  /** How many rigs a species' pool holds — what a HUD prints and a test reads. */
  poolSize(species: CreatureId): number {
    return this.slots.get(species)?.rigs.length ?? 0;
  }

  /** A new rung: the pools and the impostor caps are rebuilt; nothing about the creatures changes. */
  setRung(rung: string): void {
    if (rung === this.rung) return;
    this.rung = rung;
    for (const slot of this.order) {
      this.buildImpostor(slot);
      if (slot.template !== null) this.buildPool(slot);
    }
  }

  /** Change the player-facing bands without rebuilding models or simulation. */
  setLodSettings(settings: CreatureLodSettings): void {
    const next = sanitizeCreatureLodSettings(settings);
    const changed = JSON.stringify(next) !== JSON.stringify(this.lodSettings);
    this.lodSettings = next;
    if (next.mode === 'manual') this.lodAdaptive.reset();
    this.lodState = this.lodAdaptive.state(this.allRigs);
    this.lodEffective = effectiveCreatureLod(next, next.mode === 'auto' && !this.allRigs ? this.lodState.multiplier : 1);
    if (changed) {
      // The allocator's latches are distance decisions. Forgetting them on a
      // changed slider prevents a body from retaining the old band for one
      // frame and gives the player an immediate, coherent change.
      this.tier.clear();
    }
  }

  setCreatureLodSettings(settings: CreatureLodSettings): void {
    this.setLodSettings(settings);
  }

  get lod(): CreatureLodSnapshot {
    return creatureLodSnapshot(this.lodSettings, this.lodState);
  }

  get detail(): string {
    return this.rung;
  }

  /**
   * One call a frame, after the simulation has stepped: lend the rigs,
   * pose them, fill the impostors. `eye` is the camera's world position
   * and `eyeHeight` its world y; with the height, distance is measured
   * in 3D, so a camera high over a lawn lends no rigs to what is under
   * it. `dt` is the clamped simulation step, never raw wall-clock.
   */
  update(
    creatures: readonly CreatureState[],
    eye: WorldPoint,
    dt: number,
    eyeHeight: number = Number.NaN,
    rawFrameMs: number = Number.NaN,
  ): void {
    if (this.disposed) return;
    const hidden = typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden');
    if (!this.allRigs && Number.isFinite(rawFrameMs)) {
      this.lodState = this.lodSettings.mode === 'auto'
        ? this.lodAdaptive.update(rawFrameMs, rawFrameMs / 1000, { hidden })
        : this.lodAdaptive.observe(rawFrameMs, rawFrameMs / 1000, { hidden });
      this.lodEffective = effectiveCreatureLod(
        this.lodSettings,
        this.lodSettings.mode === 'auto' ? this.lodState.multiplier : 1,
      );
    } else {
      this.lodState = this.lodAdaptive.state(this.allRigs);
      this.lodEffective = effectiveCreatureLod(this.lodSettings, this.lodSettings.mode === 'auto' && !this.allRigs ? this.lodState.multiplier : 1);
    }
    const began = now();
    const eyeLocal = this.toLocal(eye);
    if (Number.isFinite(eyeLocal.lx) && Number.isFinite(eyeLocal.lz)) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const eyeY = Number.isFinite(eyeHeight) ? eyeHeight : null;
      this.frame += 1;
      this.room(creatures.length);
      this.frameCreatures = creatures;
      this.drawnList.length = 0;
      this.drawnIndex.clear();
      this.byIndex.clear();
      this.hidden = 0;
      this.pastCap = 0;
      this.farTier = 0;
      this.withinFull = 0;
      this.withinReduced = 0;
      this.grewThisFrame = 0;
      for (const slot of this.order) slot.candidates.length = 0;
      // PASS 1: who is drawn at all, and how far away, bucketed by
      // species — and, for everyone who is not, WHY NOT. The order of
      // the three refusals is the order they cost: a species switched
      // off never advances a latch, and neither does the simulation's
      // own far cut, so `drawn` (which advances one) is asked last.
      for (let i = 0; i < creatures.length; i += 1) {
        const c = creatures[i];
        const slot = this.slots.get(c.species);
        if (slot === undefined || !slot.enabled) { this.hidden += 1; continue; }
        if (c.tier === 'far') { this.farTier += 1; continue; }
        if (!this.drawn(slot, c)) { this.hidden += 1; continue; }
        const dy = eyeY === null ? 0 : c.height - eyeY;
        this.d2[i] = distanceSquared(c.at, eye) + dy * dy;
        this.rigged[i] = 0;
        this.byIndex.set(c.id, i);
        slot.candidates.push(i);
      }
      // Every burrower in reach was measured above, so anything older
      // than this frame has gone far, been switched off or streamed out.
      // Its latch is dropped rather than kept for an animal that will
      // come back somewhere else.
      for (const [id, reveal] of this.reveals) if (reveal.frame !== this.frame) this.reveals.delete(id);
      // PASS 2: the rigs are dealt out ACROSS EVERY SPECIES AT ONCE, by
      // distance. Nothing below chooses a holder.
      this.allocate(creatures);
      // PASS 3: each species poses what it holds and fills its impostor.
      for (const slot of this.order) {
        if (!slot.enabled) continue;
        this.drawSpecies(slot, creatures, step);
      }
      // A fade belongs to an animal on the screen. One drawn in no form
      // this frame is forgotten, so it is met afresh — and snaps — when
      // it comes back.
      for (const id of this.fades.keys()) if (!this.drawnIndex.has(id)) this.fades.delete(id);
      for (const id of this.tier.keys()) if (!this.drawnIndex.has(id)) this.tier.delete(id);
    }
    const spent = now() - began;
    this.frames += 1;
    this.totalMs += spent;
    if (spent > this.peakMs) this.peakMs = spent;
  }

  get cost(): FaunaCost {
    let textured = 0;
    let solid = 0;
    let procedural = 0;
    for (const slot of this.order) {
      const id = slot.species.id;
      textured += this.rigsLent[id] ?? 0;
      solid += this.reducedLent[id] ?? 0;
      procedural += this.impostors[id] ?? 0;
    }
    return Object.freeze({
      meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames,
      peakMs: this.peakMs,
      rigsLent: { ...this.rigsLent },
      reduced: { ...this.reducedLent },
      impostors: { ...this.impostors },
      notDrawn: this.hidden + this.pastCap + this.farTier,
      hidden: this.hidden,
      pastCap: this.pastCap,
      farTier: this.farTier,
      fullBudget: this.fullBudget(),
      reducedBudget: this.reducedBudget(),
      withinFull: this.withinFull,
      withinReduced: this.withinReduced,
      textured,
      solid,
      procedural,
      lod: this.lod,
    });
  }

  resetCost(): void {
    this.frames = 0;
    this.totalMs = 0;
    this.peakMs = 0;
  }

  // ─── for tests and the HUD ─────────────────────────────────────────

  /** The creature id each rig of a species holds, or null when free. */
  holders(species: CreatureId): readonly (string | null)[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.holder);
  }

  /** The rig roots of a species, in pool order. */
  rigs(species: CreatureId): readonly THREE.Object3D[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.root);
  }

  /** What was measured on a species' template; null before it loads or for a placeholder. */
  anatomy(species: CreatureId): RigAnatomy | null {
    return this.slots.get(species)?.anatomy ?? null;
  }

  template(species: CreatureId): THREE.Object3D | null {
    return this.slots.get(species)?.template ?? null;
  }

  isPlaceholder(species: CreatureId): boolean {
    return this.slots.get(species)?.placeholder ?? false;
  }

  impostor(species: CreatureId): THREE.InstancedMesh | null {
    return this.slots.get(species)?.impostor ?? null;
  }

  /**
   * The TEMPLATE's uniform scale for a species: `rigScale`, or 1 for a
   * placeholder. A rig lent to an animal wears this times that animal's
   * `sizeRatio`, so read `rigs(species)[k].scale` for what is drawn.
   */
  scaleOf(species: CreatureId): number {
    return this.slots.get(species)?.scale ?? 1;
  }

  /** The crumb spacing of each rig of a species, world units — its holder's body over `CRUMBS_PER_LENGTH`; 0 for a rig with no trail. */
  trailSpacings(species: CreatureId): readonly number[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.trail?.spacing ?? 0);
  }

  /** The up each rig of a species is built on (the header, "a body on a wall"), in pool order. The vectors are the rigs' own: read, never write. */
  drawnUps(species: CreatureId): readonly THREE.Vector3[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.drawnUp);
  }

  /** What a rig of a species remembers of its holder's motion (`motion.ts`), or null for no such rig. The rig's own object: read, never write. */
  motionOf(species: CreatureId, k: number): Readonly<RigMotion> | null {
    return this.slots.get(species)?.rigs[k]?.motion ?? null;
  }

  // ─── the pick surface ──────────────────────────────────────────────

  /**
   * Where a creature's body is drawn, in LOCAL render coordinates — the
   * centre of its rig's box as placed and turned, the middle of a worm's
   * laid chain, or its impostor's centre — or null when it is not drawn
   * this frame (far tier, species off, buried, or not in the list). The
   * returned vector is OWNED BY THE VIEW and rewritten by the next call:
   * copy it to keep it. Allocation-free.
   */
  positionOf(id: string): THREE.Vector3 | null {
    const index = this.drawnIndex.get(id);
    if (index === undefined) return null;
    const o = index * 3;
    return this.pick.set(this.drawnPos[o], this.drawnPos[o + 1], this.drawnPos[o + 2]);
  }

  /** The ids drawn this frame, rigs and impostors alike. The array is the view's own and is rewritten every update. Allocation-free. */
  drawnIds(): readonly string[] {
    return this.drawnList;
  }

  /** Record where an animal's body is drawn this frame. */
  private drew(id: string, x: number, y: number, z: number): void {
    const index = this.drawnList.length;
    if ((index + 1) * 3 > this.drawnPos.length) {
      const grown = new Float64Array(this.drawnPos.length * 2);
      grown.set(this.drawnPos);
      this.drawnPos = grown;
    }
    const o = index * 3;
    this.drawnPos[o] = x; this.drawnPos[o + 1] = y; this.drawnPos[o + 2] = z;
    this.drawnList.push(id);
    this.drawnIndex.set(id, index);
  }

  // ─── loading ───────────────────────────────────────────────────────

  private load(slot: Slot): Promise<void> {
    const { species, look, bodyLength } = slot;
    return this.loadModel(species.model.path, () => placeholderFor(bodyLength, look.girth, look.colour)).then(
      (model) => {
        // The race is real: a view disposed while the file was in flight
        // must not be handed a rig nothing will ever release.
        if (this.disposed) { disposeRig(model); return; }
        this.adopt(slot, model);
      },
      (error: unknown) => {
        console.error(`[fauna] ${species.id}: the loader rejected outright; nothing will be drawn for it`, error);
      },
    );
  }

  /** Take a loaded template: dress it, scale it, measure it, warn if the table disagrees, and build the pool from it. */
  private adopt(slot: Slot, model: THREE.Object3D): void {
    const { species, bodyLength } = slot;
    slot.template = model;
    slot.placeholder = model.userData.isPlaceholder === true;
    if (slot.placeholder) {
      // Already in world units, already the species' size: not a rig, not scaled like one.
      slot.anatomy = null;
      slot.scale = 1;
    } else {
      dressRig(model);
      // Measured at the identity, BEFORE the scale, in the GLB's own units.
      const anatomy = measureRig(model, species.model.chain);
      slot.anatomy = anatomy;
      slot.scale = rigScale(species);
      model.scale.setScalar(slot.scale);
      const drawnLength = anatomy.spine * slot.scale;
      if (!(anatomy.spine > 0) || Math.abs(drawnLength - bodyLength) > bodyLength * SPINE_TOLERANCE) {
        const pct = bodyLength > 0 ? Math.round((drawnLength / bodyLength) * 100) : 0;
        console.warn(
          `[fauna] ${species.id}: the rig's spine measures ${anatomy.spine.toFixed(4)} GLB units; × rigScale ${slot.scale.toFixed(5)} `
          + `= ${drawnLength.toFixed(3)} world units, but the table cites ${species.lengthMm} mm = ${bodyLength} units. `
          + `It is drawn at ${pct}% of its length. Either ${species.model.path} changed or species.model.spineUnits `
          + `(${species.model.spineUnits}) is wrong — at this file it should be ${anatomy.spine.toFixed(4)}. Not corrected here; fix the table.`,
        );
      }
    }
    this.buildPool(slot);
  }

  // ─── the pool and the impostor ─────────────────────────────────────

  /**
   * The pool a slot should hold: the Lab's named size where it named
   * one, else THE WHOLE RUNG'S BUDGET.
   *
   * Not the species' own share of it. The lending is global and by
   * distance (the header), so the nearest thirteen at medium may all be
   * aphids, and a pool holding the old five would leave eight of them as
   * ellipsoids in arm's reach — which is the bug this pass is fixing,
   * merely moved. Every species carries the budget and the budget is
   * what is actually spent: an unlent clone is a skeleton and a scene
   * node over the template's own geometry, drawn never and posed never.
   */
  private poolTarget(slot: Slot): number {
    const named = this.poolOverride.get(slot.species.id);
    // BOTH TIERS COME OUT OF THIS POOL. A reduced body is the same clone
    // as a full one — the difference is whether its bones move this
    // frame — so a species must be able to serve the whole ladder if the
    // nearest bodies all happen to be its own.
    if (named !== undefined) return named;
    // UNCAPPED IS UNCAPPED: the pool still grows a few clones a frame
    // (`POOL_GROWTH_PER_FRAME`), so this is a ceiling and not an
    // allocation — there is simply no ceiling on a bench.
    return this.uncapped ? Number.POSITIVE_INFINITY : fullBudgetFor(this.rung) + reducedBudgetFor(this.rung);
  }

  /**
   * THE CLONES A SPECIES STARTS WITH. The rest are built as animals ask
   * for them (`spare`), which is why the ceiling above may be the whole
   * ladder for every species at once without five pools' worth of
   * skeletons being cut for a frame that can only ever lend one pool's.
   */
  private warmPool(slot: Slot): void {
    // A NAMED POOL IS NOT A CEILING, IT IS AN ORDER. The Creature Lab
    // names one to say "rig exactly these", and a bench that asked for
    // forty and got two would be measuring the warm-up.
    const named = this.poolOverride.get(slot.species.id);
    this.sizePool(slot, named ?? Math.min(POOL_WARM, this.poolTarget(slot)));
  }

  /**
   * HOW MANY RIGS MAY BE HELD AT ONCE, across every species.
   *
   * The rung's budget, or — when the Creature Lab has named pools — the
   * sum of what it asked for. A named pool is the Lab saying "rig these,
   * I am measuring rigs" (see `setPoolSize`), and a bench that answers
   * "how many fully active insects can this room hold" cannot be capped
   * at the device budget the question is about.
   */
  private fullBudget(): number {
    if (this.allRigs) return Number.POSITIVE_INFINITY;
    const base = this.budgetOf(fullBudgetFor(this.rung));
    // Auto is an adaptive capacity mode as well as a distance mode. It
    // deliberately applies on the uncapped Lab bench so a dense run can
    // measure the mode's real capacity; explicit ALL/raw remains infinite.
    if (this.lodSettings.mode === 'auto') {
      return Math.max(1, Math.floor(base * this.lodState.rigBudgetMultiplier));
    }
    return this.uncapped ? Number.POSITIVE_INFINITY : base;
  }

  /**
   * HOW MANY MAY HOLD THE MESH WITH THEIR BONES HELD STILL (LOD1).
   *
   * Zero while the Lab has NAMED pools: naming one is the bench saying
   * "rig these, I am measuring animated skeletons", and handing it a
   * middle tier on top would answer a question it did not ask — the
   * number it printed would stop being the one Baselines A and B are
   * written in.
   */
  private reducedBudget(): number {
    if (this.allRigs) return 0;
    const base = this.budgetOf(reducedBudgetFor(this.rung));
    if (this.lodSettings.mode === 'auto') {
      return Math.max(1, Math.floor(base * this.lodState.rigBudgetMultiplier));
    }
    return this.uncapped ? Number.POSITIVE_INFINITY : base;
  }

  /**
   * NO BUDGET, NO POOL CEILING — the Creature Lab's switch, and nothing
   * else's.
   *
   * Joshua, 2026-09-11: "Remove any limits because it is a stress test,
   * and if you keep adding rules, how can I actually get the correct
   * numbers?" He is right, and it is not a concession: a bench that
   * stops handing out rigs at thirteen measures THIRTEEN. The phone
   * never gets asked. Everything the ladder decides here is decided by
   * DISTANCE, every creature inside a radius gets that radius's
   * treatment, and the run ends when the frame rate ends it.
   *
   * The game keeps its budgets — a phone in a forest has to — and the
   * numbers for them come from here. That is the whole point of a
   * bench: measure uncapped, then choose a cap.
   */
  setUncapped(on: boolean): void {
    this.uncapped = on;
  }

  /**
   * EVERY DRAWN BODY WEARS A FULL RIG, whatever its distance — RIGS: ALL
   * on the bench, and the question Baselines A and C ask ("how many
   * fully active insects can this room hold"). There is no middle tier
   * and no impostor: one animated skeleton per animal, or the run is
   * measuring something else.
   */
  setAllRigs(on: boolean): void {
    this.allRigs = on;
    this.lodState = this.lodAdaptive.state(on);
    this.lodEffective = effectiveCreatureLod(this.lodSettings, this.lodSettings.mode === 'auto' && !on ? this.lodState.multiplier : 1);
  }

  /** A rung number, or the sum the Lab named instead of it. */
  private budgetOf(rungBudget: number): number {
    if (this.poolOverride.size === 0) return rungBudget;
    let sum = 0;
    for (const slot of this.order) {
      const named = this.poolOverride.get(slot.species.id);
      sum += named === undefined ? poolSizeFor(this.rung, slot.species.id) : named;
    }
    return sum;
  }

  /** Every rig thrown away and built again: a new rung, or a template that has just arrived. */
  private buildPool(slot: Slot): void {
    // Every rig LETS GO before it is thrown away: `byHolder` answers the
    // allocator's only question, and an entry pointing at a clone that
    // is no longer in the pool would hand a creature a rig nothing poses.
    for (const rig of slot.rigs) {
      this.release(rig);
      slot.group.remove(rig.root);
      for (const material of rig.materials) material.dispose();
      rig.materials.length = 0;
    }
    slot.rigs = [];
    this.warmPool(slot);
  }

  /**
   * BRING A POOL TO `count` WITHOUT REBUILDING IT. Cloning a skinned rig
   * is the expensive thing this file does — the queen's is 103,491
   * triangles — so a pool that grows one at a time (the stress test
   * lends a skeleton to every creature it places, one a second) must add
   * ONE clone, not re-clone the lot. Rigs are removed from the end, and
   * a rig that had a holder lets go of it first; a clone shares the
   * template's geometry and material (`SkeletonUtils.clone`), so it is
   * dropped, never disposed — disposing one would take the template's
   * geometry with it and every other rig of the species. Its MATERIALS
   * are its own (`ownMaterials`, so a crossfade is one body's), and
   * those do go with it.
   */
  private sizePool(slot: Slot, count: number): void {
    const template = slot.template;
    if (template === null) return;
    while (slot.rigs.length > count) {
      const rig = slot.rigs.pop();
      if (rig === undefined) break;
      this.release(rig);
      slot.group.remove(rig.root);
      for (const material of rig.materials) material.dispose();
      rig.materials.length = 0;
    }
    const anatomy = slot.anatomy;
    for (let k = slot.rigs.length; k < count; k += 1) {
      const root = cloneSkinned(template);
      root.visible = false;
      root.name = `${slot.species.id}:rig:${k}`;
      // The root is turned by its QUATERNION (`motion.rootQuaternion`);
      // the Euler three derives from it reads heading about Y, then
      // pitch about the body's X, then bank about its Z — the old order,
      // which on the ground is what the quaternion composes to.
      root.rotation.order = 'YXZ';
      const bones = new Map<string, THREE.Bone>();
      root.traverse((n) => { if ((n as THREE.Bone).isBone) bones.set(n.name, n as THREE.Bone); });
      const legs: BoundLeg[] = [];
      const wings: BoundWing[] = [];
      const antennae: BoundAntenna[] = [];
      const jaws: BoundJaw[] = [];
      let head: BoundJoint | null = null;
      let gaster: BoundJoint | null = null;
      const chain: THREE.Bone[] = [];
      const headOffset = new THREE.Vector3();
      const headFrame = new THREE.Quaternion();
      if (anatomy !== null) {
        for (const spec of anatomy.legs) {
          const bone = bones.get(spec.coxa);
          if (bone) legs.push({ bone, spec, femur: spec.femur === null ? null : bones.get(spec.femur) ?? null });
        }
        for (const spec of anatomy.wings) { const bone = bones.get(spec.bone); if (bone) wings.push({ bone, spec }); }
        for (const spec of anatomy.antennae) { const bone = bones.get(spec.bone); if (bone) antennae.push({ bone, spec }); }
        for (const spec of anatomy.mandibles) { const bone = bones.get(spec.bone); if (bone) jaws.push({ bone, spec, angle: 0 }); }
        if (anatomy.head !== null) { const bone = bones.get(anatomy.head.bone); if (bone) head = { bone, spec: anatomy.head }; }
        if (anatomy.gaster !== null) { const bone = bones.get(anatomy.gaster.bone); if (bone) gaster = { bone, spec: anatomy.gaster }; }
        if (anatomy.chain !== null) {
          for (const name of anatomy.chain.bones) { const bone = bones.get(name); if (bone) chain.push(bone); }
          if (chain.length >= 2) {
            // The head's parent frame in the root's UNSCALED frame: the
            // root's own matrix divided out of the parent's, so a rig
            // whose armature carries a transform is still seated right.
            root.updateMatrixWorld(true);
            const parent = chain[0].parent ?? root;
            const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(parent.matrixWorld);
            const origin = new THREE.Vector3();
            const scale = new THREE.Vector3();
            m.decompose(origin, headFrame, scale);
            headOffset.copy(chain[0].position).multiply(scale).applyQuaternion(headFrame).add(origin);
          }
        }
      }
      const coats = skinsOf(root, slot.look.colour);
      slot.rigs.push({
        root, legs, wings, antennae, jaws, head, gaster, chain, headOffset, headFrame,
        motion: newMotion(), drawnUp: new THREE.Vector3(0, 1, 0), ...coats, wearing: 'textured', transparent: false, trail: null,
        holder: null, creature: -1, lastAt: null, lastHeight: 0, lastHeading: 0,
      });
      slot.group.add(root);
    }
  }

  private buildImpostor(slot: Slot): void {
    if (slot.impostor !== null) {
      slot.group.remove(slot.impostor);
      slot.impostor.dispose();
      slot.impostor = null;
    }
    const cap = impostorCapFor(slot.species, this.rung);
    slot.cap = cap;
    const material = new THREE.MeshLambertMaterial({ color: slot.look.colour, fog: true });
    this.materials.push(material);
    const mesh = new THREE.InstancedMesh(this.impostorGeometry, material, Math.max(1, cap));
    mesh.count = 0;
    // It rides the camera: its bounds always contain the eye, so a frustum test could only ever be wrong.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `${slot.species.id}:impostor`;
    slot.group.add(mesh);
    slot.impostor = mesh;
  }

  // ─── the frame ─────────────────────────────────────────────────────

  /** Grow the per-creature scratch. Allocation only when the list outgrows what it had. */
  private room(n: number): void {
    if (this.d2.length >= n) return;
    let size = this.d2.length;
    while (size < n) size *= 2;
    this.d2 = new Float64Array(size);
    this.rigged = new Uint8Array(size);
  }

  /**
   * THIS ANIMAL'S LENGTH, world units — not its species'.
   *
   * `sizeRatio` is the one place a body is measured against its species'
   * cited one, and every length this renderer draws with comes through
   * here, so the whole of "based on size" is one multiplication in two
   * methods rather than a constant repeated at nine call sites.
   */
  private lengthOf(slot: Slot, c: CreatureState): number {
    return slot.bodyLength * sizeRatio(c, slot.species);
  }

  /** The uniform scale a rig lent to this animal wears: the template's, through the animal's own ratio. */
  private rigScaleOf(slot: Slot, c: CreatureState): number {
    return slot.scale * sizeRatio(c, slot.species);
  }

  /**
   * Whether a creature in the near tiers is drawn at all: a burrower
   * under the ground is not, unless the cutaway is showing its burrow.
   *
   * Called exactly once per creature per frame, from pass 1 — it is what
   * advances that creature's latch, and `pose` reads the answer back
   * rather than measuring it again.
   */
  private drawn(slot: Slot, c: CreatureState): boolean {
    if (slot.species.burrow === null) return true;
    if (this.groundAt === null) return c.behaviour !== 'burrow';
    const reveal = this.reveal(slot, c);
    return !reveal.deep || reveal.cut;
  }

  /**
   * This creature's latch, advanced by one frame of measurement.
   *
   * The two thresholds are asymmetric on purpose and the constants say
   * why: `cut` opens the moment most of the body is under an open roof
   * and shuts only after `REVEAL_HOLD` frames of shut readings, and
   * `deep` is judged at `BURROW_HIDE` for an animal met for the first
   * time and at `BURROW_HIDE * BURROW_KEEP` once the animal is being
   * drawn. Nothing here reads the head alone, and nothing here moves a
   * creature: the simulation owns where the animal is, and this decides
   * only what is shown of it.
   */
  private reveal(slot: Slot, c: CreatureState): Reveal {
    const ground = this.groundAt === null ? Number.NaN : this.groundAt(c.at);
    const depth = Number.isFinite(ground) ? ground - c.height : 0;
    const open = this.cutawayOver(slot, c);
    // The line a body goes out of sight at is that body's — see BURROW_HIDE.
    const hide = BURROW_HIDE * sizeRatio(c, slot.species);
    let reveal = this.reveals.get(c.id);
    if (reveal === undefined) {
      reveal = { cut: open >= REVEAL_OPEN, deep: depth > hide, shutFor: 0, frame: this.frame };
      this.reveals.set(c.id, reveal);
      return reveal;
    }
    reveal.frame = this.frame;
    if (open >= REVEAL_OPEN) {
      reveal.cut = true;
      reveal.shutFor = 0;
    } else if (open > REVEAL_SHUT) {
      // In the band: whatever it was reading, it goes on reading.
      reveal.shutFor = 0;
    } else if (reveal.cut) {
      reveal.shutFor += 1;
      if (reveal.shutFor >= REVEAL_HOLD) { reveal.cut = false; reveal.shutFor = 0; }
    }
    reveal.deep = depth > hide * (reveal.deep ? 1 : BURROW_KEEP);
    return reveal;
  }

  /**
   * How much of a body the cutaway has the roof off, 0..1.
   *
   * THE WHOLE ANIMAL IS ASKED ABOUT, not its nose: `BODY_SAMPLES` points
   * from the head backwards along the heading, spanning one body length,
   * which is how `seedTrail` lays a body it has no history for. The head
   * is the only point that is certainly on the animal — the rest is
   * where the body would be if it had crawled in a straight line — and
   * that is enough, because the question is which SOIL TILES the animal
   * lies across, and a 15 cm body lies across about five of them
   * whichever way it is bent.
   */
  private cutawayOver(slot: Slot, c: CreatureState): number {
    const ceiling = this.ceilingAt;
    const ground = this.groundAt;
    if (ceiling === null || ground === null) return 0;
    const step = this.lengthOf(slot, c) / (BODY_SAMPLES - 1);
    const ax = Math.sin(c.heading);
    const az = Math.cos(c.heading);
    let open = 0;
    for (let k = 0; k < BODY_SAMPLES; k += 1) {
      const at = k === 0 ? c.at : translate(c.at, -k * step * ax, -k * step * az);
      if (ceiling(at) < ground(at) - 1e-6) open += 1;
    }
    return open / BODY_SAMPLES;
  }

  /**
   * PASS 2: THE RIGS ARE DEALT OUT ACROSS EVERY SPECIES AT ONCE, BY
   * DISTANCE — which is the whole of the fix for "some close up change
   * while others don't" (the header).
   *
   * Four steps, in this order for reasons each states:
   *
   *   MARK   every candidate the band admits goes into one list, sorted
   *          nearest first with the id as the tie, and the first
   *          `rigBudget()` of them are marked. Nothing about a species
   *          is consulted; the marks are the decision.
   *   LET GO a rig whose creature is drawn in NO form this frame is
   *          released at once rather than faded: a crossfade needs a
   *          body to fade against, and a buried worm has none.
   *   HAND   each mark without a rig takes a free clone of its species,
   *          or the clone of whichever animal of that species is
   *          furthest through fading out. A marked holder is never taken
   *          from: it is nearer, which is the only thing that ranks.
   *   CAP    the budget bounds rigs HELD, not rigs marked, so the
   *          fade-outs still holding one are counted and the least-lent
   *          are let go until the total is inside it. Without this a
   *          camera sweeping a crowd would carry the marked thirteen
   *          plus a tail of fading skeletons, and the tail is exactly
   *          the cost the budget exists to refuse.
   *
   * Then the fades themselves, once the holders have settled: a body
   * with a rig rises toward 1, one without falls toward 0, and one met
   * for the first time is simply put where it belongs.
   */
  private allocate(creatures: readonly CreatureState[]): void {
    const full = this.fullBudget();
    const reduced = this.reducedBudget();
    const texturedIn = unitsOfMetres(this.lodEffective.textureEnd);
    // The ordered slider pair defines a continuous shader blend. The full
    // mesh is retained through `solidEnd`; only the procedural outer pair
    // below is history-dependent.
    const texturedOut = unitsOfMetres(this.lodEffective.solidEnd);
    const meshIn = unitsOfMetres(this.lodEffective.proceduralOnly);
    const meshOut = unitsOfMetres(this.lodEffective.proceduralOnly + 0.02);
    const list = this.eligible;
    list.length = 0;
    for (const slot of this.order) {
      if (!slot.enabled || slot.rigs.length === 0) continue;
      // A NAMED POOL HAS NO TIERS. The ladder is a device budget for a
      // wild population strung across a forest; the Creature Lab names a
      // pool to ask "how many fully active insects can this room hold"
      // (`setPoolSize`), and a bench answering that question about a
      // one-metre room cannot have its skeletons taken away at 0.85 m.
      const gated = !this.allRigs && !this.poolOverride.has(slot.species.id);
      // A body reaches for a clone at MESH_IN and only gives it up at
      // MESH_OUT. The texture transition itself is not latched: the full
      // mesh is retained through SOLID_END so its shader can blend.
      const wants = gated ? meshIn * meshIn : Infinity;
      const keeps = gated ? meshOut * meshOut : Infinity;
      for (const i of slot.candidates) {
        const d2 = this.d2[i];
        // THE DEMAND, before a budget has refused any of it. Counted on
        // the RADII alone and for every species alike, so the HUD can
        // say whether a near ellipsoid is the ladder finding nobody
        // closer or the ladder having nothing left to give.
        if (d2 <= texturedIn * texturedIn) this.withinFull += 1;
        if (d2 <= meshIn * meshIn) this.withinReduced += 1;
        if (d2 <= wants || d2 <= keeps) list.push(i);
      }
    }
    list.sort(this.byNearest);
    // THE LADDER. The nearest take the full budget; whoever is left over
    // — whether because they are past the near line or because the
    // budget ran out under them — takes the reduced one. Distance is the
    // priority; the budgets are the capacity.
    let fulls = 0;
    let reduceds = 0;
    for (const idx of list) {
      const d2 = this.d2[idx];
      const gated = !this.allRigs && !this.poolOverride.has(creatures[idx].species);
      // The full mesh owns the whole texture-to-solid transition. This is a
      // distance-only decision: no previous tier may turn the blend into an
      // instant material swap or widen the band.
      const wantsFull = !gated || d2 <= texturedOut * texturedOut;
      if (wantsFull && fulls < full) { this.rigged[idx] = 1; fulls += 1; continue; }
      if (reduceds < reduced) { this.rigged[idx] = 2; reduceds += 1; continue; }
      this.rigged[idx] = 0;
    }

    for (const slot of this.order) {
      for (const rig of slot.rigs) {
        if (rig.holder === null) continue;
        const idx = this.byIndex.get(rig.holder);
        // GONE FROM THE WORLD, and nothing else. A holder that has left
        // every tier is NOT released here: it keeps its clone while it
        // crossfades out, and the fade releases it when it reaches zero.
        //
        // Releasing on the mark instead — which this briefly did, to fix
        // a "holder past the far line never lets go" that was not real —
        // deletes the mesh on the first frame it falls out of a tier and
        // there is no fade OUT at all, only a pop to a growing ellipsoid.
        // What made it look unreleased was a test reading the count one
        // frame after the body crossed, while the fade was still running.
        if (idx === undefined) this.release(rig);
        else rig.creature = idx;
      }
    }

    // EVERY MARK, not the first `fulls + reduceds` of the list. The two
    // are usually the same set and are not always: a body can be marked for
    // the full texture-to-solid band while a nearer one is passed over, so
    // a prefix would spend the mark and never lend its mesh. The list is
    // still nearest-first, so a donor found below is always further off.
    for (const idx of list) {
      if (this.rigged[idx] === 0) continue;
      const c = creatures[idx];
      if (this.byHolder.has(c.id)) continue;
      const slot = this.slots.get(c.species);
      if (slot === undefined) continue;
      const rig = this.spare(slot, this.d2[idx]);
      // Every clone of the species is held by a nearer animal: this one
      // waits as an impostor rather than a nearer body being demoted.
      if (rig === null) { this.rigged[idx] = 0; continue; }
      // Whoever is giving it up loses the mark with it.
      if (rig.creature >= 0) this.rigged[rig.creature] = 0;
      this.release(rig);
      this.lend(slot, rig, c);
      rig.creature = idx;
    }

    let held = 0;
    for (const slot of this.order) for (const rig of slot.rigs) if (rig.holder !== null) held += 1;
    const meshes = full + reduced;
    while (held > meshes) {
      const going = this.leastLent();
      if (going === null) break;
      this.release(going);
      held -= 1;
    }

    for (const slot of this.order) {
      for (const i of slot.candidates) {
        const c = creatures[i];
        const rig = this.byHolder.get(c.id);
        // NO RIG IS NO FADE. The impostor draws `1 - fade` of the body,
        // so an animal that has just been let go of has to be pinned at
        // zero — `release` does it — or the ellipsoid would come back
        // shrunken and the animal would be half there.
        if (rig === undefined) { this.fades.set(c.id, 0); this.tier.delete(c.id); continue; }
        // THE FADE IS THE DISTANCE, and only the distance: whole at
        // `FADE_FROM`, gone at `FADE_TO`, a straight ramp between. A body
        // the budget refused entirely (`rigged` 0) is an ellipsoid now,
        // not a body on its way to being one, so it fades by the clock of
        // the ladder rather than by one of its own.
        //
        // The timed crossfade this replaces had to be started, held and
        // finished, and it ran at the wrong moment whenever a body
        // crossed the line while something else was deciding tiers. This
        // is simply true every frame.
        // UNGATED IS UNFADED. RIGS: ALL and a named pool both say "draw
        // every one of these as a model, wherever it stands" — the radii
        // do not apply to them, and neither does the ramp the radii
        // define, or a body past 0.6 m would dissolve out of a run whose
        // whole question is how many models the phone can hold.
        const gated = !this.allRigs && !this.poolOverride.has(c.species);
        const now = this.rigged[i] === 0 ? 0 : gated ? meshShare(
          this.d2[i],
          unitsOfMetres(this.lodEffective.proceduralStart),
          meshIn,
        ) : 1;
        if (now <= 0) { this.tier.delete(c.id); this.fades.set(c.id, 0); this.release(rig); continue; }
        this.fades.set(c.id, now);
        // NEXT FRAME'S QUESTION NEEDS THIS FRAME'S ANSWER: which side of
        // each boundary the body is already on is what makes the pair of
        // radii a hysteresis rather than two arbitrary numbers.
        this.tier.set(c.id, this.rigged[i]);
      }
    }
  }

  /**
   * WHICH COAT THIS CLONE WEARS THIS FRAME. Full-tier bodies use one
   * textured draw and continuously mix it toward the matching solid colour
   * across the two endpoints; reduced-tier bodies bind the solid material.
   *
   * Swapping a material REFERENCE is free; swapping a material's `map`
   * is a shader recompile and a hitch. Both coats are built once when the
   * clone is (`skinsOf`), and the blend is a uniform update on the one draw.
   */
  private skin(rig: Rig, textured: boolean, blend: number): void {
    const amount = Math.max(0, Math.min(1, blend));
    const want = textured && amount < 1 ? 'textured' : 'solid';
    for (const s of rig.skins) for (const uniform of s.textureBlends) uniform.value = amount;
    if (rig.wearing === want) return;
    rig.wearing = want;
    for (const s of rig.skins) s.mesh.material = want === 'textured' ? s.textured : s.solid;
  }

  /**
   * A CLONE OF THIS SPECIES FOR AN ANIMAL `d2` AWAY: one free to lend;
   * else the one whose animal is furthest through fading out; else the
   * one held by the FURTHEST marked animal, if that animal is further
   * off than this one; else none.
   *
   * The last clause is what keeps a species whose pool is smaller than
   * the budget honest — the Lab names such pools, and the rung's own
   * table did until this pass. Without it the animal that happened to
   * hold the single clone last frame would keep it while something
   * nearer stood beside it as an ellipsoid, which is the complaint. The
   * marks are walked nearest first, so a donor found here is always
   * further away than the claimant and the swap cannot go back and
   * forth within a frame.
   */
  private spare(slot: Slot, d2: number): Rig | null {
    let fading: Rig | null = null;
    let least = Infinity;
    let marked: Rig | null = null;
    let furthest = d2;
    let free: Rig | null = null;
    for (const rig of slot.rigs) {
      if (rig.holder === null) { free = rig; break; }
      // EITHER MESH TIER IS PROTECTED, and by the same rule. This read
      // `=== 1`, so a body holding the FROZEN mesh was filed with the
      // ones fading out and could be taken by a claimant standing
      // further away than it — a priority inversion in the one direction
      // the ladder is supposed to guarantee. LOD1 is a body being drawn,
      // not a body leaving.
      if (this.rigged[rig.creature] > 0) {
        const held = this.d2[rig.creature];
        if (held > furthest) { furthest = held; marked = rig; }
        continue;
      }
      const fade = this.fades.get(rig.holder) ?? 0;
      if (fade < least) { least = fade; fading = rig; }
    }
    if (free !== null) return free;
    // NOTHING FREE: GROW BEFORE RECYCLING, while the ceiling and this
    // frame's allowance both have room. Taking the clone of a body that
    // is fading out is cheaper than building one and it is the wrong
    // first move — in a crowd there is nearly always someone fading, so
    // a pool that recycled first would never reach the budget it is
    // allowed and the ladder would run permanently short of meshes.
    // Build while there is room; recycle once there is not.
    const ceiling = this.poolTarget(slot);
    if (slot.rigs.length < ceiling && this.grewThisFrame < POOL_GROWTH_PER_FRAME) {
      this.grewThisFrame += 1;
      this.sizePool(slot, slot.rigs.length + 1);
      const grown = slot.rigs[slot.rigs.length - 1];
      if (grown !== undefined && grown.holder === null) return grown;
    }
    return fading ?? marked;
  }

  /** The held rig, anywhere in the view, whose animal is furthest through fading out. Null when every holder is marked. */
  private leastLent(): Rig | null {
    let going: Rig | null = null;
    let least = Infinity;
    for (const slot of this.order) {
      for (const rig of slot.rigs) {
        if (rig.holder === null || this.rigged[rig.creature] === 1) continue;
        const fade = this.fades.get(rig.holder) ?? 0;
        if (fade < least) { least = fade; going = rig; }
      }
    }
    return going;
  }

  /**
   * PASS 3: pose what this species holds and fill its impostor. It
   * chooses no holders — `allocate` did that across every species at
   * once — and the crossfade is why a body may appear in both: a rig at
   * `fade` opacity over an ellipsoid at `1 - fade` of its size is one
   * animal drawn once, never half of one and never two.
   */
  private drawSpecies(slot: Slot, creatures: readonly CreatureState[], dt: number): void {
    const id = slot.species.id;
    const cand = slot.candidates;
    cand.sort(this.byNearest);
    let lent = 0;
    let frozen = 0;
    /** Holders on no tier: mid-crossfade, on their way to an ellipsoid. */
    let leaving = 0;
    for (const rig of slot.rigs) {
      if (rig.holder === null) { rig.root.visible = false; continue; }
      // WHICH TIER, AND THEREFORE WHICH MATERIALS. Both mesh tiers are
      // ANIMATED EVERY FRAME — "model still there and animated" — and
      // what the far one gives up is the TEXTURE: the same skeleton, the
      // same motion, in the species' solid colour. The posing was
      // measured at 1.3 ms for 198 rigs of a 31 ms frame, so freezing it
      // was never going to be the saving; the fragment work is.
      const mark = this.rigged[rig.creature];
      const full = mark === 1;
      // PAST THE FADE IT IS NOT DRAWN. A holder in the slack between
      // `MESH_IN` and `MESH_OUT` is at zero share, and a draw call for
      // nothing is a draw call: the clone is kept (that is the
      // hysteresis) and the mesh is not submitted.
      if ((this.fades.get(rig.holder) ?? 0) <= 0) { rig.root.visible = false; leaving += 1; continue; }
      const blend = full && !this.allRigs && !this.poolOverride.has(slot.species.id)
        ? creatureLodTextureBlend(
          Math.sqrt(Math.max(0, this.d2[rig.creature])) / unitsOfMetres(1),
          this.lodEffective,
        )
        : 0;
      this.skin(rig, full, blend);
      this.pose(slot, rig, creatures[rig.creature], dt);
      rig.root.visible = true;
      // COUNTED BY THE TIER IT IS ON, not by the clone it happens to be
      // holding.
      if (full) lent += 1;
      else if (mark === 2) frozen += 1;
      else leaving += 1;
    }
    this.reducedLent[id] = frozen;
    this.rigsLent[id] = lent;
    // THE IMPOSTORS: everyone else drawn, nearest first, never past the cap.
    const mesh = slot.impostor;
    let count = 0;
    let bodies = 0;
    const into = mesh === null ? null : mesh.instanceMatrix.array as Float32Array;
    for (let k = 0; k < cand.length; k += 1) {
      const idx = cand[k];
      const c = creatures[idx];
      const rig = this.byHolder.get(c.id);
      const fade = rig === undefined ? 0 : this.fades.get(c.id) ?? 1;
      // A body its rig has arrived on needs no ellipsoid at all.
      if (fade >= 1) continue;
      if (into === null || count >= slot.cap) {
        // Nothing is drawn of it — unless a rig is carrying most of it
        // already, in which case it is that rig's body and counted there.
        if (rig === undefined) this.pastCap += 1;
        continue;
      }
      // THE ELLIPSOID IS THIS ANIMAL'S. Past the pool the whole
      // population is impostors, so it is here that a range of sizes
      // is mostly seen; a constant here would make the sizes the few
      // lent rigs show read as an accident rather than as the world.
      // And it is this animal's SHARE of itself: the crossfade is a
      // scale in this matrix, which is how one instance of a shared mesh
      // fades without the shader learning a per-instance alpha.
      const len = this.lengthOf(slot, c) * (1 - fade);
      const r = (len * slot.look.girth) / 2;
      const half = len / 2;
      const here = this.toLocal(c.at);
      const cs = Math.cos(c.heading);
      const sn = Math.sin(c.heading);
      // A rotation about +Y by the heading — ahead is (sin h, cos h),
      // the actor convention — with the ellipsoid's long axis on +Z.
      // HORIZONTAL whatever the animal's `up`: an impostor is never
      // drawn where there is a wall (the header, "the impostors keep
      // the horizontal matrix").
      const o = count * 16;
      into[o] = cs * r; into[o + 1] = 0; into[o + 2] = -sn * r; into[o + 3] = 0;
      into[o + 4] = 0; into[o + 5] = r; into[o + 6] = 0; into[o + 7] = 0;
      into[o + 8] = sn * half; into[o + 9] = 0; into[o + 10] = cs * half; into[o + 11] = 0;
      into[o + 12] = here.lx; into[o + 13] = c.height + r; into[o + 14] = here.lz; into[o + 15] = 1;
      // The pick surface is told once per animal, and a crossfading one
      // was already told by its rig.
      if (rig === undefined) { this.drew(c.id, here.lx, c.height + r, here.lz); bodies += 1; }
      count += 1;
    }
    if (mesh !== null) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    bodies += leaving;
    this.impostors[id] = bodies;
  }

  /**
   * WRITE A CROSSFADE ONTO A RIG'S OWN MATERIALS.
   *
   * `transparent` is toggled, and only on the frames it changes, because
   * three compiles `OPAQUE` into the shader — an opaque program forces
   * alpha to 1 and would ignore `opacity` altogether — and the define
   * only changes when the material asks to be built again. That is also
   * why a settled rig is put back: a skinned mesh left transparent joins
   * the sorted transparent pass against the opaque terrain for the rest
   * of the session, which is a look nobody asked for.
   */
  private applyFade(rig: Rig, fade: number): void {
    const settled = fade >= 1;
    // ONLY THE SOLID COAT EVER FADES. The crossfade band is 0.5–0.6 m and
    // the textures are gone by 0.32 m, so a textured material can never
    // be in it — writing one would be a transparent pass bought for a
    // body that is never in the fade.
    for (const material of rig.flat) material.opacity = settled ? 1 : fade;
    if (rig.transparent === !settled) return;
    rig.transparent = !settled;
    for (const material of rig.flat) { material.transparent = !settled; material.needsUpdate = true; }
  }

  private release(rig: Rig): void {
    if (rig.holder === null) return;
    // The animal keeps no half-fade it has no rig to draw.
    this.fades.set(rig.holder, 0);
    this.byHolder.delete(rig.holder);
    rig.holder = null;
    rig.creature = -1;
    rig.lastAt = null;
    rig.root.visible = false;
    this.applyFade(rig, 1);
  }

  /**
   * Hand a rig to a creature: TAKE ITS SIZE, forget the last holder's
   * motion, seed the worm's trail straight behind it.
   *
   * THE SCALE IS WRITTEN HERE AND NOT IN `buildPool`. A rig is built
   * before it has a holder, so there is no animal to take a size from;
   * it takes one the moment it changes hands, on that frame. Building
   * the pool at one size would draw a 250 mm worm at a 100 mm worm's
   * length for as long as it held a rig the small one had.
   */
  private lend(slot: Slot, rig: Rig, c: CreatureState): void {
    rig.holder = c.id;
    this.byHolder.set(c.id, rig);
    const bodyLength = this.lengthOf(slot, c);
    rig.root.scale.setScalar(this.rigScaleOf(slot, c));
    resetMotion(rig.motion, AIRBORNE.includes(c.behaviour));
    // A rig changing hands has nothing to ease from: the drawn up is the holder's, at once.
    rig.drawnUp.set(c.up.x, c.up.y, c.up.z);
    for (const jaw of rig.jaws) jaw.angle = 0;
    rig.lastAt = c.at;
    rig.lastHeight = c.height;
    rig.lastHeading = c.heading;
    if (rig.chain.length >= 2) {
      let trail = rig.trail;
      if (trail === null) {
        trail = {
          points: new Array<WorldPoint>(TRAIL_CAPACITY).fill(c.at),
          heights: new Float64Array(TRAIL_CAPACITY),
          depths: new Float64Array(TRAIL_CAPACITY),
          spacing: bodyLength / CRUMBS_PER_LENGTH,
          head: 0,
          count: 0,
          owner: c.id,
        };
        rig.trail = trail;
      }
      // A TRAIL IS SPACED BY THE BODY THAT LAYS IT: `CRUMBS_PER_LENGTH`
      // crumbs to THIS animal's length. The same animal handed its rig
      // back gets the same number, so the crawl kept below is untouched;
      // a different one gets its own, and is re-seeded anyway.
      trail.spacing = bodyLength / CRUMBS_PER_LENGTH;
      // A RIG HANDED BACK TO THE SAME ANIMAL KEEPS THE PATH IT CRAWLED.
      // A trail is a record of a crawl, and this animal's crawl did not
      // stop happening because a rig changed hands for a frame — laying
      // it straight again is what draws a body as a rotating log. It is
      // laid again only when the record is not this creature's, or when
      // the head is further from its newest crumb than a crawl reaches
      // (the same test `pose` makes every frame).
      if (trail.owner !== c.id || trail.count === 0
        || distance(c.at, trail.points[trail.head]) > bodyLength * TRAIL_BREAK_LENGTHS) {
        trail.owner = c.id;
        this.seedTrail(trail, c);
      }
    }
  }

  /**
   * Lay a straight trail behind a creature at the depth it is at: what a
   * body that has just been handed a rig, or has just been moved, is
   * drawn along until it has crawled far enough to have a real one.
   */
  private seedTrail(trail: Trail, c: CreatureState): void {
    trail.head = TRAIL_CAPACITY - 1;
    trail.count = 0;
    const ahead = { x: Math.sin(c.heading), z: Math.cos(c.heading) };
    for (let k = TRAIL_CAPACITY - 1; k >= 0; k -= 1) {
      const at = translate(c.at, -k * trail.spacing * ahead.x, -k * trail.spacing * ahead.z);
      this.pushCrumb(trail, at, c.height, this.depthAt(c.at, c.height));
    }
  }

  /** How far under the ground a body is at a point. Zero with no ground to ask. */
  private depthAt(at: WorldPoint, height: number): number {
    if (this.groundAt === null) return 0;
    const ground = this.groundAt(at);
    return Number.isFinite(ground) ? ground - height : 0;
  }

  /**
   * A DRAWN BODY LIES IN THE GROUND IT IS OVER — never through it, and
   * never hanging over it either.
   *
   * A CRUMB REMEMBERS A DEPTH, NOT A HEIGHT. That is the whole rule, and
   * it is what alpha.26 got half right: it kept the absolute height the
   * worm had when the crumb was dropped and raised it to the ground at
   * draw time, which fixed a body half buried on a slope and left the
   * opposite failure standing. The ground here MOVES — an HD tile lands
   * under the camera and `Heightfield.heightAt` stops answering from the
   * coarse lattice — and when it moves DOWN, a one-sided raise pins
   * every crumb at the height the old lattice had. The creature follows
   * the new ground (`locomotion.burrow` re-clamps it into the band the
   * same tick), the trail does not, and the seventeen bones are laid up
   * the gap between them: measured at a two-metre drop, the whole 15 cm
   * body stood vertical, and at a ten-centimetre drop it drew the L
   * Joshua photographed — ten of vertical, five of horizontal. A worm
   * wanders 3 mm a second, so it drops a crumb every six seconds and the
   * shape stands for over a minute; a `surface` worm's pace is zero and
   * it never drops another at all.
   *
   * A depth is immune to that: whatever the ground does, the body goes
   * with it. Nothing here is a clamp against the ground, so nothing can
   * be stranded above it.
   *
   * The one clamp left is `Math.max(0, depth)` for a body NOT in a
   * prepared cutaway: it draws a surfacing worm lying on the ground
   * rather than half through it, which is what alpha.26 was for. In a
   * cutaway the true depth is what there is to see, so it is used raw.
   * With no ground to ask, the absolute the crumb was dropped at stands.
   */
  private crumbHeight(at: WorldPoint, height: number, depth: number, exposedBurrow: boolean): number {
    if (this.groundAt === null) return height;
    const ground = this.groundAt(at);
    if (!Number.isFinite(ground)) return height;
    return ground - (exposedBurrow ? depth : Math.max(0, depth));
  }

  private pushCrumb(trail: Trail, at: WorldPoint, height: number, depth: number): void {
    trail.head = (trail.head + 1) % TRAIL_CAPACITY;
    trail.points[trail.head] = at;
    trail.heights[trail.head] = height;
    trail.depths[trail.head] = depth;
    if (trail.count < TRAIL_CAPACITY) trail.count += 1;
  }

  /** Pose one lent rig from what its creature did since last frame. */
  private pose(slot: Slot, rig: Rig, c: CreatureState, dt: number): void {
    // HOW MUCH OF THIS BODY THE RIG IS CARRYING, written every frame
    // from the animal in front of it rather than latched on the rig —
    // the same rule the scale below follows.
    this.applyFade(rig, this.fades.get(c.id) ?? 1);
    const anatomy = slot.anatomy;
    const chain = anatomy?.chain ?? null;
    const chained = chain !== null && rig.chain.length >= 2 && rig.trail !== null;
    const planar = rig.lastAt === null ? 0 : distance(c.at, rig.lastAt);
    const climbed = c.height - rig.lastHeight;
    // THE MEASURED MOTION IS ALONG THE SURFACE for a legged rig — the
    // 3-D distance, so a climber walking straight up a wall with no
    // planar travel still strides (the header). The worm's chain keeps
    // the planar distance its trail is measured in.
    const moved = chained ? planar : Math.hypot(planar, climbed);
    const turned = wrapAngle(c.heading - rig.lastHeading);
    rig.lastAt = c.at;
    rig.lastHeight = c.height;
    rig.lastHeading = c.heading;
    const m = rig.motion;
    // EVERY LENGTH IN THIS FRAME IS THIS ANIMAL'S, and the scale is
    // written again rather than trusted: a drawn size is derived from
    // the creature in front of the rig each frame (ARCHITECTURE §2.3),
    // never latched from whoever held it last.
    const bodyLength = this.lengthOf(slot, c);
    const scale = this.rigScaleOf(slot, c);
    rig.root.scale.setScalar(scale);
    // The words become booleans HERE, and nothing below reads a word.
    stepMotion(m, {
      dt, moved, climbed, turned, airborne: AIRBORNE.includes(c.behaviour),
      biting: BITING.includes(c.behaviour), feeding: FEEDING.includes(c.behaviour), bodyLength, phase: c.phase,
    });
    // THE ONE WORLD → LOCAL CROSSING, through the origin like every renderer.
    const here = this.toLocal(c.at);
    if (chain !== null && rig.chain.length >= 2 && rig.trail !== null) {
      // THE REVEAL IS THE ANIMAL'S, and it was decided for the whole
      // body in pass 1. Reading it back here rather than asking the
      // ceiling again under the head is the fix itself: one fact, one
      // frame, every crumb of the body drawn by the same answer.
      const reveal = this.reveals.get(c.id);
      const exposedBurrow = reveal !== undefined && reveal.cut && reveal.deep;
      const trail = rig.trail;
      const behind = distance(c.at, trail.points[trail.head]);
      if (behind > bodyLength * TRAIL_BREAK_LENGTHS) {
        // IT DID NOT CRAWL THERE. A creature is streamed out and back at
        // the spot its cell generates it at, and a rig held across that
        // would draw the body reaching from where the animal is to where
        // it was. A trail is a record of a crawl; when the crawl is
        // broken the record is worthless, so it is laid again.
        this.seedTrail(trail, c);
      } else if (behind >= trail.spacing) {
        this.pushCrumb(trail, c.at, c.height, this.depthAt(c.at, c.height));
      }
      // The path: the body right now, then the crumbs, newest first,
      // each at its own depth in the ground under it (see `crumbHeight`)
      // and lifted so the belly rests on it.
      const lift = exposedBurrow ? 0 : chain.lift * scale;
      const path = this.path;
      const headDepth = this.depthAt(c.at, c.height);
      path[0] = here.lx; path[1] = this.crumbHeight(c.at, c.height, headDepth, exposedBurrow) + lift; path[2] = here.lz;
      let points = 1;
      for (let k = 0; k < trail.count; k += 1) {
        const i = (trail.head - k + TRAIL_CAPACITY) % TRAIL_CAPACITY;
        const l = this.toLocal(trail.points[i]);
        path[points * 3] = l.lx;
        path[points * 3 + 1] = this.crumbHeight(trail.points[i], trail.heights[i], trail.depths[i], exposedBurrow) + lift;
        path[points * 3 + 2] = l.lz;
        points += 1;
      }
      // THE CHAIN IS THIS BODY'S POSE, and it is what LOD1 stops paying
      // for: the crumbs are still collected every frame — a trail is a
      // record of a crawl and a gap in it never comes back — but the
      // fifteen bones are laid along them every frame.
      layChain(rig.root, rig.chain, chain, scale, rig.headOffset, rig.headFrame, path, points, m, bodyLength, c.phase);
      // The body's middle: half a length back along the path it was laid on.
      const mid = pointAlongPath(path, points, bodyLength / 2, this.centre);
      this.drew(c.id, mid.x, mid.y, mid.z);
      return;
    }
    const bob = walkBob(m, bodyLength, c.phase) + restBob(m, bodyLength, c.phase, slot.look.restBob, slot.look.restBobRate);
    // THE FRAME IS (UP, HEADING), the header: the drawn up eased onto the
    // state's, the heading carried into it and never eased, the bob
    // along the up, and the attitude as local turns after the basis.
    const up = rig.drawnUp;
    easeUp(up, c.up, dt);
    drawnAhead(c.up, c.heading, up, this.ahead);
    rig.root.position.set(here.lx + up.x * bob, c.height + up.y * bob, here.lz + up.z * bob);
    rootQuaternion(up, this.ahead, m.pitch, m.bank, rig.root.quaternion);
    // PLACED ABOVE, POSED HERE, and the line between them is the middle
    // tier. Where the body IS — its position, its facing, its scale, the
    // bob along its up — is written every frame at every tier, so a
    // reduced body still walks across the room like the animal it is.
    // What LOD1 gives up is everything below: six legs, two antennae,
    // the jaws, the head, the gaster and a fly's wings, each of them a
    // handful of quaternions a frame, sixty times a second, for a body
    // that is half a metre off and a few dozen pixels tall.
    poseLegs(rig.legs, m, bodyLength, c.phase);
    poseWings(rig.wings, m, c.phase, slot.hz);
    poseAntennae(rig.antennae, m, c.phase, bodyLength);
    poseJaws(rig.jaws, m, c.phase, dt);
    poseHead(rig.head, m, c.phase);
    poseGaster(rig.gaster, m, bodyLength, c.phase);
    // The drawn centre: the rig's box centre, scaled, turned as the root is, on the root; a placeholder's box is its own.
    const centre = this.centre;
    if (anatomy !== null) {
      centre.copy(anatomy.box.min).add(anatomy.box.max).multiplyScalar(0.5 * scale);
    } else {
      centre.set(0, (bodyLength * slot.look.girth) / 2, 0);
    }
    centre.applyQuaternion(rig.root.quaternion).add(rig.root.position);
    this.drew(c.id, centre.x, centre.y, centre.z);
  }

  // ─── the end ───────────────────────────────────────────────────────

  /** Everything this made and everything it loaded. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.order) {
      for (const rig of slot.rigs) {
        slot.group.remove(rig.root);
        // The clone's own materials go with it; its geometry and its
        // maps are the template's and go below, once.
        for (const material of rig.materials) material.dispose();
        rig.materials.length = 0;
      }
      slot.rigs = [];
      if (slot.impostor !== null) { slot.group.remove(slot.impostor); slot.impostor.dispose(); slot.impostor = null; }
      if (slot.template !== null) { disposeRig(slot.template); slot.template = null; }
      this.group.remove(slot.group);
    }
    this.impostorGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.reveals.clear();
    this.fades.clear();
    this.tier.clear();
    this.byHolder.clear();
    this.byIndex.clear();
    this.eligible.length = 0;
    this.frameCreatures = [];
    this.drawnList.length = 0;
    this.drawnIndex.clear();
    this.slots.clear();
    this.order.length = 0;
  }
}
