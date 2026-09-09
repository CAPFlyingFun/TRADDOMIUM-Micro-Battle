/**
 * THE ISLAND'S ANIMALS, AS DATA — five species, every number labelled.
 *
 * Joshua, 2026-09-07 (the ecology pass): "Creature behaviour should be
 * data-driven where practical … species DATA drives behaviour", the
 * sizes verified against the repo's own research and set BY THE SPINE,
 * not the bounding box, and the old creature AI reused as a donor of
 * shapes and lessons, never copied whole. This file is the data. The
 * brain (`intent.ts`), the legs (`locomotion.ts`, `demand.ts`) and the
 * crowd (`population.ts`) read it and hold no numbers of their own.
 *
 * THREE ARE WILD AND TWO ARE PLACED (the Creature Lab, 2026-09-09). The
 * earthworm, the aphid and the housefly are generated per 16 m cell by
 * `population.ts` and are what `CREATURE_IDS` lists: the layers, the
 * budgets, the HUD, the rig pools and the default simulation all
 * enumerate that list, and a species that has no rig measured and no
 * layer yet has no business in it. The fire-ant QUEEN and WORKER are
 * the Lab's first two controllable creatures (Joshua's brief, §12,
 * §13): they carry a zero-density population entry — the wild generates
 * none — and are PLACED by the Lab (`labWorld.ts`, `labSpawns`).
 * `LAB_CREATURE_IDS` names all five, in the Lab's own order. A ground
 * species is a fourth MEDIUM: it walks on the ground, and a ground
 * species with a `flight` spec may also use the air words (the queen
 * is a winged alate; the worker is not). Their rigs are PLACEHOLDERS
 * until the fauna pass measures them — see each `model` block — and
 * the validator refuses the placeholder on purpose, so the Lab cannot
 * boot a queen nobody has measured and think it is the right size.
 *
 * WHY NOT `data/registries.SPECIES`: that registry is the ANT species —
 * castes, growth curves, life states, the player's own kind — and its
 * docblock says content arrives with the Queen. A worm has no castes.
 * The wild three are the island's wildlife, and they live here, in the
 * module that simulates them, in the same frozen-table shape the object
 * families use (`world/objects/families.ts`). The two ants sit beside
 * them for the Lab's sake — one creature engine, not two — and when the
 * ant registries fill, a queen's growth curve is theirs and her walking
 * pace, her senses and her medium stay here.
 *
 * EVERY NUMBER IS LABELLED (ARCHITECTURE §7, FIRE_ANT_BIOLOGY §38):
 *
 *   MEASURED          a published measurement, cited on the line.
 *   BIOLOGICAL SHAPE  the mechanism is real, the magnitude is tuned.
 *   GAME TUNING       invented for play, or for the phone.
 *
 * UNITS. Lengths in this table are MILLIMETRES and speeds millimetres a
 * second, because that is what the sources say and what the research in
 * `docs/research/` uses; the world's unit is the centimetre, and
 * `unitsOfMm` is the one conversion. Densities are per HECTARE because
 * a cell is 16 m square (0.0256 ha) and a per-cell count of 0.3 reads
 * worse than 12/ha. The `caps` are per detail rung and are MAXIMUMS,
 * never quotas: a beach does not hold forty worms because forty are
 * allowed; it holds what its habitat generates, which is none.
 *
 * SIZES ARE BY THE SPINE. `model.spineUnits` is the length of the rig's
 * body — head to tail along the bone chain, legs, wings and antennae
 * excluded — in the GLB's OWN units, measured on these three files with
 * three's loader (`tests/faunaRealRigs.test.ts` re-measures them and
 * fails if the table drifts). TCS's `creatureScale.ts` numbers were NOT
 * usable as they stood: its probe multiplied the chain length by its own
 * five-millimetre unit, and for the aphid and the fly it had picked an
 * antenna and the abdomen chain rather than the body — carried across
 * unchecked, the worm would have drawn at a fifth of its length. The
 * renderer scales the rig by `unitsOfMm(lengthMm) / spineUnits`,
 * `tests/creatureContracts.test.ts` holds the arithmetic, and the GLBs
 * themselves are never modified.
 *
 * A SIZE IS AN INDIVIDUAL'S; THE TABLE'S IS THE REFERENCE (Joshua,
 * 2026-09-08, on the earthworm: "it should be based on size and
 * dynamic"). `lengthMm` is the animal the sources describe and
 * `lengthRangeMm` the range a real one is drawn from; `population.ts`
 * draws one per creature and every body-length measure is multiplied
 * by `sizeRatio` — that individual's length over the cited one — and
 * every pace by `paceRatio`, which is the same ratio raised to the
 * species' `paceExponent`. A 300 mm worm travels twice as fast as a
 * 150 mm worm because it is twice as long, which is the whole of the
 * law Quillin measured: a tenth of ITS OWN body a second (exponent 1).
 * An ant does not: across twenty-four ant species running speed goes as
 * mass to the quarter, length to the three quarters (Hurlbert,
 * Ballantyne & Powell 2008), so a 6 mm major runs 1.9× a 2 mm minim
 * and not 3× (exponent 0.75). The exponent is on the species because it
 * IS the species' law; the ratio is the individual's. Nothing else in
 * this table is per-individual: the senses, the burrow band, the flight
 * and the needs belong to the species, and where that line falls is
 * argued on the entries themselves.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { HabitatKind } from '../world/habitat';
import type { ObjectRung } from '../world/objects/budget';
import type { ResourceKind } from '../world/ecology/resources';
import type { CreatureState } from './state';

/** The wild three, and the Lab's two ants. `CREATURE_IDS` lists the wild; `LAB_CREATURE_IDS` lists all five. */
export type CreatureId = 'earthworm' | 'aphid' | 'housefly' | 'queen' | 'worker';

/**
 * THE WILD SPECIES, in the order the layers, the budgets and the HUD
 * list them: what the island generates, what the default simulation
 * runs, what has a measured rig. The two ants are not here — see the
 * header: they are placed by the Lab, never generated, and join this
 * list when they have a rig, a layer and a wild population.
 */
/** The three the island generates. The ants are Lab animals until Kauaʻi's integration (ARCHITECTURE §11, 6.10). */
export type WildCreatureId = 'earthworm' | 'aphid' | 'housefly';
export const CREATURE_IDS: readonly WildCreatureId[] = Object.freeze(['earthworm', 'aphid', 'housefly']);

/** Every species in the table, in the Lab's order (Joshua's brief, "FIRST CREATURE SET"): the two ants first, then the wild three. */
export const LAB_CREATURE_IDS: readonly CreatureId[] = Object.freeze(['queen', 'worker', 'earthworm', 'aphid', 'housefly']);

/**
 * Where a species lives: in the ground, on a plant, in the air over the
 * ground, or ON the ground. Decides which behaviours it can have
 * (`state.ts`, `BEHAVIOURS_BY_MEDIUM`). A `ground` species walks the
 * ground's surface as the air species do between flights; one that also
 * carries a `flight` spec (the queen) may use the air words too, and
 * `behaviourAllowedFor` says so.
 */
