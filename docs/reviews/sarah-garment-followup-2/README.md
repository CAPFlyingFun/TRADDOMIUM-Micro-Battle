# The procedural tee, Stage 2 follow-up, round 2: the four checks (local, awaiting review)

Joshua approved the follow-up's direction on 2026-10-27: the raglan armpit fix, R2 as the default neckline, set-in bust
shaping as an option (none by default), and the belly results as Stage 3's baseline. Before the alpha.133 push he asked
for four checks: a proper set-in armpit fix, the chest clipping at 100% belly with her arms raised, the 5x seated-hem
edges, and R2 in movement. Nothing here is pushed.

All measurements were taken in the room, on the same garment, at the same camera, poses and timings. Strain is an edge's
length over its pattern length.

## 1. Set-in back armhole: fixed (sheet 1)

**The cause** was the same as the raglan's: the back piece by the armhole rode skin her arm moves. The raglan's rule
cannot be used on the set-in, because its back piece covers the back of her shoulder up to the armhole, and her skin
showed through it.

**The fix** is the armhole band, a set-in rule only (`TeeParams.armholeBand`, 5 cm by default). The body within 5 cm of
the armhole is bound the way the armhole seam is, to her arm or her trunk, whichever is nearer, so it moves with the
sleeve. The raglan has no armhole and is unaffected. `armholeBand: 0` gives back the Stage 2 set-in for comparison.

| Set-in, worst edge | Standing | Arms raised | Arms forward |
| --- | --- | --- | --- |
| Before (Stage 2) | 3.4x | 6.7x | 2.6x |
| After | 1.6x | 1.6x | 1.6x |

No skin shows through the cloth anywhere around the armhole.

## 2. Chest clipping at 100% belly with her arms raised: a collision problem, fixed (sheet 2)

**What it was:** a collision problem. It was not fitting, and not the render offset: the cloth itself had no hole.

- About 45 particles at the lower outer side of her bust were measuring themselves against the wrong skin. Their contact
  had stopped on the far side of the fold under her breast, 4 to 6 cm away, while her real skin was 3 to 5 mm away, on
  the other side of the cloth.
- The contact search only ever steps to a nearer triangle, so it can get stuck across a fold. The fold deepens as her
  belly grows.

**The fix** is an opt-in contact rescue (`clothSkin.ts` `rescueOver`, which the garment turns on at 2 cm):

- A particle more than 2 cm from its contact is looked at again, a share of particles each frame.
- The search covers the triangles around its own contact and around its cloth neighbours' contacts.
- If it finds nearer skin, it moves the contact there.

The approved cloth tee does not turn it on.

**Result:** the patch is gone on both constructions, from both sides, and the worst edge with her arms raised at 100% is
1.7x. A few particles still sit 2 to 4 cm from their contact elsewhere, and none of them shows.

**Cost:** in node, cloth skinning rises by about 1 to 2 ms a frame on this computer. The iPhone benchmark is Stage 5.

## 3. Seated hem at 100% belly (raglan): an isolated contact pinch, explained rather than forced (sheet 3)

**What it is:** a contact pinch. It is not an instability, and the cloth is not tearing.

- When she sits with her hands on her thighs, her right forearm crosses the side of her hip. The forearm collider holds
  the hem's back corner out about 5 cm while the rest of the hem lies on her.
- That one row of edges stretches up to 5x. It goes back to 1.5x as soon as she stands.

**Tested:**

- Turning the forearm colliders off removes the stretch: the worst edge drops to 1.95x. But then the tee rides up off her
  belly, and her forearm would pass through the cloth.
- Moving the thigh colliders, or stopping her legs' skin from dragging the hem, made no difference. Those changes are not
  kept.

**Recommendation:** keep the forearm colliders. This is one pinched corner in one pose. The belly allowance and seated
behaviour in Stage 3 are the right place to come back to it, for example a longer or looser hem, or colliders the hem can
slide along.

