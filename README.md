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

## Landscape only

On a touch device the game asks you to turn the phone sideways before it
will play. The HUD puts a stick under the left thumb and keeps the right
side clear for the action controls, and portrait has room for neither.
Desktop is never blocked, however narrow the window — a keyboard plays
fine either way.

## Controls

**Throttle** — a ship's telegraph on the left edge, and the only speed
control. It is a *setting*: pick a notch and she holds it, so crossing
an island that takes minutes needs no separate auto-move mode to arm
and cancel. Tap any notch to go straight there, which makes easing off
one step and slamming from a sprint to astern the same gesture.

```
  ››››  sprint   — costs stamina
  ›››   run
  ››    walk
  ›     crawl
  ■     stop
  ‹     reverse crawl
  ‹‹    reverse walk
```

Reverse only goes as fast as a crawl or a walk; an ant hauling
something backwards is not sprinting. The fill runs from the Stop line
out to the live notch, so ahead and astern read as opposite directions
rather than more or less of the same thing, and the readout underneath
gives her speed in cm/s — one world unit is about a centimetre.

**Stamina** — sprinting is the one notch that costs anything, and the
sprint notch doubles as its meter. Run it dry and she eases down to a
run rather than stopping dead; it refills on its own whenever she is
not sprinting, and faster still standing still. Per the project rule, a
bar may only move if there is a way to move it back, and this one has
one that needs no mechanic that does not exist yet.

**Steering** — a fixed stick, bottom left, which aims her and nothing
else. Push and she comes round to that heading at a rate the throttle
sets: she pivots freely at Stop and takes a wide line at a sprint. Let
go and she holds her heading.

A push dead astern does *not* spin her a direction nobody chose — at a
half-turn neither way round is shorter, so with no lean to read she
holds her heading. Lean the push to one side and she comes round that
way; to actually travel backwards, use an astern notch.

On desktop, **W** and **S** work the telegraph and **A** / **D** steer,
which is the arrangement the warship games settled on.

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
