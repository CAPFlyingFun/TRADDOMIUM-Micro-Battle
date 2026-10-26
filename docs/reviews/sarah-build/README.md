# Her height and proportions (alpha.131, approved)

Joshua's request, 2026-10-26: "let's add a height adjuster so you can raise or shorten the length of the legs, hips, arms, hands and more basic body controls as well as maybe you can create some common female shape profiles. I would say maybe the max/min per section is +/-30cm from the default positions."

He approved the sheets: "Go ahead and push."

His choices on the questions that followed:

- **Lengths in cm, small parts as a size %.** Legs, arms, torso and neck move in centimetres; head, hands and feet scale by percent.
- **HEIGHT spread over her legs and torso.** It lengthens her legs, torso and neck in their own proportions. Head, hands and feet keep their size.
- **The classic five profiles:** hourglass, pear, apple, rectangle and inverted triangle.

## In the room

The new section is **BODY › HEIGHT & PROPORTIONS**, first in the Body tab (sheet 6). It is called proportions on screen because the room's **Build** tab is the strap builder's.

- **The five profiles** come first. Each sets her shoulders, waist, hips and bust size and leaves everything else as it is. The button lights while she matches it.
- **HEIGHT** (−30 to +30 cm) shows her standing height with the slider: `1.80 m · 5 ft 11 in`. It is shared over her upper legs, lower legs, torso and neck in proportion to their lengths, so they add up to exactly the height asked for. Her arms grow by the same factor, so a taller Sarah's fingertips still reach where they did.
- **Lengths**, each added on top of HEIGHT's share:

  | Control | Range (cm) |
  |---|---|
  | Upper legs | −18 to +30 |
  | Lower legs | −20 to +30 |
  | Torso (hips to under the bust) | −8 to +27 |
  | Neck | −6 to +12 |
  | Upper arms | −13 to +26 |
  | Forearms | −11 to +22 |

  He suggested ±30 cm a section. A length may shrink to half of itself and grow by the smaller of 30 cm and its own length; her forearm is only 22 cm long. The torso stops at −8 cm (see below). When HEIGHT and a length's own slider together reach a limit, the line says `at its shortest` or `at its longest` instead of looking as if it still moved.
- **Widths:**
  - Shoulders: −6 to +10 cm (the arms are carried out with them).
  - Waist: −25 to +35 %.
  - Hips: −20 to +30 % (the upper thighs come with them).
- **Sizes:** Head, Hands and Feet, −30 to +30 % each. Her hair grows with her head.
- **RESET PROPORTIONS** puts these back as approved.
- Every control is an ordinary body control. Saves, the library, undo/redo and RANDOMIZE all carry them; RANDOMIZE has a PROPORTIONS group lock and per-control locks and ranges. An older save loads as the approved build.
- Standing, walking or in T-pose, she is lifted so her soles stay on the floor (longer legs, bigger feet). Seated, the stool does it as before.

## How it works

Nothing in her files changes. The approved body, its maps and its shapes are byte for byte as they were, and the approved build changes nothing at all: every bone and every vertex comes back bit for bit.

- **`src/actor/bodyBuild.ts`**: the arithmetic, with no three.js.
  - Turns the controls into amounts: metres added to each segment, girth fractions and size factors.
  - Splits HEIGHT, applies the limits and computes her standing height.
  - Holds the five profiles.
- **`src/view/bodyBuild.ts`**: applies the amounts to her.
  - **Her bones** take offsets along each segment, and her head, wrists and ankles take a scale. Her clothes and hair share her skeleton, so they come along.
  - **Her skin**, and every garment's, takes a stretch field in rest space. Without it the skin would tear where two bones' weights meet. With it, the skin between two joints stretches evenly.
  - **Her normals** are turned to match the stretch, so the lighting follows the new shape.
  - **Waist and hips** are measured from her 0% shape. Her base mesh carries the 100% bump, and measured from that the waist control made a square bump. The front of her waist moves half as much as the sides, so her bump rides out with a wider waist rather than being stretched sideways.
  - **Her feet and hands** grow smoothly up the shin and forearm, so there is no ledge at the ankle or wrist.
