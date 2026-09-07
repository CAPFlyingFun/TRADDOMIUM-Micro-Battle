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
 * THE SEVEN OF THE ECOLOGY PASS (2026-09-07) SHARE ONE MOBILE BUDGET:
 * together they add at most 6,000 instances at `high` — a quarter of
 * the grass's cap, for seven kinds of thing — because the brief's
 * standing condition is the phone's baseline ("~55–60 fps on an iPhone
 * 15 Plus"), and Joshua's rule is that sacrificing graphics on mobile
 * beats amazing graphics with horrible performance. Litter gets the
 * most (it is the forest floor, and the smallest geometry); shrubs the
 * fewest (they are somebody, and cost forty triangles each). The lower
 * rungs are those numbers scaled the way the first five are, and
 * `ultra-high` doubles them, as it doubles everything.
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
    caps: Object.freeze({
      grass: 1_500, twig: 150, stone: 60, rock: 8, tree: 15,
      fern: 50, reed: 60, flower: 100, leaf: 200, shrub: 40, broadleaf: 60, coastal: 40,
    }),
    draw: Object.freeze({
      grass: 0.35, twig: 0.4, stone: 0.4, rock: 1, tree: 1,
      fern: 0.4, reed: 0.4, flower: 0.4, leaf: 0.4, shrub: 1, broadleaf: 0.4, coastal: 0.4,
    }),
  }),
  low: Object.freeze({
    caps: Object.freeze({
      grass: 4_000, twig: 400, stone: 150, rock: 15, tree: 30,
      fern: 120, reed: 160, flower: 250, leaf: 500, shrub: 80, broadleaf: 160, coastal: 100,
    }),
    draw: Object.freeze({
      grass: 0.5, twig: 0.6, stone: 0.6, rock: 1, tree: 1,
      fern: 0.6, reed: 0.6, flower: 0.6, leaf: 0.6, shrub: 1, broadleaf: 0.6, coastal: 0.6,
    }),
  }),
  medium: Object.freeze({
    caps: Object.freeze({
      grass: 10_000, twig: 1_000, stone: 300, rock: 30, tree: 60,
      fern: 250, reed: 350, flower: 550, leaf: 1_200, shrub: 150, broadleaf: 350, coastal: 200,
    }),
    draw: Object.freeze({
      grass: 0.75, twig: 0.8, stone: 0.8, rock: 1, tree: 1,
      fern: 0.8, reed: 0.8, flower: 0.8, leaf: 0.8, shrub: 1, broadleaf: 0.8, coastal: 0.8,
    }),
  }),
  high: Object.freeze({
    // The seven sum to 6,000 exactly: the mobile budget of the header.
    caps: Object.freeze({
      grass: 25_000, twig: 2_000, stone: 500, rock: 50, tree: 100,
      fern: 500, reed: 700, flower: 1_100, leaf: 2_300, shrub: 300, broadleaf: 700, coastal: 400,
    }),
    draw: Object.freeze({
      grass: 1, twig: 1, stone: 1, rock: 1, tree: 1,
      fern: 1, reed: 1, flower: 1, leaf: 1, shrub: 1, broadleaf: 1, coastal: 1,
    }),
  }),
  'ultra-high': Object.freeze({
    caps: Object.freeze({
      grass: 60_000, twig: 4_000, stone: 1_000, rock: 100, tree: 200,
      fern: 1_000, reed: 1_400, flower: 2_200, leaf: 4_600, shrub: 600, broadleaf: 1_400, coastal: 800,
    }),
    draw: Object.freeze({
      grass: 1, twig: 1, stone: 1, rock: 1, tree: 1,
      fern: 1, reed: 1, flower: 1, leaf: 1, shrub: 1, broadleaf: 1, coastal: 1,
    }),
  }),
});

export function isObjectRung(value: unknown): value is ObjectRung {
  return typeof value === 'string' && (OBJECT_RUNGS as readonly string[]).includes(value);
}

/** The budget for a rung named by the detail ladder. An unknown name is `medium`, and says so in the HUD by its counts. */
export function objectBudgetFor(rung: string): ObjectBudget {
  return isObjectRung(rung) ? OBJECT_BUDGETS[rung] : OBJECT_BUDGETS.medium;
}
