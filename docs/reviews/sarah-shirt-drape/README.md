# Sarah: shirt length and the shirt's drape below her waist (2026-10-22)

Joshua, 2026-10-22, drawn on her front and side:
- "add a smoothening effect like the bust around the crotch area at the legs and seam bottom that extends to the belly";
- "add the smoothing in the back to do the same";
- "make the shirt length adjustable from knee-length up to just above the crotch", with the range marked on her front
  (0% just above the crotch, 100% just above the knee).

Then, on the first renders: smooth "the lower belly curve" so that straight on "you can barely see it", and "you mainly
see it from the side and 45°".

## What changed

1. **SHIRT LENGTH** (clothes controls, and as a dial on the shirt templates).
   - It runs from 0% just above her crotch to 100% just above her knee, both measured on her own body.
   - The hem is level all round, as a real one hangs.
   - It starts at 0%, his marked line at the groin creases (Joshua, 2026-10-22, choosing the default after the 0% line
     was raised to his mark).
   - Every painted shirt keeps the chosen length: the tees (crew, U, V, 3/4, long), the sleeveless shirt and the tank.
   - With no painted shirt on (a modelled outfit, the v1 model), the slider is dimmed and says "painted shirts only".
2. **The shirt's drape** (`src/sarahlab/tunicDrape.ts`). It does below her waist what the cleavage bridge does at her
   bust: a sheet in the shirt's fabric that shows only where real fabric would stand off her skin. Everywhere else the
   paint is the shirt.
   - **Front:** it spans the gap between her thighs and lies flat over her groin. Under her belly it falls to her
     thighs instead of tucking under.
   - **Back:** the same between her thighs, and it falls from her seat to the backs of her thighs.
   - **Hem:** one line across both legs.
   - **Lower belly:** from the front, the curve under her belly is the shirt's smooth surface, lit softly. The fall shows
     in profile, from the side and at 45°.
   - **Movement:** it moves with her like her own skin, on the graphics card. Between her legs it stretches as they move,
     and her belly's bob, sway and tilt carry over.
   - **Rebuilds:** it is rebuilt when her shape changes (a slider, a pose), at most about eight times a second.
   - **Cost:** nothing extra downloads.
3. The BREAST SHAPE sliders: the paint and the cleavage bridge follow them (sheet 5).

## Sheets

All are front, 45°, side and back unless marked.
- `1-b0-l20.jpg`: belly 0%, length 20%.
- `2-b100-l20.jpg`: belly 100%, length 20%.
- `3-b200-l20.jpg`: belly 200%, length 20%.
- `4-b100-l100.jpg`: belly 100%, knee length.
- `5-bust-size.jpg`: belly 100%, BREAST SHAPE size +100% and -100%, front and 45°.
- `6-lower-belly-close.jpg`: the lower belly close up at 0%, 100% and 200%, front and 45°.
- `7-under-belly-100-200.jpg`: after Joshua's second marks ("between 100-200% underneath the belly and to the side,
  it's not smooth... need a smoother curve all around"), belly 100%, 150% and 200%, front, 45° and side.
- `8-under-belly-200-close.png`: 200% side and 45° close up.
- `9-posed-fit-0-150.jpg`: after the posed fit (third marks), belly 0% and 150%, at 20% length.
- `10-default-length-0.jpg`: the approved state, SHIRT LENGTH at its new default 0% (his line), belly 0%, 100% and
  200%.

Sheets 1-8 are earlier builds at 20% length, kept as the review trail.

### The jagged edge under a big belly (second marks)

A big belly rests sagged: its tilt grows with its size, and it is one of her motion shapes. The drape was fitted to her
without that tilt and had it added back approximately, so past about 100% the real belly poked through the drape along
the curve underneath. That made the ragged line. The drape is now fitted to her as she rests, sag included, and carries
only movement from there (a bounce, a sway). Also:
- How far it stands off her is smoothed more, so the edge where it leaves her belly is one curve.
- Wherever any of it shows, it stays just outside her skin.
- Only where it truly stands off her is it lit as fabric falling away. Where it lies on her it shades as her skin does.

### The hard line on the belly's sides at 100-200% (third marks)

Joshua, 2026-10-22: "make the sides on the belly from 100-200% slightly more off the skin so it doesn't have that hard
line". The close-ups showed her belly in FRONT of the shirt along its lower sides: the shirt had been fitted to her
un-posed shape, and her standing pose leans her spine back to carry the bump, more the bigger it is. So the shirt is now
fitted to her as she stands, then carried back to her bind pose through its own bones. Also:
- Where the fabric falls away below her belly, it takes over the belly's surface from its widest point downward, fading
  in. The whole lower curve is one fabric surface, handed over to her skin where the two are lit alike.
- Where it shows fully, it stands a few millimetres off her.
- Her skin's outline is lightly smoothed before fitting, so the fabric's edge round her hips does not step.

## Checks

`npm run typecheck`, `npm run relay:typecheck`, `npm test`, `npm run build`, `npm run probe:sarahlab`,
`npm run probe:boot`.

## Still open

- **Sitting:** the drape is shaped standing. When she sits it follows her bones, but it is not re-shaped for the seat.
- **Loose shirts:** a relaxed shirt that hangs off her body is still a modelled garment. These are fitted tops.
