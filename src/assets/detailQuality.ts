/**
 * THE DETAIL LADDER: how far the moving water reaches, and which of
 * those rungs a phone may be offered.
 *
 * Joshua, 2026-09-05, having asked how big the wave radius was and been
 * told that ultra-high, high and medium were all the same 84 m: "Probably
 * separate the two like rendering details vs textures. So could do a
 * random combination but, Ultra-High would be unavailable for mobile for
 * both." This is the RENDERING DETAIL half. `textureQuality.ts` is the
 * texture half, and the two are now independent settings — a player may
 * run high detail with low textures or the other way round, because they
 * cost different parts of the machine.
 *
 * WHY THEY HAD TO SPLIT. One rung used to drive both, so a player who
 * dropped textures to save memory also dropped the wave radius, and one
 * who wanted more water paid for 2048² textures they may not have had
 * room for. Texture size is GPU MEMORY and is a cliff — the tab is
 * killed, not slowed. Wave radius is VERTICES A FRAME and is a slope. A
 * setting that moves a cliff and a slope together can only be tuned for
 * whichever bites first on the machine it was tuned on.
 *
 * THE RUNG IS A RADIUS, and everything else is derived from it. The near
 * sheet's vertex count is not a number anyone should have to keep in
 * step with a distance — `OceanView` divides the radius by the cell it
 * owns. So this file holds the decision (how far can she see waves) and
 * nothing else, and there is no second copy of it to drift.
 *
 * THE NUMBERS ARE JOSHUA'S, from the same message, with one change he
 * has been told about: he proposed 5 m for ultra-low and this ships 15 m.
 * The player is an ant with her eye about a centimetre above the water,
 * and the crossfade starts at 72% of the radius — at 5 m the waves would
 * begin flattening 3.6 m away, which is the middle of what she is
 * looking at. 15 m is the floor that keeps a real step below low without
 * putting the flat water inside her view. It costs 1,849 vertices; his
 * 5 m would have cost 225, and neither is what the frame is spent on.
 *
 * COST IS THE SQUARE OF THE RADIUS, which is the whole reason this is a
 * ladder and not a slider: halve the reach and you quarter the vertices.
 *
 *   ultra-high  200 m   571² =  326,041   +  far 66,049  =  392,090
 *   high        100 m   287² =   82,369   +  far 66,049  =  148,418
 *   medium       50 m   143² =   20,449   +  far 37,249  =   57,698
 *   low          20 m    57² =    3,249   +  far 16,641  =   19,890
 *   ultra-low    15 m    43² =    1,849   +  far  9,409  =   11,258
 *
 * v0 drew 124,130 every frame at every setting. High is 1.20 times that
 * and is what Joshua's phone selects; it holds 60 fps at v0's count
 * already, and this is the one rung that costs him more than before.
 *
 * ULTRA HIGH IS NOT FOR PHONES, for the same reason as its texture
 * namesake and by a different mechanism: 392,090 vertices is 3.2 times
 * what v0 submitted, and v0's own screenshots on this phone read 10 to
 * 30 fps. `MOBILE_DETAIL` is what a phone may be offered. The honesty
 * rule (CLAUDE.md) says a control that cannot work must not be presented
 * as a choice — there, a killed tab; here, a slideshow.
 *
 * Pure: no three, no DOM. A distance is not a mesh.
 */

/** Coarsest first, so the array reads as a ladder you climb. */
export type DetailTier = 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high';

export const DETAIL_TIERS: readonly DetailTier[] = Object.freeze([
  'ultra-low',
  'low',
  'medium',
  'high',
  'ultra-high',
]);

export interface DetailTierSpec {
  readonly tier: DetailTier;
  /**
   * How far the SWELL reaches from the camera, in world units.
   *
   * Not how far the sea reaches — the far sheet spans 8.2 km at every
   * rung and the horizon is not negotiable. This is the radius inside
   * which the water MOVES, before it hands over to the flat sheet.
   */
  readonly waveRadius: number;
  /** What a player would read in a menu. */
  readonly label: string;
  /**
   * Whether a PHONE may be offered this rung. False is not a warning to
   * be clicked past: it is a rung whose cost is not a slower frame but
   * an unplayable one.
   */
  readonly mobile: boolean;
  readonly note: string;
}

/** 100 world units to the metre, as everywhere: one unit is a centimetre. */
const M = 100;

