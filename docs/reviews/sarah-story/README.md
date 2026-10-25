# Sarah v2 in TMB-Story's Watch

Joshua, 2026-10-24: "add this new Sarah into the TMB-Story so I can watch Sarah and see how it looks."

The Sarah in the Watch is the one he saved in the Sarah Lab (`src/sarahlab/sarahLook.ts`):
- the v2 body at 73%, navel +20;
- the red light spandex tee (athletic swatch 8) over the painted charcoal leggings;
- her face rig and her hair.

## The file

`public/models/sarah-v2-story.glb` is 4.7 MB. TMB-Story carries it as `assets/models/sarah-v2.glb`.

`scripts/sarahV2Recovery/story-sarah.mjs` bakes it from the running Lab (`?open=CharacterRoom&bake=story`, `src/sarahlab/storyBake.ts`):
- The GPU runs her own materials and shader patches, and the bake reads back what they computed:
  - positions and normals per vertex;
  - her body's colour, surface and normal maps, leggings paint included.
- Nothing about her look is re-implemented, so the file cannot drift from the Lab.
- The bake starts from `sarah-v2-body-slim.glb`, so the skeleton, skin and inverse bind matrices are that file's to the byte.
- It is deterministic and fails on its own self-checks.
- Rerun it whenever her look changes.

What is in it:

| Part | Vertices | Triangles |
|---|---:|---:|
| Body (`Material_0`, plus the painted islands as `sarahPaint`) | 115,710 | 208,592 |
| Fitted tee | 20,705 | 31,999 |
| Hair | 17,012 | 28,020 |

There is one `storySeat` corrective (the Lab's seated belly shape). The body node's `storySarah` extras say what she was baked at.

## What the Watch does with it

All of this is in TMB-Story's `visual/engine/people3d.js`, with this game's rig, face rig, face animator and hair patch bundled into `visual/vendor/three-human.js`:
- **Poses.** Her walk and her sit are posed for her bump, as the Lab poses her: the settled pregnant sit, and shorter, wider steps. `storySeat` blends in as she sits.
- **Face.**
  - Her eyes go where her head is aimed: the other person's eyes, or a monitor. They look idly about when nothing draws them.
  - She blinks, and her eyes stay shut while she sleeps.
  - Her jaw moves while her own line is heard.
- **Arms.** Her master hangs its arms down, where Jack stands in a T. The scenes' elbow and wrist moves (a talking hand, a point, a wave) are carried into the hanging arm's frame, as `humanSeated.ts` does. Jack's arms are unchanged.
- **Hair.** Her hair's cards are lit from the side they face.
- **Comparing.** `?sarah=toon` brings back the toon Sarah.

Not in the Watch: the cloth simulation. She wears the fitted tee, skinned.

## Sheets

- `01-watch-chapter1-before-after.jpg`: four moments of Chapter 1, the toon Sarah against Sarah v2. The two "talking" moments have her jaw moving and, standing, her talking hand up.
- `02-face-and-poses.jpg`: her face under the Watch's own lights:
  - eyes on the viewer, talking, looking aside, blinking;
  - standing, and the settled sit from the side and the front.
- `03-other-chapters.jpg`: Chapters 2, 4, 6 and 10. All ten 3D chapters were loaded with her: each reports the 3D people ready, with no page errors.
- `04-on-their-marks.jpg`: the scene-code fixes Joshua asked for (2026-10-25: "check that Jack and Sarah's position doesn't randomly change places and that it matches the scene"). It shows Chapter 1 before and after (Jack no longer rolls across in front of Sarah's screen; her hand rests on her thigh), Chapter 2 at the window (walked round the consoles), and Chapter 9 outdoors (Jack back in the shot). TMB-Story decision 0038 has the frame-by-frame audit behind it.
