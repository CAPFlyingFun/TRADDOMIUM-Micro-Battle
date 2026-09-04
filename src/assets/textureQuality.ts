/**
 * THE TEXTURE LADDER: five square sizes, and which of them a phone may
 * be offered.
 *
 * Joshua set the rungs on 2026-09-04, comparing his own v0 build against
 * Path of Titans on the same phone: "maybe it's how it's optimized to
 * keep in mind while we are programming". Nothing samples a texture yet —
 * the world is a grid and two capsules — so this file is the DECISION,
 * recorded before there is any content to bake, so that the first texture
 * that arrives is authored to a ladder rather than a ladder being
 * reverse-engineered from whatever the first texture happened to be.
 *
 * EACH RUNG IS A QUARTER OF THE ONE ABOVE IT. Texture memory goes as the
 * square of the side, so halving the side is a quarter of the bytes; a
 * ladder of powers of two is what the GPU wants anyway (mipmaps, and on
 * older mobile GPUs non-power-of-two textures lose mipmapping and wrap
 * modes entirely). `textureBytes` computes the cost rather than asserting
 * it, mipmaps included — the 4/3 is the sum of the mip chain, 1 + 1/4 +
 * 1/16 + …
 *
 * ULTRA HIGH IS NOT FOR PHONES, and that is the whole reason the flag
 * exists. One 2048² RGBA texture is 16 MiB, about 21 MiB with its mip
 * chain: a handful of them is a mid-range phone's entire texture budget,
 * and the failure is not a slow frame but a browser tab the OS kills.
 * `MOBILE_TIERS` is what a phone may be offered; ULTRA_HIGH is desktop
 * only, and the honesty rule (CLAUDE.md) says a control that would kill
 * the tab must not be offered as though it were a choice.
 *
 * THE PLAYER'S SETTING IS NOT THIS LADDER. `ui/settingsStore.ts` offers
 * three levels — low, medium, high — and today NOTHING READS THEM: the
 * quality select is a stored preference with no consumer. `tierFor` is
 * the one mapping from that setting to a rung, so when a loader finally
 * honours it there is a single place where "high" means 1024. The two
 * extra rungs are deliberately outside the player's three: ULTRA_LOW is
 * a fallback for a device that cannot hold the low tier, and ULTRA_HIGH
 * is for a desktop build. `tests/assetsTextureQuality.test.ts` pins the
 * mapping against `QUALITY_LEVELS` so the two lists cannot drift apart.
 *
 * WHAT IS NOT DECIDED HERE: how the baked files are NAMED. There is no
 * texture pipeline yet, and inventing `bark.1024.png` before anything
 * bakes one would be a convention nothing had to obey. The rung sizes
 * are the decision; the naming belongs with the bake step that produces
 * them (`scripts/bakeArt.mjs` is where that would go).
 *
 * Pure: no three, no DOM. A number and a name are not a texture.
 */

/** Coarsest first, so the array reads as a ladder you climb. */
export type TextureTier = 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high';

export const TEXTURE_TIERS: readonly TextureTier[] = Object.freeze([
  'ultra-low',
  'low',
  'medium',
  'high',
  'ultra-high',
]);

export interface TextureTierSpec {
  readonly tier: TextureTier;
  /** Pixels along one side. Square and a power of two, for mipmaps and for older mobile GPUs. */
  readonly size: number;
  /** What a player would read in a menu. */
  readonly label: string;
  /**
   * Whether a PHONE may be offered this rung. False is not a warning to
   * be clicked through — it means the tier is absent from the choices a
   * phone build shows.
   */
  readonly mobile: boolean;
  /** Why this rung exists, in one sentence, for whoever reads the menu code next. */
  readonly note: string;
}

export const TEXTURE_QUALITY: Readonly<Record<TextureTier, TextureTierSpec>> = Object.freeze({
  'ultra-low': Object.freeze({
    tier: 'ultra-low',
    size: 128,
    label: 'Ultra low',
    mobile: true,
    note: 'The floor. For a device that cannot hold the low tier, and the size a distant LOD can drop to.',
  }),
  low: Object.freeze({
    tier: 'low',
    size: 256,
    label: 'Low',
    mobile: true,
    note: "The player's LOW. Safe on an old phone with several textures resident at once.",
  }),
  medium: Object.freeze({
    tier: 'medium',
    size: 512,
    label: 'Medium',
    mobile: true,
    note: "The player's MEDIUM, and the sensible default for a phone.",
  }),
  high: Object.freeze({
    tier: 'high',
    size: 1024,
    label: 'High',
    mobile: true,
    note: "The player's HIGH, and the highest a phone is offered: about 5.6 MiB a texture with mipmaps.",
  }),
  'ultra-high': Object.freeze({
    tier: 'ultra-high',
    size: 2048,
    label: 'Ultra high',
    mobile: false,
    note: 'DESKTOP ONLY. About 21 MiB a texture with mipmaps — a handful is a phone’s whole budget, and the tab is killed rather than slowed.',
  }),
});

/** The rungs a phone build may offer, coarsest first. `ultra-high` is not among them. */
export const MOBILE_TIERS: readonly TextureTier[] = Object.freeze(
  TEXTURE_TIERS.filter((tier) => TEXTURE_QUALITY[tier].mobile),
);

/** The highest rung a phone may be offered. */
export const MAX_MOBILE_TIER: TextureTier = 'high';

/**
 * Bytes one RGBA texture of this tier occupies on the GPU. `mipmapped`
 * adds the whole mip chain, which is what a sampled texture actually
 * costs — the chain sums to 4/3 of the base level.
 *
 * Uncompressed on purpose: a compressed format (ASTC, ETC2, S3TC) is a
 * fraction of this, but which formats a device has is a runtime
 * question, and a budget written against the worst case is the one that
 * does not get a tab killed.
 */
export function textureBytes(tier: TextureTier, mipmapped = true): number {
  const side = TEXTURE_QUALITY[tier].size;
  const base = side * side * 4;
  return mipmapped ? Math.round((base * 4) / 3) : base;
}

/** The size in pixels along one side. */
export function textureSize(tier: TextureTier): number {
  return TEXTURE_QUALITY[tier].size;
}

/**
 * The rung the player's three-level quality setting means.
 *
 * Kept as plain string literals rather than importing `Quality` from
 * `ui/settingsStore`: assets/ has no business importing a screen's
 * document, and the test pins these keys against `QUALITY_LEVELS` so
 * they cannot drift apart anyway.
 */
export const TIER_FOR_QUALITY: Readonly<Record<'low' | 'medium' | 'high', TextureTier>> = Object.freeze({
  low: 'low',
  medium: 'medium',
  high: 'high',
});

export function tierFor(quality: 'low' | 'medium' | 'high'): TextureTier {
  return TIER_FOR_QUALITY[quality];
}

/**
 * The rung to actually use: the player's choice, held down to what the
 * platform may be offered. A desktop build passes `mobile: false`.
 *
 * It clamps rather than refusing, because a setting carried over from
 * another device — a save synced from a desktop, a URL shared between
 * phones — must not leave the player with a black screen and no way
 * back. What they chose is remembered; what runs is what fits.
 */
export function tierToUse(tier: TextureTier, mobile: boolean): TextureTier {
  if (!mobile || TEXTURE_QUALITY[tier].mobile) return tier;
  return MAX_MOBILE_TIER;
}
