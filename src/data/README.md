# `src/data` — where the numbers live

Gameplay consumes these registries; it never keeps a second copy of a
number (ARCHITECTURE §2.8). `schema.ts` is the one pattern, `registries.ts`
is the ten typed registries. Both are pure: no three, no DOM, no storage.

## The pattern in one line

```
value = sampleCurve(stat.curve, growth) × (stat.scale[lifeState] ?? 1)
```

**Growth** (0..1, young → adult) is what the body can do at that size: a
five-point curve, straight lines between points, clamped at the ends.
**Life state** is what she is doing with it: a named multiplier on the
stat, 1 when the state says nothing. `statOf(registry, id, stat, growth,
lifeState)` is the only resolver. Unknown stat, unknown life state,
malformed curve — all THROW, at the read or at `register()`, so a typo can
never propagate a zero.

## Where does a number belong

| The number…                                   | goes on          |
|-----------------------------------------------|------------------|
| changes with body size (length, mass, speed)  | a caste stat's curve |
| changes with what she is doing (founding, laying) | a life-state scale on that stat |
| is a thing she can or cannot do (dig, fly)    | an ability; the caste lists which it has |
| is a property of a thing in the world         | that thing's registry (item mass, water salinity) |
| is true of every member whatever the caste    | the species |

One registry per kind. If a number seems to want two homes, it is usually
a curve (on the caste) plus a property (on the thing) being conflated.

## Adding a species

1. Export a `SpeciesEntry` from a data file (`name` for the player,
   `scientificName` for the literature). It carries no curves by default.
2. Export one `CasteEntry` per caste with `speciesId`, its `lifeStates`
   (a worker's is one long state: say so), its `abilities`, and a curve
   for EVERY stat in `CASTE_STATS`. The compiler rejects a missing or a
   misspelt stat; `register()` rejects a NaN, a negative scale, or a
   scale on a state the caste did not declare.
3. Label every number MEASURED (cite it), BIOLOGICAL SHAPE, or GAME
   TUNING (`docs/research/FIRE_ANT_BIOLOGY.md` §38).
4. The integration pass registers the exports in one place. Data files
   never register themselves on import.

## Adding an ability

An ability is discrete. Export an `AbilityEntry` with `built: false`
until the mechanic exists — the HUD reads `built` before it shows a
control as live (§2.9). The magnitude (bite damage, dig rate) is a caste
stat; add it to `CASTE_STATS` and to every caste's curves.

## Adding an item

Export an `ItemEntry` with its own properties (`massMg`, and what it
yields once food lands). An item does not grow, so its `stats` is `{}`
and both the compiler and `register()` refuse a curve there.

## The WIRED discipline

Most numbers in a data file are recorded design — real once the mechanic
exists, inert until then. When a live system starts consuming a stat:

1. Add the stat name to that registry's `defineWired(registry, [...])`
   call, written once, next to the data.
2. Keep ONE named `ReferencePoint` — "the adult mated alate", not
   "index 4" — whose `expected` values are imported from the consuming
   modules' own exported constants.
3. A test asserts `checkWired(registry, point)` equals `[]`. It reports
   every drift at once: a wired stat with no constant, a constant for a
   stat that is not wired, a value that disagrees with the game.

If the check fails, the data file is lying about the game. Fix the data
or the constant; never the test.
