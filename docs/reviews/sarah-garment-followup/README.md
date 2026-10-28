# The procedural tee, Stage 2 follow-up: armpit strain, neckline, bust shaping, belly (awaiting approval)

Joshua's decisions on Stage 2 (2026-10-26): keep both constructions, with raglan + gusset the default; try a narrower,
steadier raglan neckline with a band, keeping the current one to compare; keep bust shaping as a set-in option without
forcing a visible dart; find out what the 6 to 7 times stretched edges are; compare both constructions at 100% and 200%
belly on one garment each, the belly stepped up under it.

Nothing here is pushed. The garment is still only reachable through the room's probe hook (`?probe=cloth`).

## 1. The extremely stretched edges

**What they are: a constraint problem, with a small visible pinch.** They are not a measuring artefact, and the
geometry is not degenerate.

- One or two back-piece particles sat at the back of each armpit, on skin her arm bones carry about half of.
- When she raised her arms, that skin went up with the arm. The particle's floor and friction pulled it about 5 cm into
  the armpit, and the edges around it stretched 5 to 7 times.
- On the tee, this shows as a small pinched fold at the back of the armpit.

**The fix (`clothSkin.ts` `looseOverArm`, used by `garmentCloth.ts`).** It applies to a body-piece particle over skin
her arm carries more than 30% of:

- Where that skin faces level, down or only slightly up, under and behind her armpit, the particle has no floor. It
  bridges the hollow, as fabric does.
- On the top of her shoulder it keeps its floor, but her skin no longer drags it along.

The particles a body piece shares with a sleeve or gusset now move with the sleeve (`place.ts`).

| Worst edge, room, arms raised | Stage 2 | Now |
| --- | --- | --- |
| Raglan + gusset | 6 to 7x | 1.9x at most (every raglan run since) |
| Set-in | 6 to 7x | 6.7x (unchanged, see below) |

**Not fixed for set-in, on purpose.** I tried the same rule on the set-in, and it moved the problem rather than solving
it: its back piece covers the back of her shoulder up to the armhole, and her skin showed through there (sheet 1, the
bottom right pair). So the set-in keeps its Stage 2 behaviour, a small pinch at the back of the armpit with her arms up,
until it gets its own fix. The likely fix is to bind a band of the body along the armhole the way the sleeve is bound.

## 2. Raglan neckline (sheets 2 and 3)

| Variant | Neck width | Neckline length, standing → arms raised |
| --- | --- | --- |
| R0 current | 20 cm | 69.2 → 66.7 cm |
| R2: 18 cm, band at 90% | 18 cm | 61.4 → 60.4 cm |
| R3: 17 cm, 3 cm drop, band at 90% | 17 cm | 57.7 → 57.4 cm |

- **R2 is the recommendation.** It is rounder and narrower, its little points at the back neck are smaller, and its
  strain is unchanged.
- **R3 is steadier still, but its edge ripples.** The opening is too small for the band to lie flat.
- Width, drop and band are parameters, ready for Stage 3's neckline controls.

## 3. Set-in bust shaping (sheet 4)

`TeeParams.bustShaping` can be:

- `'none'`: the default.
- `'ease'`: the front's side seam is cut longer and gathered onto the back's, so there is no visible seam.
- `'dart'`: a side bust dart, with equal legs, toward her bust point.

Either shaping raises the whole upper front by 60% of what her bust needs, up to 6 cm. On Sarah that is 4 cm.

**What it does on her:**

- The dart takes the downward stretch over her bust from about 1.11 to 1.05 times its pattern length. 'ease' gets it to
  about 1.09.
- Most of the extra length ends up lowering the front hem instead.
- The dart adds a little underarm strain.
- Visually all three are very close.

**The recommendation:** keep `'none'` as the default for her, and keep `'ease'` and `'dart'` as options for characters
with a larger bust, where they should matter more.

## 4. Belly 100% and 200% (sheets 5 and 6)

Each tee was put on at 0%, then the belly was raised 10 points at a time under it, to 100% and then 200%, with no
re-tailoring.

- **100%:** both tees cover her belly and stay stable standing, with her arms raised and seated. The raglan's seated
  worst edge reached 5x where the hem folds under the belly.
- **200%:** both ride up and gather under her bust, leaving the belly bare. That is the standard size being too small,
  which you said is acceptable, and nothing tears or blows up.
- **One small flaw:** with her arms raised at 100%, a spot of skin shows through at the side of the chest on both
  constructions.

A belly allowance is a Stage 3 control.

## Tests and checks

- `tests/garmentFollowup.test.ts` (16 tests) pins:
  - bust shaping, including equal dart legs and matched side seams;
  - the seam `ease` allowance;
  - the neck band's rest lengths;
  - the `looseOverArm` rule;
  - `armpitRule`.
- `tests/garmentTailor.test.ts` pins the shared seam particles.
- The approved cloth tee does not pass `looseOverArm`, so its behaviour is unchanged.
