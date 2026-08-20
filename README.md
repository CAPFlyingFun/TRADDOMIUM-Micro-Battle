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

## Add it to your home screen

The game ships a web manifest and icons, so adding it to a phone's home
screen runs it with **no browser chrome at all** — which is worth doing,
because a browser's URL bar can overlay the top of the screen and take
the fastest notches of the throttle with it.

- iOS: Share → Add to Home Screen.
- Android: the browser's menu → Install app / Add to Home screen.

There is deliberately **no service worker**, so it is not an offline PWA.
While the game is changing daily, a cache that serves yesterday's build
is worse than a fetch. `npm run icons` regenerates the icon set.

The layout survives a browser bar either way: it sizes itself from
`visualViewport` rather than trusting the layout viewport, and the
throttle is bounded top and bottom so it shrinks instead of overflowing.
Both left-thumb controls are anchored to the BOTTOM, so a shorter window
takes height off the top of the ladder — never off the reach.

## Landscape only

On a touch device the game asks you to turn the phone sideways before it
will play. The HUD puts a stick under the left thumb and keeps the right
side clear for the action controls, and portrait has room for neither.
Desktop is never blocked, however narrow the window — a keyboard plays
fine either way.

## Controls

Three separate ideas, deliberately not merged: **pace** is the ceiling,
the **stick** is how much of it you are asking for, and **Auto** keeps
her travelling without a thumb held down.

**Pace** — bottom left, inboard of the stick. It sets how fast a FULL
push of the stick is; it does **not** move her. Choosing WALK does not
make her walk.

```
  ››››  sprint  — an override, not a pace: costs stamina
  ›››   run
  ››    walk
  ›     crawl
```

There is no Stop row and no reverse row, because neither is a maximum
forward speed: stop is letting go of the stick, and reverse is pushing
it down.

The reason for a ceiling rather than speed-by-deflection is measured,
not theoretical. A thumb-sized stick has about 64 px of travel, which
is not enough to divide into four reliable bands — the earlier build
proved that on the device. Pick a pace and the *whole* radius becomes
precision inside it.

**Stick** — bottom-left corner. Push forward and she goes, from a
creep to the full selected pace; let go and she stops. Left and right
**sidestep**: she is a six-legged animal and crabs sideways without
turning. Reverse is capped at a reverse walk however high the pace,
and cannot be sprinted.

**Auto** — drag the stick *past its rim* into the lane that appears
above it, and release on the lock.

```
        🔒        ← release here to engage
        ▲
        ▲
        ▲
     ( stick )
```

Reaching full forward does **not** engage it — full forward is just
fast, and it happens constantly, so the lane needs real extra travel
beyond the ordinary radius. Reaching the lock only *arms* it: Auto
engages when you lift your thumb inside the lock, so sliding back out
first is a free change of mind. There is no permanent Auto button —
the right side of the screen belongs to bite, grab, dig and abilities.

While Auto runs, sidestepping and looking around leave it alone; a
clear push forward or back takes manual control back. The cancel test
is which axis wins, not how far the thumb went, because a real thumb
aiming sideways lands at about `x 0.90, y 0.08`.

**Sprint** — raises the ceiling rather than adding a gear, and is the
only thing that costs anything. Run it dry and she drops to the
selected pace rather than stopping, Auto included; it refills on its
own, faster standing still, and the next sprint has to be asked for
deliberately. Per the project rule, a bar may only move if there is a
way to move it back.

**Camera** — drag anywhere the controls are not. It is independent:
she travels north while you watch a beetle to the west, and the view
stays where you put it rather than snapping back behind her.

At **stop or crawl** the camera may lead her. Pan within ~30° and
nothing happens — a few degrees of thumb must never make her wiggle —
but hold it further out and after ~0.35 s she comes round to it. Above
a crawl she holds her heading whatever the view does, **so you slow
down to turn**. That is a deliberate choice with its cost accepted;
`CATCHUP_MAX_SPEED` in `src/ant/pace.ts` is the single constant that
opens turning up at speed if it plays badly.

On desktop: **W / S** manual forward and back, **A / D** sidestep,
**1 / 2 / 3** pick a pace, **Shift** sprints, **=** toggles Auto,
**Q / E** swing the camera and **R / F** lift it.

## Deployment

Every push to `main` runs typecheck, tests and the production build,
then publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). The Vite `base` is relative, so the
build works from the project's Pages subpath.
