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

`MASTERROADMAP.md` in this repo is the long-form product vision — the
acts, the phases, and what the game is eventually for. It is
deliberately broader than the current build: a feature appearing there
does not mean it should be implemented now.

The Trello board is the shorter execution layer — what is being built
right now, acceptance criteria, bugs, ownership:
https://trello.com/b/DoBMcBRT/traddomium-micro-battle-typescript

Order when they disagree: Joshua's newest instruction, then the
roadmap, then Trello, then this file and `CLAUDE.md`.

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

### The procedural sea (dev flag, off by default)

The shipped ocean is the built-in two-wave table and stays that way
unless asked. `?sea=` swaps in the generated field described in
`src/weather/waveField.ts`, so the two can be compared on the device:

| Query                      | Sea                                    |
| -------------------------- | -------------------------------------- |
| *(none)*                   | the shipped two waves                  |
| `?sea=procedural`          | macro + meso at the default chop scale |
| `?sea=macro`               | the long swell only, no chop           |
| `?sea=meso`                | the chop only                          |
| `?sea=procedural&meso=0.6` | chop at a chosen scale                 |

Live from a probe: `__island.waves('procedural', 0.6)` rebuilds the
water and returns the report `__island.waveState()` also gives.

`npm run measure:sea` is the 60 Hz analysis (ride, reach, current,
steepness, shoaling); `npm run probe:seastage` is the on-device half
(frame cost and screenshots, needs a preview server).

The shore's depth-limited breaking envelope applies to both seas and is
measured by `npm run measure:breaker`; `npm run probe:breaker <tag>`
photographs the surf zone so two builds can be put side by side.

The camera rides the sea's SLOW half and ignores its fast half, split
per component in `seaSwell` (`heaveGain`) and carried to the camera on
the water query's `chop`. It is a spectral filter, not a temporal one,
so there is no lag to be caught out by — and every patience around it
(the envelope's, the underwater tint's) is a fraction of the sea's own
period rather than a fixed number of seconds. `npm run measure:camera`
reports what the lens does on each sea.

## Commands

```
npm install
npm run dev          # local dev server
npm test             # vitest
npm run typecheck    # tsc -b
npm run build        # production build (dist/)
npm run probe:island  # headless boot + screenshot (needs a preview server)
npm run probe:spawn   # menu → island map → spawn → death → respawn, three times
npm run probe:weather # canned storm, canned clear day, and the network refused
```

The last two want a preview server (`npm run build && npm run preview`).
`probe:weather` intercepts Open-Meteo rather than calling it: a probe
that depends on a third-party service tests that service, and cannot be
made to rain on demand.

## The weather

The sky is the real island's, and the island does not have one sky.
Waiʻaleʻale takes about 9,500 mm of rain a year while Kekaha, twenty-five
kilometres downwind, takes around 500 — the sharpest rainfall gradient
measured anywhere. Twenty-two real coordinates are read from Open-Meteo
in a single request and interpolated to wherever she is standing, so one
coast can be under a shower while the other is in the sun.

Four rules hold it together:

- **Global, always.** A station is a place on Kauaʻi. Moving the
  floating origin does not move a front.
- **One wall between real and game.** `src/weather/gameplay.ts` is the
  only crossing. She is 5.5 mm long; an ordinary 20 mph trade wind
  reaching her physics as "20" of anything would put her in the next
  valley. The game sees dimensionless dials.
- **Nothing here can stop a launch.** Live → cached → simulated, with a
  usable field before the first request exists. The offline model is
  built on the same orographic gradient, not on noise.
- **Fog is a weather effect.** Not a place to hide the streaming seam.
  Clear weather is genuinely clear, and the density is fitted to the
  meteorological definition of visibility rather than tuned by eye.

## The island

The island is real Kauai, not procedural terrain. Beyond Extinction
ships it as Terrarium height tiles baked from USGS elevation data;
`scripts/bakeKauai.py` folds those into `public/kauai-1025.bin`, a
1025-square grid of int16 decimetres.

It runs at TRUE SCALE, with one world unit to the centimetre for the
terrain as well as the ant — so 56 km of
Kauai becomes 56 m of world, and the 1592 m summit becomes 1.59 m. To
an ant that is a continent four thousand body-lengths across.

`src/world/heightfield.ts` is the single ground truth: the terrain
mesh, the walking ant, the camera's floor clamp and the tests all ask
it how high the ground is, so what you see and what you walk can never
disagree.

To re-bake from source, point the script at a Beyond Extinction
checkout: `python3 scripts/bakeKauai.py <BE-repo>/artifacts/beyond-extinction`.

The surface wears seven band textures (`public/kauai-tex/`) blended by
elevation and tiled from WORLD position — the same shape as the Godot
prototype's terrain shader. World-position tiling is not a detail: the
mesh is cut into sections, and a per-section parameterisation prints
the section grid across the island every time the tiling restarts.

