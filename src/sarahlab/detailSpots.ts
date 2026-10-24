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
 What is over her uses them two ways (`clothDetail.ts` draws both):
 * - the cloth tee (`clothShirt.ts`) keeps clear of a proud detail in a dome, and draws them through its fabric;
 * - the FITTED tee carries her navel modelled into it -- a dome over her outie, 8-9 mm high at 100% -- and nothing at
 *   her nipples (it bridges her bust 8-10 mm off them). So NAVEL DETAIL SETTLES its
 *   own navel onto the tee's smooth surface there (`TeeNavel`, below), and BREAST DETAIL draws her nipples through it
 *   as on the cloth.
 *
 * Every position is WORLD (the room's, 100 to the metre).
 */
import type { ClothDetailSettle, ClothDetailState } from './clothDetail';

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
 * - The fitted tee bridges her bust about FITTED_NIPPLE_GAP (9 mm, measured) off her nipples, so a nipple's relief is
 *   drawn on it that far out along her normal: at her skin, the shading's own fade with depth lost a third of it.
 * - The cloth over a detail standing proud (an outie navel, a nipple): kept clear of it by a dome centred on its
 *   tip, flat across DOME_IN of that ring's radius and falling to her smooth surface at DOME_OUT, which widens to
 *   WIDE_OUT as the detail is hidden, so a hidden one is a gentle rise rather than a bump. The flat top is wider than
 *   the cloth's own spacing (about 11 mm: DOME_IN is 9-13 mm), so no triangle of cloth over the tip has a corner on
 *   the slope and dips below it. A nipple is domed only as BREAST DETAIL hides it; a proud navel always, or it comes up
 *   through the cloth between particles (the dark spot on the phone, 2026-10-24).
 */
export const DETAIL_LOOK = Object.freeze({ navelRadius: 0.35, innieThrough: 0.5, nippleRadius: 0.3, nippleRelief: 0.3, domeIn: 0.5, domeOut: 0.9, wideOut: 1.6, fittedNippleGap: 0.9 });

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

  /**
   * What the FITTED tee shows: her nipples drawn through it as on the cloth (it has no nipple of its own), and its own
   * modelled navel settled onto its smooth surface by what NAVEL DETAIL hides (none at 100%, all of it at 0). No navel
   * is shaded onto it: at full detail its own modelled navel is the navel.
   */
  fitted(keep: DetailKeepLike, navel: TeeNavel | null): ClothDetailState {
    const L = DETAIL_LOOK;
    return {
      navel: null,
      nipples: this.nipples.slice(0, this.points.nipples.length).map((d) => {
        const g = L.fittedNippleGap;
        return { center: [d.c[0] + d.n[0] * g, d.c[1] + d.n[1] * g, d.c[2] + d.n[2] * g] as [number, number, number], normal: d.n, height: L.nippleRelief * clamp01(keep.nipple), radius: L.nippleRadius * d.rho };
      }),
      settle: navel?.settle(1 - clamp01(keep.navel)) ?? null,
    };
  }
}

/** The fitted tee's navel: points of its outer layer on her navel's axis, and round it where its navel has died away. */
export interface TeeNavelPoints {
  /** On the axis: the tee's navel itself (its height over the smooth surface is the probe's reading). */
  readonly centre: readonly number[];
  /** 30 to 50 mm out, sixteen sectors in two rings: the tee's smooth surface is fitted through them. */
  readonly fit: readonly number[];
}

/**
 * The light tee's (`public/models/sarah-v2-spandex-lite.glb`), found by `scripts/sarahV2Recovery/tee-detail.mjs` at
 * its own 100% reference; `tests/sarahLiteTeeNavel.test.ts` checks them against the files.
 */
export const SARAH_V2_LITE_TEE_NAVEL: TeeNavelPoints = Object.freeze({
  centre: [13905, 13980, 13898, 13979, 13981, 13906, 13982, 13983],
  fit: [
    9995, 9971, 9953, 9935, 9931, 9912, 1984, 1979, 1960, 1958, 10953, 10949, 10793, 10264, 10263, 9970, 9955, 9936,
    9929, 9914, 9903, 1982, 1978, 1961, 1926, 8331, 10732, 10735, 10788, 10606, 9996,
  ],
});