export type Medium = 'soil' | 'plant' | 'air' | 'ground';

/**
 * How it treats the world. `skittish` flees a disturbance; `passive`
 * only moves away from one; `defensive` turns to face it and holds its
 * ground — the fire ant's answer (Haight 2010: a disturbance near the
 * nest is met, and the heavier it is the larger the workers that meet
 * it). Defensive is not predatory: a `defend` is a stand, and whether a
 * species ever chooses `attack` is the Lab's predation option, not this
 * word (Joshua's brief, §10, §11, §25).
 */
export type Temperament = 'passive' | 'skittish' | 'defensive';

export type Diet = 'detritivore' | 'sap' | 'omnivore';

/** Millimetres per world unit: the world is in centimetres (`world/dem.ts`, one unit a centimetre). */
export const MM_PER_UNIT = 10;

/** The one conversion from this table's millimetres to world units. */
export function unitsOfMm(mm: number): number {
  return mm / MM_PER_UNIT;
}

export interface CreatureModel {
  /** Under `public/`, the way `assets.loadModel` is asked for it. */
  readonly path: string;
  /** The rig's body length along its bone chain, in the GLB's units. MEASURED against the file (see the header). */
  readonly spineUnits: number;
  /**
   * The bone chain's names, for a renderer that aims it along a trail.
   * Listed in NAME order; the file's own parentage (`Bone_000 → Bone_016
   * → Bone_015 … → Bone_001` in the worm) is what the renderer walks,
   * so this list is a roster, not an order. Null for a rig posed by its
   * legs and wings.
   */
  readonly chain: readonly string[] | null;
}

export interface CreatureSenses {
  /** How far it notices a thing at all, mm. */
  readonly sightMm: number;
  /** Field of view, degrees. 360 for a worm, which has no eyes and senses vibration. */
  readonly fovDeg: number;
  /** A disturbance closer than this — the camera today, the ant later — triggers the alarm behaviour. */
  readonly alarmMm: number;
  /** How long the alarm holds after the disturbance has gone, seconds. */
  readonly alarmS: number;
}

export interface CreaturePace {
  /** Ordinary travel, mm/s. */
  readonly wanderMmS: number;
  /** Fleeing, mm/s. */
  readonly fleeMmS: number;
  /** Turn rate, radians/s. */
  readonly turnRadS: number;
}

/** A flying species' hops. All GAME TUNING shaped by how a fly is seen to move. */
export interface FlightSpec {
  /** Level flight, mm/s. */
  readonly cruiseMmS: number;
  /**
   * The most it can do in the air, mm/s: an escape, or a possessed
   * flier's sprint. Never below the cruise. The wild AI never asks for
   * it — an air species has no `flee` word, it takes off — so adding it
   * moved nothing that was already flying.
   */
  readonly burstMmS: number;
  /** Climb and descent, mm/s. */
  readonly climbMmS: number;
  /** Ceiling above the ground, mm. Keeps a fly in the world an ant sees. */
  readonly ceilingMm: number;
  /** Preferred height band above the ground while cruising, mm. */
  readonly cruiseMm: readonly [number, number];
  /** How long one hop lasts before it looks for somewhere to land, seconds. */
  readonly hopS: readonly [number, number];
  /** How far a hop with nothing to aim at goes, mm — the brief's "short flights", never a cruise across the island. */
  readonly hopMm: readonly [number, number];
  /** How long it hovers over a spot before landing or moving on, seconds. */
  readonly hoverS: readonly [number, number];
  /** How long it sits between hops, seconds. */
  readonly perchS: readonly [number, number];
  /** Resource kinds that draw it in when one is within sight. */
  readonly drawnTo: readonly ResourceKind[];
}

/** A burrowing species' life in the soil. */
export interface BurrowSpec {
  /** How far under the surface it travels, mm — the band it stays in while burrowing. */
  readonly underMm: number;
  /** The bore it makes, mm — the ONLY number the terrain-edit seam is handed. */
  readonly boreMm: number;
  /** How often it picks a new heading underground, seconds. */
  readonly headingS: readonly [number, number];
  /** How much of a turn a new heading is, 0..1 of a half-turn. */
  readonly turn: number;
  /** How long it stays up once surfaced, seconds. */
  readonly surfaceS: readonly [number, number];
  /** How long between surfacings when nothing else brings it up, seconds. */
  readonly betweenSurfacingsS: readonly [number, number];
  /** It comes up when it rains, and at night. BIOLOGICAL SHAPE: anecic worms surface to feed and in wet weather. */
  readonly surfacesInRain: boolean;
  readonly surfacesAtNight: boolean;
}

export interface CreatureNeeds {
  /** Hunger climbs at this rate while not feeding, per second, 0..1. */
  readonly hungerPerS: number;
  /** Fatigue climbs at this rate while moving, per second, 0..1. */
  readonly fatiguePerS: number;
  /** It looks for food above this hunger. */
  readonly feedAt: number;
  /** It rests above this fatigue. */
  readonly restAt: number;
  /** How long one feed lasts, seconds; hunger returns to 0 over it. */
  readonly feedS: readonly [number, number];
  /** How long one rest lasts, seconds; fatigue returns to 0 over it. */
  readonly restS: readonly [number, number];
  /** The resource kinds it eats, in order of preference. Empty for a species that feeds where it stands (a worm in litter, an aphid on its host). */
  readonly eats: readonly ResourceKind[];
}

export interface CreaturePopulation {
  /**
   * How many per hectare each habitat generates. A kind missing here
   * generates none. GAME TUNING throughout: the real numbers (a pasture
   * carries hundreds of Lumbricus a square metre) are three orders of
   * magnitude past what any phone will simulate, so these are the
   * density at which the island READS as inhabited.
   */
  readonly perHectare: Readonly<Partial<Record<HabitatKind, number>>>;
  /**
   * Plant families it sits on. A creature with hosts is placed AT a
   * host plant of the cell, never on bare ground; a cell with none of
   * them holds none. Null for a ground or soil creature.
   */
  readonly hosts: readonly string[] | null;
  /** 0..1, how strongly a cell's creatures gather at a few sites. An aphid colony is a clump; worms are spread. */
  readonly clump: number;
  /** The most of this species simulated inside the bubble at each rung. Maximums, never quotas. */
  readonly caps: Readonly<Record<ObjectRung, number>>;
  /** How far from the focus this species EXISTS, metres. Cells beyond are not generated. */
  readonly reachM: number;
  /** Inside this distance it thinks and moves at the near rate; beyond it, it is a resident count and nothing more. */
  readonly nearM: number;
  /** Inside this distance it thinks and moves every frame. */
  readonly fullM: number;
}

