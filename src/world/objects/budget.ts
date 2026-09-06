/**
 * HOW MUCH OF THE WORLD THIS DEVICE DRAWS — the third of the three
 * questions, and the only one the detail rung is allowed to answer.
 *
 * Joshua, 2026-09-06: "Do NOT make graphics quality define the world.
 * Changing High → Medium → Low must not cause major trees, rocks, or
 * other persistent world objects to move to different locations." So
 * the rung never reaches the populator. It sets three things here and
 * nothing else: how far the bubble reaches, the CAP on each family
 * inside it, and how much of each family's generated density is DRAWN.
 * The objects exist where they exist; the rung decides which of them
 * this phone can afford to see.
 *
 * CAPS ARE MAXIMUMS, NOT QUOTAS. A beach at `high` does not contain
 * 25,000 blades because 25,000 is allowed; it contains what the habitat
 * puts there, which on sand is nearly nothing. The cap only bites when
 * the habitat generates MORE than the rung can draw — a grassland at
 * `high` does — and then the thinning takes the excess by RANK, highest
 * first, so the same blades go first every time and the picture does
 * not shimmer as the count hovers at the cap.
 *
 * THE NUMBERS AT `high` ARE JOSHUA'S (25,000 blades, 100 trees, 50
 * rocks, 2,000 twigs, inside 100 m). The other rungs are that set
 * scaled by the ratio of areas the rung's radius encloses, then rounded
 * to something a person can read, and they are GAME TUNING until his
 * phone says otherwise — that is what the HUD's counts are for.
 *
 * Keyed by the detail rung's NAME as a plain string literal rather than
 * importing `DetailTier` from `assets/`: `world/` is core and reaches
 * nothing outside itself but its own siblings, and a test pins these
 * keys against `DETAIL_TIERS` so the two cannot drift.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import type { ObjectFamily } from './families';

export type ObjectRung = 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high';

export const OBJECT_RUNGS: readonly ObjectRung[] = Object.freeze(['ultra-low', 'low', 'medium', 'high', 'ultra-high']);

export interface ObjectBudget {
  /** The most of each family the rung will draw inside its radius. */
  readonly caps: Readonly<Record<ObjectFamily, number>>;
  /**
   * The fraction of each family's generated density the rung draws
   * inside a family's full-density band. 1 at `high` and above: the
   * habitat's own density. Below it the near grass thins so a low rung
   * is a sparser lawn rather than a smaller one.
   */
  readonly draw: Readonly<Record<ObjectFamily, number>>;
}

export const OBJECT_BUDGETS: Readonly<Record<ObjectRung, ObjectBudget>> = Object.freeze({
  'ultra-low': Object.freeze({
    caps: Object.freeze({ grass: 1_500, twig: 150, stone: 60, rock: 8, tree: 15 }),
    draw: Object.freeze({ grass: 0.35, twig: 0.4, stone: 0.4, rock: 1, tree: 1 }),
  }),
  low: Object.freeze({
    caps: Object.freeze({ grass: 4_000, twig: 400, stone: 150, rock: 15, tree: 30 }),
    draw: Object.freeze({ grass: 0.5, twig: 0.6, stone: 0.6, rock: 1, tree: 1 }),
  }),
  medium: Object.freeze({
    caps: Object.freeze({ grass: 10_000, twig: 1_000, stone: 300, rock: 30, tree: 60 }),
    draw: Object.freeze({ grass: 0.75, twig: 0.8, stone: 0.8, rock: 1, tree: 1 }),
  }),
  high: Object.freeze({
    caps: Object.freeze({ grass: 25_000, twig: 2_000, stone: 500, rock: 50, tree: 100 }),
    draw: Object.freeze({ grass: 1, twig: 1, stone: 1, rock: 1, tree: 1 }),
  }),
  'ultra-high': Object.freeze({
    caps: Object.freeze({ grass: 60_000, twig: 4_000, stone: 1_000, rock: 100, tree: 200 }),
    draw: Object.freeze({ grass: 1, twig: 1, stone: 1, rock: 1, tree: 1 }),
  }),
});

export function isObjectRung(value: unknown): value is ObjectRung {
  return typeof value === 'string' && (OBJECT_RUNGS as readonly string[]).includes(value);
}

/** The budget for a rung named by the detail ladder. An unknown name is `medium`, and says so in the HUD by its counts. */
export function objectBudgetFor(rung: string): ObjectBudget {
  return isObjectRung(rung) ? OBJECT_BUDGETS[rung] : OBJECT_BUDGETS.medium;
}
