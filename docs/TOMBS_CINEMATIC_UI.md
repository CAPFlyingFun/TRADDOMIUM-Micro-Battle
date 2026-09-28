# TOMBS cinematic UI integration

This PR adapts the ChatGPT story prototype's presentation to the existing TypeScript game. It is a laboratory UI change, not a second game or a replacement renderer.

- `src/tombs/TombsHud.ts` owns DOM presentation only. The scene supplies readouts and handles the existing `tombsTool.ts` actions.
- `src/tombs/tombsHud.css` scopes the navy/teal palette, serif dialogue, touch targets, and orientation layouts to this HUD.
- Landscape puts dialogue along the right edge; portrait puts it at the bottom. Text scrolls independently of previous/next controls. A changed line resets text scroll; routine refreshes preserve the reader's position.
- Lab tools expand to expose all room destinations, movement controls, array/light controls and diagnostics. Back remains outside the drawer. The existing movement stick and reach prompt use a lab-local stage container above/beside dialogue.
- The Three.js canvas still renders the full viewport behind the HUD. This change does not modify its aspect ratio, camera poses or simulation.
- Dialogue, speakers, beat names and ordering remain sourced from the existing audio manifest and chapter data. Next is disabled at the last available line. Audio remains manually advanced; no unimplemented playback timer, pause or auto-advance is advertised.
- No new dependency, media file, external font, asset copy or framework is introduced. Version advances to alpha.60.

## Review on device

Run `npm ci`, `npm run dev`, then Editors → Tombs laboratory. Check portrait and short landscape, with a long narrated line. Scroll the text and confirm Next/Prev remain reachable; rotate mid-line. Expand Lab tools, teleport, walk/run and test a reach prompt. Confirm the joystick is above dialogue in portrait. Check Back returns normally.

`tests/tombsHud.test.ts` verifies scene action routing, canonical text, line boundaries, scroll reset and disposal. `probe:player` opens and closes the tools drawer around its existing simulation checks.

Local validation: production build/typecheck passed; existing suite 3,556 passed / 3 skipped, plus the new HUD test passed. Browser layout and full player probe remain pending: this environment had no Chromium executable and its browser download was blocked/invalid. Real iPhone Safari review is required before merging. This PR is deliberately a draft until that visual pass.

Further cinematic camera direction, animation and automatic line completion should be separate changes using the game's existing story/camera and audio owners.
