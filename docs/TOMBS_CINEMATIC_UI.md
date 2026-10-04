# TOMBS cinematic UI integration

This PR adapts the ChatGPT story prototype's presentation to the existing TypeScript game. It is a laboratory UI change, not a second game or a replacement renderer.

- `src/tombs/TombsHud.ts` owns DOM presentation only. The scene supplies readouts and handles the existing `tombsTool.ts` actions.
- `src/tombs/tombsHud.css` scopes the navy/teal palette, serif dialogue, touch targets, and orientation layouts to this HUD.
- Landscape puts dialogue along the right edge; portrait puts it at the bottom. Text scrolls independently of previous/next controls. A changed line resets text scroll; routine refreshes preserve the reader's position.
- Lab tools expand to expose all room destinations, movement controls, array/light controls and diagnostics. Back remains outside the drawer. The existing movement stick and reach prompt use a lab-local stage container above/beside dialogue.
- The Three.js canvas still renders the full viewport behind the HUD. This change does not modify its aspect ratio, camera poses or simulation.
- Dialogue, speakers, beat names and ordering remain sourced from the existing audio manifest and chapter data. Next is disabled at the last available line. Audio remains manually advanced; no unimplemented playback timer, pause or auto-advance is advertised.
- No new dependency, media file, external font, asset copy or framework is introduced. The refresh retains main's alpha.69 version and dependency lockfile.

## Review on device

Run `npm ci`, `npm run dev`, then Editors → Tombs laboratory. Check portrait and short landscape, with a long narrated line. Scroll the text and confirm Next/Prev remain reachable; rotate mid-line. Expand Lab tools, teleport, walk/run and test a reach prompt. Confirm the joystick is above dialogue in portrait. Check Back returns normally.

`tests/tombsHud.test.ts` verifies scene action routing, canonical text, line boundaries, scroll reset and disposal. `probe:player` opens and closes the tools drawer around its existing simulation checks.

## Refresh validation — 2026-10-04

Merged main at `18b49c654a92cb8579acd82e19f97a3b9cf1a1f6` into the review branch in an isolated checkout. Retained main's package versions, chapter content, audio, character behavior, laboratory layout and textures; no deployment settings changed.

Typecheck and production build passed (existing bundle-size warnings remain). The full suite reported 3,664 passed, 3 skipped and one terrain-population timeout under parallel load. Running that unchanged test file alone passed all 17 tests, including the timed-out test in 2.24 seconds.

Browser validation used the actual HUD module in a separate DOM-only harness at 390×844, 844×390 and 667×375. Long dialogue scrolled independently, navigation stayed visible, and rotation preserved the line and scroll position. The expanded tools drawer exposed a 14px overlap with Back; its reserved space was increased by 30px to remove that overlap.

**Merge blockers:** the real game could not initialize WebGL in the test browser, so actual joystick movement, interaction, 3D visibility, audio and character behavior remain unverified. Additionally, current main's static portrait/coarse-pointer orientation gate blocks phone portrait play; this refresh intentionally preserves that newer landscape-only rule rather than silently overriding it. The portrait HUD harness is not evidence that portrait gameplay works. Reconcile that rule with the requested portrait experience and complete a WebGL-capable browser/device review before merging. The PR remains draft and unmerged.

Further cinematic camera direction, animation and automatic line completion should be separate changes using the game's existing story/camera and audio owners.
