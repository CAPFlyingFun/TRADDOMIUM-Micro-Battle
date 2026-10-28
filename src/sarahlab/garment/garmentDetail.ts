/**
 * HER NAVEL AND NIPPLES UNDER THE PROCEDURAL GARMENT: the cloth tee's own method (`clothShirt.ts` `follow` and `dome`),
 * brought across as Joshua asked (2026-10-27: "look at the current method we did for the navel and nipples as they are
 * poking through the shirt"). Her body is never hidden; the garment has to clear her by itself.
 *
 * Each detail (`detailSpots.ts`, followed on her every frame) that stands proud of her smooth surface -- an outie navel,
 * a nipple -- gets a DOME standing in for her skin under every particle within it: a floor square to the detail's axis,
 * right under the particle, at the dome's height there, flat across DETAIL_LOOK.domeIn of the detail's inner ring at
 * the tip's height and DOME_MARGIN more, falling smoothly to her smooth surface at DETAIL_LOOK.domeOut. Along the axis
 * the cloth only rises; pushed out along her skin's normal on the tip's flank instead, it was shoved sideways off the
 * tip and her detail came up between two particles (the cloth tee's dark spot, 2026-10-24).
 *
 * BREAST and NAVEL DETAIL work as they do on the cloth tee (Joshua, 2026-10-27: "both should behave exactly the same
 * way"): `keep` is the room's two sliders, the navel's dome is always whole and widens as NAVEL DETAIL hides it, a
 * nipple's dome is as high and as wide as BREAST DETAIL hides it, and `shading` is what the room draws through the
 * fabric (`clothDetail.ts`), the cloth tee's own `DetailSpots.cloth`. Under every setting the cloth still clears her
 * TIP: the tent from the tip (DOME_MARGIN above it, falling at TENT_SLOPE) stands under the cloth even where BREAST
 * DETAIL lowers the dome to nothing, so a full BREAST DETAIL shows her nipple's shape in the fabric and never her skin
 * through it.
 *
 * Friction holds the cloth to the motion of her skin under each particle (`SkinContacts.carried` less last frame's
 * contact). Where a dome stood in for her skin last frame, last frame's contact is the dome's floor, so the carried
 * point is moved to match -- exactly as the cloth tee does.
 *
 * Every position is WORLD (the room's, 100 to the metre).
 */
import type { SkinContacts } from '../clothTypes';
import type { ClothDetailState } from '../clothDetail';
import { DETAIL_LOOK, DetailSpots, type DetailPoints, type Poser, type Posed } from '../detailSpots';

/** How far a dome's top stands above her detail's tip, world units (0.5 mm): the cloth is flat between its particles. */
export const DOME_MARGIN = 0.05;
/** Beyond the dome's flat top, the floor under the cloth falls from the tip's height no faster than this (rise / run). */
export const TENT_SLOPE = 0.35;
/** How far from her navel's axis (in its inner ring's radii) a cloth point may be and still be laid on it as the apex. */
export const APEX_REACH = 0.8;
/** The highest the apex stands over her smooth surface, in her navel's own relief at its tip (DOME_MARGIN more). */
export const APEX_MAX = 3;
/** How much wider than the triangle over a tip its dome's flat top is kept (the cloth moves between frames). */
export const SPACING_SLACK = 1.15;
/** How fast a detail's drawn relief spreads with the cloth's distance off its tip beyond touching (radius per unit of gap). */
export const SHADE_SPREAD = 1;
/**
 * A cap on how steep the drawn relief may be (rise over run), for a probe (`shade.slope`; off by default). Tried for
 * the hard dark crescent under her navel on the coarse cloth, and set aside: Joshua wanted the cloth tee's definite
 * shape (2026-10-27: "It doesn't match the red shirt and not a definite shape"), which the finer mesh at her details
 * now carries (`roomGarment.ts` DETAIL_MESH), with the tee's own relief on it.
 */
export const SHADE_SLOPE = 0.5;
/** How much wider than the cloth tee's her navel's relief may be drawn, for a probe (`shade.grow`; 1, the tee's, by default). */
export const SHADE_NAVEL_GROW = 1.5;
/** The outer share of the dome over which the tent gives way to her smooth surface (no step at the dome's edge). */
export const TENT_FADE = 0.5;

