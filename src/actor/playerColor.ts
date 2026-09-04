/**
 * Which colour a player's capsule wears.
 *
 * Colour is the one thing that tells two capsules apart on screen
 * (ActorState), so it has to be the SAME on every client and after
 * every reload without anyone sending it: a pure function of the
 * PlayerId. The id is hashed with FNV-1a in integer arithmetic
 * (`Math.imul`, exact in every JavaScript engine — v0's `stableHash`
 * lesson: `Math.sin`-based mixing is not required to agree to the last
 * bit between two phones) and the hash picks from a small fixed palette.
 *
 * A palette rather than a hue wheel because eight colours a player can
 * NAME beat three hundred and sixty they cannot: "the amber one" is how
 * two players talk about a third. The colours are chosen to read against
 * the Performance World — a grey-blue horizon, dark grid lines, a gold
 * centre line — and against each other. Two players in eight can still
 * collide; that is the authority's problem to resolve when a session has
 * more players than colours, not this function's to hide.
 *
 * Pure: no three, no DOM.
 */
import { HEX_COLOR } from './ActorState';
import type { PlayerId } from './PlayerId';

/** Lower-case `#rrggbb`, as `ActorState.color` requires. Order matters: it is part of the mapping. */
export const PLAYER_PALETTE: readonly string[] = Object.freeze([
  '#e4572e', // vermilion
  '#ffb400', // amber
  '#3ddc84', // green
  '#2f8fff', // azure
  '#c34aff', // violet
  '#ff5da2', // pink
  '#00d1d1', // cyan
  '#f4f1de', // bone
]);

/** FNV-1a, 32-bit, over UTF-16 code units. Unsigned so the modulo below is never negative. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The palette slot a player lands in. Exposed so a lab can show "slot 3 of 8" beside the swatch. */
export function paletteIndexFor(player: PlayerId): number {
  return fnv1a(player) % PLAYER_PALETTE.length;
}

/** Stable per player, valid for `ActorState.color`, identical on every machine. */
export function colorFor(player: PlayerId): string {
  const color = PLAYER_PALETTE[paletteIndexFor(player)];
  // The palette is checked at module load by its test; this guard is the same promise at runtime.
  if (!HEX_COLOR.test(color)) throw new Error(`playerColor: palette entry ${JSON.stringify(color)} is not #rrggbb`);
  return color;
}
