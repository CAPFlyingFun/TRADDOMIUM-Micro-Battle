# Hybrid Chapter One — implementation

The pinned TMB-Story manuscript, all 182 recordings, island/cloud opening and
procedural laboratory are retained. Exploration occurs after a dialogue queue,
with existing required actions determining progression. This is not an island
integration or a promotion to the production game's main branch.

## Controls

- Keyboard: WASD / arrows move relative to the camera; C switches characters.
- Portrait: tap an unobstructed floor position to walk there.
- Landscape touch: hold a direction button, or tap the floor.
- Jack / Sarah buttons switch control. Sarah becomes available after arrival.
- Objective buttons and visible consoles route the character to an interaction
  point, then invoke the existing prerequisite-checked story action.
- Drag/orbit, pan, pinch/zoom and the four camera views remain available.
- Camera adjustments → Auto shot resumes the current cinematic shot.
- Pause clears held directions but retains positions and routes. Rotation only
  reframes the viewport; it does not remount the scene or reset characters.

## Systems

| File | Responsibility |
| --- | --- |
| `app/game/three/lab-navigation.ts` | Floor bounds, furniture clearance, A* routes and direct-movement collision checks |
| `app/game/three/lab-player.ts` | Shared actor poses, selection, route following, queued interaction and return-to-script authority |
| `app/game/three/lab-direction.ts` | Beat titles and canonical source-index ranges selecting camera shots |
| `app/game/three/lab-camera.ts` | Responsive shot geometry, shared portrait/landscape bearing |
| `app/game/three/lab-renderer.ts` | Models, procedural staging, input, camera easing and renderer lifecycle |
| `app/game/components/LabPlayerControls.tsx` | Character selection, touch directions and contextual status |
| `app/game/components/StoryPlayer.tsx` | Existing canonical dialogue/action prerequisites; waits for staging handoff before audio |

Only one movement authority writes actor poses at a time. Entering exploration
captures the scripted poses. Returning walks both actors to those anchors,
turns them and restores their seat blends; the audio remains paused until the
handoff completes. The existing scripted chair/entrance timeline then resumes.

The floor map reflects the **current** room, with 0.16 m clearance around the
workstation, bench and rack. It must be updated alongside a later Layout D
change. This first navigation version routes around static furniture; it is not
a general crowd simulator or full navmesh. Chairs and other characters are not
dynamic navigation obstacles. There are no facial animations. Session progress
is still not persisted.

## Validation

Run `npm run typecheck`, `npm test`, `npm run verify:assets`,
`npm run verify:rigs`, and `npm run build` from `prototype/`.
The existing scale-atlas warning concerns an unexposed Chapters 2–3 scene;
it is not a missing Chapter One startup asset. The Three.js chunk size warning
remains a bundling/performance consideration. Physical iPhone Safari performance
and silent-switch behaviour require device review.

## Separate test preview

After the source commit is pushed, `node scripts/build-preview.mjs` builds
`dist-preview/` without copying model/audio/image binaries. The runtime asset
base points at that exact source commit, matching the existing preview hosting
recipe. Copy only its index and browser bundles to TRADDOMIUM-Prototype-Preview;
record the SHA and bundle hashes in preview.json. Production main is unchanged.

### Verification record

- 29 focused automated tests passed, including navigation, pose and voice tests.
- Typecheck, production build, all 206 startup asset hashes and both actual rigs
  passed. No model/audio/image binaries changed in this implementation.
- WebGL browser checks exercised the island-to-lab handoff, keyboard movement,
  pause/resume, returning to Jack's seat, terminal actions, the intercom, Sarah's
  entrance/selection, and reachable controls at 1280×800, 393×852 and 844×390.
- A separate source review checked movement/interaction/camera authority and
  found no remaining important issue after fixes.
- This does not establish physical iPhone Safari performance or silent-switch
  behaviour. The preview is the device-review candidate, not production main.