export interface CreatureSpecies {
  readonly id: CreatureId;
  /** What the player reads. */
  readonly name: string;
  readonly scientificName: string;
  /**
   * The species' body length, mm. MEASURED — `lengthSource` says where.
   * It is the REFERENCE an individual is measured against (`sizeRatio`),
   * and by construction the MEAN of the draw over `lengthRangeMm`.
   */
  readonly lengthMm: number;
  readonly lengthSource: string;
  /**
   * The range an individual is drawn from, mm. MEASURED, from the same
   * source as `lengthMm`: a species' cited size is a typical animal, not
   * every animal, and `population.drawLengthMm` draws inside this.
   */
  readonly lengthRangeMm: readonly [number, number];
  readonly model: CreatureModel;
  readonly medium: Medium;
  readonly temperament: Temperament;
  readonly diet: Diet;
  readonly senses: CreatureSenses;
  readonly pace: CreaturePace;
  /**
   * How a pace scales with the body: an individual's pace is the
   * table's times (its length over the cited length) to this power
   * (`paceRatio`). 1 is Quillin's worm — a fraction of its own body a
   * second; 0.75 is Hurlbert's ants — speed as mass to the quarter.
   * Body-length DISTANCES (an arrive radius, a walk from the host, a
   * rig's scale) never use it: a 6 mm major is 6 mm long whatever it
   * runs at. The header argues it.
   */
  readonly paceExponent: number;
  /** Present for an air species, and for a ground species that flies (the winged queen). Null for the rest. */
  readonly flight: FlightSpec | null;
  /** Present for a soil species only. */
  readonly burrow: BurrowSpec | null;
  readonly needs: CreatureNeeds;
  readonly population: CreaturePopulation;
  /** Seconds between decisions. A worm need not think as often as a fly. */
  readonly thinkS: number;
  /**
   * Whether this species is an authorised terrain editor (the rule in
   * `terrainEdit.ts`). True names it as one; the edit still only happens
   * through the seam, and only when the seam is built.
   */
  readonly canEditTerrain: boolean;
}

// ---------------------------------------------------------------------------
// The three
// ---------------------------------------------------------------------------

export const EARTHWORM: CreatureSpecies = Object.freeze({
  id: 'earthworm' as CreatureId,
  name: 'Earthworm',
  scientificName: 'Lumbricus terrestris',
  // MEASURED. The night crawler is the size everyone has met; Kauaʻi's
  // introduced earthworms include it and the smaller Amynthas, and the
  // rig is a plain segmented worm that reads as either.
  lengthMm: 150,
  lengthSource: 'Lumbricus terrestris commonly 120-250 mm — U. Maryland Extension; Dimensions.com',
  // MEASURED: the range the same source gives. The draw over it is
  // skewed so its mean is the 150 mm above, not the 185 mm midpoint —
  // `population.drawLengthMm` says how and why.
  lengthRangeMm: Object.freeze([120, 250]) as readonly [number, number],
  model: Object.freeze({
    path: 'models/earthworm.glb',
    // MEASURED against the file: the 17-bone chain's length in GLB units, head to tail (`tests/faunaRealRigs.test.ts`).
    spineUnits: 25.7398,
    chain: Object.freeze([
      'Bone_000', 'Bone_001', 'Bone_002', 'Bone_003', 'Bone_004', 'Bone_005', 'Bone_006', 'Bone_007', 'Bone_008',
      'Bone_009', 'Bone_010', 'Bone_011', 'Bone_012', 'Bone_013', 'Bone_014', 'Bone_015', 'Bone_016',
    ]),
  }),
  medium: 'soil' as Medium,
  temperament: 'skittish' as Temperament,
  diet: 'detritivore' as Diet,
  senses: Object.freeze({
    // BIOLOGICAL SHAPE: no eyes; light and vibration sensed over the whole body. The distance is GAME TUNING.
    sightMm: 60, fovDeg: 360, alarmMm: 40, alarmS: 6,
  }),
  pace: Object.freeze({
    // MEASURED, and the reference every individual scales off. Quillin
    // (1999, J. Exp. Biol.) measured L. terrestris crawling at roughly a
    // tenth of a body length a second, so the cited 150 mm animal travels
    // at 15 mm/s. Joshua's source (Backyardnature, quoted by All About
    // Worms) reaches the same number the other way round — small 27 ft/hr,
    // medium 185, large 240, which convert to 0.23, 1.57 and 2.03 cm/s —
    // and its medium worm is 15.7 mm/s: the same animal at the same speed.
    // Against the tenth-of-a-body law those three read as a ~30 mm, a
    // 150 mm and a ~250 mm worm, which is why the law, and not any one of
    // these figures, is what the individuals are scaled by. Quillin is the
    // citation; the popular page corroborates it.
    //
    // TWO INVENTED NUMBERS DIED HERE. TCS used 3 mm/s — a fivefold
    // discount off the measured crawl for "underground is slower", with no
    // source for the factor — which came out at 1.85 mm/s of mean travel
    // over ten simulated minutes: eighty-one seconds to move its own body
    // length, a correct ecology nobody can see. Earlier today that became
    // 10 mm/s, which was a number picked rather than derived, and it was
    // the same mistake in a smaller coat. The burrow uses this pace too
    // (`locomotion.paceOf`), because there is no measured discount for
    // pushing through soil and inventing one is what went wrong twice.
    //
    // fleeMmS is INVENTED and there is no source for it: nobody has
    // published an escaping earthworm's burst, and a hydrostatic skeleton
    // has no sprint to publish. GAME TUNING at five thirds of the measured
    // crawl — fast enough that a withdrawal reads as one, slow enough that
    // it is still a worm, and over the alarm's six seconds it retreats
    // about one body length, which is as far as it needs to be to be gone.
    wanderMmS: 15, fleeMmS: 25, turnRadS: 1.2,
  }),
  // MEASURED: Quillin (1999) — crawling speed goes as mass to the third, which is length to the first. The law the whole pace story rests on.
  paceExponent: 1,
  flight: null,
  burrow: Object.freeze({
    // GAME TUNING carried from TCS islandWorm.ts (WORM_UNDER_MM, WORM_BORE_MM,
    // WORM_HEADING_MIN/MAX_S, WORM_TURN): the band it wanders in is deep
    // enough to be hidden and shallow enough to be near the ant.
    //
    // AND IT IS NOT THIS SPECIES' DEPTH, WHICH IS WORTH SAYING RATHER THAN
    // LEAVING TO BE FOUND. Wikipedia's Earthworm article puts L. terrestris
    // — the animal named at the top of this entry — in the ANECIC group:
    // "worms that construct permanent deep vertical burrows which they use
    // to visit the surface to obtain plant material for food". The
    // horizontal wanderers are ENDOGEIC, and even they work the upper
    // 10-30 cm. This band is 12 MILLIMETRES and it wanders sideways, which
    // is neither. The reason is the player: an ant is 3-5 mm, and a worm a
    // metre down a vertical shaft is not in the game at all. So the
    // BEHAVIOUR below is anecic and correctly cited — it surfaces at night
    // and in rain — while the DEPTH is a stage, chosen for the ant. A
    // future nest that goes down properly is where this stops being a
    // compromise.
    underMm: 12, boreMm: 6, headingS: Object.freeze([30, 60]) as readonly [number, number], turn: 0.12,
    surfaceS: Object.freeze([20, 90]) as readonly [number, number],
    betweenSurfacingsS: Object.freeze([120, 400]) as readonly [number, number],
    // BIOLOGICAL SHAPE: anecic worms feed at the surface at night and come up in rain (Edwards & Bohlen, Biology and Ecology of Earthworms).
    surfacesInRain: true, surfacesAtNight: true,
  }),
  needs: Object.freeze({
    // GAME TUNING. A worm feeds on what it burrows through; hunger is what brings it to the surface litter.
    hungerPerS: 1 / 300, fatiguePerS: 1 / 240, feedAt: 0.7, restAt: 0.8,
    feedS: Object.freeze([20, 60]) as readonly [number, number], restS: Object.freeze([30, 90]) as readonly [number, number],
    eats: Object.freeze(['litter']) as readonly ResourceKind[],
  }),
  population: Object.freeze({
    // GAME TUNING (see CreaturePopulation). Wet and shaded ground first; none on sand, at sea or on bare rock.
    perHectare: Object.freeze({ wetland: 400, forest: 320, grassland: 240, shrubland: 120, rocky: 20, ridge: 10 }),
    hosts: null,
    clump: 0.3,
    caps: Object.freeze({ 'ultra-low': 6, low: 12, medium: 24, high: 40, 'ultra-high': 60 }),
    reachM: 30, nearM: 15, fullM: 6,
  }),
  thinkS: 0.5,
  canEditTerrain: true,
});

