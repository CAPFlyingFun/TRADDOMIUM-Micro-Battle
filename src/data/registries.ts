/**
 * The typed registries — one per kind (ARCHITECTURE §7), every one EMPTY
 * in Phase 0. This file ships the SHAPES and the rule for what goes
 * where. Species content arrives in Phase 7 (v0's `castes.ts` re-read
 * against §2, not copied), food and combat in Phase 10, and each phase's
 * data file EXPORTS entries for the integration pass to register in one
 * place. Nothing here registers on import.
 *
 * WHERE DOES A NUMBER BELONG (§7, made concrete per kind below):
 *
 *   varies with body size               → a growth-curve stat on the CASTE
 *   varies with what she is doing       → a life-state scale on that stat
 *   a discrete thing an ant can/cannot do → an ABILITY (its magnitude is
 *                                          still a caste stat; whether a
 *                                          caste has it is the caste's list)
 *   a property of a thing in the world  → that thing's registry
 *   true of every member, whatever caste → the SPECIES
 *
 * LABEL EVERY NUMBER when content arrives (FIRE_ANT_BIOLOGY §38):
 * MEASURED (a published measurement, cited), BIOLOGICAL SHAPE (the
 * mechanism is real, the magnitude is tuned) or GAME TUNING (invented
 * for play). The label stops a future reader "correcting" a tuned
 * number in the belief that it is biology.
 *
 * The `never` vocabularies are not placeholders: a kind that does not
 * grow has no curve stats, and both the compiler and `register()` refuse
 * one. The two `as const` lists that CAN grow are empty because no live
 * system consumes a stat yet — the day one does, the name goes in the
 * list, the curve goes on the entry, and the WIRED test holds them.
 */
import { createRegistry, type Entry } from './schema';

/**
 * A species: identity and what is true of every member regardless of
 * caste — the binomial research is filed under, which castes exist,
 * which damage type its sting deals. Growth-curve stats DEFAULT TO THE
 * CASTE, because a queen's body and a worker's body of the same species
 * are different curves; this vocabulary stays empty unless Phase 7
 * finds a curve that genuinely is the same for every caste.
 */
export const SPECIES_STATS = [] as const;
export type SpeciesStat = (typeof SPECIES_STATS)[number];

export interface SpeciesEntry extends Entry<SpeciesStat> {
  /** Binomial, 'Solenopsis invicta'; `name` is what the player reads, 'Red imported fire ant'. */
  readonly scientificName: string;
}

export const SPECIES = createRegistry<SpeciesStat, SpeciesEntry>('species', SPECIES_STATS);

/**
 * A caste is a BODY: this is where growth curves live, and the only
 * kind with a life-state axis. Every number that changes with size
 * (length, mass, speed, health, carry, bite) is a curve here; every
 * number that changes with what she is doing (founding zeroes hunger, a
 * laying queen cannot dig) is a scale on that curve, keyed by a state in
 * `lifeStates`. Worker size is a continuum, not two body plans
 * (FIRE_ANT_BIOLOGY §3): "major" is the upper end of one distribution,
 * so it is a caste entry with its own curves rather than a worker × 2,
 * and never a Pheidole soldier.
 *
 * `lifeStates` is required here rather than optional: a worker's life is
 * one long state, and saying so (`['adult']`) is better than leaving the
 * axis open. The male is NOT a caste — he is a sex, and folding him in
 * would put him in every switch over a colony job he does not have.
 */
export const CASTE_STATS = [] as const;
export type CasteStat = (typeof CASTE_STATS)[number];

export interface CasteEntry extends Entry<CasteStat> {
  readonly speciesId: string;
  readonly lifeStates: readonly string[];
  /** Ability ids this caste can possess. Whether the GAME has built one is the ability's `built`. */
  readonly abilities: readonly string[];
}

export const CASTES = createRegistry<CasteStat, CasteEntry>('castes', CASTE_STATS);

/**
 * A growth stage is a NAME for a point on the growth axis — what the HUD
 * calls 0.5 — and holds no numbers of its own: the numbers are the caste
 * curves it indexes into. Five stages, one per curve sample point, at 0,
 * 0.25, 0.5, 0.75 and 1; a Phase 7 test pins the registered stages to
 * those points. A real ant ecloses at final size and never grows, so
 * growth is a GAME progression and the stage names should say so rather
 * than borrow instar names.
 */
