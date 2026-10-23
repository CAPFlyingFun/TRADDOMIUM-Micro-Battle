# Sarah Lab: only the outside layer is the shirt (alpha.111)

Joshua sent a drawing on 2026-10-23. It showed the shirt standing off her (green) and the same paint still on the skin under it (red): "I want the part directly under that bridge to not be painted."

## What changed

- **The skin behind the cleavage bridge no longer carries the top's paint.**
  - `CleavageBridge.under` holds one value per vertex.
  - `fabricMaterial.setUnder` lays it on her skin as a second "uncover" channel beside the drape's `fabricHang`.
  - The paint comes off only that one layer, and its edge is drawn crisp at the half-way line, the same as the paint's own edge.
- **Which skin counts as behind the bridge** is measured against the sheet itself, at the skin's own height as she stands.
  - Skin is bare where the sheet stands clear in front of it, from about 5 mm, with the ramp running over about 1 cm.
  - Skin keeps its paint where the sheet meets it: at the sheet's ends on her breasts, at its bottom, and at a crew's top.
  - From the outside, those are the places where the skin is what you see.
- **The sheet itself:**
  - It is now solid to within about 2.5 mm of its ends. It used to fade over a fifth of its width, and bare skin showed through the fade.
  - A crew's sheet now goes back onto her skin at its top instead of ending in the air, so from above there is no gap to look down into.
  - Its bottom fade is shorter.
- **A low neckline (scoop, U, V):** her cleavage is bare all the way up past the cut.
  - Looking down the neckline shows her skin inside the shirt.
  - The neckline's edge crosses her cleavage on the bridge's hem instead of diving into it. This was also the cause of the notch seen from above in alpha.110.

## Sheet

`1-before-after.jpg` uses the same camera for each pair:

- the scoop from above, alpha.110 against this build;
- the crew neck from above;
- the crew from the front and from three-quarter. These show that nothing bare can be seen from outside.

## Still to watch

From above, a small step remains on one side of a low neckline, where the paint's curve meets the bare cleavage at her breast's rim.

## Checked

- typecheck and relay typecheck pass.
- 3,865 tests pass, including the new `tests/fabricUnder.test.ts`.
- The build passes.
- `probe:sarahlab` passes.
- In-page measurement: every bared vertex sits at least 3.5 mm behind the drawn sheet, and none is level with it.
