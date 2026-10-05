# Chapter One prototype candidate

This is the **actual ChatGPT source-only prototype**, restored under `prototype/`
without replacing the existing game. It is a development candidate, not a
production promotion. `main`, the island game, its save formats, legacy/v0-main,
and the unmerged cinematic PR remain unchanged.

## Run independently

Node 22+, pnpm 10+:

```sh
cd prototype
pnpm install --frozen-lockfile
pnpm dev --host 0.0.0.0
```

No account, server, Cloudflare, generated voices or paid service is required.
The Vinext/Next/Sites starter is not carried into this static React/Vite adapter.

```sh
pnpm typecheck
pnpm test
pnpm verify:assets
pnpm verify:rigs
pnpm build
pnpm preview --host 0.0.0.0
```

Build defaults to relative `./` hosting. For an explicit mount, set
`BASE_PATH=/your/mount/` when running dev/build. Models, recorded audio,
backgrounds and portraits use the same mount prefix. Deploy `prototype/dist`
only when the owner approves a separate candidate deployment; do not replace
the existing site's output or modify its two-build deployment workflow.

## Scope and source ownership

- New Game starts Chapter One's 3D laboratory, through the original story
  controller and camera/object interactions.
- Continue is disabled: lab progress is session-only. Settings persist in the
  prototype's existing settings key; old island/cinematic saves are not read or
  rewritten.
- Terminal investigation, intercom, Sarah's arrival, logs/conversation and
  administrator rejection use the prototype's existing progression.
- Between dialogue queues, Jack and Sarah can be controlled independently.
  Keyboard WASD/arrows, portrait floor taps, and landscape touch directions
  share a ground-plane movement authority. Sarah unlocks after her entrance.
  Furniture routing uses A*; progression still requires the canonical actions.
- Dialogue transitions return both characters to their captured staging anchors
  before recorded speech resumes. Rotation and pause do not reset their positions.
- Automatic canonical shot ranges are separate from camera geometry. Manual
  camera views/orbit remain available; Auto shot resumes cinematic direction.
- The original procedural lab arrangement/materials and navy/teal UI remain.
  Layout D, enhanced texture atlas and island integration
  are later milestones.
- TMB-Story is the canonical Read/Listen/Watch source. This playable candidate
  consumes a pinned Chapter One export; it does not create a second canon.
- Chapter II/III, Scale Explorer and the character viewer are not exposed in
  this milestone. Their source/data may remain for provenance, but their omitted
  assets are deliberately not restored.

## Restored assets and canon

See `docs/asset-provenance.json` and `docs/chapter1-audio-source.json`.

- ZIP source commit: `0f30b02a9ed9d6054e4ac54cde80f8da544cd050`.
- Canonical Story revision: `dfe810e670a42867b014dae4a206df5d80350414`.
- All 182 current Chapter One segments and recorded voices are imported.
- The three changed narration lines at indices 55, 59 and 65 are imported with
  current recordings. Approach starts at 55, when Sarah walks straight in, not
  at 65, when Jack only points toward the monitor.
- Current canonical sound cues are imported once. The old prototype's manual
  chair/typing repairs are not appended to already-correct canonical cues.
- Exact prototype GLBs were recovered from authorized game Git history by the
  omitted-assets inventory's blob IDs. Jack has 69 bones; Sarah has 35. These
  are not the larger character-viewer variants or today's differently sized
  Story models. Neither binary is modified.
- Missing title background/portraits are replaced by authorized Story artwork.
  The procedural 3D room is not rebuilt from that image.

To refresh canon from a pinned local Story checkout:

```sh
python scripts/import-chapter-one.py /path/to/TMB-Story
```

The importer fails if required anchors or canonical cues are inconsistent;
recheck staging and run tests after any source update. Restoring original
non-audio assets is reproducible with `scripts/restore-assets.py` using a full
authorized game history checkout and the source ZIP.

## Validation boundary

The focused CPU checks decode the actual meshopt models and exercise rig chains,
seating, walk/gaze poses, portrait/landscape shot calculations, cue/text alignment
and voice-transport pause/replay/skip cancellation. They are not visual WebGL or
iPhone Safari validation.

The Replit browser runner reported `GL_VENDOR = Disabled`,
`GL_RENDERER = Disabled` and `BindToCurrentSequence failed` when creating WebGL.
It verified the title, disabled Continue, settings, portrait/landscape error
layout and Menu/Resume/Return-to-title recovery. It could not reach the actual
3D story journey or confirm audible playback.

Owner iPhone review remains required before promotion. Use New Game; check
Replay/Skip and pause/resume, trace/lock the terminal, use the intercom, wait for
Sarah, inspect logs and talk, reject initialization and test administrator access.
Rotate in both directions, try the camera views, drag/pan/zoom/reset and return
to the title. The visible interaction buttons are equivalent to object targets.

Build warnings: the preserved, unreachable Chapter III camera CSS still names
the omitted scale atlas; Chapter One does not render that selector. Three's lazy
renderer chunk is above Vite's default size-warning threshold. Neither warning
is evidence of a Chapter One runtime failure.