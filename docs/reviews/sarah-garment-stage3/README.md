# The new tee's controls, Stage 3 (local, awaiting review)

Joshua, 2026-10-28: "Good to do stage 3 now", and to the plan's six changes, "Yes to all questions." The plan is the
Claude doc "Stage 3 plan · the new tee's controls". Nothing here is pushed.

## What it does

Every control in the plan works on the new tee in the OUTFIT tab, and saves with the outfit.

- **Instant** (the tee she has on is cut while you drag): LENGTH (Crop, Standard, Tunic, Mini, Knee), FRONT HEM and
  BACK HEM (±8 cm), HEM CURVE, SLEEVE (Tank, Cap, Short, Elbow, Three-quarter, Wrist), NECKLINE DEPTH deeper than the
  approved scoop, and BELLY ROOM.
- **Re-tailor** (the pattern is drafted again when you let go; the tee she has on stays until the new one is ready):
  NECKLINE DEPTH higher than the scoop, NECKLINE WIDTH, NECK SHAPE (U to V), BUST, WAIST and HIP FIT, CONSTRUCTION and
  GUSSET.
- **Live**: the cloth dials, now shown for the new tee too, and saved with it.
- **TEE DEFAULTS**: every control back to the approved tee, in the construction she has on.

The tee is drafted to its full extent, to her knee and her wrists. The length below the drafted hem and cuffs is extra
pieces, sewn on and cut away until a setting asks for them, so the default tee is the alpha.135 tee: the same pieces,
points and fit.

## Sheets

All on your phone held upright (430 × 932, DPR 2), bump 73% unless a sheet says otherwise.

1. `1-length.jpg`: Crop, Standard, Tunic, Mini, Knee and a stop between, front and side.
2. `2-hips.jpg`: the three dresses at her hips, close.
3. `3-hems.jpg`: FRONT HEM +5 with BACK HEM −3, and HEM CURVE 100% at Standard and at Mini.
4. `4-sleeves.jpg`: every sleeve stop, and Tank and Cap from under her arm.
5. `5-neckline.jpg`: scoop, crew, U 10 cm, deepest U, deepest V, 12 and 6 cm V raised from it, U 12 cm, width 26 cm.
6. `6-belly-room.jpg`: BELLY ROOM 0, 60 and 100% at bump 0% and 50%.
7. `7-fit-construction.jpg`: loose fit (6/8/8 cm), bust −2 cm, set-in, and set-in Knee with Wrist sleeves.
8. `8-seated.jpg`: Knee, Mini and Standard seated.
9. `9-save.jpg`: an outfit saved, TEE DEFAULTS pressed, the outfit worn again from the save. It came back with every
   setting as saved.
10. `10-hips-why.jpg`: why the dresses stand out at her hips (below).
11. `11-neckline-brought-up.jpg`: a V raised from the deepest one, before and after the fix.
12. `12-seated-fix.jpg`: the Knee dress and the Standard tee seated, before and after the fix (same run).
13. `13-default-tee.jpg`: the default tee at 0, 41, 67, 100 and 200% belly, alpha.135 beside Stage 3.
14. `14-necklines-smooth.jpg`: the scoop (the default) and the crew, before and after the follow-up below.
15. `15-necklines-cut.jpg`: a 10 cm U, and a 6 cm V raised from a 12 cm one, before and after.
16. `16-sit-knee-side.jpg` and `16-sit-knee-34.jpg`: the Knee dress through the 5-second sit, the old cut and the
    straight one.
17. `17-sit-mini-standard.jpg`: the Mini dress and the Standard tee through the 5-second sit.

## Follow-up, 2026-10-28: necklines, and sitting down

Joshua, on sheets 5 and 12: "Make sure all the necklines are smooth lines (not jagged edges) and even on both sides",
and "a knee high dress shouldn't rise up more than mid-thigh… we probably need to add a smooth procedural standing to
sitting that lasts about 5s, and then see if from standing to sitting the sim does the dress correctly".