/** Her body at rest, for finding each detail's tip vertices once: her vertex count and a vertex's rest position. */
export interface RestBody { readonly count: number; at(v: number, out: number[]): void }

/**
 * Where a detail's TIP is this frame: the tallest of the vertices around its centre. On Sarah the nipple's centre
 * vertex (`SARAH_V2_DETAIL_POINTS`) is not its tip: the tip vertices stand about 3 mm higher along the axis, and the
 * dome laid at the centre's height let them through the cloth (Joshua, 2026-10-27). `k` is the tip across the axis
 * from the outer ring's centre, `along` its height along the axis from there, `top` the most any of them stands above
 * her smooth surface.
 */
export interface Tip { readonly at: [number, number, number]; readonly k: [number, number, number]; along: number; top: number }
const tip = (): Tip => ({ at: [0, 0, 0], k: [0, 0, 0], along: 0, top: 0 });

export class GarmentDetail {
  private readonly spots: DetailSpots;
  /** Her skin under each particle last frame, before any dome stood in for it. */
  private readonly lastSkin: Float32Array;
  /** The vertices around each detail's centre (navel, then each nipple), within its inner ring at rest; null without `rest`. */
  private readonly around: (Int32Array | null)[];
  /** Each detail's tip this frame (navel, then each nipple). */
  readonly tips: Tip[] = [tip(), tip(), tip()];
  /** BREAST and NAVEL DETAIL (0 hidden, 1 all of it), set by the room: the cloth tee's own default until it is. */
  keep: { nipple: number; navel: number } = { nipple: 0.45, navel: 0.8 };
  private readonly q = [0, 0, 0];

  /**
   * How far from each detail's axis the corners of the cloth's triangle over its tip stand this frame (navel, then
   * each nipple; SPACING_SLACK more), world units: the dome's flat top is at least this wide (`domeOver`'s `flat`), so
   * every corner of the triangle over the tip stands on it and the cloth between them clears the tip. Without it, at
   * 100% belly her navel's flat top (half its inner ring, 0.9 cm) was narrower than the cloth's spacing (about 1.4 cm,
   * the garment cut for her belly), and her navel came up through a triangle whose corners stood beside it. (The
   * longest edge NEAR the tip was the first measure, and it found a 3.7 cm edge of a fold beside her navel: a flat top
   * 7 cm across, a mesa on her belly with a rim (Joshua, 2026-10-27: "It doesn't look smooth").)
   */
  readonly spacing = [0, 0, 0];
  /** How much wider each detail's flat top is than the cloth tee's (`spacing` past DETAIL_LOOK.domeIn of its inner ring), now. */
  readonly widened = [0, 0, 0];
  /** The corners of the cloth's triangle over each detail's tip this frame (3 per detail; -1 where none is). */
  readonly cover = new Int32Array(9).fill(-1);
  /** The cloth point held over her navel's tip this frame (`apexOver`), or -1. */
  apex = -1;
  /** How far along her navel's axis the apex is held this frame (`apexHeight`; from the outer ring's plane). */
  apexAlong = 0;
  /** Her navel's vertices round its tip this frame: across the axis from the outer ring's centre (3) and above her smooth surface (1). */
  private relief = new Float32Array(0);
  private reliefCount = 0;
  /** How the drawn relief is softened (`shading`): by the cloth's distance off the tip, by the widened flat top, and the steepest it may be. */
  shade: { spread: number; widen: number; slope: number; grow?: number } = { spread: SHADE_SPREAD, widen: 0, slope: Infinity, grow: 1 };

  constructor(points: DetailPoints, count: number, private readonly domes = true, rest?: RestBody, private readonly triangles?: Uint32Array) {
    this.spots = new DetailSpots(points);
    this.lastSkin = new Float32Array(count * 3);
    const details: [number, readonly (readonly number[])[]][] = [[points.navel, points.navelRings], ...points.nipples.slice(0, 2).map((v, i) => [v, points.nippleRings[i]] as [number, readonly (readonly number[])[]])];
    // a nipple's tip is found within its inner ring; her navel's whole shape within its OUTER ring, since at 100% belly
    // and full NAVEL DETAIL her outie spreads past the inner one and came up through the cloth beside its apex
    this.around = details.map(([centre, rings], i) => (rest && rings?.length ? aroundOf(rest, centre, i === 0 ? rings[rings.length - 1] : rings[0]) : null));
  }