export const APHID: CreatureSpecies = Object.freeze({
  id: 'aphid' as CreatureId,
  name: 'Aphid',
  scientificName: 'Aphidoidea',
  // MEASURED. The rig is a generic green aphid; the size is the middle of the garden species.
  lengthMm: 2.5,
  lengthSource: 'garden aphids 1.5-4 mm — UMN Extension; MSU Extension',
  // MEASURED: the range the same source gives, the cited 2.5 mm its mean.
  lengthRangeMm: Object.freeze([1.5, 4]) as readonly [number, number],
  model: Object.freeze({
    path: 'models/aphid.glb',
    // MEASURED against the file: the body's bone extent along the head axis, legs and antennae excluded (`tests/faunaRealRigs.test.ts`).
    spineUnits: 2.3071,
    chain: null,
  }),
  medium: 'plant' as Medium,
  temperament: 'passive' as Temperament,
  diet: 'sap' as Diet,
  senses: Object.freeze({
    // BIOLOGICAL SHAPE: aphids see poorly — the sense here is mostly
    // touch, vibration and alarm pheromone ((E)-β-farnesene), answered by
    // walking off or dropping. The distances are GAME TUNING.
    sightMm: 30, fovDeg: 300, alarmMm: 20, alarmS: 8,
  }),
  pace: Object.freeze({
    // BIOLOGICAL SHAPE: a walking aphid covers about a body length a second; the flee pace is the drop-and-scramble.
    wanderMmS: 0.6, fleeMmS: 2.5, turnRadS: 2.5,
  }),
  // BIOLOGICAL SHAPE: nothing measured for an aphid's size-speed law; a body length a second is the linear rule, carried unchanged.
  paceExponent: 1,
  flight: null,
  burrow: null,
  needs: Object.freeze({
    // GAME TUNING. An aphid mostly feeds where it sits; the cycle is long feeds broken by short rests and moves along the stem.
    hungerPerS: 1 / 90, fatiguePerS: 1 / 200, feedAt: 0.4, restAt: 0.7,
    feedS: Object.freeze([30, 120]) as readonly [number, number], restS: Object.freeze([10, 40]) as readonly [number, number],
    eats: Object.freeze(['honeydew-host']) as readonly ResourceKind[],
  }),
  population: Object.freeze({
    // GAME TUNING. Clustered: a colony on a stem, not a scatter — see `clump`. Placed AT host plants only.
    perHectare: Object.freeze({ grassland: 1500, shrubland: 2000, forest: 1200, wetland: 800, beach: 120, rocky: 60, ridge: 100 }),
    hosts: Object.freeze(['shrub', 'broadleaf', 'flower', 'fern', 'grass', 'tree']),
    clump: 0.9,
    caps: Object.freeze({ 'ultra-low': 20, low: 40, medium: 80, high: 150, 'ultra-high': 300 }),
    reachM: 20, nearM: 10, fullM: 4,
  }),
  thinkS: 0.4,
  canEditTerrain: false,
});

export const HOUSEFLY: CreatureSpecies = Object.freeze({
  id: 'housefly' as CreatureId,
  name: 'Housefly',
  scientificName: 'Musca domestica',
  // MEASURED.
  lengthMm: 6.5,
  lengthSource: 'Musca domestica body 4-8 mm, mean 6.35 — Animal Diversity Web',
  // MEASURED: the range the same source gives. The cited length sits
  // ABOVE this range's midpoint, so the draw's skew runs the other way
  // from the worm's — big flies are the common ones.
  lengthRangeMm: Object.freeze([4, 8]) as readonly [number, number],
  model: Object.freeze({
    path: 'models/housefly.glb',
    // MEASURED against the file: head to abdomen tip along the body's bones, wings and legs excluded (`tests/faunaRealRigs.test.ts`).
    spineUnits: 3.7633,
    chain: null,
  }),
  medium: 'air' as Medium,
  temperament: 'skittish' as Temperament,
  diet: 'omnivore' as Diet,
  senses: Object.freeze({
    // BIOLOGICAL SHAPE: Card & Dickinson (2008, Curr. Biol.) — a fly plans
    // its escape takeoff within ~200 ms of a looming threat; the distance
    // at which the camera counts as looming is GAME TUNING.
    sightMm: 300, fovDeg: 330, alarmMm: 150, alarmS: 3,
  }),
  pace: Object.freeze({
    // BIOLOGICAL SHAPE: walking pace is a few body lengths a second; the flee pace is a takeoff, handled by `flight`.
    wanderMmS: 15, fleeMmS: 40, turnRadS: 6,
  }),
  // BIOLOGICAL SHAPE: the walking law, carried linear; a fly's FLIGHT does not scale with the body at all (`fly` in demand.ts reads the flight spec unscaled).
  paceExponent: 1,
  flight: Object.freeze({
    // BIOLOGICAL SHAPE: Musca domestica is commonly reported at about 2 m/s
    // (7 km/h) in free flight. Short hops, a hover, a landing: the game
    // fly never cruises for minutes, because a fly that leaves is a fly
    // the ant never sees again.
    //
    // burstMmS is GAME TUNING from the Lab research (SUMMARY §5: escape
    // burst 3 m/s over a 2 m/s cruise; the maximum is unpublished, above
    // the cruise). The wild fly never reaches for it — it has no `flee`
    // word — so this line changed nothing that was flying; a possessed
    // fly's sprint is what it is for.
    cruiseMmS: 1500, burstMmS: 3000, climbMmS: 600, ceilingMm: 1500,
    cruiseMm: Object.freeze([120, 600]) as readonly [number, number],
    hopS: Object.freeze([0.8, 3.5]) as readonly [number, number],
    // GAME TUNING, from the ecology brief: a random hop lands half a metre to three metres away.
    hopMm: Object.freeze([500, 3000]) as readonly [number, number],
    hoverS: Object.freeze([0.3, 1.5]) as readonly [number, number],
    perchS: Object.freeze([3, 20]) as readonly [number, number],
    drawnTo: Object.freeze(['carrion', 'litter', 'sap', 'nectar', 'water-edge']) as readonly ResourceKind[],
  }),
  burrow: null,
  needs: Object.freeze({
    // GAME TUNING.
    hungerPerS: 1 / 120, fatiguePerS: 1 / 40, feedAt: 0.6, restAt: 0.75,
    feedS: Object.freeze([4, 15]) as readonly [number, number], restS: Object.freeze([3, 20]) as readonly [number, number],
    eats: Object.freeze(['sap', 'nectar', 'litter', 'water-edge']) as readonly ResourceKind[],
  }),
  population: Object.freeze({
    // GAME TUNING. The wrack line and wet ground draw flies; open rock and the ridge hardly any; never over the sea.
    perHectare: Object.freeze({ beach: 300, wetland: 400, grassland: 200, shrubland: 200, forest: 150, rocky: 30, ridge: 20 }),
    hosts: null,
    clump: 0.5,
    caps: Object.freeze({ 'ultra-low': 8, low: 16, medium: 30, high: 50, 'ultra-high': 80 }),
    reachM: 40, nearM: 20, fullM: 8,
  }),
  thinkS: 0.15,
  canEditTerrain: false,
});

