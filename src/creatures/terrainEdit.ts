/**
 * THE ONE DOOR TO THE GROUND — the terrain-edit seam, no-op until the
 * voxel milestone builds it.
 *
 * THE RULE (Joshua, 2026-09-07, the ecology pass): only EXPLICITLY
 * AUTHORISED actors may change the terrain —
 *
 *   player ants, AI ants, burrowing creatures (through this seam), and
 *   tools or systems explicitly granted the right;
 *
 * and these NEVER do —
 *
 *   water, rain, rivers, ocean, weather, walking, vegetation growth,
 *   aphids, flies. WATER NEVER CARVES OR ERODES THE TERRAIN in v1.
 *
 * And his instruction for this milestone, verbatim in spirit: "If the
 * voxel terrain contract is not yet implemented, do not invent a second
 * private worm-only terrain deformation system. Leave the worm's
 * burrowing edit behind that shared contract." There is no voxel
 * contract in v1 yet — `world/heightfield.ts` is a read-only survey and
 * the standing rule is "the terrain is not ours to move" — so this file
 * is the contract's shape and `NO_BURROW_EDITOR` is its implementation.
 * The worm burrows (moves under the surface, surfaces, casts) and the
 * ground does not change, and the HUD can say so, because
 * `BurrowEditor.built` is a fact and not a hope (§2.9).
 *
 * WHAT THE SEAM IS SHAPED FOR. A burrower reports where it bored and how
 * wide, in world units, and the editor answers whether anything changed.
 * The editor owns the ground; the creature owns nothing of it. When the
 * voxel milestone lands, the integration pass constructs the real editor
 * with the same three arguments and the simulation, the species data
 * and the tests do not change.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { WorldPoint } from '../world/coords';

export interface BurrowEditor {
  /** Does the build implement terrain editing at all? An unbuilt editor is honest about it. */
  readonly built: boolean;
  /**
   * A burrower has moved through the ground here. `height` is the bore's
   * centre above mean sea level and `radius` its half-width, world units.
   * Returns true when the ground changed.
   */
  bore(at: WorldPoint, height: number, radius: number): boolean;
}

/** The editor this build has: none. The worm burrows; the survey stands. */
export const NO_BURROW_EDITOR: BurrowEditor = Object.freeze({
  built: false,
  bore: () => false,
});

/**
 * Wrap an editor so that only a species the table names as an editor
 * reaches it, and count what it did — the simulation's one gate. Every
 * bore from a non-editor is refused before the editor hears of it, so a
 * bug that let an aphid dig would fail here, in core, in a test.
 */
export interface BurrowGate {
  readonly editor: BurrowEditor;
  /** Bores forwarded to the editor since construction. */
  readonly attempted: number;
  /** Bores the editor said changed the ground. */
  readonly applied: number;
  /** Bores refused because the caller was not an authorised editor. */
  readonly refused: number;
  bore(canEditTerrain: boolean, at: WorldPoint, height: number, radius: number): boolean;
}

export function burrowGate(editor: BurrowEditor = NO_BURROW_EDITOR): BurrowGate {
  const gate = {
    editor,
    attempted: 0,
    applied: 0,
    refused: 0,
    bore(canEditTerrain: boolean, at: WorldPoint, height: number, radius: number): boolean {
      if (!canEditTerrain) {
        gate.refused += 1;
        return false;
      }
      gate.attempted += 1;
      const changed = editor.bore(at, height, radius);
      if (changed) gate.applied += 1;
      return changed;
    },
  };
  return gate;
}
