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

## Per-screenshot notes

To come — each shot's HUD clusters, their sizes in points, and what to
copy, adapt or avoid.
