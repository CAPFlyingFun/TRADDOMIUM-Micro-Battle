/**
 * THE ISLAND'S ANIMALS, AS DATA — three species, every number labelled.
 *
 * Joshua, 2026-09-07 (the ecology pass): "Creature behaviour should be
 * data-driven where practical … species DATA drives behaviour", the
 * sizes verified against the repo's own research and set BY THE SPINE,
 * not the bounding box, and the old creature AI reused as a donor of
 * shapes and lessons, never copied whole. This file is the data. The
 * brain (`intent.ts`), the legs (`locomotion.ts`) and the crowd
 * (`population.ts`) read it and hold no numbers of their own.
 *
 * WHY NOT `data/registries.SPECIES`: that registry is the ANT species —
 * castes, growth curves, life states, the player's own kind — and its
 * docblock says content arrives with the Queen. A worm has no castes.
 * These three are the island's wildlife, and they live here, in the
 * module that simulates them, in the same frozen-table shape the object
 * families use (`world/objects/families.ts`). When the ant registries
 * fill, nothing here needs to move.
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
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { HabitatKind } from '../world/habitat';
import type { ObjectRung } from '../world/objects/budget';
import type { ResourceKind } from '../world/ecology/resources';

export type CreatureId = 'earthworm' | 'aphid' | 'housefly';

/** In the order the layers, the budgets and the HUD list them. */
export const CREATURE_IDS: readonly CreatureId[] = Object.freeze(['earthworm', 'aphid', 'housefly']);

/** Where a species lives: in the ground, on a plant, or in the air over the ground. Decides which behaviours it can have. */
export type Medium = 'soil' | 'plant' | 'air';

/** How it treats the world. `skittish` flees a disturbance; `passive` only moves away from one. */
export type Temperament = 'passive' | 'skittish';

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
  /** Body length, mm. MEASURED — `lengthSource` says where. */
  readonly lengthMm: number;
  readonly lengthSource: string;
  readonly model: CreatureModel;
  readonly medium: Medium;
  readonly temperament: Temperament;
  readonly diet: Diet;
  readonly senses: CreatureSenses;
  readonly pace: CreaturePace;
  /** Present for an air species only. */
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
    // BIOLOGICAL SHAPE: Quillin (1999, J. Exp. Biol.) measured L. terrestris
    // crawling at roughly a tenth of a body length a second; 150 mm × 0.1
    // is 15 mm/s on the surface. Underground is slower and is what the
    // player mostly meets, so the wander pace is TCS's 3 mm/s (GAME TUNING)
    // and the flee pace the measured surface crawl.
    wanderMmS: 3, fleeMmS: 15, turnRadS: 1.2,
  }),
  flight: null,
  burrow: Object.freeze({
    // GAME TUNING carried from TCS islandWorm.ts (WORM_UNDER_MM, WORM_BORE_MM,
    // WORM_HEADING_MIN/MAX_S, WORM_TURN): the band it wanders in is deep
    // enough to be hidden and shallow enough to be near the ant.
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
  flight: Object.freeze({
    // BIOLOGICAL SHAPE: Musca domestica is commonly reported at about 2 m/s
    // (7 km/h) in free flight. Short hops, a hover, a landing: the game
    // fly never cruises for minutes, because a fly that leaves is a fly
    // the ant never sees again.
    cruiseMmS: 1500, climbMmS: 600, ceilingMm: 1500,
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

export const CREATURE_SPECIES: Readonly<Record<CreatureId, CreatureSpecies>> = Object.freeze({
  earthworm: EARTHWORM,
  aphid: APHID,
  housefly: HOUSEFLY,
});

export function isCreatureId(value: unknown): value is CreatureId {
  return typeof value === 'string' && (CREATURE_IDS as readonly string[]).includes(value);
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
  finite('pace.turnRadS', species.pace.turnRadS, 1e-6);
  if ((species.medium === 'air') !== (species.flight !== null)) problems.push(`${where}: an air species has a flight spec and only an air species does`);
  if ((species.medium === 'soil') !== (species.burrow !== null)) problems.push(`${where}: a soil species has a burrow spec and only a soil species does`);
  if (species.canEditTerrain && species.medium !== 'soil') problems.push(`${where}: only a burrower may be a terrain editor`);
  if (species.flight) {
    finite('flight.cruiseMmS', species.flight.cruiseMmS, 1e-6);
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

/** Throws on the first problem in the table. The simulation calls it once on construction. */
export function assertSpeciesTable(table: Readonly<Record<CreatureId, CreatureSpecies>> = CREATURE_SPECIES): void {
  for (const id of CREATURE_IDS) {
    const species = table[id];
    if (species.id !== id) throw new Error(`species table: entry "${id}" carries id "${species.id}"`);
    const problems = speciesProblems(species);
    if (problems.length > 0) throw new Error(problems.join('\n'));
  }
}