export interface GrowthStageEntry extends Entry<never> {
  /** Position on the 0..1 growth axis this stage names. */
  readonly growth: number;
}

export const GROWTH_STAGES = createRegistry<never, GrowthStageEntry>('growthStages', []);

/**
 * An ability is a DISCRETE capability — dig, bite, sting, fly, swim,
 * carry — a thing an ant can or cannot do, never a number that grows.
 * How HARD she bites is a caste stat; WHETHER she can bite is her
 * caste's `abilities` list; whether the GAME can bite yet is `built`.
 * `built` exists for §2.9: an unavailable action must never look
 * functional, so the HUD reads it before it shows a control as live.
 */
export interface AbilityEntry extends Entry<never> {
  /** Does the game implement the mechanic? Not "does this ant have it" — that is the caste's list. */
  readonly built: boolean;
}

export const ABILITIES = createRegistry<never, AbilityEntry>('abilities', []);

/**
 * An item is a discrete thing that can be picked up and carried — a
 * seed, a dead insect, a soil particle. Its properties are ITS OWN and
 * do not grow: mass is here, and the carry stat measured against it
 * ("times her own mass") is on the caste. What an item yields when eaten
 * is a Phase 10 field pointing at `RESOURCES`.
 */
export interface ItemEntry extends Entry<never> {
  /** Milligrams. MEASURED where a source exists, else GAME TUNING — the doc comment on the entry says which. */
  readonly massMg: number;
}

export const ITEMS = createRegistry<never, ItemEntry>('items', []);

/**
 * A resource is a KIND of nourishment the colony stocks and spends —
 * carbohydrate, protein, water — not a thing on the ground. "Food" is
 * not one resource (FIRE_ANT_BIOLOGY §17: sugar fuels workers, protein
 * feeds larvae and the queen), so the rate at which a body burns each is
 * a caste stat, and what an item contains is on the item.
 */
export type ResourceEntry = Entry<never>;

export const RESOURCES = createRegistry<never, ResourceEntry>('resources', []);

/**
 * A biome is a property of a PLACE — beach, lowland forest, wet upland,
 * cliff — read from the surveyed terrain and never written to it (the
 * terrain is not ours to move). What grows there and how its soil digs
 * are properties of the biome; how fast an ant digs is a caste stat.
 */
export type BiomeEntry = Entry<never>;

export const BIOMES = createRegistry<never, BiomeEntry>('biomes', []);

/**
 * A vegetation kind is a property of a PLANT — a grass tuft, a shrub, a
 * tree with a climbable trunk — the things Phase 6 scatters
 * deterministically. Whether it can be climbed is a fact about the plant
 * and lives here; how well an ant climbs is a caste stat; whether the
 * game can climb at all is the climb ability's `built`.
 */
export type VegetationEntry = Entry<never>;

export const VEGETATION = createRegistry<never, VegetationEntry>('vegetation', []);

/**
 * A water type is a property of WATER — sea, stream, pool, puddle. Salt
 * is the one fact every consumer asks first (v0's water query answered
 * saltwater against fresh, and drinking refilled only from fresh), so it
 * is the one field the shell carries. Depth, flow and surface tension
 * are the water's own; how long an ant lasts submerged is a caste stat.
 */
export interface WaterTypeEntry extends Entry<never> {
  readonly saline: boolean;
}

export const WATER_TYPES = createRegistry<never, WaterTypeEntry>('waterTypes', []);

/**
 * A damage type names HOW harm arrives — bite, sting venom, crush,
 * drowning, heat — so armour, resistances and causes of death can key on
 * it. It holds no magnitude: how much a sting does is the stinging
 * caste's stat, and how much it hurts THIS caste is a per-caste
 * resistance keyed by damage type id, added when combat lands (Phase 10).
 */
export type DamageTypeEntry = Entry<never>;

export const DAMAGE_TYPES = createRegistry<never, DamageTypeEntry>('damageTypes', []);

/** Every registry, in spec order, for a dev tool or a test that walks them all. */
export const DATA_REGISTRIES = [
  SPECIES,
  CASTES,
  GROWTH_STAGES,
  ABILITIES,
  ITEMS,
  RESOURCES,
  BIOMES,
  VEGETATION,
  WATER_TYPES,
  DAMAGE_TYPES,
] as const;
