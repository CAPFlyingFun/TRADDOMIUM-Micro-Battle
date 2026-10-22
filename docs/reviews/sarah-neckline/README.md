# Sarah: painted tops that span the cleavage, with crew, U and V necks (2026-10-22)

Joshua, 2026-10-22: "keep the modeled clothing, but not load them, and instead, do painted... between the breasts,
add a simple shape connector between the breasts to make it look like a shirt... and depending on the type of shirt,
will determine the shape and dip like if it's a U-neck and V-neck". Then: "make sure the side profile is the same
shape and roundness as the breasts."

## What changed

1. **The cleavage bridge** (`src/sarahlab/cleavageBridge.ts`). Paint lies on her skin, so a painted top followed her
   into her cleavage and read as body paint. Painted tops now get a thin sheet in their own fabric that spans the gap,
   the way a real top does.
   - It runs straight from the front of one breast to the other, in level slices from under her bust to where her
     cleavage closes.
   - It is re-laid every frame between two points on her own skin, so it follows every belly and breast shape, pose
     and bounce.
   - It is lit as part of the breasts it joins and fades into them at its edges, so there is no visible seam. From the
     side it sits behind her breasts' own curve: the profile is hers, unchanged.
   - It adds fewer than 800 vertices, and nothing extra downloads.
2. **Necklines.** A painted top has a crew, U or V neck. The bridge's top edge is cut to the same curve as the paint's
   neckline, so a U or V dips into the cleavage and the bridge stops at the same line as a hem.
3. **Two new painted outfits** in the OUTFIT cycle: U-neck tee + leggings and V-neck tee + leggings. The painted crew
   tee is unchanged apart from the bridge.
4. **Modelled outfits are kept but not loaded.** They are still in the repository and in the code. The OUTFIT button
   skips them while painted outfits are available, so nothing large downloads.

## Sheets

- `1-tees-0-pct.jpg`, `2-tees-100-pct.jpg`, `3-tees-200-pct.jpg`: crew, U and V at belly 0%, 100% and 200%. Each is
  shown front, 45° and side.
- `4-bridge-close.jpg`: the chest close up, all three necklines at all three sizes.

## Checks

`npm run typecheck`, `npm run relay:typecheck`, `npm test` (3840 passed), `npm run build`, `npm run probe:sarahlab`,
`npm run probe:boot`: all pass.

## Still open

- The bikini keeps its modelled cups, and the bridge is not used on it.
- A loose or relaxed shirt hangs off her body, and paint cannot do that. These are fitted tops.