/**
 * How the fitted tee's navel is settled (`clothDetail.ts`). The window reaches OUTER of the fit points' mean distance
 * from the axis (45 mm at her reference, so 32 mm: just inside the fit points, where the tee's navel has died away to
 * a millimetre or so at every belly) and is whole within INNER of that (18 mm). The tee is THICKNESS thick (0.9 mm
 * between its layers, measured), and a point standing more than REACH off its smooth surface is the back of the tee,
 * left alone. The settle is off while the tee is not over her navel: its navel points more than OFF_AXIS from her
 * navel's axis, or its fit points' mean distance from it outside RING (4.5 cm at her reference). World units (cm).
 */
export const SETTLE_LOOK = Object.freeze({ outer: 0.72, inner: 0.55, thickness: 0.09, reach: 2.5, offAxis: 1, ring: [2.5, 7] as const });

/**
 * THE FITTED TEE'S OWN NAVEL, measured each frame against hers. Its `fit` points, posed (`skinPose.ts`), are laid
 * against her navel's axis (`DetailSpots`'s navel: her smooth surface's normal there and the outer ring's centre), and
 * the tee's smooth surface is fitted through them by least squares as a quadric -- along the axis, `h + a·x + b·y +
 * c·x² + d·x·y + e·y²` at (x, y) across it: tilted, and curved differently up and across, as her belly is. (A round
 * paraboloid left up to 4 mm of error 20-30 mm out; this leaves about 1.) That surface is what NAVEL DETAIL settles the
 * tee onto. At her reference the settled tee stays 1.4 mm off her with her own navel settled under it (`tee-detail.mjs`
 * measures it; `tests/sarahLiteTeeNavel.test.ts` holds it); at other sizes the room's fitting shapes, written onto the tee
 * on the CPU, change it, and the room's probe reads it (`?probe=cloth`, `fitted()`).
 */
export class TeeNavel {
  /** The tee's navel over its smooth surface on the axis, world (a dome +, a hole -), as last measured. */
  relief = 0;
  /** For a probe: how the last fit stood -- its centre points' mean distance off her navel's axis, the fit points' mean, least and most distance from it, and how many fell in each quarter round it. */
  readonly last = { off: 0, ring: 0, near: 0, far: 0, quarters: [0, 0, 0, 0] };
  private ok = false;
  private readonly c: [number, number, number] = [0, 0, 0];
  private readonly n: [number, number, number] = [0, 0, 1];
  private h = 0;
  private readonly l: [number, number, number] = [0, 0, 0];
  private readonly q = new Array<number>(9).fill(0);
  private outer = 0;
  private readonly at = new Float32Array(3);
  private readonly M = Array.from({ length: 6 }, () => new Float64Array(7));

  constructor(readonly points: TeeNavelPoints) {}

