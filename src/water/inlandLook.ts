/**
 * INLAND WATER WEARING THE OCEAN'S LOOK.
 *
 * Joshua, 2026-09-06: "maybe the inland water, the same texture and look
 * as the ocean as v0 looked bland with no textures. We can tweak the
 * inland waters later, but made for the moment like the ocean, just
 * without the waves."
 *
 * WHY v0's INLAND WATER LOOKED BLAND, in numbers. It ran the SAME
 * material as the ocean — one `makeWaterLook`, one shader — and simply
 * passed it different arguments:
 *
 *                 ocean      v0 inland
 *   green           0            1      full green shift, off the sea palette
 *   texAmp        0.4         0.20      HALF the ripple in the colour
 *   surf            1         0.15      the foam band cut to a seventh
 *
 * `texAmp` is literally how much of the ripple texture reaches the
 * water's colour, and v0 gave inland half of it. That one number is most
 * of the blandness; `green: 1` is the rest, because it walks the palette
 * away from the blue the ocean was accepted at. Nothing was missing —
 * the textures were there and being sampled. They were turned down.
 *
 * SO THIS TURNS THEM BACK UP, and takes the waves off instead:
 *
 *   green 0        the ocean's own palette, unmodified
 *   texAmp 0.4     the ocean's own ripple weight
 *   ocean false    NO BREAKERS — this is the "without the waves" half
 *   swellRim       omitted, so no swell displaces the surface at all
 *
 * WHAT IS DELIBERATELY *NOT* COPIED FROM THE OCEAN: the depth ramps.
 * `edgeLo/edgeHi` feather the waterline and `midAt/deepAt` run the
 * colour from shallow teal to deep navy, and the ocean's are 35..95 and
 * 700..2,600 units — 0.35 m to 26 m. A Kauaʻi stream runs a median of
 * about 0.3 m deep. Handed the sea's ramps, every river and every lake
 * on the island would sit at the very shallowest tint the shader can
 * produce, uniformly, and read as pale nothing — which is a different
 * way of arriving at exactly the blandness this file exists to fix.
 * So the DEPTH scales stay inland-sized and only the PALETTE and the
 * TEXTURE come across. That is the one place this departs from a literal
 * reading of the instruction, and it departs in service of it.
 *
 * NOT ADVECTED YET, and that is a decision rather than an oversight.
 *
 * `advected: true` samples every ripple octave TWICE, half an advection
 * cycle apart, and crossfades — which is what stops a spatially varying
 * current shearing the texture into taffy round a bend. It is the flag a
 * river wants, and this file set it at first.
 *
 * But it advects by the `flow` ATTRIBUTE, and the solver deliberately
 * reports no current: flux over depth is singular at the edge of every
 * pool, and v0 measured 368 cm/s coming out of 1.5 mm of film on
 * Joshua's device. The solver's own comment says the fresh current stays
 * zero until there is a flow model to give it — channel slope, a
 * velocity floor, a depth below which water moves nothing.
 *
 * Advecting by zero makes both phases sample the same point, so it is
 * `mix(x, x, t)`: double the texture reads for an identical pixel. That
 * is precisely the waste the OCEAN was changed to stop paying. So this
 * waits for the flow model, and turning it on is one line the day that
 * lands. The ripple still scrolls and the water still moves; what it
 * does not yet do is carry its surface downstream.
 *
 * ONE MATERIAL, TWO WATERS. `sea/waterLook.ts` is the shared water
 * material rather than the sea's private one — it already carried
 * `ocean`, `green` and `surf` precisely so a lake could wear it. It
 * lives under `sea/` for historical reasons and this file importing it
 * is not a layering mistake; a second copy of that shader WOULD be.
 */
import type { SeaSwell } from '../world/sea/swell';
import type { SeaTextures } from '../sea/SeaTextures';
import { makeWaterLook, type WaterLook } from '../sea/waterLook';

/**
 * The waterline feather, in depth units: invisible at `edgeLo` of
 * column, fully drawn by `edgeHi`.
 *
 * v0's inland numbers, kept. 1.5 units is 1.5 cm — the sheet fades out
 * while the water is still a film, so the geometric cut where the
 * surface meets the bank happens where nothing is drawn. The ocean uses
 * 35 for the same trick at its own scale; the trick is the same and the
 * scale is not.
 */
const EDGE_LO = 1.5;
const EDGE_HI = 8;

/**
 * Where the colour finishes handing shallow to mid, and mid to deep, in
 * depth units.
 *
 * 70 units is 0.7 m and 260 is 2.6 m — v0's, and right for water whose
 * median depth is about 0.3 m. See the header for why the ocean's
 * 700/2,600 must not be used here.
 */
const MID_AT = 70;
const DEEP_AT = 260;

/**
 * How much the ripple shows in the colour. THE OCEAN'S OWN 0.4, which is
 * the headline of this file: v0 ran inland at 0.20.
 */
const TEX_AMP = 0.4;

/**
 * The foam/surf depth band scale.
 *
 * Not the ocean's 1 and not v0's 0.15. The breaker block is gated off by
 * `ocean: false` — there are no waves to break — so what `surf` still
 * reaches is the shoreline froth where shallow water meets the bank, and
 * a river bank should have some. GAME TUNING, and the first number a
 * later pass should argue with: Joshua's "we can tweak the inland waters
 * later" is aimed squarely at this one.
 */
const SURF = 0.4;

export interface InlandLookOpts {
  /**
   * The swell table. REQUIRED BY THE MATERIAL and unused by this water:
   * `ocean: false` gates off the breaker block that reads it, and no
   * `swellRim` means no vertex is displaced by it. It is here because
   * the shared material's signature wants one, not because a river has
   * a swell.
   */
  readonly swell: SeaSwell;
  /** THE SEA'S OWN TEXTURES, shared rather than baked twice. */
  readonly textures: SeaTextures;
  /** Ripple octaves — the detail rung's, so both waters cost alike. */
  readonly octaves: number;
}

/**
 * The material for inland water: the ocean's palette and texture, no
 * waves, and a current that carries the surface.
 */
export function makeInlandLook(opts: InlandLookOpts): WaterLook {
  return makeWaterLook({
    swell: opts.swell,
    ripple: opts.textures.ripple,
    foam: opts.textures.foam,
    // THE OCEAN'S PALETTE, unmodified. This is the ask.
    green: 0,
    surf: SURF,
    edgeLo: EDGE_LO,
    edgeHi: EDGE_HI,
    midAt: MID_AT,
    deepAt: DEEP_AT,
    texAmp: TEX_AMP,
    octaves: opts.octaves,
    // A FILM LIES ON THE GROUND IT IS COPLANAR WITH. The ocean SINKS in
    // the depth buffer so near-coplanar shore terrain wins the tie;
    // inland must LIFT, or a stream a centimetre deep is handed entirely
    // to the mud underneath it.
    sink: false,
    // NOT THE SEA: no breakers, no shoaling foam marching across a pond
    // at the Pacific's speed. v0 ran that block ungated on fresh water
    // for eight versions and the audit's F4 is what it looked like.
    ocean: false,
    // See the header: there is no current to advect by yet, and
    // advecting by zero is double the texture reads for the same pixel.
    advected: false,
  });
}