- **Necklines are smooth and even** (sheets 14 and 15). The neckline is held where the tee settled on her, so it kept
  every crumple the dressing left in it, and one side sat higher than the other. When the tee settles, the band within
  3 cm of the neckline is now made the same on both sides, and its crumples are smoothed out before it is held there.
  What is smoothed is how the cloth lies against where it belongs, not the cloth's shape. Wherever it would still
  stretch an edge past 1.4 times its pattern length (or past what it already was), it does less there: smoothed
  without that, the back neckline's edge cut its corners at her shoulders and was held at 1.8 times its length. A neckline brought up from a deeper one gets the same pass for the cloth that comes back, which took the
  step out of the side of the raised V. A cut neckline's hold on her may also lift across a dip in her skin, never
  pull further into one.
- **STAND to SIT and back is a 5-second move** (sheets 16 and 17). Her joints turn from one pose to the other, eased in
  and out, and her feet stay where she stood while she lowers back onto the stool. The tee or dress stays on her and is
  simulated the whole way, rather than being laid on her again in the seated pose. Pressing STAND part way down turns
  her back up from where she is. Other pose switches are instant, as before.
- **The dress skirt falls straight from her hips** (sheet 16). Below the widest point of her hips the dress followed her
  thighs in, a pencil skirt about 80 cm round above her knee, and sitting slid it up to where her thighs fit. It now
  falls straight down from her hips, as a plain dress skirt is cut. Measured as how far down her thigh the front of the
  skirt reaches seated (0 her hip joint, 1 her knee), after the 5-second sit:

| Knee dress | Standing | Seated |
| --- | --- | --- |
| Old cut (pencil) | 1.03 | 0.52 to 0.56 |
| Straight | 1.03 | 0.58 to 0.59 |

  So seated it ends just below mid-thigh. Halfway down it is still at 0.96 (the pencil cut was already at 0.63). The
  Mini seated reaches 0.52 to 0.56 of her thigh (0.46 standing), and the Standard tee stays over her lap.
- **The default tee's neckline changes slightly**: it is now the smooth, even curve on sheet 14. The same probe as the
  table below, against alpha.135:

| Belly | Folds over 60°, alpha.135 | Follow-up | Strain max, alpha.135 | Follow-up |
| --- | --- | --- | --- | --- |
| 0% | 71 | 90 | 1.56 | 1.54 |
| 41% | 69 | 84 | 1.56 | 1.49 |
| 67% | 68 | 83 | 1.56 | 1.49 |
| 100% | 66 | 76 | 1.56 | 1.49 |
| 200% | 96 | 111 | 1.56 | 1.58 |

  The most stretched edge is a little shorter at every size but 200%. There are 10 to 20 more sharp folds. As the room
  opens they are on her upper chest and shoulders (4 more there; none at the neckline itself). The shots differ from
  alpha.135's by under one colour step on average, and side by side I could not see where they are.

## Found and fixed on the way to these sheets

- **The dress's side seam made a point at the hem's corner.** The extension met the tee's side seam at an angle, so the
  cloth gathered into a cone at the corner (14.8° of it). It now joins along the side seam's own direction: 1.7°.
- **Tank and Cap left a slit under her arm.** The gusset was dropped whole and left the side 6 cm open. Its lower half,
  the half sewn to the body, now stays, so the armhole closes under her arm.
- **A U neckline read as a V.** Its bottom is now a quarter ellipse.
- **A cut neckline pinched into the hollow between her breasts.** Held to her skin, the edge across the hollow was
  pulled down into it in teeth. It is now let off wherever holding it would stretch it: the worst edge went from
  2.6–3.4 times its length to 1.6 or under.