  /** Her navel and nipples as posed now (for a probe). */
  get posed(): { readonly navel: Posed; readonly nipples: readonly Posed[] } { return { navel: this.spots.navel, nipples: this.spots.nipples.slice(0, this.spots.points.nipples.length) }; }

  /**
   * After the skin's update and before the step: carry friction over last frame's domes (unless `fresh`, when nothing
   * was carried), then lay this frame's domes into `after` for the `count` particles at `positions`.
   */
  follow(poser: Poser, positions: Float32Array, after: SkinContacts, before: SkinContacts, count: number, fresh: boolean): void {
    const n3 = count * 3, A = after, B = before, last = this.lastSkin;
    if (!fresh) for (let k = 0; k < n3; k++) A.carried[k] = B.point[k] + (A.carried[k] - last[k]);
    last.set(A.point.subarray(0, n3));
    this.spots.measure(poser);
    const ds = [this.spots.navel, ...this.spots.nipples.slice(0, this.spots.points.nipples.length)];
    ds.forEach((d, i) => this.tipOf(poser, d, i));
    ds.forEach((d, i) => { this.spacing[i] = this.spacingNear(positions, d, this.tips[i], i); this.widened[i] = Math.max(0, this.spacing[i] - DETAIL_LOOK.domeIn * d.rho); });
    if (!this.domes) return;
    // as the cloth tee lays them (`clothShirt.ts` `follow`): her navel's dome whole, widened by what NAVEL DETAIL hides;
    // a nipple's as high and as wide as BREAST DETAIL hides it
    const k = this.keep, nav = clamp01(k.navel), nip = clamp01(k.nipple);
    // the cloth tee's own dome, its height at the tip, with the three corners of the cloth's triangle over the tip held
    // at the tip's height: a tent, as the cloth tee's own outie is, rather than a flat top as wide as the triangle
    // her navel: the cloth point nearest its axis is laid ON the axis, the apex of a tent over it (`apexOver`)
    this.apex = this.apexOver(positions, count, ds[0], this.tips[0]);
    if (this.apex >= 0) this.apexAlong = this.apexHeight(positions, ds[0], this.tips[0], this.apex);
    ds.forEach((d, i) => domeOver(d, positions, A, count, this.around[i] ? this.tips[i] : undefined, i === 0 ? 1 : 1 - nip, i === 0 ? 1 - nav : 1 - nip, 0,
      i === 0 && this.apex >= 0 ? [this.apex] : this.cover.subarray(i * 3, i * 3 + 3), i === 0 && this.apex >= 0 ? this.apexAlong : undefined));
  }

