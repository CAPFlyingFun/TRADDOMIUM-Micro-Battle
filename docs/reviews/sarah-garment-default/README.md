# The new raglan tee as Sarah's default outfit (local, awaiting review)

Joshua, 2026-10-27: "Add both to outfit list and both shirts have simulated shirts. Make the new shirt the default, and
the other shirt as the second option to compare." Nothing here is pushed.

## What changed

- **OUTFIT list.** A new built-in outfit, `Sarah · red raglan tee + charcoal leggings`, sits at index 7. It is the
  procedural raglan tee in the light tee's red jersey over the painted charcoal leggings. The simulated spandex tee
  (`Sarah · red spandex tee + charcoal leggings`) follows it at index 8, so OUTFIT steps from one to the other.
- **Default.** The room opens in the raglan tee (`SARAH_DEFAULT_OUTFIT`). Her saved look still names the spandex tee,
  so the room opens in the default instead whenever the saved look asks for that tee. Every other saved outfit opens as
  saved.
- **Putting it on.** The room tailors the tee for her, which takes 2 to 4 s on the main thread behind a "Tailoring the
  new tee" card. It then dresses her as the probes do: weightless for 1.2 s, her arms raised a little and lowered,
  then settled.
- **Cut for her shape** (sheet 2). The tee is drafted from her 0%-belly design. It was being put on as though her
  shape at that moment (73%) were the one it was cut for, so it was never refit. Its front was too short for her belly,
  and the back gathered into a rolled band across her waist. The room now takes the tee's reading of her shape at 0%,
  then refits it at once for her shape now, the way the cloth tee is cut for the body it is on. The band is gone at
  73%, at 0% and back at 73%. The back now hangs over her hips: its lowest centre-back point dropped from 97 to 91.
- **Navel cover** (`garmentDetail.ts`, `COVER_REACH`). A nipple dome's cover corner is held only within 1.2× its
  radius. A far corner was raising a poke under her right bust.
- **Slow frames.** A frame slower than 1/40 s runs the tee in two halves.
- **Card picture.** The new outfit's card uses a copy of the spandex tee's picture for now. It looks nearly the same,
  and a real bake can replace it.

## Measured (phone viewport 932×430, her saved look at 73%)

- No skin is seen through the tee from the front or either ¾ view. The only "seen" hits are her forearms, at x ±18,
  which hang outside the tee.
- No particle sits inside her.
- Strain p95 is 1.12, the highest 1.56.
- Switching to the next outfit takes the tee off and shows the sim tee.
- No page errors.

## Sheets

1. `1-new-tee-default.jpg`: the room as it opens, front, both ¾ views, back.
2. `2-back-band-fixed.jpg`: the back waist before and after the refit.
3. `3-both-outfits.jpg`: outfit 1, the new tee, and the next outfit, the sim tee.