- **A V raised from a deeper one came back wide and torn at its point** (sheet 11). Dressed with a deep V, nothing held
  its sides as the tee was put on, so they parted over her breasts, and the cloth the V had taken away was bound as that
  edge lay. The tee is now put on with the drafted neckline and the cut neckline is taken once it has settled, from
  cloth that lay on her. The cloth it took keeps where it lay, and cloth that comes back is placed from where the cloth
  round it was held. The 12 cm V raised from the deepest went from an edge at 4.0 times its length to 1.55; the 6 cm V
  from 2.8 to 1.55.
- **Seated, the front dipped into her lap** (sheet 12). Laid on her afresh as she sits, the front of the tee and of a
  dress started inside her thighs, where they rise to her belly. Her thigh capsules were inside her skin and started
  35% of the way down her thigh, so nothing put it out. They are now her thigh's own size, from by her hip joint. The
  front now lies across her lap, with more soft folds there (the Standard tee seated: 211 over 60° before, 325 after).

## The default tee has not moved

The same probe as alpha.135's review (bump dragged from 73%), same views:

| Belly | Folds over 60°, alpha.135 | Stage 3 | Strain max (both) |
| --- | --- | --- | --- |
| 0% | 71 | 70 | 1.56 |
| 41% | 69 | 69 | 1.56 |
| 67% | 68 | 67 | 1.56 |
| 100% | 66 | 65 | 1.56 |
| 200% | 96 | 95 | 1.56 |

The 95th-percentile strain is within 0.0004 at every size, and the shots differ by less than a fifth of a colour step
on average (sheet 13).

## Cost

- **Opening the room**: the tee is on her 0.3 s later (15.1 s alpha.135, 15.4 s Stage 3, median of three, on the review
  computer's software renderer). That is the full-extent tee tailored once.
- **A re-tailor**: 2.1 to 2.7 s from letting go to the new tee on her, on the same renderer.
- **While she wears it**: the Standard tee simulates 5,389 points, as alpha.135. Knee with Wrist sleeves (set-in)
  simulates 9,120, 69% more; a Crop with Tank sleeves fewer.

## Known, and next

- **The dresses stand out at her hips** (sheets 2 and 10). A tee is shaped only at its side seams, so the curve of her
  hips gathers there. It does not show at Standard length, but past her hips it stands out as a pouch on each side. A
  one-piece dress drafted by the tee's own rules to the same hem does the same, so it is the cut, not the extension.
  Proposed: hip darts in the front and back below the waist, or let FLARE (Stage 4) take it.
- **Seated, a dress still rides up to just below mid-thigh** (sheet 16). The skirt now falls straight, and sitting
  takes up its length over her lap and under her seat. FLARE (Stage 4) widens a skirt further, so it can lie over her
  knees.
- **A small step where the sleeve meets the front neckline** (sheets 14 and 15, at each shoulder). It is the corner of
  the pattern where the raglan sleeve's top joins the neckline; it is the same on both sides, and shows most on a cut U
  or V.
- **TEE DEFAULTS after a long session** can tailor a tee a point or two different along one edge (5,391 points rather
  than 5,389). Tailoring reads her body as it stands, and that had changed by a hair since the room opened. It does not
  show.

## Checks

- Garment and cloth tests: 14 files, 320 tests. New tests:
  - cloth a neckline brings back is laid and bound where it lay;
  - a cut neckline is taken once the garment has settled;
  - what a cut neckline took keeps its binding.
  Each was checked to fail without its fix.
- Follow-up, new tests: the neckline settles smooth and even without stretching its band; the skirt falls straight from
  her hips (both constructions); the 5-second sit's timing, easing and joint blend. The first two were checked to fail
  without their fix.
- Full suite (follow-up): 4,692 tests: 4,689 pass, 3 skipped.
- typecheck, relay:typecheck, build and probe:boot all pass.
- Her body file is unchanged: sarah-v2-body.glb 47e990f0…7f42.
- The stage probe: every control and view on these sheets, 2,968 s headless, no page errors.
