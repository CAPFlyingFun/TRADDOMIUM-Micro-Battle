/**
 * HER NAVEL AND NIPPLES, FOLLOWED ON HER EVERY FRAME, FOR WHATEVER IS OVER THEM (Joshua, 2026-10-24: "the breast
 * slider has no effect on the outfit… it still should have a visible effect"; "the bellybutton also doesn't appear
 * with the slider… the overrides should be working").
 *
 * Each detail is a vertex of her body with two rings of skin round it, an inner and an outer, found once by the cloth
 * bake (`scripts/sarahV2Recovery/shirt-cloth.mjs`, recorded in the cloth file and here, for the fitted tee, which does
 * not load that file; `tests/sarahClothTee.test.ts` holds the two equal). Posed each frame, the rings say how her
 * SMOOTH surface lies there without the detail -- its outward normal (the outer ring's winding, counter-clockwise from
 * the front), and its curve (a curved belly or breast puts the outer ring lower than the inner one) -- and so how far
 * the detail itself stands above it: an outie navel or a nipple positive, an innie's depth negative.
 *
 * The cloth tee (`clothShirt.ts`) keeps clear of a proud detail in a dome, and draws them through its fabric
 * (`clothDetail.ts`). They are measured here, apart from the cloth, so the fitted tee can follow them too.
 *
 * Every position is WORLD (the room's, 100 to the metre).
 */
import type { ClothDetailState } from './clothDetail';

/** Her navel and nipples on her body, by vertex, each with its inner and outer ring of skin. */
export interface DetailPoints {
  readonly navel: number;
  readonly navelRings: readonly (readonly number[])[];
  readonly nipples: readonly number[];
  readonly nippleRings: readonly (readonly (readonly number[])[])[];
}

/**
 * Sarah v2's (`public/models/sarah-v2-body-slim.glb`), as the cloth bake found them on her approved body at 100%:
 * her navel the vertex her navel shapes move most, each nipple her breast's apex, the rings 2.2-3 cm and 3.6-4.4 cm round.
 */
export const SARAH_V2_DETAIL_POINTS: DetailPoints = Object.freeze({
  navel: 22088,
  navelRings: [
    [21999, 21968, 21938, 21915, 63374, 63373, 63372, 63655, 63668, 63527, 61783, 71370, 23541, 23544, 22004],
    [21990, 21979, 21906, 21908, 63218, 63365, 63371, 74917, 63639, 61785, 61772, 61437, 23537, 23430, 23424, 22003],
  ],
  nipples: [36410, 61079],
  nippleRings: [
    [
      [37818, 36366, 36348, 26552, 26526, 26515, 26591, 26497, 31114, 31102, 31103, 30902, 30813, 30812, 30578, 30574],
      [35447, 36319, 36363, 35683, 26521, 26401, 26405, 26504, 36269, 30939, 30923, 30901, 30777, 30771, 30570, 30547],
    ],
    [
      [60958, 61098, 61106, 61113, 89353, 89291, 89285, 89223, 89163, 67236, 66882, 66834, 66832, 66778, 60962],
      [60955, 61058, 61123, 61122, 89318, 89329, 89298, 89157, 66940, 67239, 67231, 66879, 66878, 66864, 66782, 60926],
    ],
  ],
});

/** Anything that can say where a vertex of her body is now, world: `ClothSkin` (the cloth's) or `SkinPose` (alone). */
export interface Poser { posedVertex(v: number, out: Float32Array | number[], o?: number): void }

/**
 * One detail as posed this frame: its centre, her smooth surface's outward normal there, the outer ring's plane centre
 * (`base`), the inner ring's radius (`rho`), the smooth surface's rise over that plane, `curve × (reach2 − r²)` at r
 * from it, and how far the detail stands above that surface at its centre (`h`).
 */
export interface Posed { readonly c: [number, number, number]; readonly n: [number, number, number]; readonly base: [number, number, number]; rho: number; curve: number; reach2: number; h: number }
const posed = (): Posed => ({ c: [0, 0, 0], n: [0, 0, 1], base: [0, 0, 0], rho: 1, curve: 0, reach2: 1, h: 0 });

/**
 * How her navel and nipples show through a tee. Art-direction numbers, Joshua's to change; the BREAST and NAVEL
 * DETAIL sliders scale what they give.
 * - The shading (clothDetail.ts): each relief's radius against the detail's own inner ring of skin, how much of an
 *   innie's depth the fabric dips into (it bridges the rest), and a nipple's relief at full detail (world units, cm).
 * - The cloth over a detail standing proud (an outie navel, a nipple): kept clear of it in a dome reaching DOME_IN
 *   to DOME_OUT of that ring's radius, which widens to WIDE_OUT as the detail is hidden, so a hidden one is a gentle
 *   rise rather than a bump. A nipple is domed only as BREAST DETAIL hides it; a proud navel always, or it comes up
 *   through the cloth between particles (the dark spot on the phone, 2026-10-24).
 */