export const DETAIL_QUALITY: Readonly<Record<DetailTier, DetailTierSpec>> = Object.freeze({
  'ultra-low': Object.freeze({
    tier: 'ultra-low',
    waveRadius: 15 * M,
    label: 'Ultra low',
    mobile: true,
    note: 'The floor. Waves inside 15 m, flat beyond — the rung for a phone that would otherwise choose between the sea and the frame rate.',
  }),
  low: Object.freeze({
    tier: 'low',
    waveRadius: 20 * M,
    label: 'Low',
    mobile: true,
    note: 'About a sixth of v0’s vertex count.',
  }),
  medium: Object.freeze({
    tier: 'medium',
    waveRadius: 50 * M,
    label: 'Medium',
    mobile: true,
    note: 'Under half of v0’s count, on the rung most phones will land on.',
  }),
  high: Object.freeze({
    tier: 'high',
    waveRadius: 100 * M,
    label: 'High',
    mobile: true,
    note: 'The highest a phone is offered: 1.20x v0’s vertex count, on geometry that already holds 60 fps.',
  }),
  'ultra-high': Object.freeze({
    tier: 'ultra-high',
    waveRadius: 200 * M,
    label: 'Ultra high',
    mobile: false,
    note: 'DESKTOP ONLY. 3.2x v0’s vertex count, and v0 on this phone read 10 to 30 fps.',
  }),
});

/** The rungs a phone build may offer, coarsest first. `ultra-high` is not among them. */
export const MOBILE_DETAIL: readonly DetailTier[] = Object.freeze(
  DETAIL_TIERS.filter((tier) => DETAIL_QUALITY[tier].mobile),
);

/** The highest rung a phone may be offered. */
export const MAX_MOBILE_DETAIL: DetailTier = 'high';

/** How far the swell reaches at this rung, in world units. */
export function waveRadius(tier: DetailTier): number {
  return DETAIL_QUALITY[tier].waveRadius;
}

/**
 * The rung the player's three-level detail setting means.
 *
 * Kept as plain string literals rather than importing `Quality` from
 * `ui/settingsStore`: assets/ has no business importing a screen's
 * document, and the test pins these keys against `QUALITY_LEVELS` so
 * they cannot drift apart anyway.
 */
export const DETAIL_FOR_QUALITY: Readonly<Record<'low' | 'medium' | 'high', DetailTier>> = Object.freeze({
  low: 'low',
  medium: 'medium',
  high: 'high',
});

export function detailFor(quality: 'low' | 'medium' | 'high'): DetailTier {
  return DETAIL_FOR_QUALITY[quality];
}

/**
 * The rung to actually use: the player's choice, held down to what the
 * platform may be offered. A desktop build passes `mobile: false`.
 *
 * It clamps rather than refusing, for the reason its texture twin does:
 * a setting carried over from another device must not leave the player
 * with an unplayable frame rate and no way back. What they chose is
 * remembered; what runs is what fits.
 */
export function detailToUse(tier: DetailTier, mobile: boolean): DetailTier {
  if (!mobile || DETAIL_QUALITY[tier].mobile) return tier;
  return MAX_MOBILE_DETAIL;
}

/**
 * THE TESTING OVERRIDE: `?detail=ultra-high`, and why it exists.
 *
 * Exactly the shape and the argument of `?tier=` next door: the player's
 * setting offers three rungs and the ladder has five, so the two outside
 * it are reachable by ADDRESS rather than by menu. It is how a rung a
 * phone is not offered gets measured ON a phone, which is the only way
 * to know whether the reason it is not offered is still true.
 *
 * IT IS AN OVERRIDE, NOT A SETTING: nothing is stored and nothing
 * survives the reload that drops the parameter. And it is NOT CLAMPED —
 * a parameter typed deliberately is not an offer, and answering
 * `?detail=ultra-high` with a quietly different rung would make the
 * measurement worthless. On a phone it may well be a slideshow, which is
 * what the ladder says about that rung and is itself the measurement.
 */
export const DETAIL_QUERY_PARAM = 'detail';

/** Whether a string names a rung. Narrow, so the caller gets a `DetailTier` and not a hopeful cast. */
export function isDetailTier(value: unknown): value is DetailTier {
  return typeof value === 'string' && (DETAIL_TIERS as readonly string[]).includes(value);
}

/**
 * The rung to build with: the override when it names one, otherwise the
 * player's choice.
 *
 * A parameter that is not a rung is IGNORED rather than an error. It
 * arrives from an address bar, where a typo is ordinary, and the cost of
 * being strict is a phone that will not open the game at all — against a
 * benefit of nothing, since the HUD prints the rung actually in use and
 * a typo therefore shows up as the wrong word.
 */
export function resolveDetail(override: string | null, chosen: DetailTier): DetailTier {
  return isDetailTier(override) ? override : chosen;
}
