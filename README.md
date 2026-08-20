# TRADDOMIUM: Micro Battle!

A 3D Battle/Growth Survival Simulator with different game modes, quests,
and gameplay to play.

**Play the current build:**
https://capflyingfun.github.io/TRADDOMIUM-Micro-Battle/

A direct-control ant survival RPG in a huge tiny world, built with
three.js + TypeScript + Vite for the browser (mobile landscape first).

The colony is the persistent home and identity, but the player directly
controls ONE individual ant at a time. Individual ants can die; the
colony and the world continue.

Influences (influence, not copying): Path of Titans (direct creature
control), ARK (living ecosystem, hard stat tradeoffs), Smalland
(ordinary nature as enormous terrain).

## Design source of truth

The Trello board is the living design document:
https://trello.com/b/DoBMcBRT/traddomium-micro-battle

This is a CLEAN REBUILD. Requirements, research, art and lessons from
the earlier implementations are reused; code is written fresh, one
focused development scene at a time, each with an integration gate
before the next layer.

Rebuild order (see "The spine" card): 01 movement, 02 input + camera,
03 six-leg IK, 04 digging, 05 carry, 06 HUD, 07 combat, 08 AI wildlife,
09 colony/nest, 10 hatch/tutorial, 11 polished mini-world.

## Development scenes

Every approved system gets a permanent lab reachable via `?scene=`:

| Scene    | URL              | Covers                                  |
| -------- | ---------------- | --------------------------------------- |
| `island` | `/?scene=island` | 01 movement + 02 input/camera (default) |

## Commands

```
npm install
npm run dev          # local dev server
npm test             # vitest
npm run typecheck    # tsc -b
npm run build        # production build (dist/)
npm run probe:island # headless boot + screenshot (needs a preview server)
```

## The island

The island is real Kauai, not procedural terrain. Beyond Extinction
ships it as Terrarium height tiles baked from USGS elevation data;
`scripts/bakeKauai.py` folds those into `public/kauai-1025.bin`, a
1025-square grid of int16 decimetres.

It runs at 1:1000, with one world unit to the centimetre — so 56 km of
Kauai becomes 56 m of world, and the 1592 m summit becomes 1.59 m. To
an ant that is a continent four thousand body-lengths across.

`src/world/heightfield.ts` is the single ground truth: the terrain
mesh, the walking ant, the camera's floor clamp and the tests all ask
it how high the ground is, so what you see and what you walk can never
disagree.

To re-bake from source, point the script at a Beyond Extinction
checkout: `python3 scripts/bakeKauai.py <BE-repo>/artifacts/beyond-extinction`.
Its band textures (`public/kauai-tex/` in Thronemound) are not used yet
— the terrain is vertex-coloured by elevation for now.

## Controls

**Move** — a fixed stick, bottom left. How far you push it picks the
gait as well as the direction: near the centre is a crawl, the rim is a
run. That is the whole movement control; there is nothing to toggle and
nothing to lock. On desktop, WASD and the arrow keys read as full
deflection, so the keyboard always runs.

**Throttle** — the notched bar on the left edge is a READOUT, not a
control. Nothing on it is tappable; it exists so the stick's analog
gait is never invisible, showing a level that rises through the notches
as she pushes harder. The glyphs (snail / ant / bolt) are placeholders
standing in for real art.

**Camera** — drag anywhere the controls are not. There is no camera
button: it would spend a slot the action controls will want, and a drag
is unambiguous because controls claim their own pointers first. Taps are
left free for grab, dig and bite later. The view eases back behind her
when you let go. On desktop, Q / E swing and R / F lift.

## Deployment

Every push to `main` runs typecheck, tests and the production build,
then publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). The Vite `base` is relative, so the
build works from the project's Pages subpath.