// ---------------------------------------------------------------------------
// The Lab's two ants: placed, never generated (see the header)
// ---------------------------------------------------------------------------

/**
 * THE RIG IS NOT MEASURED YET, and the table says so in a way the
 * validator refuses. `spineUnits` is the rig's body length in the GLB's
 * own units, measured against the file with three's loader
 * (`tests/faunaRealRigs.test.ts`), and a number typed in here without
 * that measurement would draw the queen at whatever size the guess
 * implied — the mistake the header describes TCS making with the worm.
 * Zero is below the validator's floor (`finite('model.spineUnits', ..,
 * 1e-6)`), so `assertSpeciesTable(CREATURE_SPECIES, LAB_CREATURE_IDS)`
 * throws until the fauna pass replaces it, and the Lab cannot boot a
 * queen of unknown size. The chain is null for the same reason: a rig
 * posed by its legs and wings has none, and whether these two are is
 * the measurement's to say.
 */
export const UNMEASURED_SPINE_UNITS = 0;

export const QUEEN: CreatureSpecies = Object.freeze({
  id: 'queen' as CreatureId,
  name: 'Winged queen',
  scientificName: 'Solenopsis invicta (alate gyne)',
  // MEASURED: an alate female runs 7-9.5 mm across the identification
  // sources, typical 8; the one measured S. richteri alate is 8.3
  // (queen.md). The 10 mm v0 carried is not in any of them.
  lengthMm: 8,
  lengthSource: 'Solenopsis invicta alate female 7-9.5 mm, typical 8 — UF/IFAS EENY-195; Texas A&M field guide ("3/8 in")',
  // MEASURED: the same sources' range; the draw's mean is the 8 mm above (`population.drawLengthMm`).
  lengthRangeMm: Object.freeze([7, 9.5]) as readonly [number, number],
  model: Object.freeze({
    path: 'models/queen-winged.glb',
    // MEASURED against the file (`tests/faunaRealRigs.test.ts`): the
    // rig's median-band extent, mandible tip to gaster tip, in GLB
    // units — the same convention as the aphid and the fly. The skin
    // overhangs the bones by about a tenth, so the DRAWN queen is
    // ~8.9 mm at the cited 8 mm; if the skin must equal the citation,
    // change `lengthMm`, never this number. v0's alate, 74 bones, no
    // clips, faces +Z; the four wings are separate bone chains.
    spineUnits: 2.3718,
    chain: null,
  }),
  medium: 'ground' as Medium,
  // A cornered queen stings and never hunts (queen.md, "flee"): she meets a threat and does not go looking for one.
  temperament: 'defensive' as Temperament,
  // GAME TUNING with a biological shape: an alate does not forage and a
  // founding queen is claustral, but keepers' founding queens take sugar
  // water and do better for it (queen.md, "feed / drink"). Sugars and
  // water, then — the `eats` list below — and the word is `omnivore`
  // because the union has no narrower one that is not `sap`.
  diet: 'omnivore' as Diet,
  senses: Object.freeze({
    // GAME TUNING PLACEHOLDERS, named as such: the same shape as the
    // housefly's row (queen.md gives 300 / 120 / 300 for sight, alarm and
    // field of view, all tuning — reproductives have more ommatidia than
    // workers and three ocelli, BIOLOGICAL SHAPE, but no distance was
    // measured). alarmS is tuning: "alarm decays over seconds; a real
    // queen resumes digging quickly".
    sightMm: 300, fovDeg: 300, alarmMm: 120, alarmS: 4,
  }),
  pace: Object.freeze({
    // GAME TUNING, derived and then discounted (queen.md, "Proposed queen
    // walk / flee"): no alate queen has been timed. Workers walk 9.6 mm/s
    // (Wen et al. 2020) and burst past 27 (Gravish et al. 2013); Hurlbert
    // 2008's mass^0.25 lifts a 15 mg body about 1.8× over a 1 mg worker,
    // and a gravid alate carrying forty percent of herself as fat is then
    // discounted to a walk of ~2.5 body lengths a second and a flee of
    // ~6. v0's 90 / 180 mm/s would have out-run a desert Cataglyphis.
    // Turn rate is tuning (queen.md: 6 rad/s on the ground).
    wanderMmS: 20, fleeMmS: 50, turnRadS: 6,
  }),
  // BIOLOGICAL SHAPE: Hurlbert, Ballantyne & Powell 2008 — running speed as mass^0.25 across 24 ant species, i.e. length^0.75.
  paceExponent: 0.75,
  flight: Object.freeze({
    // MEASURED: Vogt, Appel & West 2000 flew S. invicta females on a
    // flight mill and read a sustained mean of 0.7 m/s, rising with
    // temperature. A sustained mean is a cruise — v0 had it as the
    // ceiling, which queen.md flags — and the cruise is it.
    cruiseMmS: 700,
    // GAME TUNING: no published maximum for a female; set near the male
    // mean of 1.0 m/s from the same paper (queen.md, "burst").
    burstMmS: 1000,
    // GAME TUNING: no measured climb rate; capped at half the airspeed
    // (queen.md disagreement 7 — v0's 3 m/s LIFT_MAX was four times her
    // airspeed and is not carried).
    climbMmS: 350,
    // GAME TUNING, FOR NOW: real nuptial flights climb to 60-250 m
    // (Markin et al. 1971, as cited) and the Lab is a metre of air. A
    // ceiling of 1.5 m keeps her in the box she is being tested in; the
    // island's sky is a later decision.
    ceilingMm: 1500,
    // GAME TUNING: the band she cruises in inside that ceiling.
    cruiseMm: Object.freeze([150, 900]) as readonly [number, number],
    // SHE DOES NOT HOP; A FLIGHT IS ONE LONG FLIGHT. The measured time
    // aloft is up to 30 minutes and 99 % land within 2 km (Markin 1971);
    // the housefly's seconds-long hops are the wrong shape for her. GAME
    // TUNING: a flight of half a minute to two minutes, aimed metres
    // away, so the Lab can watch one end — a fraction of the measured
    // half hour, kept long by the standard of the fly.
    hopS: Object.freeze([30, 120]) as readonly [number, number],
    hopMm: Object.freeze([1000, 5000]) as readonly [number, number],
    // SHE DOES NOT HOVER. Hovering is not documented for ants; mated
    // alates "glide towards the ground" (queen.md). Zero seconds: the
    // air brain's hover word is passed through on the way to a landing
    // and never held.
    hoverS: Object.freeze([0, 0]) as readonly [number, number],
    // GAME TUNING: rest is long — "she is an investment, not a forager".
    perchS: Object.freeze([30, 180]) as readonly [number, number],
    // Sugars and water draw her from the air; carbohydrate is what the flight burns (RQ ≈ 1, Vogt 2000).
    drawnTo: Object.freeze(['nectar', 'sap', 'honeydew-host', 'water-edge']) as readonly ResourceKind[],
  }),
  burrow: null,
  needs: Object.freeze({
    // GAME TUNING. Hunger climbs slowly — she carries ~40 % of her body
    // as fat (Keller & Passera 1989) — and fatigue climbs as a flier's
    // does: flight costs 48-51× resting (Vogt 2000), so the number is the
    // housefly's order rather than the worm's.
    hungerPerS: 1 / 900, fatiguePerS: 1 / 120, feedAt: 0.6, restAt: 0.7,
    feedS: Object.freeze([20, 60]) as readonly [number, number], restS: Object.freeze([60, 240]) as readonly [number, number],
    eats: Object.freeze(['nectar', 'sap', 'honeydew-host', 'water-edge']) as readonly ResourceKind[],
  }),
  population: Object.freeze({
    // NOT IN THE WILD. An empty density table generates none anywhere
    // (see CreaturePopulation): the Lab places her (`labWorld.ts`), and
    // S. invicta is not established on Kauaʻi in any case (queen.md). The
    // caps and tiers are the shape the simulation needs to run ONE of her
    // when she is placed; GAME TUNING that is never reached by the wild.
    perHectare: Object.freeze({}),
    hosts: null,
    clump: 0,
    caps: Object.freeze({ 'ultra-low': 1, low: 1, medium: 1, high: 1, 'ultra-high': 1 }),
    reachM: 30, nearM: 15, fullM: 6,
  }),
  // GAME TUNING: between the fly's 0.15 s and the aphid's 0.4 s — she decides faster than a worm and is not a fly.
  thinkS: 0.2,
  // FOR NOW. A founding queen digs (FIRE_ANT_BIOLOGY §16) and ants are
  // authorised editors by CLAUDE.md's rule; the dig itself is a later
  // milestone (Joshua's brief, §22), and until it exists the honest
  // answer is that she does not.
  canEditTerrain: false,
});

