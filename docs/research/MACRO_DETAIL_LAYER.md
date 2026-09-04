# The macro detail layer

**Status:** specification, nothing built.
**Written because:** at 21 m the island has no texture on it at all, and the
obvious fix — raise the detail fade — is the one thing that cannot work.

---

## 1. The problem, measured

The ground shader blends seven 1024-texel band maps tiled at `BAND_TILE`
(4 units) and fades them out to each band's average colour as the pixel
footprint grows. The fade is measured in **texels per pixel**, and runs
from `FADE_FROM_TEXELS = 128` to `FADE_TO_TEXELS = 768`.

`npm run probe:reach` reports what that means on the ground:

| what | distance from the eye |
|---|---|
| full detail | out to **21 cm** |
| hand-over complete | **64 cm** |

Those are the numbers at the dial's default of 1×. They are correct for a
camera four centimetres above the soil, which is where the camera normally
is, and they are the result of a real fix — see the comment block in
`terrainMaterial.ts` for why the fade is in texels and not in metres.

**At 21 m of altitude, every pixel of ground on the screen is past 64 cm.**
The entire island renders as seven flat average colours with the terrain's
own shading over them. Joshua flew at 21 m and reported it as terrain that
looked wrong; it is not a bug, it is the fade doing exactly what it says,
several hundred times past the range it was tuned for.

## 2. Why raising the fade is not the answer

The instinct is to push `FADE_TO_TEXELS` up until the detail reaches the
horizon. It has been tried and measured:

- **16× is clean.** It is what ships.
- **36× brings the diagonal smearing back**, plainly visible in a
  side-by-side crop. That is the streaking the fade exists to remove.

The reason is geometric, not a matter of tuning. A 4 cm tile seen from 21 m
at a grazing angle puts thousands of texels down the long axis of one
pixel's footprint. Anisotropic filtering will do 16:1 and no more; past
that the hardware blurs along one axis and keeps detail along the other,
and the ground turns into streaks running to the horizon. There is no
threshold that makes a 4 cm pattern legible at 21 m, because at that range
the pattern carries no information a pixel can hold.

**Raising the fade cannot add detail. It can only add aliasing.**

So the answer is not a longer reach for the existing maps. It is a
*different layer*, whose texel size is chosen for the distance it serves.

## 3. What is actually missing

Worth being precise, because it changes the design.

From 21 m, real ground does look smooth. Smoothness is not the complaint.
What the current render lacks is **large-scale variation** — the thing that
survives at altitude and that a per-band average colour cannot express:

- ridge and valley form, picked out by light
- vegetation patchiness: forest against scrub against bare rock
- stream lines, gullies, old lava flows, field edges
- the colour drift across a hillside that is not a function of height alone

The band system is a function of **elevation only** (`h` in the shader).
Two points at the same height are the same colour everywhere on Kauaʻi.
That is invisible underfoot and glaring from the air.

## 4. The design: two layers, each sharp where it can be

### 4a. Analytic relief shading — free, infinitely sharp

Compute the surface normal per fragment from the geometry already there
(`dFdx`/`dFdy` of `vGround`, or the interpolated vertex normal) and shade
with a fixed sun direction plus a curvature term.

This costs nothing, has no texture and no memory, and stays **pixel-sharp
at any altitude** because it is derived from geometry rather than sampled
from a map. It gives ridge definition, valley shadow and slope contrast —
the single biggest part of what "looks like terrain from the air" means.

It should be built first, on its own, and looked at before anything is
downloaded. It may be most of the answer.

*Caveat:* the terrain tiers have different vertex spacing (8 / 32 / 312.5 /
3,125 / 43,750 units), so a normal taken from geometry changes character at
a tier boundary. Take the normal from the **heightfield sampled in the
shader** — no: the heightfield is not on the GPU. Take it from geometry,
but soften the shading with the same `far` term the bands use so the
transition is not a visible edge. This needs a probe.

### 4b. A macro albedo map — soft, but real

One texture covering the whole island, sampled by world position.

**Resolution is set by the data we already have.** The heightfield is
`SAMPLES = 1025` across a `SPAN` of 5,600,000 units, so one grid sample is
5,463 units — about **55 m**. Anything derived from the heightfield is
naturally a 1024² map and nothing is gained by making it larger.

Two sources, in order of cost:

1. **Procedural, baked at load from the grid already downloaded.**
   Elevation, slope, aspect and curvature → colour. Zero extra bytes over
   the wire, and it breaks the "colour is a function of height alone" rule
   that is the actual defect: a steep north-facing slope at 300 m can be
   dark wet forest while a flat bench at 300 m is pasture. Bake to a 1024²
   texture once, after `loadGrid`, on a worker or during the existing
   loading screen — it already has a progress bar with a work-weight slot.

2. **Real satellite albedo**, if (1) is not enough. Sentinel-2 true colour
   at 10 m/px over Kauaʻi, downsampled to 1024² (55 m/px) or 2048²
   (27 m/px). This is the only way to get field edges and genuine
   vegetation patchiness. It is also an asset to source, license, colour-
   match to the band palette, and ship.

Start with (1). It is free and it is testable against (2) later.

### 4c. Memory

| map | RGBA8 + mips |
|---|---|
| current seven band maps @1024 | ~39 MB |
| macro @1024 | ~5.6 MB |
| macro @2048 | ~22 MB |

1024² is a rounding error against what already ships. 2048² is not, and
should not be reached for until 1024² has been looked at on the phone.

## 5. Where it goes in the shader

Today, `terrainMaterial.ts`:

```glsl
float texels = max(length(duvdx), length(duvdy)) * bandTexels;
float far    = smoothstep(fadeFrom, fadeTo, texels);
// ... ground mixes toward the band's average colour by `far`
```

The change is one line of intent: **the detail hands over to the macro
layer instead of to a flat average.**

```glsl
vec3 near  = /* the band blend, as now */;
vec3 macro = texture2D(t_macro, macroUv).rgb * relief_shading;
vec3 out   = mix(near, macro, far);
```

The macro layer gets **its own footprint fade** to the band average, on the
same texels-per-pixel scale — at 55 m a texel it will not strain until the
whole island is on screen, which is exactly the backdrop tier's problem and
is already solved there. One perceptual scale, two layers.

## 6. The float32 trap, which this walks straight into

**This is the part that will break if it is written carelessly**, and it is
the same bug that produced Joshua's east-west stripes.

The macro UV is world position over the island span. Unlike the band tiles,
it *cannot* be folded into a small remainder, because its tile IS the
island: there is no modulo to take. Computing

```glsl
macroUv = (vGround.xz + originOffset) / ISLAND_SPAN;   // WRONG
```

rebuilds the full multi-million-unit world coordinate in float32, which is
precisely what the floating origin exists to prevent. At Kapaʻa that
quantises the UV into visible steps.

**The fix: compute the UV per mesh, on the CPU, in float64.**

Every terrain mesh already knows its own world corner exactly
(`chunkOrigin(cell.id)`, `transitionAt`, `middleAt`, the backdrop's corner).
Pass that corner's UV as a `vec2` uniform and add the *local* offset in the
vertex shader:

```glsl
vMacroUv = cornerUv + position.xz / ISLAND_SPAN;   // position is local, small
```

`cornerUv` is in 0..1 where float32 spacing is about 6e-8 — a third of a
world unit on a 5.6 M span, and far finer than a 5,463-unit texel. The
local `position` never exceeds the mesh's own span. Interpolating the UV
across the triangle is fine for a map this smooth.

**Do not compute the macro UV in the fragment shader from `vGround`.**

## 7. Verification

Nothing here should be judged by looking at a render and saying it seems
better. That is how the fade ended up flat by nine centimetres.

- Extend `npm run probe:reach` to report macro texels-per-pixel against
  distance, the way it already does for the bands.
- Add `npm run probe:altitude`: render the same spot from 0.2 m, 1 m, 5 m,
  21 m and 100 m, and report **mean local contrast** per frame — a direct
  measure of "is there anything on the ground". Today the 21 m figure will
  be near zero, which is the number this work has to move.
- Side-by-side crops at 21 m, before and after, at 932×430.
- Memory: `renderer.info.memory.textures` before and after, on the phone.

## 8. Phasing

1. **Relief shading only.** No assets, no download, no memory. Look at it.
2. **Procedural macro albedo** baked from the grid at load. Still no
   download. Look at it.
3. **Satellite albedo**, only if 1 and 2 leave the island looking synthetic
   from the air.
4. Retune `FADE_FROM/TO` *down* if the macro layer lets the detail hand over
   earlier and more cheaply than it does now.

## 9. What this does not fix

At 21 m the ground will still be soft, because a 55 m texel is soft and
there is no memory on a phone for anything else. It will look like
**terrain** — shaped, varied, lit — rather than like painted cardboard,
which is the actual complaint. Anything sharper at that altitude needs a
clipmap or a virtual texture, which is a different and much larger piece of
work and is not proposed here.
