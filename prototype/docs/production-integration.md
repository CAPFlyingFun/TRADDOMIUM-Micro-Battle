# Hybrid Chapter One production integration — 2026-10-05

Production backup: `backup/production-main-2026-10-05`, commit
`18b49c654a92cb8579acd82e19f97a3b9cf1a1f6`. The retained prototype source
branch is `prototype-integration` at `94bdd5b068c69e1ad2b4411ab8a64c00e6fc23d5`.

## Preservation and mounts

This integration adds the narrative runtime; it does not replace the existing
TypeScript engine. Existing src/, public/, worker/, scripts and tests are retained.
Root package dev now starts the hybrid; dev:systems retains the original sandbox.
No models, recordings, island geometry, texture masters, save keys or relay code
were changed. Story canon remains pinned to the previously verified export.

| Published path | Build | Access |
| --- | --- | --- |
| ./ | prototype/dist | Normal PWA entry |
| ./v1/ | prototype/dist | Existing v1 installations |
| ./island/ | root dist | Extras: island and advanced systems, including original lab |
| ./legacy/ | legacy/v0-main build | Extras: original game |

All use relative asset URLs. Each hybrid mount registers a local service worker
scope and manifest start URL. Island/legacy navigation is excluded from hybrid
shell fallback. Same-origin localStorage preserves original island save keys;
the hybrid's settings use their own existing key. Lab progression is session-only.

## Captions over unchanged audio

`Line.captions` can provide `{text,start,end}` visual cues in seconds within the
existing clip. The validation requires cues to reconstruct its complete transcript
and cover the clip without gaps. Otherwise the caption helper estimates timings
by word counts and punctuation against the recording's actual duration.
These estimates are not forced-aligned word timestamps; editorial cue overrides
can refine them without modifying an audio file or changing story progression.

Portrait narration shows about 2–4 lines (normally 100 characters or fewer),
with a brief fade/slide. Replay, pause, clip completion and playhead changes
select cues directly. Landscape shows the full scrollable transcript as before.
Audio error/blocked states expose the full transcript so text stays readable.
Large-text and reduced-motion preferences remain available.

## iPhone and offline behavior

The story grid uses 100dvh to respond to Safari toolbar changes, plus safe-area
insets for top, bottom and landscape sides. The standalone manifest permits any
orientation. No orientation gate was added. Menus/dialogs also respect safe areas.
Touch buttons retain 44px hit targets while the transport and captions use less
vertical space. Service-worker revision includes all public model/audio/art bytes,
so an asset-only release also refreshes stable cached URLs. Cache pressure never
prevents online playback. The shell is precached; chapter assets are cached when
fetched, not all island assets or all chapters in advance. An open lab does not
automatically reload when an update becomes available.

## Verification

Existing game: 3,664 tests passed, 3 skipped; typecheck, production build and
relay typecheck passed. Hybrid: 33 tests passed, typecheck/build, hashes of all
206 startup assets, 182 canonical lines, 30 cues and actual Jack/Sarah rig decode.
Production browser checks cover timed caption progression, pause/replay, portrait,
landscape, simulated standalone safe-area geometry, Extras URLs, scoped PWA
registration and offline shell reload at the existing /v1/ mount.

Physical iPhone Safari and installed-mode testing remain necessary; simulated
safe-area/browser checks are not a physical device certification. Existing scale
atlas warning concerns unexposed later scenes. Large bundle warnings remain.

## Deployment and rollback

Build & Deploy gates both runtimes and publishes the assembled site on push to
main. Production main remains an ordinary forward-moving branch; the backup and
prototype branches are kept. To roll back, restore production files/workflow from
the backup as a new commit and redeploy. Do not delete or force-reset unrelated
history. The backup preserves the former root/v1 entry layout too.