export const WORKER: CreatureSpecies = Object.freeze({
  id: 'worker' as CreatureId,
  name: 'Fire ant worker',
  scientificName: 'Solenopsis invicta (worker)',
  // BIOLOGICAL SHAPE: the typical worker of worker.md. A mature colony
  // is 45 / 42 / 16 % small / medium / large by head width (Wood &
  // Tschinkel 1981: small ≤ 0.80 mm, medium ≤ 1.00, large ≤ 1.50), so
  // the median worker sits at the small/medium line, head width 0.8 mm;
  // body length runs about four times head width across the range
  // (1.6-6.0 mm against 0.45-1.50, Tschinkel et al. 2003), which puts
  // that median at 3.2 mm, rounded to the 3 mm at which Gravish's tunnel
  // burst is quoted. One worker caste, one continuous draw — no
  // "soldier" (Joshua's brief, §12; Tschinkel 1988).
  lengthMm: 3.0,
  lengthSource: 'Solenopsis invicta workers 1.6-6.0 mm, continuously polymorphic — Texas A&M fire ant project; CDFA RIFA profile; mix from Wood & Tschinkel 1981',
  // MEASURED: the whole worker range (TAMU; CDFA); the draw's mean is the 3 mm above.
  lengthRangeMm: Object.freeze([1.6, 6.0]) as readonly [number, number],
  model: Object.freeze({
    path: 'models/worker.glb',
    // MEASURED against the file (`tests/faunaRealRigs.test.ts`), the
    // queen's convention: mandible tip to gaster tip in GLB units; the
    // drawn worker is ~3.3 mm at the cited 3.0. TCS's worker rig, 61
    // bones, one mesh, no clips, faces +Z — the ONE polymorphic caste
    // at whatever size the draw gives it.
    spineUnits: 3.7917,
    chain: null,
  }),
  medium: 'ground' as Medium,
  // Attack and flee are one decision, sized (worker.md): near the nest a disturbance is met. `defend` is the stand; `attack` is the Lab's option.
  temperament: 'defensive' as Temperament,
  // MEASURED: 70-80 % of loads are liquid (Tennant & Porter 1991), the rest insects, seeds and dead matter.
  diet: 'omnivore' as Diet,
  senses: Object.freeze({
    // GAME TUNING (worker.md): 48-92 ommatidia resolve coarse motion at
    // a few centimetres, so sight is 50 mm; the field is wide; the alarm
    // pheromone is short-lived (Vander Meer 2010), so the alarm is short.
    sightMm: 50, fovDeg: 300, alarmMm: 30, alarmS: 3,
  }),
  pace: Object.freeze({
    // MEASURED, then scaled to this entry's reference body. Wen et al.
    // 2020 timed trail-following workers at 9.6 mm/s, about 2.7 body
    // lengths a second for a 3.5 mm worker. The cited animal here is
    // 3.0 mm, and the ant's law is length^0.75 (paceExponent below), so
    // the table's pace is 9.6 × (3.0 / 3.5)^0.75 = 9.6 × 0.8908 = 8.55
    // mm/s — and a drawn 3.5 mm worker gets its 9.6 back through
    // `paceRatio`.
    wanderMmS: 8.55,
    // MEASURED in tunnels: > 9 body lengths a second (Gravish et al.
    // 2013), 27 mm/s at 3 mm. That it holds on the flat is GAME TUNING —
    // no flat-ground burst is published for S. invicta (worker.md).
    fleeMmS: 27,
    // GAME TUNING: a half-turn in half a second at walking pace (worker.md).
    turnRadS: 6,
  }),
  // BIOLOGICAL SHAPE: Hurlbert, Ballantyne & Powell 2008 — a 6 mm major runs ~1.9× a 2 mm minim, not 3×.
  paceExponent: 0.75,
  flight: null,
  burrow: null,
  needs: Object.freeze({
    // GAME TUNING with the measured shape: a feed is a crop fill of tens
    // of seconds that ends in a trip home (Tennant & Porter 1991); rest
    // is naps, not blocks — 253 a day of about a minute, four in five
    // workers awake at any moment (Cassill et al. 2009) — so the rest is
    // short and the threshold low.
    hungerPerS: 1 / 240, fatiguePerS: 1 / 180, feedAt: 0.6, restAt: 0.6,
    feedS: Object.freeze([10, 40]) as readonly [number, number], restS: Object.freeze([40, 120]) as readonly [number, number],
    // In worker.md's order of preference: liquid carbohydrate first, then
    // protein, seed last (S. invicta takes an eighth of the seeds S.
    // geminata does). `carrion` is named by the resource layer and offered
    // by nothing in the wild yet; the Lab offers a test carrion as its
    // protein resource (`labWorld.ts`). `water-edge` is the drink.
    eats: Object.freeze(['honeydew-host', 'nectar', 'sap', 'carrion', 'seed', 'water-edge']) as readonly ResourceKind[],
  }),
  population: Object.freeze({
    // NOT IN THE WILD: as the queen. The Lab places one representative worker (Joshua's brief, §12).
    perHectare: Object.freeze({}),
    hosts: null,
    clump: 0.5,
    caps: Object.freeze({ 'ultra-low': 1, low: 1, medium: 1, high: 1, 'ultra-high': 1 }),
    reachM: 30, nearM: 15, fullM: 6,
  }),
  // Beyond Extinction's decision cadence, the SHAPE the brief asks to keep (Joshua's brief, §2): 0.15 s, the housefly's.
  thinkS: 0.15,
  // FOR NOW: a worker digs, and the dig is a later milestone (Joshua's brief, §22). See the queen's line.
  canEditTerrain: false,
});

