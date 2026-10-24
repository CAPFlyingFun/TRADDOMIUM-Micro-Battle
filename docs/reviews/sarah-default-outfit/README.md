# Sarah's default outfit, and the belly sides (alpha.115)

Joshua, 2026-10-23, with a reference picture: "match and make the default outfit for Sarah, this one". Then: "Check each side of the belly from the front view, looks like part of the shirt is frayed out just a little bit."

## The outfit

The room now opens in **Sarah · red tee + charcoal leggings**: a painted short-sleeve tee in red `#be0f2a` over over-belly leggings in charcoal `#3a3b52`. Both are custom colours measured off the picture: the tee is jersey and the leggings are athletic knit, each family's White dyed (`fabricTint.ts`).

It is painted, so it has nothing to download and follows every slider. The white tee and its other built-ins are still there as cards.

Not matched:
- **The scoop neckline.** Painted as a scoop, the neckline's edge came out wavy across the large triangles of her upper chest, with a small bare notch under it at the cleavage bridge (`3-necklines-tried.jpg`). She wears the clean crew until a scoop can be drawn as cleanly.
- **The shoes.** The room has no footwear yet.
- **The hair and face.** These are not part of an outfit.

## The frayed sides

The frays were the shirt's drape (`tunicDrape.ts`), not the paint. There were two causes:

1. **Faded points were left out on the outline.** Where the drape has faded out, its points were left on the outline round her, which spans hollows (her waist above the bump, her hips below it) a few millimetres to centimetres off her skin. The triangles from those points to their shown neighbours drew half-seen wedges past her side. Now:
   - A faded point lies just under her skin, except beside where the shirt hangs from her bump, where the outline is well clear of her.
   - A strip that is still fading in never stands off her.
2. **Her measured skin was a staircase.** The drape measures her skin as the farthest of a few vertices per row. Down the slope of her hips that reads as a staircase, and the drape laid on it drew a tooth per row. Now:
   - Her measured skin is smoothed down her.
   - How far the drape stands off her skin is smoothed round her and down her.

The sides are much smoother at 100% and 200% (`2-belly-sides-before-after.jpg`). A little unevenness remains at 200% where her hips are steepest.

## Sheets

1. `1-default-vs-picture.jpg`: the picture next to her FRONT, ¾ and upright.
2. `2-belly-sides-before-after.jpg`: the frayed sides before, and now at 100% and 200%.
3. `3-necklines-tried.jpg`: scoop, U, a shallower U, and crew.
