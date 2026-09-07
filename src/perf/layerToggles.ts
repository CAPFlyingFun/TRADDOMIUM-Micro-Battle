/**
 * The pure model behind the perf HUD's LAYERS column.
 *
 * One row per world layer in the world plan's order (`WORLD_LAYERS`), each
 * knowing whether this build implements it and whether it is switched on.
 * A layer the build does not implement can never be switched on: an
 * unavailable action must never look functional (§2.9), and the HUD renders
 * such a row disabled with the label "not built" from this same fact rather
 * than from a second list that could drift from it.
 *
 * Pure so the honesty rule is testable without a DOM.
 */
import { WORLD_LAYERS, type WorldLayerId } from '../world/WorldLoader';

/**
 * The layers this build can actually render in the performance world.
 * Grows with the world plan: the phase that adds a layer to the perf world
 * adds its id here, and the HUD row comes alive on its own.
 *
 * `terrain` was added in Phase 2, `ocean` in Phase 3, `freshwater` in
 * Phase 4, `vegetation` in Phase 6 (the world objects: grass, twigs,
 * stones, rocks and trees — the toggle's name is the plan's, and rocks
 * ride under it) and `weather` in Phase 5 (the HDRI dome, the sun, the
 * fog and the rain, driven by the island's real weather — the toggle
 * stops the DRAWING; the model underneath keeps running, because the
 * rivers still have to be rained on), each in the same commit that made
 * its toggle real — a layer listed here before it draws anything is a
 * control that looks functional and is not (§2.9).
 *
 * `resources`, `worms`, `aphids` and `flies` arrived together in Phase 7
 * (the ecology pass, 2026-09-07 — Joshua: "Performance World toggles per
 * category"). What each one stops when it is switched off:
 *
 *   resources   the sites stop being derived — no nectar, seed, sap,
 *               litter, honeydew host or water edge is worked out for
 *               any cell — and the creatures stop finding them, because
 *               a resource they cannot ask for is one that is not there.
 *               The HUD's line reads `sites off`, the layer's own word.
 *   worms       that species is dropped from the simulation and from the
 *   aphids      renderer: its residents go, nothing of it is generated
 *   flies       or drawn, and its line reads `0 of <cap>`. The world
 *               forgets NOTHING by it, because the population is a
 *               function of the cell (`creatures/world.ts`,
 *               `setEnabled`): switch it back on and the same worms are
 *               in the same cells.
 *
 * Each species is its own row, not one "creatures" row, so a phone can
 * switch one off and read what THAT one cost — three rigs, three
 * brains, three prices.
 *
 * IN THE WORLD PLAN'S ORDER (`WORLD_LAYERS`), not the order the phases
 * landed in: `weather` sits before `vegetation` because that is where
 * the plan puts it, and the test pins this list to that order.
 */
export const BUILT_LAYERS: readonly WorldLayerId[] = [
  'terrain', 'ocean', 'freshwater', 'weather', 'vegetation', 'resources', 'worms', 'aphids', 'flies',
];

export interface LayerToggle {
  readonly id: WorldLayerId;
  /** Does this build implement the layer? */
  readonly built: boolean;
  readonly enabled: boolean;
}

export class LayerToggles {
  private readonly built: ReadonlySet<WorldLayerId>;
  private readonly on = new Set<WorldLayerId>();

  constructor(built: readonly WorldLayerId[] = BUILT_LAYERS) {
    this.built = new Set(built);
  }

  /** Every layer in plan order, built or not — the HUD shows the whole plan. */
  list(): LayerToggle[] {
    return WORLD_LAYERS.map((id) => ({ id, built: this.built.has(id), enabled: this.on.has(id) }));
  }

  isEnabled(id: WorldLayerId): boolean {
    return this.on.has(id);
  }

  /** Returns true when the state changed. An unbuilt layer never changes. */
  setEnabled(id: WorldLayerId, enabled: boolean): boolean {
    if (!this.built.has(id)) return false;
    if (enabled === this.on.has(id)) return false;
    if (enabled) this.on.add(id);
    else this.on.delete(id);
    return true;
  }

  /** The enabled layers in plan order — the shape a `WorldDescriptor` takes. */
  enabled(): WorldLayerId[] {
    return WORLD_LAYERS.filter((id) => this.on.has(id));
  }
}
