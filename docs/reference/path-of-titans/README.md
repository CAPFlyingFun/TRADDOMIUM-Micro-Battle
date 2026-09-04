# Path of Titans, on a phone — a HUD and performance reference

Six screenshots Joshua took on 2026-09-04 and asked to keep for "when we
get to the actual gameplay and HUD".

*Path of Titans* is a dinosaur survival MMO built in Unreal Engine. These
were taken on **iPhone, landscape, with every graphics setting on its
lowest**, and Joshua's note about them was two things at once:

> the older version (v0) was running a little choppy but consistent, haha,
> but Path of Titans is from Unreal Engine and runs a lot smoother
> (although all set on lowest settings, but still looks good, probably
> different coding language — haha) so maybe it's how it's optimized to
> keep in mind while we are programming the game to keep everything
> optimized.

So they are here for two reasons, not one: **how the HUD is laid out**,
and **what a smooth mobile build gives up to stay smooth**.

## They are the same canvas we design for

Every one is **2796 × 1290 physical pixels**, which on an iPhone Pro Max
at 3× is **932 × 430 logical points** — *exactly* TMB's design canvas
(CLAUDE.md, and what `probe:boot` and `probe:bot` measure at). Nothing has
to be rescaled to compare: an icon that is 44 points across there is 44
points across here, and a panel that fits there fits here.

Divide any pixel measurement in these images by **3** to get points.

## What they are not

Reference, not assets. This is somebody else's game: nothing in these
files is copied into TMB, no icon is traced, no layout is reproduced. They
are here to be looked at and argued with, the way the ocean screenshots
and the blueprint images on Trello are.

## Format

Saved as **quality-92 progressive JPEG at full resolution** — 4.8 MB for
all six, against 29.5 MB for the original PNGs. That is not a corner cut
blind: the smallest text on screen (the quest panel, top right of `01`)
was cropped 1:1 from both the PNG and the JPEG and compared, and the two
are indistinguishable. A 25 MB saving in every clone of this repository,
for ever, is worth more than bytes nobody can see.

Original filenames are kept in each name, so a shot can be matched back to
Joshua's camera roll: `01-IMG_3641.jpg` … `06-IMG_3646.jpg`.

## The rules these get read against

TMB's own standing rules come first; a screenshot is evidence, not an
instruction. When the two disagree, ours wins and the disagreement is
worth writing down.

- **Controls belong to the thumbs, not the screen.** Screen space near the
  thumbs is the scarcest resource and action controls have first claim.
  Before adding a control, check whether a gesture can carry it.
- **The HUD is contextual, not a permanent inventory of every action.** An
  unavailable action must never look functional; an unbuilt one need not
  be on screen at all.
- **A meter may only move if there is a way to move it back.**
- Movement is settled: camera-relative stick, pace as a **ceiling**,
  steering is looking.

## Where the performance half of this lands

The texture ladder Joshua set in the same message is recorded in
[`src/assets/textureQuality.ts`](../../../src/assets/textureQuality.ts) —
five rungs from 128² to 2048², each a quarter of the memory of the one
above, with 2048² marked desktop-only because a handful of them is a
phone's whole texture budget. `tests/assetsTextureQuality.test.ts` holds
the arithmetic.

The place to *measure* any of this is the Performance World
(`src/perf/`, ARCHITECTURE §9): raw frame time and simulation dt as two
separate numbers, one toggle per world layer, so each layer's cost can be
read on a real phone rather than guessed at. That scene exists precisely
so "it feels choppy" can become a number.

## The six

| | What it shows |
|---|---|
| `01` | Shaggy quadruped on a sandstone ledge over a fogged canyon. The full resting HUD, nothing mid-interaction. |
| `02` | Over-the-shoulder on the same creature. Twenty-two round buttons on screen at once. |
| `03` | A small critter at the canyon lip, camera high and behind at ~25-30° depression. |
| `04` | **An insect** — black-and-yellow, green gaster, long antennae — on a pale boulder. |
| `05` | A large predator standing on a carcass, with a contextual eat/interact prompt up. |
| `06` | **The insect again**, with two survival meters and a contextual prompt captioning a button. |

`04` and `06` are the valuable ones: the same engine, the same phone, an
arthropod as the player character. They are the closest thing to a
photograph of the problem we are actually solving.

## What all six agree on

These are the findings that turned up independently in shot after shot.
They carry more weight than anything seen once.

**No joystick is drawn. Ever.** The bottom-left quadrant is empty in all
six — no stick graphic, no ring, no base. The movement control is
invisible and appears where the thumb lands. TMB already works this way
(`perf/FreeFlyCamera.ts`: a drag that STARTS on the left half is a stick,
one that starts on the right half is a look), so this is confirmation, not
a change — and worth defending when somebody proposes drawing one.

**Action buttons sit on an arc hugging the bottom-right, and both size and
opacity fall off with distance from the thumb pivot.** Nearest the corner:
opaque, saturated, illustrated, 42-50pt. Further out: 33-38pt, greyscale
glyph, 55-60% opacity. That gives two visual registers — *system
furniture* versus *a real ability* — without a legend.

**But do not copy the sprawl.** Three of the six flagged that most of Path
of Titans' buttons are NOT actually inside a thumb's arc, and that the
cluster sits on no grid at all — which reads as a user-arranged HUD rather
than a shipped default. `02` has twenty-two always-on round buttons. That
is the thing to reject outright: TMB's HUD is contextual by rule, and an
unbuilt ability need not be on screen at all.