- **The room** (`SarahLabScene.ts`) wires it in:
  - the section, profiles and labels;
  - fields for every mesh she wears;
  - the lift onto her soles.

## What the renders caught along the way

- **The joints were measured 100× too small**, because three.js keeps one of a skin's matrices in world space and the room scales her ×100. The unit tests ran on an unscaled scene and could not see it. Fixed, and a test now loads her under a ×100 parent.
- **A jagged layer on her upper arm at long arms.** This came from the alpha.130 crease repair. Its zone round her chest takes in her upper arms, and it was looking for folds in her rest shape without her bones. With a build, that rest shape is only whole once the bones are added, so the repair "untangled" folds that were never drawn. The repair now looks at her shape as her bones carry it (`bodyCrease.ts`, `shift`), with a test. The cloth tee's pattern had the same blind spot and is now cut on the same shape (`clothSkin.ts`, `restShift`).
- **Torso shortened by half folded her belly** at 0%, 100% and 200%. At −8 cm it was clean, so the torso's slider stops at −8 and its combined floor is 30%. HEIGHT −30 still gives 1.40 m.
- **Fixed in the stretch itself:**
  - A seam behind the knee and the elbow at the shortest legs and arms.
  - A ledge at the Achilles with big feet.
  - A crease behind the armpit with wide shoulders.
  - A "spare tire" on the apple profile.
- **Checked, and it is right: the tee doesn't really ride up.** In her red tee at HEIGHT +20, the tee seems to ride up her bump. Measured on her, the tee's hem moves exactly with the skin under it (within 0.04 cm). It covers the same part of her, and what grows below it is her bump, stretched with her torso.

## Sheets

- `1-height-and-lengths.jpg`: approved, HEIGHT ±30, legs, torso (+15 and −8), arms, neck; front and side.
- `2-sizes-and-widths.jpg`: head, hands and feet at both ends; shoulders, waist and hips wide and narrow.
- `3-profiles-belly-0.jpg`: the five profiles at belly 0%, front and three-quarter.
- `4-profiles-belly-100.jpg`: the five profiles at 100%.
- `5-in-her-clothes.jpg`: her red tee and leggings, taller and shorter, seated and walking.
- `6-the-panel.jpg`: the section on the phone.

## Left as it is

- **Upper arms at their shortest (−13 cm):** a crease at the back of each armpit. Her shoulder bone's weight changes too sharply there for a stretch to tell her arm's skin from her side's. It would need her shoulder weights smoothed in the body file.
- **Neck and head at their extremes** blend sharply where her weights do, at the back of the neck and under the jaw. Her hair covers the back of the neck in every render.
- **The story bake** (`?bake=story`) does not carry proportions yet. It refuses a non-approved build with a clear message rather than writing a torn file.
- **The room's camera does not reframe** for a taller Sarah. At 2.00 m her head reaches the title in the portrait view; zoom or pan as usual.
- **The profiles' numbers are a first tuning**, by eye:

  | Profile | Shoulders | Waist | Hips | Bust size |
  |---|---|---|---|---|
  | Hourglass | +1 | −12 | +10 | +20 |
  | Pear | −3 | −4 | +18 | −15 |
  | Apple | +1 | +22 | −4 | +15 |
  | Rectangle | 0 | +12 | −6 | −10 |
  | Inverted triangle | +7 | +2 | −10 | +15 |

## Checks

- typecheck passes.
- Every test passes (4,334), including the new ones in `bodyBuild.test.ts` (18), `bodyBuildView.test.ts` (15) and `bodyCrease.test.ts` (1).
- `bodyBuildView.test.ts` loads her real body. It checks:
  - exact joint moves;
  - no crossings at her elbows, knees and ankles at the extremes;
  - the edge-stretch table;
  - normals;
  - the ×100 parent.
- Build passes.
- Renders: about 150 shots across seven rounds.
