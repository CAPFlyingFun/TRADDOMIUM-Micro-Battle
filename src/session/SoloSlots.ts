/**
 * THREE SOLO SAVE SLOTS: which documents exist, which of them hold a game,
 * and which game is the newest.
 *
 * WHY SLOTS AT ALL. Phase 1 shipped one solo save and no way to start
 * over, because a PLAY that started over would have overwritten the only
 * save at its first pause with no question asked, and a data-loss path
 * with no "are you sure" is worse than no new game at all. Three slots
 * answer that properly: NEW GAME asks which slot, an occupied slot asks
 * again before it is replaced, and RESUME opens a game rather than
 * guessing that the player meant the last one.
 *
 * WHY THREE. Three fits the 430 px landscape panel as one screen of rows
 * with no scrolling, and it is enough for the thing players actually do —
 * keep a game, try something, keep the game. It is game tuning, not
 * measured biology.
 *
 * WHY SLOT 1 KEEPS THE OLD KEY. Slot 1 is stored under Phase 1's
 * single-save key, so a device that already held a game finds it as slot
 * 1 instead of losing it to a feature. Slots 2 and 3 suffix that key.
 *
 * Each slot is a WHOLE, INDEPENDENT `SoloSave` document with its own
 * version, map and camera, read through the same defensive sanitiser as
 * before: one corrupt slot costs that slot, never the other two. That is
 * the reason the slots are three documents rather than an array inside
 * one — an array makes every slot share one parse, one version stamp and
 * one chance to be refused.
 *
 * Pure over a KeyValueStore: no DOM (ARCHITECTURE §2.6).
 */
import { defineStore, type KeyValueStore, type StoreSpec } from '../persistence/store';
import { SOLO_SAVE_KEY, soloSaveSpec, type KnownMap, type SoloSave } from './SoloSave';

/** The slots a player can see, in the order they are shown. */
export const SOLO_SLOTS = [1, 2, 3] as const;

export type SoloSlot = (typeof SOLO_SLOTS)[number];

export const SOLO_SLOT_COUNT = SOLO_SLOTS.length;

/** True for a number that names a slot this build has. Guards anything read back from a document or a DOM dataset. */
export function isSoloSlot(value: number): value is SoloSlot {
  return (SOLO_SLOTS as readonly number[]).includes(value);
}

/** Slot 1 is Phase 1's key; the others suffix it. See the header for why. */
export function soloSlotKey(slot: SoloSlot): string {
  return slot === 1 ? SOLO_SAVE_KEY : `${SOLO_SAVE_KEY}.${slot}`;
}

export function soloSlotSpec(slot: SoloSlot, knownMap: KnownMap): StoreSpec<SoloSave> {
  return soloSaveSpec(knownMap, soloSlotKey(slot));
}

/** One slot as a screen shows it: which slot, and what — if anything — is in it. */
export interface SoloSlotState {
  readonly slot: SoloSlot;
  /** ISO 8601 as the game was stamped, or null when the slot is empty to THIS build. */
  readonly savedAt: string | null;
  /** The map the game is on; `''` when the slot is empty. */
  readonly mapId: string;
}

/**
 * What is in one slot. A save this build cannot open — wrong version,
 * unknown map — reads as an EMPTY slot rather than as an occupied one
 * that cannot be entered, because the store's sanitiser has already
 * refused it and a slot the player cannot open is not a game.
 */
export function readSoloSlot(kv: KeyValueStore, knownMap: KnownMap, slot: SoloSlot): SoloSlotState {
  const save = defineStore(soloSlotSpec(slot, knownMap), kv).read();
  return save.savedAt === null
    ? { slot, savedAt: null, mapId: '' }
    : { slot, savedAt: save.savedAt, mapId: save.mapId };
}

/** Every slot, in slot order — the order the picker draws them. */
export function readSoloSlots(kv: KeyValueStore, knownMap: KnownMap): readonly SoloSlotState[] {
  return SOLO_SLOTS.map((slot) => readSoloSlot(kv, knownMap, slot));
}

export function occupiedSoloSlots(states: readonly SoloSlotState[]): readonly SoloSlotState[] {
  return states.filter((s) => s.savedAt !== null);
}

/**
 * The game RESUME opens: the most recently stamped occupied slot, or null
 * when nothing is saved. A stamp that does not parse (a phone whose clock
 * was wrong) still counts as a game — the save is real — but it never
 * wins the comparison, because "newest" is a claim this module can only
 * make from a time it can read.
 */
export function newestSoloSlot(states: readonly SoloSlotState[]): SoloSlotState | null {
  let best: SoloSlotState | null = null;
  let bestAt = -Infinity;
  for (const state of occupiedSoloSlots(states)) {
    const at = Date.parse(state.savedAt ?? '');
    const rank = Number.isFinite(at) ? at : -Infinity;
    if (best === null || rank > bestAt) {
      best = state;
      bestAt = rank;
    }
  }
  return best;
}

/** The lowest slot with nothing in it, or null when all three hold games. */
export function firstEmptySoloSlot(states: readonly SoloSlotState[]): SoloSlotState | null {
  return states.find((s) => s.savedAt === null) ?? null;
}

/** Throw the game in one slot away. The other two are untouched: they are separate documents. */
export function clearSoloSlot(kv: KeyValueStore, slot: SoloSlot): void {
  kv.remove(soloSlotKey(slot));
}
