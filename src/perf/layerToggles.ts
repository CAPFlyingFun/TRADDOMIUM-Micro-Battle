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
 * `terrain` was added in Phase 2, in the same commit that made the toggle
 * real — a layer listed here before it draws anything is a control that
 * looks functional and is not (§2.9).
 */
export const BUILT_LAYERS: readonly WorldLayerId[] = ['terrain'];

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
