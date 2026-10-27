# The procedural tee, Stage 2: pattern, fit, raglan beside set-in (alpha.132, approved as experimental)

Joshua's brief, 2026-10-26: one procedural garment family (crop top to dress, sleeveless to wrist), drafted from Sarah rather than modelled. Stage 2 asked for the flat pattern (2a), then the standard tee on her and raglan sleeves with a gusset compared against set-in sleeves "using equivalent measurements, settings, camera angles, and animations" (2b): "Please don't assume raglan is automatically better."

He approved it as an experimental foundation: "I'm happy to approve Stage 2 for an experimental push. Please keep the new garment isolated behind the existing probe/experimental entry point." Both constructions stay: raglan + gusset is the default, and set-in remains a construction option.

## What it is

`src/sarahlab/garment/` takes her body (her rest shape at 0% belly), measures it, drafts the pieces flat, meshes them, welds the seams, lays the sewn sheet round her and runs it as cloth.

| Step | Module | On her |
| --- | --- | --- |
| Measure | `measure.ts` (with the armhole loop) | bust 95.0, waist 72.1, hip 104.6 cm |
| Draft | `draft.ts`, `develop.ts`, `form.ts`, `curves.ts` | front, back, two sleeves (+ two gussets) |
| Mesh, sew, check | `mesh.ts`, `sew.ts` | 1 sheet, 4 openings, no flipped or non-manifold edges |
| Lay on her, bind | `place.ts`, `bind.ts`, `tailor.ts` | about 1.5 s in all |
| Wear | `garmentCloth.ts`, `capsules.ts`, `roomGarment.ts` | the room's cloth, with arm, leg and stool capsules |

The yoke is drafted along her surface rather than her height (`develop.ts`): her front is 30.8 cm of surface from the underarm line to her shoulder ridge, against 20.3 cm of height.

## Where it shows

Only through the room's probe hook: open the Character Room with `?probe=cloth` and call `__sarahLabCloth.garment('raglan' | 'setIn', gusset)`. The room never puts it on her by itself. The approved cloth tee, her body, the outfits, the default outfit and the seated fallback are unchanged.

## What was measured (room, same cameras, poses and timings, bump 0%)

| Underarm strain, 95th percentile | Raglan + gusset | Set-in |
| --- | --- | --- |
| Standing | 1.17 | 1.27 |
| Arms raised | 1.21 | 1.32 |
| Arms forward | 1.22 | 1.21 |
| Seated | 1.18 | 1.31 |

The raglan never passed 1.34 under the arms; the set-in reached 1.43. The set-in keeps the rounder, steadier neckline. Frame cost on the review computer: cloth tee 23.4 ms, set-in 22.0 ms, raglan + gusset 24.1 ms, arm capsules about 1 ms more.

## Sheets

1. `1-pattern-raglan-gusset.jpg`, `2-pattern-set-in.jpg`: the flat pieces, every edge named with its length and particles, seams coloured in pairs.
2. `3-sewn-wireframe.jpg`: the sewn sheet on her, her body hidden.
3. `4-standing.jpg`, `5-neckline.jpg`, `6-arms-raised-underarms.jpg`, `7-arms-forward-underarms.jpg`, `8-seated.jpg`: raglan + gusset on the top row, set-in below.

The full review, with every view and table, is the Claude doc "Procedural garment family: Stage 2 review".

## Known, and next

- One or two back-piece particles at the back of each armpit stretch to 5 to 7 times their pattern length when her arms are raised (a small tent inside the armpit). They sit on skin her arm bones carry half of. This is being worked on in the follow-up, with the narrower raglan neckline, set-in bust shaping, and the 100% and 200% belly comparison.
- Stage 3: the controls (lengths, sleeves, neckline, hems, belly allowance, fit, construction) and saving with outfits.
