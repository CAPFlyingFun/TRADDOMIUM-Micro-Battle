# Independent review handoff

Review branch: `prototype-integration`.
Backup branch: `Main-Backup`, preserved commit
`18b49c654a92cb8579acd82e19f97a3b9cf1a1f6`.

## Executed plan

1. Checked remote refs and created the backup/candidate without overwriting any
   existing branch. Candidate begins at preserved main.
2. Extracted the supplied ZIP's real game source, focused tests and required UI
   primitives. Added a standalone static Vite/React adapter in `prototype/`.
3. Kept the navy/teal UI and original procedural lab, story controller,
   camera/object controls, scripted human staging and voice controls.
4. Recovered exact omitted prototype human GLBs from game history, verified
   their blob IDs, decoded them and tested their different rigs.
5. Imported current canonical Chapter One text, voices and cues. Reconciled
   Sarah's revised entrance with approach staging; removed obsolete cue repairs.
6. Restored only Chapter One assets; added source hashes, reproducible importers
   and asset/rig verification scripts.
7. Ran candidate typecheck, focused tests, asset checks, rig decoding and build.
   Browser check established WebGL runner limitation plus usable error recovery;
   it did not establish successful integrated 3D gameplay.

## Review targets

- `scripts/import-chapter-one.py`: current canonical queues, audio and cue export;
  no generated dialogue/audio, duplicated repaired cues or stale approach anchor.
- `docs/chapter1-audio-source.json`: source revision, file hashes and staging.
- `docs/asset-provenance.json`: original ZIP identity, exact GLB blob recovery,
  transparent artwork substitutions.
- `app/game/three/rig-contract.ts`: fail explicitly for incompatible replacement
  rigs; original pose/seated-skin code retained.
- `app/game/three/lab-renderer.ts`, `lab-camera.ts`, `lab-room.ts`: original layout,
  controls and staging preserved; actual asset path prefixing.
- `app/game/lib/audio.ts`, `useVoicePlayback.ts`, `voice-transport.ts`: only
  Chapter One recordings/effects in this milestone, gesture unlock and voice
  cancellation behavior.
- `app/game/GameApp.tsx`: lab-primary entry, truthful disabled Continue; no
  unfinished Chapter II/III or unrelated preview entry points.
- `lib/asset-url.ts` / `vite.config.ts`: independent static hosting at root or
  a mount path, without root-relative asset escape.

The root island application and `.github/workflows/deploy.yml` must remain
identical to preserved main. No PR was merged or production site published.
The local Replit preview wrapper selects this candidate checkout; that wrapper
is development infrastructure, not a change to the GitHub production workflow.

## Checks and remaining limits

- Typecheck and build pass.
- 14 focused tests pass using the restored exact model bytes.
- 201 assets are hash/size verified; 182 current canonical segments are aligned.
- Both exact GLBs decode with meshopt; required chains and finite poses pass.
- Browser runner cannot create WebGL. Title/settings/rotation/error recovery
  pass, but full rendered story, audible playback, canvas raycasts and Safari
  behavior remain unverified until a WebGL-capable browser/device review.
- Build retains an unreachable Chapter III scale-atlas CSS reference and a
  Three bundle-size warning. Do not mistake these for verified live lab defects.

Please review the branch independently rather than editing the same files
concurrently. Promotion comes only after Joshua's iPhone review. Layout D,
enhanced materials/atlas, free player walking, Beyond Extinction-style objectives
and exploration, and island integration remain outside this restoration.