export const CREATURE_SPECIES: Readonly<Record<CreatureId, CreatureSpecies>> = Object.freeze({
  earthworm: EARTHWORM,
  aphid: APHID,
  housefly: HOUSEFLY,
  queen: QUEEN,
  worker: WORKER,
});

/** Any species the table knows, wild or placed. */
export function isCreatureId(value: unknown): value is CreatureId {
  return typeof value === 'string' && (LAB_CREATURE_IDS as readonly string[]).includes(value);
}

/**
 * The rig's scale in the renderer: the world units the spine should
 * measure, over the units it does measure. The one place the size of a
 * creature is decided from, so a change to `lengthMm` reaches the screen.
 */
export function rigScale(species: CreatureSpecies): number {
  return unitsOfMm(species.lengthMm) / species.model.spineUnits;
}

/**
 * HOW BIG THIS ONE IS, as a multiple of the animal the table cites: the
 * ONE place the ratio is worked out, so a pace, a body length and a
 * renderer's scale can never disagree about the same worm.
 *
 * Joshua, 2026-09-08: the earthworm "should be based on size and
 * dynamic". Every pace read and every distance measured in bodies is
 * multiplied by this — not because big animals are quick, but because
 * the law that was measured is a tenth of ITS OWN body a second, so the
 * speed IS the size (Quillin 1999; see `EARTHWORM.pace`).
 *
 * Guarded to a positive finite number. A state carrying a length it
 * should not — a creature built by hand, a save written before
 * individuals had sizes, a NaN out of arithmetic upstream — reads as the
 * species' own animal at ratio 1, which is the behaviour this table had
 * before the draw existed. A creature that stands still or leaves the
 * island is worse than one that is the size the table says.
 */
export function sizeRatio(state: CreatureState, species: CreatureSpecies): number {
  const length = state.lengthMm;
  const cited = species.lengthMm;
  if (!Number.isFinite(length) || length <= 0) return 1;
  if (!Number.isFinite(cited) || cited <= 0) return 1;
  return length / cited;
}

/**
 * HOW FAST THIS ONE IS, as a multiple of the table's pace: `sizeRatio`
 * raised to the species' `paceExponent`. Every pace the brain and the
 * legs read is multiplied by this and by nothing else; every DISTANCE
 * measured in bodies stays on `sizeRatio`, because a body is as long as
 * it is whatever it runs at.
 *
 * Why two functions and not an exponent inside `sizeRatio`: the ratio
 * also sets the rig's scale in the renderer and the arrive radius in the
 * legs, and a 6 mm major drawn at 6^0.75 of itself would be the
 * size-by-guess this table was built to end. The worm's exponent is 1
 * and `Math.pow(x, 1)` is `x`, so nothing shipped moved; the exponent is
 * skipped outright at 1 so that is true to the bit and not to the ulp.
 * A broken exponent (non-finite, negative) reads as 1.
 */
export function paceRatio(state: CreatureState, species: CreatureSpecies): number {
  const ratio = sizeRatio(state, species);
  const k = species.paceExponent;
  if (k === 1 || !Number.isFinite(k) || k < 0) return ratio;
  return Math.pow(ratio, k);
}

/**
 * Hold the table to its own rules, loudly, once, at the door — the way
 * `data/schema.ts` validates a registry entry. Returns the problems so a
 * test can list them; the simulation throws on any.
 */