**The text is too small — unanimously.** Body copy measures 5-7pt cap
height on a 932 × 430 canvas. Every reader called the quest panel
decorative rather than readable. **Set a hard floor of about 11-13pt for
anything the player must actually read**, and treat these screenshots as
the floor to beat, not the target to hit.

**Touch targets: 44pt is the floor, not 33pt.** Path of Titans ships
in-play controls at 33-38pt with 10-16pt gaps. That is a once-a-session
size, not a gameplay size.

**Meters live bottom-centre, between the thumbs** — read constantly,
touched never. One wide bar bookended by small round icons that name what
refills it, the whole tray about 270 × 25pt. Copy the arrangement.

**But give the bar a track.** Their bars are painted strokes with no
empty channel behind them, over bright busy ground, so the *deficit* — the
part that matters — is invisible. Two readers independently called the
health bar unreadable at a glance.

**Unavailable is drawn by draining contrast while keeping the button's
exact position and shape.** Near-total darkening plus desaturation, not a
button that moves or disappears. This is TMB's own honesty rule already
("an unavailable action must never look functional"), arrived at
independently.

**A contextual prompt captions an existing button rather than adding a new
one** (`05`, `06`): the verb appears beside the exact glyph of the button
that performs it. That is how a contextual HUD stays contextual without
teaching a second vocabulary. Copy it — and note the failure beside it:
in `06` the prompt panel lands on top of a live control. Reserve a lane.

**The notch is handled asymmetrically.** The left ~60pt is empty; the
right edge is used to within ~6pt. `env(safe-area-inset-left/right)`, not
a symmetric margin. One reader argued they trust the opposite corner too
far — take the asymmetry, keep a little more margin than they do.

**Nothing is drawn in world space.** No nameplates, no floating health
bars, no damage numbers, no crosshair. Interaction is proved by the prompt
naming its button, not by a reticle.

**The minimap is a baked texture with one dot** — not a second camera, not
a render target. ~90pt circle, which is 22% of the screen height. Copy the
technique; question whether an ant needs the footprint at all.

**Battery and thermal state are redrawn inside the HUD** (`01`, `04`,
`06`), because fullscreen hides the iOS status bar. A small courtesy that
suits a phone game meant to be played for a long session.

## What it gives up to stay smooth

Joshua's actual question. At the lowest settings, measured off the pixels:

- **Shadows are off wholesale, not degraded.** No cast shadows, no
  self-shadowing, no contact darkening — on the player character or
  anything else. Large-scale baked terrain shading carries the form.
- **Fog IS the draw-distance budget.** Flat sky, no clouds, no sun disc;
  distant terrain dissolves to 5-8% contrast before the clip plane, so
  everything past it can be culled for free. Nothing pops in because
  nothing is visible far enough to pop.
- **No anti-aliasing, and alpha-TEST cutouts rather than blended alpha**
  for foliage and fur. Every silhouette is hard-stepped. They accepted the
  jaggies and kept the frame rate.
- **No ground clutter at all.** No grass layer, no scatter meshes near the
  camera. Foliage is clumped, not evenly scattered.
- **The frame is rendered below native and upscaled.** One reader measured
  the gradient falloff (2px-to-1px difference ratio ≈ 1.81 against ~1.35
  for a native-sharp image, with no column parity — a non-integer bilinear
  upscale). **The HUD measures just as soft**, which means the *whole
  composited frame* is upscaled. That is the one thing to do better:
  render the 3D scene at reduced resolution and composite the UI at
  native.
- **Dithered LOD transitions are left unresolved** — a chequered fringe
  along ridge silhouettes, because there is no temporal pass to resolve
  them. Cheap, and visibly grubby. Don't ship that without something to
  resolve it.
- **The palette is constrained hard.** Sand, fog, sky, and the player
  character carries the saturation.

### The one that is ours specifically

**An insect-scale camera is itself the performance budget.** At ant scale
the far plane is very near, and nothing distant needs to exist at all —
the thing Path of Titans buys with fog, we get from the premise. Worth
remembering before reaching for their tricks.

And the warning that comes with it: **terrain albedo at ant scale is
magnified enormously.** A DEM-derived ground texture that reads fine from
a dinosaur's eye height is a blurred smear from an ant's. That is a Phase
2 problem to plan for, not to discover.

## What we take, and what we refuse

**Take:** the undrawn stick and the empty left quadrant; the arc that
hugs the thumb pivot with size and opacity falling off; two visual
registers for furniture versus ability; meters bottom-centre bookended by
their refill icons; unavailable-by-drained-contrast; prompts that caption
an existing button; asymmetric safe-area insets; the baked-texture
minimap; battery and thermal on the HUD; shadows off, fog as the budget,
cutouts not blends, no ground clutter, constrained palette.

**Adapt:** 44pt touch floor rather than 33; 11-13pt type floor rather
than 5-7; a track behind every bar; reduced-resolution world with a
native-resolution HUD; a reserved lane for contextual prompts.

**Refuse:** twenty-two always-on buttons; controls placed outside the
thumb's arc; unbacked text over bright ground; unresolved dithered LOD;
low-contrast world markers; and **the missing character shadow** — Path of
Titans can skip it for a ten-metre dinosaur, but an ant is small and needs
grounding. A cheap contact blob is the one effect not to drop.