export const DETAIL_LOOK = Object.freeze({ navelRadius: 0.35, innieThrough: 0.5, nippleRadius: 0.3, nippleRelief: 0.3, domeIn: 0.35, domeOut: 0.8, wideOut: 1.6 });

/** BREAST and NAVEL DETAIL: 0 hidden, 1 all of it. */
export interface DetailKeepLike { readonly nipple: number; readonly navel: number }
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

export class DetailSpots {
  readonly navel: Posed = posed();
  readonly nipples: Posed[] = [posed(), posed()];
  private ringAt = new Float32Array(48);
  private readonly ringM = [[0, 0, 0], [0, 0, 0]];

  constructor(readonly points: DetailPoints) {}

  /** Follow every detail on her as the poser has her now. */
  measure(poser: Poser): void {
    const p = this.points;
    this.one(poser, p.navel, p.navelRings, this.navel);
    p.nipples.forEach((v, i) => { if (i < 2 && p.nippleRings[i]) this.one(poser, v, p.nippleRings[i], this.nipples[i]); });
  }

  /** One detail measured from its centre and its rings. */
  private one(poser: Poser, centre: number, rings: readonly (readonly number[])[], out: Posed): void {
    poser.posedVertex(centre, out.c);
    const ring = (around: readonly number[], m: number[], nrm: number[] | null): number => {
      const count = around.length, P = this.ringAt.length >= count * 3 ? this.ringAt : (this.ringAt = new Float32Array(count * 3));
      m[0] = m[1] = m[2] = 0;
      for (let j = 0; j < count; j++) { poser.posedVertex(around[j], P, j * 3); m[0] += P[j * 3]; m[1] += P[j * 3 + 1]; m[2] += P[j * 3 + 2]; }
      m[0] /= count; m[1] /= count; m[2] /= count;
      let r = 0, nx = 0, ny = 0, nz = 0;
      for (let j = 0; j < count; j++) {
        const a = j * 3, b = ((j + 1) % count) * 3;
        const ax = P[a] - m[0], ay = P[a + 1] - m[1], az = P[a + 2] - m[2], bx = P[b] - m[0], by = P[b + 1] - m[1], bz = P[b + 2] - m[2];
        nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx;
        r += Math.hypot(ax, ay, az);
      }
      if (nrm) { const l = Math.hypot(nx, ny, nz) || 1; nrm[0] = nx / l; nrm[1] = ny / l; nrm[2] = nz / l; }
      return r / count;
    };
    const inner = this.ringM[0], outer = this.ringM[1];
    out.rho = ring(rings[0], inner, null);
    const rhoB = ring(rings[rings.length - 1], outer, out.n);
    const nn = out.n, dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    out.base[0] = outer[0]; out.base[1] = outer[1]; out.base[2] = outer[2];
    // the smooth surface over the outer ring's plane, rising by curve x (outer radius^2 - r^2): through the inner ring
    const rise = dot([inner[0] - outer[0], inner[1] - outer[1], inner[2] - outer[2]], nn), span = rhoB * rhoB - out.rho * out.rho;
    out.curve = span > 1e-6 ? rise / span : 0;
    out.reach2 = rhoB * rhoB;
    out.h = dot([out.c[0] - outer[0], out.c[1] - outer[1], out.c[2] - outer[2]], nn) - out.curve * out.reach2;
  }

  /**
   * What the CLOTH tee draws through its fabric (it carries no relief of its own): her navel at NAVEL DETAIL (an
   * innie's depth only partly, the fabric bridging the rest), a nipple's relief at BREAST DETAIL.
   */
  cloth(keep: DetailKeepLike): ClothDetailState {
    const L = DETAIL_LOOK, nv = this.navel;
    return {
      navel: { center: nv.c, normal: nv.n, height: (nv.h >= 0 ? nv.h : nv.h * L.innieThrough) * clamp01(keep.navel), radius: L.navelRadius * nv.rho },
      nipples: this.nipples.slice(0, this.points.nipples.length).map((d) => ({ center: d.c, normal: d.n, height: L.nippleRelief * clamp01(keep.nipple), radius: L.nippleRadius * d.rho })),
    };
  }
}