export function speciesProblems(species: CreatureSpecies): string[] {
  const problems: string[] = [];
  const where = `species "${species.id}"`;
  const finite = (name: string, value: number, min = 0): void => {
    if (!Number.isFinite(value) || value < min) problems.push(`${where}: ${name} must be finite and >= ${min}, got ${value}`);
  };
  const range = (name: string, value: readonly [number, number]): void => {
    finite(`${name}[0]`, value[0]);
    finite(`${name}[1]`, value[1]);
    if (value[1] < value[0]) problems.push(`${where}: ${name} runs backwards`);
  };
  finite('lengthMm', species.lengthMm, 0.1);
  finite('lengthRangeMm[0]', species.lengthRangeMm[0], 0.1);
  finite('lengthRangeMm[1]', species.lengthRangeMm[1], 0.1);
  if (species.lengthRangeMm[1] < species.lengthRangeMm[0]) problems.push(`${where}: lengthRangeMm runs backwards`);
  else if (species.lengthMm < species.lengthRangeMm[0] || species.lengthMm > species.lengthRangeMm[1]) {
    // The cited length is the draw's mean, so a range that does not
    // contain it would generate a population the table does not describe.
    problems.push(`${where}: the cited length ${species.lengthMm} mm is outside lengthRangeMm`);
  }
  finite('model.spineUnits', species.model.spineUnits, 1e-6);
  if (!species.lengthSource) problems.push(`${where}: a measured length needs a source`);
  if (!species.model.path.endsWith('.glb')) problems.push(`${where}: model.path must name a .glb`);
  finite('senses.sightMm', species.senses.sightMm);
  finite('senses.alarmMm', species.senses.alarmMm);
  finite('senses.alarmS', species.senses.alarmS);
  if (species.senses.fovDeg <= 0 || species.senses.fovDeg > 360) problems.push(`${where}: fovDeg must be in (0, 360]`);
  if (species.senses.alarmMm > species.senses.sightMm) problems.push(`${where}: it cannot be alarmed by what it cannot sense`);
  finite('pace.wanderMmS', species.pace.wanderMmS);
  finite('pace.fleeMmS', species.pace.fleeMmS);
  // A flee that is no faster than a walk is not a flee: the word would
  // change and nothing on the screen would. The worm's flee is invented
  // (see EARTHWORM.pace) and this is what keeps the invention honest.
  if (species.pace.fleeMmS <= species.pace.wanderMmS) problems.push(`${where}: fleeing is not faster than walking`);
  finite('pace.turnRadS', species.pace.turnRadS, 1e-6);
  // The exponent is a law of scaling and stays inside 0..1: at 0 a pace
  // ignores the body (a fly's wing), at 1 it is the body's (a worm), and
  // above 1 a longer animal would out-run its own proportion, which
  // nothing measured does.
  finite('paceExponent', species.paceExponent);
  if (species.paceExponent > 1) problems.push(`${where}: paceExponent must be 0..1, got ${species.paceExponent}`);
  // An air species flies; a ground species may (the winged queen); soil and plant never.
  if (species.medium === 'air' && species.flight === null) problems.push(`${where}: an air species has a flight spec`);
  if (species.flight !== null && species.medium !== 'air' && species.medium !== 'ground') {
    problems.push(`${where}: only an air or a ground species has a flight spec`);
  }
  if ((species.medium === 'soil') !== (species.burrow !== null)) problems.push(`${where}: a soil species has a burrow spec and only a soil species does`);
  if (species.canEditTerrain && species.medium !== 'soil') problems.push(`${where}: only a burrower may be a terrain editor`);
  if (species.flight) {
    finite('flight.cruiseMmS', species.flight.cruiseMmS, 1e-6);
    finite('flight.burstMmS', species.flight.burstMmS, 1e-6);
    if (species.flight.burstMmS < species.flight.cruiseMmS) problems.push(`${where}: a burst slower than the cruise is not a burst`);
    finite('flight.climbMmS', species.flight.climbMmS, 1e-6);
    finite('flight.ceilingMm', species.flight.ceilingMm, 1);
    range('flight.cruiseMm', species.flight.cruiseMm);
    if (species.flight.cruiseMm[1] > species.flight.ceilingMm) problems.push(`${where}: cruise band above the ceiling`);
    range('flight.hopS', species.flight.hopS);
    range('flight.hopMm', species.flight.hopMm);
    if (species.flight.hopMm[0] <= 0) problems.push(`${where}: a hop of no distance is a perch`);
    range('flight.hoverS', species.flight.hoverS);
    range('flight.perchS', species.flight.perchS);
  }
  if (species.burrow) {
    finite('burrow.underMm', species.burrow.underMm, 1e-6);
    finite('burrow.boreMm', species.burrow.boreMm, 1e-6);
    if (species.burrow.boreMm > species.burrow.underMm) problems.push(`${where}: a bore wider than the band it travels in would break the surface`);
    range('burrow.headingS', species.burrow.headingS);
    if (species.burrow.turn < 0 || species.burrow.turn > 1) problems.push(`${where}: burrow.turn must be 0..1`);
    range('burrow.surfaceS', species.burrow.surfaceS);
    range('burrow.betweenSurfacingsS', species.burrow.betweenSurfacingsS);
  }
  finite('needs.hungerPerS', species.needs.hungerPerS);
  finite('needs.fatiguePerS', species.needs.fatiguePerS);
  for (const [name, value] of [['feedAt', species.needs.feedAt], ['restAt', species.needs.restAt]] as const) {
    if (!(value > 0 && value <= 1)) problems.push(`${where}: needs.${name} must be in (0, 1]`);
  }
  range('needs.feedS', species.needs.feedS);
  range('needs.restS', species.needs.restS);
  const pop = species.population;
  for (const [kind, density] of Object.entries(pop.perHectare)) {
    if (density === undefined) continue;
    finite(`population.perHectare.${kind}`, density);
    if (kind === 'sea' && density > 0) problems.push(`${where}: nothing lives at sea in this table`);
  }
  if (pop.hosts !== null && pop.hosts.length === 0) problems.push(`${where}: hosts is empty — use null for a ground species`);
  if (pop.hosts !== null && species.medium !== 'plant') problems.push(`${where}: only a plant species has hosts`);
  if (pop.clump < 0 || pop.clump > 1) problems.push(`${where}: population.clump must be 0..1`);
  const rungs: readonly ObjectRung[] = ['ultra-low', 'low', 'medium', 'high', 'ultra-high'];
  let last = 0;
  for (const rung of rungs) {
    const cap = pop.caps[rung];
    finite(`population.caps.${rung}`, cap);
    if (cap < last) problems.push(`${where}: caps fall from one rung to the next at ${rung}`);
    last = cap;
  }
  finite('population.reachM', pop.reachM, 1);
  finite('population.nearM', pop.nearM, 1);
  finite('population.fullM', pop.fullM, 1);
  if (!(pop.fullM <= pop.nearM && pop.nearM <= pop.reachM)) problems.push(`${where}: tiers must nest: full <= near <= reach`);
  finite('thinkS', species.thinkS, 0.01);
  return problems;
}

/**
 * Throws on the first problem among `ids` in the table. The simulation
 * calls it once on construction over the WILD list, which is what it
 * runs by default; the Lab asks over `LAB_CREATURE_IDS`, and until the
 * ants' rigs are measured that throws — deliberately (see
 * `UNMEASURED_SPINE_UNITS`).
 */
export function assertSpeciesTable(
  table: Readonly<Record<CreatureId, CreatureSpecies>> = CREATURE_SPECIES,
  ids: readonly CreatureId[] = CREATURE_IDS,
): void {
  for (const id of ids) {
    const species = table[id];
    if (species.id !== id) throw new Error(`species table: entry "${id}" carries id "${species.id}"`);
    const problems = speciesProblems(species);
    if (problems.length > 0) throw new Error(problems.join('\n'));
  }
}