  /**
   * What the room draws through the fabric at BREAST and NAVEL DETAIL `keep` (0 none, 1 all): the cloth tee's own, each
   * spot SOFTENED by how far the cloth stands off its tip beyond touching it. The cloth tee hugs her (it is cut from her
   * skin), so its fabric lies on her navel and the spot's narrow relief matches the fabric's own shape. This garment is
   * cut with ease: at 100% belly it hangs about 8 mm off her navel, smooth, and the same narrow relief drawn on it read
   * as a sticker -- a hard highlight and a crisp shadow on fabric that does not touch her (Joshua, 2026-10-27: "It
   * doesn't look smooth like the other sim shirt"). Fabric lying a distance off a bump shows it spread and shallower,
   * so the spot's radius grows with that distance (√(r² + (SHADE_SPREAD·e)²)) and its height falls as the radius grows
   * (by (r/r')², the relief's volume kept). `gaps` is `GarmentCloth.detailGap` (navel, then the nipples; non-finite:
   * as the tee), `touch` how far off the tip the cloth stands when it lies on it.
   */
  shading(keep: { readonly nipple: number; readonly navel: number }, gaps?: { readonly navel: number; readonly nipples: readonly number[] }, touch = 0): ClothDetailState {
    const base = this.spots.cloth(keep);
    if (!gaps) return base;
    const soften = <T extends { readonly height: number; readonly radius: number }>(spot: T, gap: number | undefined, i: number): T => {
      // spread by the cloth's distance off the tip, and by as much as the dome's flat top was widened past the cloth tee's
      // (`spacing`): the fabric lies flat over that width, so the relief drawn on it is as wide
      const t = this.shade, off = gap === undefined || !Number.isFinite(gap) ? 0 : Math.max(0, gap - touch) * t.spread;
      // `grow`, her navel only: its relief drawn wider than the cloth tee draws it, its height kept. Over her belly at 100%
      // this cloth's triangles are 2 to 3 cm across, too coarse to carry the navel's own shape the way the cloth tee's
      // cone does, and the tee's narrow relief on a smooth sheet read as a sticker; half as wide again reads as a soft
      // bump under the fabric (Joshua's review, 2026-10-27, sheet 8)
      const g = i === 0 && t.grow !== undefined && Number.isFinite(t.grow) && t.grow > 0 ? t.grow : 1, r = spot.radius * g;
      const e = Math.hypot(off, (this.widened[i] ?? 0) * t.widen), r2 = Math.hypot(r, e);
      let h = r2 > r && r > 0 ? spot.height * (r / r2) ** 2 : spot.height;
      // the relief's steepest slope is about 0.86 h / r: past `slope` its far side turns from the light at a hard edge
      if (Number.isFinite(t.slope) && t.slope > 0) h = Math.sign(h) * Math.min(Math.abs(h), (t.slope * Math.max(r2, r)) / 0.86);
      return h === spot.height && r2 <= r && g === 1 ? spot : { ...spot, radius: Math.max(r2, r), height: h };
    };
    return { ...base, navel: base.navel ? soften(base.navel, gaps.navel, 0) : base.navel, nipples: base.nipples.map((n, i) => soften(n, gaps.nipples[i], i + 1)) };
  }

  /**
   * The farthest a corner of the triangle over the tip stands from the detail's axis, now, SPACING_SLACK more: the
   * triangle the line through the tip along the axis crosses nearest the tip (0 without `triangles`, or none crossed).
   */
  private spacingNear(p: Float32Array, d: Posed, t: Tip, i: number): number {
    const T = this.triangles, C = this.cover;
    C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = -1;
    if (!T) return 0;
    const [ox, oy, oz] = t.at, [nx, ny, nz] = d.n, reach2 = (DETAIL_LOOK.wideOut * d.rho * 3) ** 2;
    let best = Infinity, far = 0;
    for (let k = 0; k < T.length; k += 3) {
      const a = T[k] * 3, b = T[k + 1] * 3, c = T[k + 2] * 3;
      if ((p[a] - ox) ** 2 + (p[a + 1] - oy) ** 2 + (p[a + 2] - oz) ** 2 > reach2) continue;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const px = ny * e2z - nz * e2y, py = nz * e2x - nx * e2z, pz = nx * e2y - ny * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = ox - p[a], ty = oy - p[a + 1], tz = oz - p[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (nx * qx + ny * qy + nz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const h = Math.abs((e2x * qx + e2y * qy + e2z * qz) * inv);
      if (h >= best) continue;
      best = h;
      far = 0;
      C[i * 3] = T[k]; C[i * 3 + 1] = T[k + 1]; C[i * 3 + 2] = T[k + 2];
      for (const q of [a, b, c]) {
        const dx = p[q] - ox, dy = p[q + 1] - oy, dz = p[q + 2] - oz, al = dx * nx + dy * ny + dz * nz;
        far = Math.max(far, Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - al * al)));
      }
    }
    return far * SPACING_SLACK;
  }