| Seated, worst edge | 0% belly | 100% belly |
| --- | --- | --- |
| Raglan | 2.4x | 5.1x |
| Set-in | 3.4x | 5.1x |

With the smoother creases of section 5, the set-in's hem catches on her forearm the same way the raglan's does.

## 4. R2 in movement: stable (sheet 4)

| R2 neckline length round | Standing | Arms raised | Arms forward | Elbows bent | Seated | Standing again |
| --- | --- | --- | --- | --- | --- | --- |
| cm | 61.4 | 60.3 | 60.7 | 61.1 | 62.2 | 61.4 |

It moves 1.9 cm at most and comes back to where it started. The edge shows no ripples or pinching.

R0 is still `neckWidth: 0.20, neckBand: 1`. The set-in keeps its own Stage 2 neckline (`SET_IN_NECK`).

## Checks

- Typecheck, relay typecheck, the full test suite, the build and the boot probe all pass.
- `tests/garmentFollowup.test.ts` (29 tests) now also pins:
  - `teeParams` and the R2 defaults;
  - the armhole band, against a band of 0;
  - the contact rescue, including its cloth-neighbour start and how it decides to look again.

## 5. The waist crease, after Joshua's notes (sheet 5)

Joshua circled a sharp crease at the side of her waist (100% belly, arms raised). He asked for smooth creases, with no
fold limits ("shirts don't have limits"), and for a slight offset or collision so the cloth doesn't cross itself.

**The fix has two parts:**

- **The cloth keeps clear of itself** (`clothSim.ts` `selfDistance`, 5 mm for the garment). Where it folds onto
  itself, its layers rest on each other instead of passing through. It runs once a frame, and her skin and the colliders
  have the last word.
- **The fabric bends ten times stiffer than the room's tee.** Creases round over several rows instead of breaking sharp
  across one edge.

**Result:** the sharp pinch at the side of her waist is now a rounded roll. A soft roll also forms under her bust.

| Folds sharper than 70° (count) | A: layers apart only | B: layers apart + stiffer bend |
| --- | --- | --- |
| Raglan, arms raised, 100% | 231 | 141 |
| Raglan, seated, 100% | 450 | 249 |
| Set-in, arms raised, 100% | 221 | 173 |
| Set-in, seated, 100% | 642 | 193 |

**Cost:** the simulation takes about 2 ms more a frame in node on this computer.

**Her body is never hidden.** The probe hook that could hide it is gone. Every review picture shows the shirt on her
as worn: her base body is always visible, and the clothes deform on top of it.

## 6. Her navel and nipples under the shirt, after Joshua's notes (sheet 6)

Joshua saw her nipples and navel poking through the shirt, and asked for the method the cloth tee uses.

**The fix is the cloth tee's own method** (`garment/garmentDetail.ts`):

- Her navel and each nipple get a dome. It stands in for her skin under the cloth: flat over the tip, then falling
  smoothly to her body. The cloth can only rise along the detail's axis, so it can't slide off the tip.
- Friction is carried over the dome the same way the cloth tee carries it.
- Nothing about her is hidden. Her body and its shape are unchanged, and the shirt clears her by itself.

**Why the first dome still let one through.** The detail point recorded for each nipple is not its tip. The tip
vertices stand about 3 mm higher, so a dome built at the recorded point's height let the tip through: the small
pink dot. The dome now finds the tallest of the vertices around each detail every frame, and stands 0.5 mm above it.

**Gap between the cloth and the tip** (cm; below 0 means the tip is through the cloth):

| Raglan | Before: nipples / navel | Now: nipples / navel |
| --- | --- | --- |
| 0%, standing | about -0.5 / clear | +0.10 / clear |
| 100%, standing | about -0.5 / -0.59 | +0.10 / +0.10 |
| 100%, arms raised | about -0.5 / -0.33 | +0.10 / +0.10 |

- The before figures were measured at the recorded detail point (-0.1 to -0.3). The tip stands another 3 mm higher.
- The set-in gives the same results: +0.08 to +0.11 on every pose.
- At 100% belly when she is seated, the shirt rides above her navel, so there is nothing to measure there.