  /** Fit the tee's smooth surface round her navel's axis as both stand now; false (and no settle) if it cannot be fitted. */
  measure(tee: Poser, axis: Posed): boolean {
    const n = axis.n, base = axis.base;
    this.c[0] = base[0]; this.c[1] = base[1]; this.c[2] = base[2];
    this.n[0] = n[0]; this.n[1] = n[1]; this.n[2] = n[2];
    // across the axis: world x made square to it (world z if the axis runs along x), and the third
    let ux = 1 - n[0] * n[0], uy = -n[0] * n[1], uz = -n[0] * n[2];
    if (Math.hypot(ux, uy, uz) < 0.1) { ux = -n[2] * n[0]; uy = -n[2] * n[1]; uz = 1 - n[2] * n[2]; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const wx = n[1] * uz - n[2] * uy, wy = n[2] * ux - n[0] * uz, wz = n[0] * uy - n[1] * ux;
    const M = this.M, P = this.at;
    for (const row of M) row.fill(0);
    let reach = 0, first = true;
    this.last.quarters.fill(0);
    const f = [0, 0, 0, 0, 0, 0];
    for (const v of this.points.fit) {
      tee.posedVertex(v, P);
      const dx = P[0] - base[0], dy = P[1] - base[1], dz = P[2] - base[2];
      const along = dx * n[0] + dy * n[1] + dz * n[2], x = dx * ux + dy * uy + dz * uz, y = dx * wx + dy * wy + dz * wz;
      f[0] = 1; f[1] = x; f[2] = y; f[3] = x * x; f[4] = x * y; f[5] = y * y;
      for (let i = 0; i < 6; i++) { M[i][6] += f[i] * along; for (let j = 0; j < 6; j++) M[i][j] += f[i] * f[j]; }
      const r = Math.hypot(x, y);
      reach += r;
      if (first) { this.last.near = r; this.last.far = r; first = false; } else { this.last.near = Math.min(this.last.near, r); this.last.far = Math.max(this.last.far, r); }
      this.last.quarters[(Math.floor((Math.atan2(y, x) / (Math.PI / 2)) + 4) % 4)]++;
    }
    const k = solve6(M);
    this.ok = !!k && this.points.fit.length > 0;
    if (!k || !this.ok) { this.relief = 0; return false; }
    this.outer = (reach / this.points.fit.length) * SETTLE_LOOK.outer;
    this.h = k[0];
    for (let i = 0; i < 3; i++) this.l[i] = k[1] * [ux, uy, uz][i] + k[2] * [wx, wy, wz][i];
    // the surface is h + L·t - t·Q t, so Q is minus the quadratic part: c·UU + (d/2)(UW + WU) + e·WW
    const U = [ux, uy, uz], W = [wx, wy, wz];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.q[i * 3 + j] = -(k[3] * U[i] * U[j] + (k[4] / 2) * (U[i] * W[j] + W[i] * U[j]) + k[5] * W[i] * W[j]);
    // the tee's navel itself: its centre points' heights over that surface, and how far they stand off her navel's axis
    let rel = 0, off = 0;
    for (const v of this.points.centre) {
      tee.posedVertex(v, P);
      const dx = P[0] - base[0], dy = P[1] - base[1], dz = P[2] - base[2];
      const along = dx * n[0] + dy * n[1] + dz * n[2], x = dx * ux + dy * uy + dz * uz, y = dx * wx + dy * wy + dz * wz;
      rel += along - (k[0] + k[1] * x + k[2] * y + k[3] * x * x + k[4] * x * y + k[5] * y * y);
      off += Math.hypot(x, y);
    }
    const centres = Math.max(1, this.points.centre.length), ring = reach / this.points.fit.length;
    this.last.off = off / centres; this.last.ring = ring;
    // The tee is not over her navel (it rides up off a big belly, or its points have strayed): no settle. Its navel
    // points stand on her navel's axis at its reference and its fit points 30-50 mm round it; far off either, the
    // surface fitted through them is not the tee round her navel, and settling the tee onto it pulls its hem about.
    if (off / centres > SETTLE_LOOK.offAxis || ring < SETTLE_LOOK.ring[0] || ring > SETTLE_LOOK.ring[1]) { this.ok = false; this.relief = 0; return false; }
    this.relief = rel / centres;
    return true;
  }

  /** The settle for `amount` (0..1) of the tee's navel taken back, or null if the surface was not fitted. */
  settle(amount: number): ClothDetailSettle | null {
    if (!this.ok) return null;
    return {
      center: [this.c[0], this.c[1], this.c[2]], normal: [this.n[0], this.n[1], this.n[2]],
      height: this.h, slope: [this.l[0], this.l[1], this.l[2]], curvature: this.q.slice(),
      inner: this.outer * SETTLE_LOOK.inner, outer: this.outer,
      amount: clamp01(amount), thickness: SETTLE_LOOK.thickness, reach: SETTLE_LOOK.reach,
    };
  }
}

/** Solve six normal equations in place (each row: six coefficients, then the right side); null if singular. */
function solve6(A: Float64Array[]): number[] | null {
  for (let c = 0; c < 6; c++) {
    let p = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > 1e-12)) return null;
    if (p !== c) { const t = A[c]; A[c] = A[p]; A[p] = t; }
    for (let r = 0; r < 6; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k < 7; k++) A[r][k] -= f * A[c][k];
    }
  }
  const out = A.map((row, i) => row[6] / row[i]);
  return out.every(Number.isFinite) ? out : null;
}