  /**
   * HER NAVEL'S APEX: the cloth point nearest the navel's axis (within APEX_REACH of its inner ring's radius, and
   * within a body's thickness of the tip along it) is moved across onto the axis this frame, before the step, and held
   * there at the tip's height (`domeOver`'s `lift`). The cloth then stands over her navel as a tent from that one point,
   * as the cloth tee's does (Joshua, 2026-10-27: "It doesn't match the red shirt and not a definite shape"): its own
   * spacing is a centimetre, and with the point nearest the tip held over it the cloth round falls from it to her skin
   * in a cone. Spread across three corners (`cover`), the top was a flat facet 2 to 3 cm wide at 100% belly; meshed
   * finer round the navel, the finer cloth buckled into lumps. Moving it does not set it moving: the step takes its
   * velocity from where it is at the start of each substep. Returns the point, or -1 where no point is near enough
   * (the cloth has ridden off her navel).
   */
  private apexOver(p: Float32Array, n: number, d: Posed, t: Tip): number {
    const [ox, oy, oz] = t.at, [nx, ny, nz] = d.n, reach = APEX_REACH * d.rho, band = 3 * d.rho;
    let best = reach * reach, bi = -1, bx = 0, by = 0, bz = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = p[i3] - ox, dy = p[i3 + 1] - oy, dz = p[i3 + 2] - oz, al = dx * nx + dy * ny + dz * nz;
      if (al < -0.5 * d.rho || al > band) continue;
      const tx = dx - al * nx, ty = dy - al * ny, tz = dz - al * nz, r2 = tx * tx + ty * ty + tz * tz;
      if (r2 < best) { best = r2; bi = i; bx = tx; by = ty; bz = tz; }
    }
    if (bi < 0) return -1;
    p[bi * 3] -= bx; p[bi * 3 + 1] -= by; p[bi * 3 + 2] -= bz;
    return bi;
  }

  /**
   * How high along the axis the apex must stand so the cloth falling from it to its neighbours clears every vertex of
   * her navel: for each of her navel's vertices (`relief`), the triangle of the apex's fan it lies under (seen along
   * the axis), and the cloth's height there (the apex's height H and its two neighbours' as they stand now, weighted as
   * the vertex lies in that triangle) at least the vertex's own height and DOME_MARGIN more. H is at least the tip's own
   * height and at most APEX_MAX of it. Heights are above her smooth surface; the result is along the axis from the outer
   * ring's plane. (Measured against her nearest neighbour alone, the first try, her navel came up through the cloth
   * under the apex toward a farther neighbour: sheet 9, the set-in at 100% belly.)
   */
  private apexHeight(p: Float32Array, d: Posed, t: Tip, apex: number): number {
    const T = this.triangles, [bx, by, bz] = d.base, [nx, ny, nz] = d.n, [kx, ky, kz] = t.k;
    // two directions square to the axis
    let ux = -nz, uy = 0, uz = nx; if (Math.hypot(ux, uy, uz) < 0.1) { ux = 0; uy = nz; uz = -ny; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const smoothAt = (tx: number, ty: number, tz: number) => d.curve * (d.reach2 - (tx * tx + ty * ty + tz * tz));
    const smoothTip = smoothAt(kx, ky, kz), base = Math.max(0, t.top);
    // the apex's fan: each other corner across the axis from the tip (2D) and its height above her smooth surface now
    const fan: number[] = [];
    if (T) for (let k = 0; k < T.length; k += 3) {
      const a = T[k] === apex ? 0 : T[k + 1] === apex ? 1 : T[k + 2] === apex ? 2 : -1;
      if (a < 0) continue;
      for (const c of [(a + 1) % 3, (a + 2) % 3]) {
        const q = T[k + c] * 3, ex = p[q] - bx, ey = p[q + 1] - by, ez = p[q + 2] - bz, al = ex * nx + ey * ny + ez * nz;
        const tx = ex - al * nx, ty = ey - al * ny, tz = ez - al * nz, ox = tx - kx, oy = ty - ky, oz = tz - kz;
        fan.push(ox * ux + oy * uy + oz * uz, ox * vx + oy * vy + oz * vz, al - smoothAt(tx, ty, tz));
      }
    }
    let H = base + DOME_MARGIN;
    const L = this.relief;
    for (let j = 0; j < this.reliefCount; j++) {
      const ox = L[j * 4] - kx, oy = L[j * 4 + 1] - ky, oz = L[j * 4 + 2] - kz, px = ox * ux + oy * uy + oz * uz, py = ox * vx + oy * vy + oz * vz;
      for (let f = 0; f < fan.length; f += 6) {
        const b1 = fan[f], b2 = fan[f + 1], c1 = fan[f + 3], c2 = fan[f + 4], det = b1 * c2 - b2 * c1;
        if (Math.abs(det) < 1e-12) continue;
        const wb = (px * c2 - py * c1) / det, wc = (b1 * py - b2 * px) / det, wa = 1 - wb - wc;
        if (wb < -1e-6 || wc < -1e-6 || wa < -1e-6) continue;
        // a vertex next to the far edge is that edge's to clear, not the apex's
        if (wa > 0.05) H = Math.max(H, (L[j * 4 + 3] + DOME_MARGIN - wb * fan[f + 2] - wc * fan[f + 5]) / wa);
        break;
      }
    }
    return smoothTip + Math.min(H, APEX_MAX * base + DOME_MARGIN);
  }

  /** Detail `i`'s tip this frame: its centre, or the tallest of the vertices around it. */
  private tipOf(poser: Poser, d: Posed, i: number): void {
    const t = this.tips[i], [bx, by, bz] = d.base, [nx, ny, nz] = d.n, q = this.q, list = this.around[i];
    let bestAlong = -Infinity, top = -Infinity;
    const take = (x: number, y: number, z: number): void => {
      const ex = x - bx, ey = y - by, ez = z - bz, al = ex * nx + ey * ny + ez * nz;
      const tx = ex - al * nx, ty = ey - al * ny, tz = ez - al * nz;
      top = Math.max(top, al - d.curve * (d.reach2 - (tx * tx + ty * ty + tz * tz)));
      if (al > bestAlong) { bestAlong = al; t.at[0] = x; t.at[1] = y; t.at[2] = z; t.k[0] = tx; t.k[1] = ty; t.k[2] = tz; }
    };
    take(d.c[0], d.c[1], d.c[2]);
    // her navel's relief round its tip, kept for the apex's height (`apexHeight`): across the axis, and above her smooth surface
    const keep = i === 0 && list ? (this.relief.length >= list.length * 4 ? this.relief : (this.relief = new Float32Array(list.length * 4))) : null;
    if (list) for (let j = 0; j < list.length; j++) {
      poser.posedVertex(list[j], q); take(q[0], q[1], q[2]);
      if (keep) {
        const ex = q[0] - bx, ey = q[1] - by, ez = q[2] - bz, al = ex * nx + ey * ny + ez * nz, tx = ex - al * nx, ty = ey - al * ny, tz = ez - al * nz;
        keep[j * 4] = tx; keep[j * 4 + 1] = ty; keep[j * 4 + 2] = tz; keep[j * 4 + 3] = al - d.curve * (d.reach2 - (tx * tx + ty * ty + tz * tz));
      }
    }
    if (keep) this.reliefCount = list!.length;
    t.along = bestAlong; t.top = top;
  }
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** The vertices within `ring`'s mean radius of `centre`, at rest. */
function aroundOf(rest: RestBody, centre: number, ring: readonly number[]): Int32Array {
  const c = [0, 0, 0], q = [0, 0, 0];
  rest.at(centre, c);
  let r = 0;
  for (const v of ring) { rest.at(v, q); r += Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]); }
  r /= ring.length || 1;
  const out: number[] = [];
  for (let v = 0; v < rest.count; v++) { if (v === centre) continue; rest.at(v, q); if ((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 < r * r) out.push(v); }
  return Int32Array.from(out);
}