**A second check, from the camera.** For every close-up, I cast a ray from the camera to each vertex of her torso and
checked whether her skin stands in front of the cloth. On both constructions, at 0% and 100%, in every pose, nothing on
her chest, bust or belly does. The only hits are her hands and forearms over the hem when she is seated. That is the
contact pinch from section 3, not her skin coming through the shirt.

## 7. BREAST and NAVEL DETAIL sliders, the same as the cloth tee (sheet 7)

Joshua asked whether the navel and nipple sliders still work, and said the procedural shirt should look and behave
exactly like the sim shirt that is pushed. It now uses the cloth tee's own rules, read from the same two sliders:

| | Cloth tee (`clothShirt.ts`) | Procedural garment (`garmentDetail.ts`) |
| --- | --- | --- |
| Navel dome | always whole; widens as NAVEL DETAIL goes down | the same |
| Nipple dome | as high and as wide as BREAST DETAIL hides | the same |
| Drawn through the fabric | `DetailSpots.cloth(keep)` via `clothDetail.ts` | the same call on its material |
| Her navel softened under it | 1 − NAVEL DETAIL | the same (`clothFlatten` counts the garment) |

**The one addition is a safety floor.** Under every slider setting, the cloth still clears her real nipple tip (section
6). At full BREAST DETAIL the dome drops to nothing, as on the tee, and the cloth shows the nipple's shape, but never her
skin through it. That floor fades out over the outer half of the dome, so there is no step at its edge.

**Results:**

- At 0%, 50% and 100% on both sliders, at 0% and 100% belly, both constructions keep +0.1 cm over her nipple tips. The
  camera check finds no skin in front of the cloth.
- At 0% the bust is smooth. At 100% the nipples show as shape, and the navel shows as a small dimple, as on the tee.

**Her outie didn't show, and the hem crept up at 100% belly.** Both had one cause: the garment didn't grow with her.

- The cloth tee is cut again for her shape whenever her belly or build changes (`ClothShirt.refit`, "a maternity tee").
  The procedural garment kept its 0% cut, so at 100% it was too small for her. Its hem sat at her navel and crept up
  past it over about 10 seconds, so the outie had no fabric over it to show through.
- The fix: the garment is now cut for her the same way (`GarmentCloth.refit`). Each edge of the pattern grows by as much
  as her skin under it has grown since the garment was tailored. The drafted design is kept, and the particles stay
  where they are.
- Now the hem stays down at 100% (held for 10 seconds, sliders moved throughout), and her outie shows as a bump, just
  as on the cloth tee.

**A second fix the outie needed.** At 100% belly the dome's flat top over her navel (0.9 cm) was narrower than the cloth's
spacing there (about 1.4 cm). Her navel came up through a triangle whose corners stood beside it. The flat top is now
at least as wide as the longest edge of cloth near the tip (`GarmentDetail.spacing`), so every triangle over the tip
clears it. The gap is now measured on the sheet itself, along the axis through the tip, not only at the particles.

| Gap over the tip, cm | Navel at 0% / 50% / 100% NAVEL DETAIL | Nipples |
| --- | --- | --- |
| Raglan, 100% belly | +0.49 / +0.49 / +0.36 | +0.10 to +0.11 |
| Set-in, 100% belly | +1.44 / +0.79 / +0.47 | +0.10 to +0.13 |

The camera check finds no skin in front of the cloth in any of them. At 0% belly the set-in hangs off her navel by about
2 cm, so nothing of it shows through, as it would under a loose tee.

**Still different from the cloth tee: the fabric.** The cloth tee wears the room's fabric (here, red jersey through the
Fabric panel), laid on by the fitted tee's material. The procedural garment still has its own plain cream material.

## 8. The navel's shape and shading, made smooth (sheet 8)

Joshua: "Can you double check the shape/shadowing around the bellybutton? It doesn't look smooth like the other sim
shirt."

