/**
 * THE WORLD SEED — one number, one island, everyone.
 *
 * Joshua, 2026-09-06, asked where the seed should live and chose a
 * FIXED seed shared by every player, every slot and every room over a
 * per-save one. The reasons, so the choice is not re-litigated: the
 * island is real Kauaʻi and is the same Kauaʻi in every session; two
 * phones in one multiplayer room must see the same tree in the same
 * place or one of them is walking through it; and a per-save seed would
 * have to be STORED, which means a SoloSave version bump, which the
 * store answers by refusing every save on his phone (`persistence/store`
 * reads a wrong version as no document).
 *
 * WHAT IS PERSISTED, THEN: nothing, yet. The generated world is a
 * function of this seed, a cell address and the habitat, and it is
 * rebuilt identically every time. What a later phase saves is DELTAS —
 * "tree:12,-40:3 was felled" — keyed by the stable ids `populate.ts`
 * gives major objects. The seam for that is `WorldDelta`.
 *
 * Changing this number regrows the island. It is a constant and not a
 * registry stat because nothing tunes it: it is an identity, not a
 * quantity.
 */
export const WORLD_SEED = 0x4b41_5541; // 'KAUA', the same four letters the weather's default seed spells.

/**
 * What a saved game will one day say about the generated world: which
 * major objects are no longer as generated. The generator asks it and
 * skips what it names, so a felled tree stays felled after a reload and
 * a moved rock is not also still where it grew.
 *
 * NOTHING IMPLEMENTS IT YET — no save writes one, and the scene passes
 * `NO_DELTAS`. It exists now so that the identity every major object
 * carries has a consumer written down, and so the day something is
 * felled the generator does not have to be rewritten to notice.
 */
export interface WorldDelta {
  /** Whether a major object, by its stable id, has been removed from the world. */
  isRemoved(id: string): boolean;
}

/** The world exactly as generated. */
export const NO_DELTAS: WorldDelta = Object.freeze({ isRemoved: () => false });