It matters more than it looks. A flat-coloured surface gives the eye
nothing to measure motion against, so at ant scale a sprint and a crawl
look identical, and that reads as dull controls when the controls are
fine. A procedural noise tile (`src/world/groundTexture.ts`, baked at
boot, no asset to ship) rides on top at a tile size sharing no factor
with the band tile, so the repeat never lines up. The vertex colours
carry only shading now — soil showing through where the ground steepens,
and the macro relief mottle.

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

**Stick** — bottom-left corner, and read in the **camera's** frame:
forward is away from the view, left and right are across it. Let go
and she stops. Reverse is capped at a reverse walk however high the
pace, and cannot be sprinted.

**Steering is looking.** There is no turn control. While she is being
driven her body comes onto the camera's heading, briskly — travelling
somewhere is already a statement about which way she means to face. So
you steer by swinging the view, and because her body ends up aligned
with it, a sideways push still reads as a proper sidestep on screen:
she crabs, she does not pivot.

At **rest** she is left alone. You can look round her and she just
watches you over her shoulder; past 30° she turns, and only back to the
*edge* of that arc, because chasing the camera onto her nose would mean
she could never be looked at from the side at all.

That arc IS the lag: she settles at its edge, so whatever it is set to
is how far behind the view she permanently sits. Godot's 60° was tuned
for a mouse and read as her trailing you; 30° at a gentle ease of 3 is
the device answer. If she still feels like she is dragging, the
deadzone is the number to change, not the rate.

**Her body** is Thronemound's wingless fire ant queen — rigged, but
carrying no animations yet, so she does not stride. Her size is
MEASURED rather than typed: the mesh is scaled on load until its length
matches `bodyLength` in `castes.ts`, which makes the stat table the
authority on how big she is. The placeholder she replaced was about
14 mm against a stat sheet that says 10, so she is now visibly smaller
and correctly so.

She is playable in the placeholder from the first frame and quietly
becomes herself when the file lands; a failed load leaves the
placeholder up rather than an ant-shaped hole.

**The placeholder's legs move.** It strides in an alternating
tripod — front and back one side with the middle of the other — driven
by the ground she covers *and* the ground she turns through. Turning on
the spot with six frozen legs is most of why a rotation used to read as
a model sliding round. This is not the six-leg IK milestone; it is the
placeholder moving so the movement can be judged on the movement.

Two earlier schemes were tried and rejected on the device: slow-to-turn,
where nothing steered her above a crawl, and lean-into-the-turn, where a
diagonal push arced her round like a car. This one matches the Godot
prototype, which is the reference for how it should feel.

**Nothing snaps.** The direction she is trying to go eases, and her
speed eases onto it separately — one is "how fast does she get up to
pace" and the other is "how fast does she change her mind", and they
want different answers. Flicking the stick across used to reverse her
travel inside a single frame, and the legs are still mid-stride the old
way when that happens.

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

Once it is running, the lane collapses to a compact **🔒 AUTO ▲** chip
beside the pace column. Tapping that chip turns Auto round — **▼** hauls
her astern at the reverse cap, which is how something gets dragged, and
holding reverse across a long haul is exactly the fatigue Auto exists to
remove. It flips rather than cancels, and a fresh lock always starts
ahead. The lane itself only ever locks forward: a downward one would
have to reach below the stick, and there is not that much screen under
a thumb resting in the corner.

While Auto runs, sidestepping and looking around leave it alone; a
clear push forward or back takes manual control back. The cancel test
is which axis wins, not how far the thumb went, because a real thumb
aiming sideways lands at about `x 0.90, y 0.08`.

**Sprint** — raises the ceiling rather than adding a gear, and is the
only thing that costs anything. Picking a pace turns it off: asking for
a walk means a walk, and a sprint sitting over the top of the selection
made every pace tap look ignored. Its reserve reads as the amber ⚡
row in the vitals cluster, top left — the meters about her all live in
one place, and two gauges of the same number in two corners is one
gauge too many. All that stays on the sprint row is the row itself
going grey when there is nothing left to sprint on, which is a
statement about the button rather than a second meter. Run it dry and
she drops to the selected pace rather than stopping, Auto included; it refills on its
own, faster standing still, and the next sprint has to be *asked for
again* — a held key will not pick it back up as the bar creeps over its
re-arm mark. Per the project rule, a bar may only move if there is a
way to move it back.

**Flight** — two buttons on the action thumb, both always visible.

```
  🪽 / ⬆️   takeoff, then climb        (Space)
  ⬇️        descend, then landing      (Left Shift)
```

The design is `FLIGHT.md`: simple controls on the surface, believable
aerodynamic behaviour underneath. The stick steers horizontally, the
camera stays free-look, and the game handles airspeed, momentum, glide
and what it all costs.

**Takeoff needs a running start**, and it reads her ACTUAL speed rather
than the pace selected — picking Run and then barely moving must not
get her airborne. The threshold sits just under a full walk rather than
at it, because her ground speed eases onto the pace ceiling
exponentially and therefore approaches 7 without ever arriving. Set it
at the ceiling and a walk could never take off, only a run, which is
the opposite of the intent.