**What it was.** Taking the drawn relief off for a moment (a probe switch) showed that the hard shapes were the drawn
relief, not the cloth. On the cloth tee, a narrow relief sits on fabric that forms a small cone over her navel. On this
garment at 100% belly the triangles over her navel are 2 to 3 cm across, too coarse to form that cone. The same narrow
relief on a smooth sheet read as a sticker: a hard highlight over a crisp dark oval.

Two of my own earlier choices made it worse:

- The flat top over the tip was widened to the longest nearby edge, and that edge was a 3.7 cm fold. It made a mesa
  7 cm across, with a rim you could see.

**The fix:**

- **The dome is the cloth tee's again.** Only the three corners of the cloth's triangle over the tip are held at the
  tip's height (`GarmentDetail.cover`, `domeOver`'s `lift`). The cloth forms a tent over her navel, as the tee's does,
  and still clears it.
- **The navel's relief is drawn half as wide again** (`SHADE_NAVEL_GROW`, 1.5), with its height kept, to suit the coarser
  cloth.
- **No relief is drawn steeper than 1 in 2** (`SHADE_SLOPE`), so its far side never turns from the light at a hard edge.
- **A relief spreads as the cloth stands farther off its tip** (`SHADE_SPREAD`). Fabric lying off a bump shows it
  wider and shallower.
- Her nipples are unchanged: their relief was never steep enough to be capped.

**Result:** the outie reads as a soft bump under the fabric at 100% NAVEL DETAIL and fades smoothly as the slider goes
down. Every tip is still covered:

| Gap over the tip, cm, 100% belly | Navel at 0% / 50% / 100% | Nipples |
| --- | --- | --- |
| Raglan | +0.44 / +0.26 / +0.10 | +0.10 to +0.11 |
| Set-in | +0.54 / +0.10 / +0.10 | +0.10 to +0.13 |

The camera check finds no skin in front of the cloth anywhere, on either construction, at 0% or 100% belly.

## 9. The bellybutton made like the red cloth tee's (sheet 9)

Joshua: "It doesn't match the red shirt and not a definite shape… Look at the red shirt. Made the new shirt also the same
red color and compare." Then, to be clear: it is the bellybutton he means; the nipples were right and are unchanged.

**Same fabric.** The garment now wears the cloth tee's own material, so whatever the Fabric panel puts on the cloth tee
it puts on the garment too (here, red jersey). It gets the fabric's rest surface from where it was laid round her
(`GarmentCloth`'s `fabricRest`). The cloth tee's neckline and trim cuts on that material are switched off while the
garment is on.

**The definite shape.** On the cloth tee, her outie at full NAVEL DETAIL is a cone: one point of cloth over her navel and
the cloth falling from it to her skin.

- The garment does the same now. The cloth point nearest the navel's axis is laid on the axis and held there, as the
  cone's apex (`GarmentDetail.apexOver`).
- The apex is held high enough that the cloth falling from it clears every vertex of her navel, each checked under the
  triangle of cloth over it (`apexHeight`). Her navel's whole shape is read within its outer ring.
- The relief drawn through the fabric is the cloth tee's own again (section 8's softening knobs are off by default).

**Tried and set aside:** meshing the cloth finer round her navel (4 mm). The finer patch buckled into lumps.

**Result:** at 100% belly the outie is a cone with a soft shadow under it, as on the red cloth tee, smaller at 50% and
flat at 0%. At 0% belly it is a faint dimple, as on the tee. Every tip stays covered, and the camera check finds no skin
through the cloth:

| Gap over the navel's tip, cm | 0% / 50% / 100% NAVEL DETAIL, 100% belly | 0% belly |
| --- | --- | --- |
| Raglan | +0.50 / +0.35 / +0.16 | +0.19 to +0.31 |
| Set-in | +0.77 / +0.20 / +0.10 | +0.42 to +0.63 |

Nipples: +0.10 everywhere, unchanged.
