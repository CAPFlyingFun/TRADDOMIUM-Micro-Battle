/**
 * THE ONE DOOR TO THE GROUND — the terrain-edit seam, shared voxel layer, with a no-op fallback.
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
 * Alpha.27 implements this seam with the shared world/SparseSoil field.
 * NO_BURROW_EDITOR remains the truthful fallback for unbuilt worlds and
 * remote sessions without authoritative terrain replication. Neither the
 * creature nor its renderer owns a separate soil system.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { WorldPoint } from '../world/coords';
import type { SoilPoint } from '../world/soilTypes';

export interface BurrowEditor {
  /** Does the build implement terrain editing at all? An unbuilt editor is honest about it. */
  readonly built: boolean;
  /**
   * A burrower has moved through the ground here. `height` is the bore's
   * centre above mean sea level and `radius` its half-width, world units.
   * Returns true when the ground changed.
   */
  bore(at: WorldPoint, height: number, radius: number, from?: SoilPoint): boolean;
}

/** Unbuilt/remote-world fallback: never silently make private terrain edits. */
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
  bore(canEditTerrain: boolean, at: WorldPoint, height: number, radius: number, from?: SoilPoint): boolean;
}

export function burrowGate(editor: BurrowEditor = NO_BURROW_EDITOR): BurrowGate {
  const gate = {
    editor,
    attempted: 0,
    applied: 0,
    refused: 0,
    bore(canEditTerrain: boolean, at: WorldPoint, height: number, radius: number, from?: SoilPoint): boolean {
      if (!canEditTerrain) {
        gate.refused += 1;
        return false;
      }
      gate.attempted += 1;
      const changed = editor.bore(at, height, radius, from);
      if (changed) gate.applied += 1;
      return changed;
    },
  };
  return gate;
}