/**
 * One detail's dome (the cloth tee's `dome`, its height taken at the tip): every particle within it whose skin lies
 * below the dome there gets the dome's floor, along the detail's axis, as its contact and the axis as its normal. `flat`
 * widens its flat top to the cloth's spacing there when that is wider, and moves its fall out with it.
 * `amount` scales the dome's height (0 none) and `hide` widens it toward DETAIL_LOOK.wideOut, exactly as on the cloth
 * tee; the tent from the tip stands under it at every amount, so the cloth never passes under the tip. `lift`: the
 * particles held at the tip's height (DOME_MARGIN above it) wherever they are -- the corners of the cloth's triangle
 * over the tip, so the cloth between them clears it however coarse the cloth is there.
 */
export function domeOver(d: Posed, p: Float32Array, A: SkinContacts, n: number, tipNow?: Tip, amount = 1, hide = 0, flat = 0, lift?: ArrayLike<number>, liftTo?: number): void {
  // the flat top at least `flat` wide (the cloth's spacing there, `GarmentDetail.spacing`), the fall beyond it as wide as ever
  const L = DETAIL_LOOK, rin0 = L.domeIn * d.rho, rin = Math.max(rin0, flat > 0 && Number.isFinite(flat) ? flat : 0);
  const rout = (L.domeOut + (L.wideOut - L.domeOut) * clamp01(hide)) * d.rho + (rin - rin0), rout2 = rout * rout;
  const [bx, by, bz] = d.base, [nx, ny, nz] = d.n, smooth0 = d.curve * d.reach2, q = A.point, qn = A.normal;
  let kx: number, ky: number, kz: number, ca: number, top: number;
  if (tipNow) {
    // the tip as measured from the vertices around the centre: the dome stands over the tallest of them
    [kx, ky, kz] = tipNow.k; ca = tipNow.along; top = Math.max(0, tipNow.top);
  } else {
    // the tip, across the axis from the rings' centre
    const cx = d.c[0] - bx, cy = d.c[1] - by, cz = d.c[2] - bz;
    ca = cx * nx + cy * ny + cz * nz;
    kx = cx - ca * nx; ky = cy - ca * ny; kz = cz - ca * nz;
    // how far the tip stands above her smooth surface WHERE THE TIP IS: `h` is measured over the rings' centre, and a
    // nipple's tip stands about a centimetre off it, where her breast has already curved down by curve·|k|² (her
    // nipple came up through the cloth tee's dome by that much: 0.7 mm at 0% belly)
    top = Math.max(0, d.h + d.curve * (kx * kx + ky * ky + kz * kz));
  }
  if (top <= 0) return;
  // the tip's own height stands for the tent; BREAST DETAIL lowers the dome over it, never the tent
  const tipTop = top;
  top *= clamp01(amount);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3, dx = p[i3] - bx, dy = p[i3 + 1] - by, dz = p[i3 + 2] - bz, along = dx * nx + dy * ny + dz * nz;
    const tx = dx - along * nx, ty = dy - along * ny, tz = dz - along * nz;
    const ex = tx - kx, ey = ty - ky, ez = tz - kz, r2 = ex * ex + ey * ey + ez * ez;
    let held = false;
    if (lift) for (let j = 0; j < lift.length; j++) if (lift[j] === i) held = true;
    // outside the dome, or a body's depth away along the axis (the back of the garment)
    if (!held && (r2 >= rout2 || Math.abs(along - smooth0) > rout + tipTop)) continue;
    const r = Math.sqrt(r2), t = r >= rout ? 0 : r <= rin ? 1 : (rout - r) / (rout - rin), f = t * t * (3 - 2 * t);
    // the dome's height over this particle, along the axis from the outer ring's plane; her skin under it, the same way
    // ...and never under a tent from the tip: level with it (and DOME_MARGIN more) across the flat top, falling at
    // TENT_SLOPE beyond. On her curved breast the dome over its smooth surface fell away from the tip faster than the
    // cloth's spacing, so the cloth between two particles beside her nipple passed under its tip
    // The tent gives way to her smooth surface over the dome's outer half (TENT_FADE), so it ends without a step at the
    // dome's edge where BREAST DETAIL has lowered the dome under it
    const smooth = d.curve * (d.reach2 - (tx * tx + ty * ty + tz * tz));
    const g = r <= rin + (1 - TENT_FADE) * (rout - rin) ? 1 : Math.max(0, (rout - r) / (TENT_FADE * (rout - rin))), gf = g * g * (3 - 2 * g);
    const tent = smooth + (ca + DOME_MARGIN - TENT_SLOPE * Math.max(0, r - rin) - smooth) * gf;
    const floor = Math.max(smooth + (top + DOME_MARGIN) * f, r >= rout ? smooth : tent, held ? Math.max(ca + DOME_MARGIN, liftTo !== undefined && Number.isFinite(liftTo) ? liftTo : -Infinity) : -Infinity);
    const skin = (q[i3] - bx) * nx + (q[i3 + 1] - by) * ny + (q[i3 + 2] - bz) * nz;
    if (floor <= skin) continue;
    const drop = along - floor;
    q[i3] = p[i3] - nx * drop; q[i3 + 1] = p[i3 + 1] - ny * drop; q[i3 + 2] = p[i3 + 2] - nz * drop;
    qn[i3] = nx; qn[i3 + 1] = ny; qn[i3 + 2] = nz;
  }
}
