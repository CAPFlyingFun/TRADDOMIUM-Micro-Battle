# Sarah Lab: a flat hem, the shirt over her seat, a swimsuit with a bottom (alpha.112)

Joshua, 2026-10-23:
- "on the shirt, there is a seam at the bottom that flares out... like how a sweater at the end is more out than the rest... fine for the sweater fabric, but shouldn't be for all the others";
- "the shirt still looks off and bows out slightly just underneath the bellybutton";
- "for all the shirts on the backside/butt, when the belly slider is more than 100%, parts of the shirt end up in her behind";
- "the swimsuit has no bottom covering the crotch and underside like the Leotard".

## What changed (`tunicDrape.ts`, `paintTemplates.ts`)

- **Flat hem.** The hem band lies on her skin about 0.5 mm out.
  - Before, it stood 1.5 mm or more off her, on the outline round her, and was lit as if it faced outward.
  - A sweater keeps a thicker, raised hem (`HEM_LIFT_RIBBED`).
- **No bow under her navel.** The extra push off her skin applies only at her sides, never where the shirt already hangs in front or behind.
- **Over her seat:**
  - The hem band is solid up to above where the shirt's paint actually ends, in every direction. With a big bump her stance tips the paint's hem above the drape's level hem behind her, and the leggings showed through between them.
  - Behind, the shirt hangs from her seat (`BACK_SLOPE`) instead of following her into the fold under it.
  - A narrow hollow down her middle (the cleft) stays spanned.
  - Where any of the drape shows, it is never inside her skin.
- **Swimsuit.** The one-piece swimsuit gets the leotard's leg cut (`ONE_PIECE_CUT`): a strip between her legs and openings over her hips. Before, it was cut straight across the tops of her thighs.

## Sheets

1. `1-hem-flat.png`: before (top) and after, at 100% and 200%.
2. `2-seat-before-after.png`: her back at 200% and 150%, alpha.110 (top) against this build.
3. `3-swimsuit-before-after.png`: before, after from the front, and after from behind.

## Still to watch

- A few small light flecks right at the hem over her right buttock at 150–200%. They were there in alpha.110 too.
- The swimsuit's back is the leotard's narrow back. A fuller back can be its own cut.