**In the air the stick flies her, not the camera.** On the ground
steering is looking; airborne, her heading is her own, so the player can
look sideways at something while she carries on flying straight. Left
and right are a COORDINATED TURN — one input, three effects, the way an
aircraft with the rudder handled for you behaves:

```
  100%  bank, to a ceiling of 30°
   70%  turn — her heading actually changes
   30%  sidestep — she slips a little across her own path
```

Level the stick and she levels out on her own, which is half of what
makes it feel like a wing rather than a cursor. The camera CHASES
gently rather than steering: leave the view where you put it and it
drifts back behind her, so free look survives without her flying out
of frame.

**Altitude is stored energy**, and it is the whole model:

```
  descend   →  airspeed rises, wings work less, the reserve refills
  climb     →  airspeed falls, wings work harder, the reserve drains
  neutral   →  a glide, not a hover: momentum carries her, and she
               pays for distance in height
```

Best glide is about 5 forward for 1 down, and the curve collapses at
low airspeed — a queen who lets her speed decay does not drift gently
down, she falls out of the sky.

**An empty reserve does not switch the wings off.** She drops to
minimum-power flight: still steerable, sinking badly, and recoverable
by diving. Height becomes a survival resource — run out high and a dive
can still save the flight; run out low and she lands.

Landing needs no button. Descend until the ground arrives.

**Camera** — drag anywhere the controls are not. It holds a **world**
bearing and stays where you put it. It cannot be bolted to her facing,
because her facing follows it: if the view chased her too, the pair
would spin.

On desktop: **W / S** manual forward and back, **A / D** sidestep,
**1 / 2 / 3** pick a pace, **Shift** sprints, **Space** jumps, **=** toggles Auto,
**Q / E** swing the camera and **R / F** lift it.

Dragging **down** lifts the view — you are pushing the view, not the
ant — and both look axes can be inverted in settings.

**Terrain height** is a dial, 10% to 150% of real Kauai. Measured off
our own heightfield, this island has a median land slope of 11.5 degrees
with a third of it steeper than 20 — Kauai is one of the most eroded,
steepest landscapes on Earth, and at ant scale the camera is a
centimetre off the ground so every fold is in your face. The dial scales
every slope by the same factor: at 50%, an 11 degree slope becomes 5.8.

It is a SCALE on the section meshes, not a rebuild, so it is instant —
and it cannot disagree with the walker, because a triangle's height
interpolates linearly between its corners and scaling the corners is the
same arithmetic as scaling the answer. The band shader divides the same
number back out, so a flattened island keeps sand at the shore and snow
on the peaks rather than going green to the summit.

**Terrain smoothing** is the other half, and it is a different lever
rather than more of the same. The height dial makes every crease
shallower *in proportion* — a 67 degree fold at half height is still 34
degrees. Smoothing removes the fold and leaves the island its size:

```
  smoothing    mean crease    worst    ground moves
      0%          4.5°        66.8°        —
     50%          3.4°        52.1°       2.9u
    100%          2.5°        23.2°       8.3u
```

**The two together are the default**, and the pairing was an accident
worth keeping: 100% smoothing with the height at 150%. Measured on the
drawn surface, that is gentler than the old default on both counts —
mean crease 2.24 degrees against 3.24, worst fold 30.2 against 46.1 —
while standing 40% taller. Smoothing takes the drama away along with
the creases; the height dial puts the drama back, and being
proportional it cannot put the creases back with it. Note that 150% is
game tuning rather than the island: it makes this Kauai steeper than
the real one.

Its far end is ten passes of a five-tap blur over the baked grid, baked
once at load; the dial blends between that copy and real Kauai. Unlike
the height scale it CANNOT be a transform — a blur mixes neighbours, so
the vertices genuinely move and every section is cut again. That takes
about 140 ms, so this one slider commits on release rather than during
the drag.

## Settings

A gear at the top right opens a panel for the numbers that are matters
of taste: turn speed, the angle at which she starts turning at rest,
how briskly she closes it, field of view, camera distance, and inverts
for look X, look Y and stick forward.

It arrived ahead of its milestone on purpose. Every one of those values
had been tuned by pushing a build and waiting for Pages — change a
number, deploy, test on the phone, repeat — and that loop was the
expensive part. A slider on the device settles the same argument in
seconds.

The defaults ARE the tuned values, so the game out of the box is the
game before the panel existed. Settings widen what is possible; they do
not decide what is good.

The panel also names the build: the version at the top, and the commit
it came from at the bottom. That is not decoration. Testing happens
against the deployed Pages build, and with nothing on screen to
identify it the honest answer to "am I looking at the new one?" was
always "probably" — a semver cannot settle that, but a commit hash can.

Choices are saved per device. What comes back is treated as untrusted:
unknown keys are dropped, wrong types ignored, and every number clamped
to its range, so an old or hand-edited store degrades to the defaults
rather than to an unplayable game. Blocked storage — a private window —
is not an error, just defaults.

## Deployment

Every push to `main` runs typecheck, tests and the production build,
then publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). The Vite `base` is relative, so the
build works from the project's Pages subpath.
