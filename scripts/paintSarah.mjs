/**
 * PAINT SARAH FROM NOTHING: AN UNTEXTURED SCULPT, COLOURED BY HAND.
 *
 * Joshua, 2026-09-29, sending `Sarah-Lab3.glb` — Meshy's untextured pass,
 * rigged with four fingers a hand: "Let's see if we can texture manually
 * since this non-textured looks good." It does. Rendered plain, the neckline
 * is a clean collar, the lanyard is a real strap standing off the shirt, the
 * badge is a card and the shoes are shoes. Everything wrong with the last
 * two Sarahs was PAINT — a scan's segmentation smeared across a shattered
 * atlas — so this pass throws the paint away and never had any to begin
 * with.
 *
 * HOW. Every texel of the 2048 atlas is placed in SPACE (`humanSurface`'s
 * rasteriser) and coloured by WHERE IT IS on her body, never by where it
 * sits in the atlas. The atlas has hundreds of islands, and anything that
 * worked in the image would bleed one body part into the next; a colour
 * that is a function of position is the same on both sides of every seam
 * by construction.
 *
 *   REGIONS   skin, hair, top, skirt, shoes and their soles, the wrist
 *             bands, the lanyard, the card and its clip. Each boundary is a
 *             curve read off orthographic renders of THIS sculpt against a
 *             millimetre grid — the collar, the shirt's hem, the sleeves,
 *             the skirt's hem and the shoes' collars are all sculpted lips,
 *             and the curves follow the lips.
 *   FACE      eyes, brows, lips and teeth are painted in FRONT PROJECTION:
 *             outlines traced on a 13,333 px/m render of the face and
 *             applied only to texels that face forward, with every edge
 *             feathered by distance so nothing is aliased to a texel.
 *   LIGHT     the occlusion bake (`humanSurface.bakeAO`) darkens creases,
 *             folds and contact, which is the only shading a surface with
 *             no normal map gets beyond its own geometry — and at 313,076
 *             triangles, the geometry carries the folds.
 *   GRAIN     a little deterministic noise per material: mottling in the
 *             skin, strands along the hair, weave in the cloth.
 *
 * THE COLOURS ARE HERS. Each is the median of the previous Sarah's own
 * texture over that region, sampled unlit, so she is recognisably the same
 * woman in the same clothes: auburn hair, a burgundy top, a black skirt,
 * grey trainers with white soles.
 *
 * THESE NUMBERS BELONG TO ONE MASTER. Every curve below was measured on
 * `Sarah-Lab3.glb` (bind pose, metres, +z forward, +x her left). A new
 * sculpt moves them; this is an authoring pass for one body, not a tool.
 *
 * Nothing here uses `Math.random`, so two bakes are byte-identical.
 */
import sharp from 'sharp';
import { gutter, surfaceOf } from './humanSurface.mjs';

// ------------------------------------------------------------------ palette
// sRGB, measured unlit off the previous Sarah (see the header).
const C = {
  skin: [242, 188, 164],
  hair: [104, 60, 36],
  brow: [118, 72, 52],
  top: [106, 11, 40],
  skirt: [22, 22, 27],
  shoe: [104, 106, 116],
  sole: [226, 224, 218],
  band: [24, 24, 28],
  strap: [26, 28, 33],
  card: [238, 238, 236],
  holder: [196, 202, 208],
  clip: [150, 152, 158],
  lip: [178, 104, 100],
  teeth: [226, 218, 200],
  sclera: [222, 212, 204],
  iris: [104, 122, 128],
  irisRim: [44, 54, 60],
  pupil: [14, 14, 16],
  lash: [44, 30, 26],
};
const L = { SKIN: 1, HAIR: 2, TOP: 3, SKIRT: 4, SHOE: 5, SOLE: 6, BAND: 7, STRAP: 8, CARD: 9, HOLDER: 10, CLIP: 11 };
const NAME = Object.fromEntries(Object.entries(L).map(([k, v]) => [v, k.toLowerCase()]));
/** How much of the occlusion bake each material takes. */
const AO_SHARE = { 1: 0.55, 2: 0.8, 3: 0.75, 4: 0.7, 5: 0.7, 6: 0.6, 7: 0.6, 8: 0.6, 9: 0.3, 10: 0.4, 11: 0.4 };
/** Roughness, 0..1. The eyes and lips are wet; the cloth is not. */
const ROUGH = { 1: 0.55, 2: 0.45, 3: 0.85, 4: 0.8, 5: 0.75, 6: 0.8, 7: 0.5, 8: 0.6, 9: 0.35, 10: 0.3, 11: 0.35 };
const METAL = { 11: 0.8 };

// ------------------------------------------------------------------ helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const srgb = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Piecewise-linear lookup in a table of [x, y] sorted by x, clamped at the ends. */
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/** Angular lookup: `table` is [degrees, y] over -180..180, wrapping. */
function interpAngle(table, deg) {
  const t = [[table[table.length - 1][0] - 360, table[table.length - 1][1]], ...table, [table[0][0] + 360, table[0][1]]];
  return interp(t, deg);
}

/** Signed distance from a point to a closed polygon: negative inside. */
function polyDist(poly, x, y) {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    const dx = xi - xj, dy = yi - yj, L2 = dx * dx + dy * dy || 1e-12;
    const t = clamp(((x - xj) * dx + (y - yj) * dy) / L2, 0, 1);
    const d = Math.hypot(x - (xj + t * dx), y - (yj + t * dy));
    if (d < best) best = d;
  }
  return inside ? -best : best;
}

/** Distance from a point to an open polyline. */
function lineDist(line, x, y) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-12;
    const t = clamp(((x - x0) * dx + (y - y0) * dy) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in 3D, 0..1, smoothly interpolated. */
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let out = 0;
  for (let c = 0; c < 8; c++) {
    const a = c & 1, b = (c >> 1) & 1, d = (c >> 2) & 1;
    out += hash3(ix + a, iy + b, iz + d) * (a ? u : 1 - u) * (b ? v : 1 - v) * (d ? w : 1 - w);
  }
  return out;
}
function fbm(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ------------------------------------------------------------- the regions
//
// All in metres on `Sarah-Lab3.glb`'s bind pose. Read off orthographic
// renders at 3,333 to 13,333 px/m with a 10 mm grid.

/** The neck's vertical axis: its throat at z -0.017 and its nape at
 * -0.12 on the 1.43 m slice, 0.10 m across. */
const NECK = { x: 0.0, z: -0.068 };
/** The crew neck, which has a ribbed neckband about 2 cm tall.
 *
 * Across the FRONT the band's top edge is a U by |x|, read off a 0.5 mm
 * grid: 1.368 at the breastbone to 1.415 at |x| 0.058. Round the sides and
 * back the band stands off the neck and then leans in against it, so it
 * is two numbers by BEARING about the neck's axis (0 ahead, 180 behind):
 *
 *   NECK_SEAM   where it joins the shirt — the 3-4 mm step in the neck's
 *               radius on her right side, where no hair hangs, and the
 *               3.7 mm step on the midline's depth profile at the nape.
 *               Everything below is shirt.
 *   NECK_TOP    its top edge, where the radius stops falling. Between the
 *               two it is shirt only where it stands clear of the bare neck
 *               (NECK_R, the neck's own radius just above it): the band
 *               flares away from the neck at the seam and lies flush at its
 *               edge, so a single height either left it skin — a pale
 *               stripe beside the strap — or painted the neck red.
 *
 * The left side is taken as the mirror; the ponytail covers it. */
const NECK_FRONT = [[0, 1.368], [0.020, 1.370], [0.035, 1.376], [0.045, 1.385], [0.052, 1.398], [0.058, 1.415]];
const NECK_SEAM = [[50, 1.398], [55, 1.400], [70, 1.407], [90, 1.425], [120, 1.431], [150, 1.427], [180, 1.424]];
const NECK_TOP = [[50, 1.415], [70, 1.436], [90, 1.445], [120, 1.447], [180, 1.448]];
const NECK_R = [[50, 0.056], [70, 0.055], [90, 0.0525], [120, 0.050], [150, 0.049], [180, 0.048]];
const bearingOf = (x, z) => Math.abs(Math.atan2(x - NECK.x, z - NECK.z)) * 180 / Math.PI;
function isShirtAtNeck(x, y, z, rNeck) {
  const b = bearingOf(x, z);
  if (b < 50) return y < Math.min(interp(NECK_FRONT, Math.abs(x)), interp(NECK_TOP, 50));
  if (y < interp(NECK_SEAM, b)) return true;
  // Behind the neck the band's top edge runs under the strap's lower edge,
  // so the band is shirt right up to the strap there.
  if (b >= 100 && y < interp(STRAP_RING, b) - STRAP_RING_HALF) return true;
  return y < interp(NECK_TOP, b) && rNeck > interp(NECK_R, b) + 0.0015;
}

/**
 * THE LANYARD, AS A CENTRELINE. Where the strap stands off the shirt a thin
 * surface finds it; where the sculpt WELDED it to the cloth — two stretches
 * a side on the bump, 1.255 to 1.285 — it is only a ridge, and a thin-surface
 * test paints those stretches burgundy. So each side's centreline is taken
 * from the medians of the thin texels, 5 mm a bin, and anything within
 * `STRAP_CORRIDOR` of it is where to look for it. [y, x, z], bind pose.
 */
const STRAP_LINE = {
  left: [[1.205, 0.001, 0.113], [1.215, 0.0020, 0.1145], [1.225, 0.0035, 0.1115], [1.235, 0.0049, 0.1099], [1.245, 0.0062, 0.1068],
    [1.255, 0.0078, 0.1019], [1.270, 0.0074, 0.0915], [1.285, 0.0156, 0.0814], [1.295, 0.0192, 0.0738], [1.305, 0.0222, 0.0655],
    [1.315, 0.0260, 0.0566], [1.325, 0.0284, 0.0482], [1.335, 0.0313, 0.0395], [1.345, 0.0347, 0.0303], [1.355, 0.0377, 0.0213],
    [1.365, 0.0402, 0.0120], [1.375, 0.0439, 0.0019], [1.385, 0.0483, -0.0082], [1.395, 0.0494, -0.0207], [1.405, 0.0507, -0.0304]],
  right: [[1.205, -0.0036, 0.1130], [1.225, -0.0104, 0.1123], [1.235, -0.0130, 0.1091], [1.245, -0.0157, 0.1048],
    [1.285, -0.0224, 0.0817], [1.295, -0.0258, 0.0753], [1.305, -0.0282, 0.0672], [1.315, -0.0309, 0.0591], [1.325, -0.0334, 0.0506],
    [1.335, -0.0361, 0.0417], [1.345, -0.0381, 0.0325], [1.355, -0.0410, 0.0231], [1.365, -0.0428, 0.0130], [1.375, -0.0447, 0.0030],
    [1.385, -0.0475, -0.0094], [1.395, -0.0494, -0.0207], [1.405, -0.0507, -0.0304]],
};
/** How far from the traced path to look for the strap, and how proud of
 * its surroundings a welded stretch stands. */
const STRAP_CORRIDOR = 0.009, STRAP_RAISE = 0.0006, STRAP_RING_HALF = 0.0055;
/** Above the front lines the strap rides round the neck, on top of the
 * neckband and then just above it. Its centre by bearing, measured: the
 * texels standing more than 0.9 mm proud of a 9 mm neighbourhood on her
 * right side fall on two tracks, the neckband's seam and — 12 to 20 mm
 * above it — the strap, whose track is this. It agrees with the midline's
 * depth profile at the nape, where the strap is a flat band 1.449-1.461. */
const STRAP_RING = [[50, 1.401], [55, 1.406], [60, 1.409], [65, 1.414], [70, 1.420], [75, 1.424], [80, 1.429], [85, 1.434],
  [90, 1.437], [95, 1.439], [100, 1.443], [105, 1.446], [110, 1.447], [115, 1.449], [120, 1.450], [125, 1.452], [130, 1.454],
  [140, 1.456], [150, 1.457], [180, 1.457]];

/** How far a point stands proud of the mean of the mesh within `r` of it,
 * along its normal: positive on a ridge, zero on a smooth sheet. */
function raisedField(P, r = 0.006) {
  const cell = 0.008, g = new Map();
  for (let v = 0; v < P.length / 3; v++) {
    const k = `${Math.floor(P[v * 3] / cell)},${Math.floor(P[v * 3 + 1] / cell)},${Math.floor(P[v * 3 + 2] / cell)}`;
    let a = g.get(k); if (!a) { a = []; g.set(k, a); } a.push(v);
  }
  return (x, y, z, nx, ny, nz) => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const list = g.get(`${cx + a},${cy + b},${cz + c}`);
      if (!list) continue;
      for (const v of list) {
        const dx = P[v * 3] - x, dy = P[v * 3 + 1] - y, dz = P[v * 3 + 2] - z;
        if (dx * dx + dy * dy + dz * dz < r * r) { sx += P[v * 3]; sy += P[v * 3 + 1]; sz += P[v * 3 + 2]; n += 1; }
      }
    }
    if (!n) return 0;
    const L = Math.hypot(nx, ny, nz) || 1;
    return ((x - sx / n) * nx + (y - sy / n) * ny + (z - sz / n) * nz) / L;
  };
}

function strapDist(x, y, z) {
  const line = STRAP_LINE[x > 0 ? 'left' : 'right'];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [y0, x0, z0] = line[i - 1], [y1, x1, z1] = line[i];
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L2 = dx * dx + dy * dy + dz * dz;
    const t = clamp(((x - x0) * dx + (y - y0) * dy + (z - z0) * dz) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy), z - (z0 + t * dz)));
  }
  return best;
}

/** The top's hem by depth: low under the bump, level across the back. */
const HEM = [[-0.25, 0.965], [-0.06, 0.962], [-0.02, 0.95], [0.02, 0.93], [0.06, 0.905], [0.10, 0.878], [0.135, 0.855], [0.25, 0.85]];
/** The skirt is a solid volume closed underneath by a flat ring at 0.580 to
 * 0.585 m (measured: 32,500 texels in that 5 mm band face the floor), so
 * its hem is 0.584 and the ring is its underside. */
const SKIRT_HEM = 0.584;

/** Sleeve hems, slanted: [x at the top of the arm, y there, x underneath, y there]. */
const SLEEVE = { left: [0.250, 1.400, 0.220, 1.295], right: [-0.263, 1.390, -0.237, 1.290] };
/** The wrist bands, as |x| ranges. */
const BAND = { left: [0.607, 0.641], right: [-0.638, -0.602] };

/** The shoes' collars round each ankle, by bearing: tongue high at the
 * front, dipping under the ankle bones, the heel tab at the back. */
const SHOE_COLLAR = [[-180, 0.097], [-135, 0.084], [-90, 0.076], [-45, 0.095], [0, 0.125], [45, 0.095], [90, 0.076], [135, 0.084], [180, 0.097]];
const SOLE_TOP = 0.022;

/** The face in front projection: hairline across the forehead, down past
 * the temples to the jaw. Applied to texels facing forward only. */
const FACE = [[-0.080, 1.45], [-0.080, 1.50], [-0.078, 1.55], [-0.072, 1.565], [-0.066, 1.59], [-0.056, 1.61], [-0.045, 1.625],
  [-0.030, 1.64], [-0.015, 1.65], [0.000, 1.655], [0.015, 1.65], [0.030, 1.64], [0.045, 1.625], [0.056, 1.605], [0.064, 1.585],
  [0.068, 1.565], [0.072, 1.55], [0.078, 1.50], [0.080, 1.45]];
/** Where the hair stops on each side of the head, by depth: skin below. */
const SIDE_HAIRLINE = {
  right: [[-0.20, 1.525], [-0.10, 1.525], [-0.06, 1.535], [-0.04, 1.552], [-0.02, 1.57], [0.0, 1.595], [0.02, 1.625], [0.04, 1.66], [0.06, 1.70]],
  left: [[-0.20, 1.530], [-0.10, 1.530], [-0.06, 1.540], [-0.04, 1.545], [-0.02, 1.55], [0.0, 1.555], [0.01, 1.57], [0.02, 1.60], [0.04, 1.63], [0.06, 1.70]],
};
/** The nape and throat are skin within this of the neck's axis (its
 * radius is 0.05); the ponytail hangs outside it. */
const NECK_SKIN_R = 0.060;

/** The card and its clip, in front projection. The card is WELDED to the
 * bump — it lies tilted and flush on it, so neither depth nor a gap finds
 * it — but seen from the front it is a clean rectangle with a clip above,
 * and everything frontmost inside that rectangle is card. Edges read off a
 * 0.5 mm grid: 59.5 x 78 mm. */
const CARD = { x0: -0.0300, x1: 0.0295, y0: 1.098, y1: 1.176 };
const CLIP = { x0: -0.0095, x1: 0.0055, y0: 1.176, y1: 1.198 };
/** How far behind the frontmost surface a texel may lie and still be the
 * card's face, and how far its rim reaches round the edge. */
const CARD_FACE = 0.002, CARD_RIM = 0.0015;

/** The frontmost depth over the card and clip, on a 0.5 mm grid. */
function frontDepth(pos, ok, S) {
  const cell = 0.0005, x0 = CARD.x0 - 0.004, y0 = CARD.y0 - 0.004;
  const nx = Math.ceil((CARD.x1 - CARD.x0 + 0.008) / cell), ny = Math.ceil((CLIP.y1 - CARD.y0 + 0.008) / cell);
  const zmax = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    const gx = Math.floor((pos[i * 3] - x0) / cell), gy = Math.floor((pos[i * 3 + 1] - y0) / cell);
    if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) continue;
    if (pos[i * 3 + 2] > zmax[gy * nx + gx]) zmax[gy * nx + gx] = pos[i * 3 + 2];
  }
  // Fill any empty cell from its neighbours, so a sparse spot is not a hole.
  const out = Float32Array.from(zmax);
  for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
    let m = zmax[gy * nx + gx];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const X = gx + a, Y = gy + b;
      if (X >= 0 && Y >= 0 && X < nx && Y < ny && zmax[Y * nx + X] > m) m = zmax[Y * nx + X];
    }
    out[gy * nx + gx] = m;
  }
  return (x, y) => {
    const gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell);
    return gx < 0 || gy < 0 || gx >= nx || gy >= ny ? -Infinity : out[gy * nx + gx];
  };
}

// ----------------------------------------------------------------- the face
const e = (px, py) => [(px - 800) / 13333, 1.56 - (py - 400) / 13333];      // eyes render
const m = (px, py) => [(px - 800) / 13333, 1.505 - (py - 400) / 13333];     // mouth render
const EYES = [
  {
    open: [e(215, 385), e(260, 320), e(330, 295), e(420, 290), e(500, 305), e(555, 345), e(560, 395), e(500, 430), e(420, 440), e(330, 440), e(260, 420)],
    lid: [e(215, 385), e(260, 320), e(330, 295), e(420, 290), e(500, 305), e(555, 345)],
    c: e(385, 362),
  },
  {
    open: [e(990, 365), e(1040, 300), e(1120, 262), e(1210, 262), e(1280, 290), e(1330, 330), e(1280, 400), e(1200, 440), e(1110, 440), e(1040, 420), e(990, 375)],
    lid: [e(1040, 300), e(1120, 262), e(1210, 262), e(1280, 290), e(1330, 330)],
    c: e(1165, 352),
  },
];
/** A real iris is 11-12 mm across; her smile narrows the eye, so the upper
 * lid covers its top, as it does on a smiling face. */
const IRIS_R = 0.0054, PUPIL_R = 0.0020, IRIS_LIFT = 0.0012;
const BROWS = [
  [[-0.012, 1.5815], [-0.022, 1.5875], [-0.034, 1.5900], [-0.046, 1.5885], [-0.057, 1.5830]],
  [[0.012, 1.5815], [0.022, 1.5875], [0.034, 1.5900], [0.046, 1.5885], [0.057, 1.5830]],
];
const LIP_TOP = [m(380, 320), m(430, 270), m(520, 248), m(650, 242), m(760, 248), m(800, 254), m(840, 246), m(960, 240), m(1080, 248), m(1150, 282), m(1165, 318)];
const SEAM = [m(390, 350), m(500, 352), m(650, 355), m(800, 352), m(950, 345), m(1080, 332), m(1150, 315)];
const TEETH_LOW = [m(420, 360), m(470, 395), m(560, 425), m(700, 440), m(800, 445), m(950, 440), m(1050, 410), m(1100, 370), m(1140, 325)];
const LIP_LOW = [m(440, 380), m(520, 450), m(640, 495), m(800, 510), m(960, 495), m(1060, 450), m(1110, 380)];
const UPPER_LIP = [...LIP_TOP, ...[...SEAM].reverse()];
const TEETH = [...SEAM, ...[...TEETH_LOW].reverse()];
const LOWER_LIP = [...TEETH_LOW, ...[...LIP_LOW].reverse()];

// ------------------------------------------------------------ classification

export function labelOf(x, y, z, nx, ny, nz, standoff, front = () => -Infinity, raised = () => 0) {
  const facing = nz / (Math.hypot(nx, ny, nz) || 1);
  // The card and its clip: whatever is frontmost inside their outlines.
  const inside = (b, m) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m;
  if (inside(CARD, CARD_RIM) || inside(CLIP, 0)) {
    const lead = front(x, y) - z;
    if (inside(CLIP, 0) && y > CARD.y1 && lead < CARD_FACE * 3) return L.CLIP;
    if (inside(CARD, 0) && lead < CARD_FACE && facing > 0.3) return L.CARD;
    if (lead < 0.0035) return L.HOLDER;
  }

  // Arms, from the sleeve hem out.
  const side = x > 0 ? 'left' : 'right';
  if (Math.abs(x) > 0.19 && y > 1.24) {
    const [xa, ya, xb, yb] = SLEEVE[side];
    const xh = xb + (xa - xb) * (y - yb) / (ya - yb);
    if (Math.abs(x) < Math.abs(xh)) return L.TOP;
    const [b0, b1] = BAND[side];
    if (x > b0 && x < b1) return L.BAND;
    return L.SKIN;
  }

  // The skirt's underside: the ring at the hem that faces the floor, clear
  // of the thighs it closes round.
  if (y < SKIRT_HEM + 0.006 && y > SKIRT_HEM - 0.010 && ny / (Math.hypot(nx, ny, nz) || 1) < -0.35
    && Math.hypot(Math.abs(x) - 0.083, z) > 0.05) return L.SKIRT;
  // Legs and feet.
  if (y < SKIRT_HEM) {
    if (y < 0.16) {
      // Each ankle's axis and radius, measured at 120-140 mm: a 28 mm
      // round at (+/-0.079, -0.025). The shoe stands clear of it.
      const ax = x > 0 ? 0.079 : -0.079, az = -0.025;
      const deg = Math.atan2(x - ax, z - az) * 180 / Math.PI;
      const r = Math.hypot(x - ax, z - az);
      if (y < SOLE_TOP || (z > 0.12 && y < 0.03)) return L.SOLE;
      if (y < interpAngle(SHOE_COLLAR, x > 0 ? deg : -deg) && (r > 0.031 || y < 0.06)) return L.SHOE;
    }
    return L.SKIN;
  }
  if (y < interp(HEM, z)) return L.SKIRT;

  // The torso up to the collar, and whatever hangs on it.
  const dx = x - NECK.x, dz = z - NECK.z, rNeck = Math.hypot(dx, dz);
  // The ponytail and the strands over her left shoulder. A strand lying on
  // the body is thinner than the body under it, and the thickest bundle of
  // the ponytail measures under 45 mm where the shoulder and neck under it
  // measure more than the 60 mm the standoff bake looks.
  const strand = x > 0.02 && y > 1.30 && standoff < 0.045 && rNeck > 0.045;
  // The lanyard. The centreline and the ring say only WHERE TO LOOK — they
  // are medians and readings of a ridge, a few millimetres off the strap in
  // places, and painting everything near them put the strap's colour on
  // the shirt beside it and left its real edge burgundy. Inside that
  // corridor the strap is found by its SHAPE: a ribbon either thin (it
  // stands off the cloth) or, where the sculpt welded it down, raised
  // above its surroundings — measured, the ribbon stands 1.0 mm proud of a
  // 6 mm neighbourhood (p10 0.39) where shirt and skin sit at 0.00 (p90 0.43
  // and 0.22). A strand of hair lying across it stays hair.
  const bearing = bearingOf(x, z);
  const nearLine = y > 1.19 && y < 1.415 && strapDist(x, y, z) < STRAP_CORRIDOR;
  // Round the neck it is painted by its measured track: there it lies on
  // the neckband or on the neck, and the band is too flat and too wide for
  // the ridge test to find anything but its edges.
  if (bearing > 50 && rNeck < 0.075 && !strand && Math.abs(y - interp(STRAP_RING, bearing)) < STRAP_RING_HALF) return L.STRAP;
  if (nearLine) {
    if (standoff < 0.008) return L.STRAP;
    if (!strand && raised() > STRAP_RAISE) return L.STRAP;
  }
  if (isShirtAtNeck(x, y, z, rNeck)) return strand ? L.HAIR : L.TOP;

  // Between the collar and the jaw: skin, bar the hair that hangs there.
  if (y < 1.46) {
    // On her left the ponytail is WELDED to the side of the neck, so it is
    // not thin there; it is simply further out. The neck's own surface
    // lies within 56 mm of its axis at every bearing on the clear right side.
    // (From 55 degrees round: nearer the front it is the neckband's flare.)
    const ponytail = x > 0.015 && bearing > 55 && bearing < 150 && rNeck > 0.060;
    return strand || ponytail ? L.HAIR : L.SKIN;
  }

  // Head. The ears first: a box read off both side views, behind the
  // loose strands that hang in front of them.
  if (Math.abs(x) > 0.058 && z > -0.055 && z < -0.018 && y > 1.495 && y < 1.558) return L.SKIN;
  // The ponytail's bundle round the left of the neck, below the ear's
  // hairline: thinner than a head. (Not "further out than the neck" here,
  // as below the jaw: at this height the jaw is further out too.)
  if (y < 1.53 && strand) return L.HAIR;
  // The face outline is a FRONT view, so it only speaks for surfaces that
  // face the front: the side of the hair mass lying over a temple falls
  // inside it too, facing sideways, and must stay hair.
  const inFace = z > -0.035 ? polyDist(FACE, x, y) : Infinity;
  if (inFace < 0 && (facing > 0.3 || inFace < -0.008)) return L.SKIN;
  const hairline = interp(SIDE_HAIRLINE[side], z);
  if (y < hairline) {
    if (rNeck < NECK_SKIN_R) return L.SKIN;
    // Cheeks and temples, in front of the ears and below the side hairline,
    // unless it is a loose strand lying on them.
    if (z > -0.02 && standoff > 0.006) return L.SKIN;
    // The jaw's underside and the throat in front of the axis.
    if (dz > 0 && Math.abs(x) < 0.07 && y < 1.50) return L.SKIN;
  }
  return L.HAIR;
}

// ------------------------------------------------------------------- colour

function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** The painted face over the skin: returns [rgb, roughness] or null. */
function faceAt(x, y, z, facing, base) {
  if (z < 0.02 || facing < 0.15 || y < 1.47 || y > 1.60 || Math.abs(x) > 0.07) return null;
  const f = 0.0006;                                 // feather, metres
  let c = base, r = null;
  // Brows: tapered at both ends, made of short strokes rather than a line.
  for (const b of BROWS) {
    const d = lineDist(b, x, y);
    const t = clamp((Math.abs(x) - 0.012) / 0.045, 0, 1);
    const half = 0.0022 * (0.75 + 0.25 * Math.sin(Math.PI * clamp(t * 1.15, 0, 1))) * (1 - 0.45 * t);
    const a = 1 - smooth(half * 0.5, half + f, d);
    if (a > 0) {
      // Strokes run up and out from the inner end.
      const stroke = noise3(x * 2600 + y * 900, y * 400, 0);
      const g = 0.8 + 0.4 * noise3(x * 3000, y * 600, 1);
      c = mix(c, C.brow.map((v) => v * g), a * (0.45 + 0.35 * stroke));
    }
  }
  // Eyes: the white inside the opening, the iris under the upper lid, the
  // lid's shadow across the top of both, and a lash line along the lid.
  for (const eye of EYES) {
    const d = polyDist(eye.open, x, y);
    const lidD = lineDist(eye.lid, x, y);
    if (d < f) {
      const a = 1 - smooth(-f, f, d);
      const cx = eye.c[0], cy = eye.c[1] + IRIS_LIFT;
      const rr = Math.hypot(x - cx, y - cy);
      // The white is not white: warmer and pinker toward the corners.
      const edge = clamp(Math.abs(x - eye.c[0]) / 0.012, 0, 1);
      let ec = mix(C.sclera, [214, 170, 160], edge * edge * 0.6);
      // Iris: fibres by angle, a darker limbal ring, the pupil.
      const ang = Math.atan2(y - cy, x - cx);
      const fib = 0.85 + 0.3 * noise3(Math.cos(ang) * 40, Math.sin(ang) * 40, rr * 900);
      const ir = mix(C.iris.map((v) => v * fib), C.irisRim, smooth(IRIS_R * 0.6, IRIS_R, rr));
      ec = mix(ec, ir, 1 - smooth(IRIS_R - 0.0003, IRIS_R + 0.0003, rr));
      ec = mix(ec, C.pupil, 1 - smooth(PUPIL_R - 0.0002, PUPIL_R + 0.0002, rr));
      // The upper lid's shadow over the eye.
      const shade = 0.55 + 0.45 * smooth(0.0004, 0.0035, lidD);
      ec = ec.map((v) => v * shade);
      // A catchlight, up and to her left.
      const cl = Math.hypot(x - (cx + 0.0016), y - (cy + 0.0016));
      ec = mix(ec, [248, 248, 248], (1 - smooth(0.0003, 0.0007, cl)) * 0.9);
      c = mix(c, ec, a);
      if (a > 0.5) r = 0.12;
    }
    // Lashes: a dark line along the upper lid, heaviest at the outer end.
    const outer = clamp((Math.abs(x) - Math.abs(eye.c[0]) + 0.004) / 0.012, 0, 1);
    const w = 0.0007 + 0.0006 * outer;
    const lash = (1 - smooth(w * 0.5, w * 1.6, lidD)) * (d > -0.0015 ? 1 : 0);
    if (lash > 0) c = mix(c, C.lash, lash * 0.92);
    // A faint line under the lower lid.
    if (d > -0.0004 && d < 0.0012 && y < eye.c[1]) c = mix(c, [150, 104, 96], 0.25 * (1 - smooth(0, 0.0012, d)));
  }
  // Teeth, a little shaded under the upper lip.
  const dt = polyDist(TEETH, x, y);
  if (dt < f) {
    const under = lineDist(SEAM, x, y);
    const t = C.teeth.map((v) => v * (0.72 + 0.28 * smooth(0.0003, 0.0022, under)));
    c = mix(c, t, 1 - smooth(-f, f, dt));
    r = 0.3;
  }
  // Lips: the vermilion, soft at the top edge where it meets the skin.
  for (const [lip, soft] of [[UPPER_LIP, 0.0012], [LOWER_LIP, 0.0010]]) {
    const d = polyDist(lip, x, y);
    if (d < soft) {
      const a = (1 - smooth(-soft, soft, d)) * 0.85;
      c = mix(c, C.lip, a);
      if (a > 0.4) r = 0.35;
    }
  }
  // A little colour in the cheeks.
  for (const cx of [-0.046, 0.046]) {
    const d = Math.hypot(x - cx, y - 1.527);
    const a = (1 - smooth(0.004, 0.022, d)) * 0.18;
    if (a > 0) c = mix(c, [226, 142, 134], a);
  }
  return c === base && r === null ? null : [c, r];
}

function colourOf(label, x, y, z, facing) {
  let c = C[NAME[label]] ?? C.skin;
  if (label === L.CARD || label === L.HOLDER) c = label === L.CARD ? C.card : C.holder;
  let g = 1, r = ROUGH[label];
  switch (label) {
    case L.SKIN: {
      g = 0.96 + 0.08 * fbm(x * 90, y * 90, z * 90);
      c = mix(c, [236, 170, 150], 0.35 * fbm(x * 25 + 7, y * 25, z * 25));
      // The face's features come from the photograph (see FACE_PHOTO);
      // `faceAt` paints them only when there is no photograph to take.
      if (!PHOTO_FACE) {
        const fc = faceAt(x, y, z, facing, c);
        if (fc) { c = fc[0]; if (fc[1] !== null) r = fc[1]; }
      }
      break;
    }
    case L.HAIR: {
      // Strands: fine across the fall, long along it. The hair falls
      // roughly downward and back, so the grain runs along y with a lean.
      const s = noise3(x * 900, (y + z * 0.4) * 60, z * 900);
      g = 0.72 + 0.56 * s;
      c = mix(c, [150, 92, 54], 0.25 * noise3(x * 40, y * 12, z * 40));
      break;
    }
    case L.TOP: case L.SKIRT: case L.STRAP: case L.BAND:
      g = 0.95 + 0.1 * noise3(x * 1500, y * 1500, z * 1500);
      break;
    case L.SHOE:
      g = 0.9 + 0.2 * noise3(x * 800, y * 800, z * 800);
      break;
    default:
      break;
  }
  return [[c[0] * g, c[1] * g, c[2] * g], r];
}

// ------------------------------------------------------------ the photograph

/**
 * HER FACE IS PROJECTED FROM THE PHOTOGRAPH MESHY BUILT HER FROM (Joshua,
 * 2026-09-29, sending the front and side reference: "could also possibly
 * be used for the texture"). A painted face is a cartoon beside a real
 * one, and this sculpt was made from that picture, so its features are
 * where the picture's are — to within an affine map, which is all the
 * difference between a phone camera and an orthographic front view comes
 * to over the 12 cm of a face.
 *
 * The map is fitted to five landmarks read on both — each pupil, the base
 * of the nose, the lips' seam and the point of the chin — by least squares:
 * [model x, model y] -> [photo px, photo py]. It is used ONLY on skin that
 * faces the camera inside the face's outline, feathered out by facing and
 * by distance from that outline into the painted skin, whose colour is
 * the photograph's own cheek so there is no seam where they meet. Nothing
 * is taken from the photograph where the sculpt faces away from it: a
 * front projection there smears one pixel across a centimetre of cheek.
 */
let PHOTO_FACE = false;
const FACE_PHOTO = {
  file: 'art/humans/ref/sarah-front.jpg',
  pairs: [
    [[-0.0338, 1.5636], [696, 341]],
    [[0.0254, 1.5651], [778, 330]],
    [[-0.0026, 1.5223], [743, 394]],
    [[-0.0026, 1.5091], [741, 419]],
    [[0.0, 1.4663], [742, 480]],
  ],
  /** Where the photograph's cheeks are sampled for the body's skin tone. */
  cheeks: [[672, 392, 12], [808, 382, 12]],
};

/**
 * THE REST OF HER FRONT, FROM THE SAME PHOTOGRAPH — through a WARP rather
 * than one map, because the photograph has perspective: measured on it,
 * the face spans 1,490 px a metre vertically, the torso 1,320 and the legs
 * 1,350. So the map is a table by height, read at landmarks on both —
 * crown, eyes, lips, chin, the neckline's lowest point, the top's hem, the
 * skirt's hem, the knees, the shoes' collars and the soles — each row the
 * photograph's row at that height, its midline and its pixels per metre
 * across (the last from the widths of skirt, belly and legs, which agree
 * to 3%). [model y, photo row, photo midline, px per metre].
 *
 * A texel only takes the photograph where it faces the camera AND the
 * photograph's pixel is what the texel is — burgundy for the top, near
 * black for the skirt, grey for a shoe — so where the two disagree, as
 * where the photograph's lanyard crosses the sculpt's shirt, the texel
 * keeps its painted colour, and that colour is the photograph's own
 * median for the region, so the join does not show. The arms are left
 * painted: she holds them out and down in the photograph, not in a T.
 */
const BODY_PHOTO = {
  rows: [
    [0.000, 2440, 720, 1375], [0.100, 2270, 724, 1375], [0.448, 1810, 730, 1375], [0.584, 1636, 734, 1354],
    [0.855, 1275, 745, 1380], [1.368, 615, 745, 1380], [1.466, 480, 742, 1397], [1.509, 419, 745, 1397],
    [1.564, 335, 743, 1397], [1.700, 161, 742, 1397],
  ],
  /** Where each region's median is read, as [x, y, half-size] in pixels. */
  patches: {
    top: [[600, 1000, 12], [890, 1000, 12], [560, 770, 10]],
    skirt: [[560, 1450, 14], [900, 1450, 14]],
    skin: [[620, 1950, 10], [840, 1950, 10], [745, 560, 8]],
    shoe: [[530, 2380, 6], [890, 2380, 6]],
    hair: [[640, 300, 6], [850, 300, 6]],
  },
};
const lumOf = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
/** The photograph's own badge and clip, which hang lower than the
 * sculpt's: never taken for anything. [x0, y0, x1, y1] in pixels. */
const PHOTO_BADGE = [696, 850, 796, 1016];
/** Is the photograph's pixel plausibly this material? */
const PHOTO_GATE = {
  [L.TOP]: (c) => c[0] > 60 && c[0] > c[1] * 1.8 && c[0] > c[2] * 1.3,
  [L.SKIRT]: (c) => lumOf(c) < 75 && !(c[0] > c[1] * 1.6),
  [L.SKIN]: (c) => c[0] > 110 && c[0] > c[1] && c[1] > c[2] && c[1] > 0.5 * c[0] && c[0] - c[2] > 25,
  [L.SHOE]: (c) => Math.abs(c[0] - c[1]) < 22 && c[2] >= c[0] - 8 && lumOf(c) > 45 && lumOf(c) < 190,
  [L.SOLE]: (c) => lumOf(c) > 150 || (c[0] > c[1] && c[1] > c[2] && c[0] > 140),
  [L.HAIR]: (c) => c[0] > 50 && c[0] > c[1] * 1.15 && c[1] > c[2] && (c[0] - c[2]) / c[0] > 0.35 && lumOf(c) < 190,
  [L.STRAP]: (c) => lumOf(c) < 60 && !(c[0] > c[1] * 1.6),
};

/** Least-squares affine map from the pairs: returns (x, y) -> [px, py]. */
function fitAffine(pairs) {
  // Solve [x y 1] * A = [px py] via normal equations, one column at a time.
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [[x, y], [px, py]] of pairs) {
    const r = [x, y, 1];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b];
      bx[a] += r[a] * px; by[a] += r[a] * py;
    }
  }
  const solve = (A, v) => {
    const m = A.map((row, k) => [...row, v[k]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };
  const cx = solve(M, bx), cy = solve(M, by);
  return (x, y) => [cx[0] * x + cx[1] * y + cx[2], cy[0] * x + cy[1] * y + cy[2]];
}

async function loadPhoto(root, spec) {
  const { data, info } = await sharp(`${root}/${spec.file}`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (px, py) => {
    const x0 = clamp(Math.floor(px), 0, W - 2), y0 = clamp(Math.floor(py), 0, H - 2);
    const fx = clamp(px - x0, 0, 1), fy = clamp(py - y0, 0, 1);
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = data[(y0 * W + x0) * 3 + c], b = data[(y0 * W + x0 + 1) * 3 + c];
      const d = data[((y0 + 1) * W + x0) * 3 + c], e = data[((y0 + 1) * W + x0 + 1) * 3 + c];
      out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    }
    return out;
  };
  // The cheek tone: the median of each channel over both cheek patches.
  const ch = [[], [], []];
  for (const [cx, cy, r] of spec.cheeks) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const p = at(x, y); for (let c = 0; c < 3; c++) ch[c].push(p[c]);
  }
  const tone = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
  const col = (k) => BODY_PHOTO.rows.map((r) => [r[0], r[k]]);
  const warp = (x, y) => [interp(col(2), y) + interp(col(3), y) * x, interp(col(1), y)];
  const median = (list) => {
    const ch = [[], [], []];
    for (const [cx, cy, r] of list) for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
      const p = at(xx, yy); for (let c = 0; c < 3; c++) ch[c].push(p[c]);
    }
    return ch.map((a) => Math.round(a.sort((p, q) => p - q)[a.length >> 1]));
  };
  const palette = Object.fromEntries(Object.entries(BODY_PHOTO.patches).map(([k, v]) => [k, median(v)]));
  /**
   * The photograph's colour at a point IF it is the right material, else
   * the mean of the nearest pixels round it that are — so a texel whose
   * pixel is the photograph's lanyard, badge or a strip of skirt keeps the
   * cloth's own light from beside it, not a flat colour that shows as a
   * patch. Rings of 16 samples out to 48 px; null if none qualify.
   */
  const inBadge = (px, py) => px > PHOTO_BADGE[0] && px < PHOTO_BADGE[2] && py > PHOTO_BADGE[1] && py < PHOTO_BADGE[3];
  const near = (px, py, gate) => {
    const c0 = at(px, py);
    if (!inBadge(px, py) && gate(c0)) return c0;
    for (const r of [4, 8, 14, 22, 32, 48]) {
      const sum = [0, 0, 0]; let n = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, qx = px + r * Math.cos(a), qy = py + r * Math.sin(a);
        if (inBadge(qx, qy)) continue;
        const c = at(qx, qy);
        if (gate(c)) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n += 1; }
      }
      if (n >= 3) return [sum[0] / n, sum[1] / n, sum[2] / n];
    }
    return null;
  };
  return { at, near, map: fitAffine(spec.pairs), tone, warp, palette };
}

// ---------------------------------------------------------------- the pass

/**
 * EVERY TEXEL BELONGS TO THE TRIANGLE NEAREST IT, AND SITS ON THAT TRIANGLE.
 *
 * The rasteriser gives each triangle a skirt of texels just outside it,
 * placed by EXTRAPOLATING its barycentrics and owned by whichever triangle
 * wrote last. Both are harmless for a shading term and both are wrong for
 * a colour chosen by position. 35,370 of this master's 313,076 triangles
 * are slivers with no texel of their own; a fragment on one samples the
 * texels round its footprint, and when those were written last by another
 * island — or placed centimetres off the sliver by extrapolation — it drew
 * a fleck of skin or shirt on the skirt.
 *
 * So the skirt is re-assigned: each texel within `REACH` of any triangle in
 * the atlas goes to the NEAREST one, at the nearest point of it. Inside
 * texels are untouched (their distance is zero). Between two islands the
 * gap is split down the middle, which is the most a shared texel can do.
 */
const REACH = 2.5;
function nearestSkirt(prim, S, pos, nrm, ok, tri) {
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const IDX = prim.getIndices().getArray();
  const best = new Float32Array(S * S).fill(Infinity);
  for (let i = 0; i < S * S; i++) if (ok[i] === 2) best[i] = 0;
  let moved = 0;
  const bary = new Float64Array(3);
  // Nearest point on a UV triangle to (px, py): barycentrics in `bary`, distance returned.
  const nearest = (ux, uy, px, py) => {
    const d = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
    if (Math.abs(d) > 1e-12) {
      const l0 = ((uy[1] - uy[2]) * (px - ux[2]) + (ux[2] - ux[1]) * (py - uy[2])) / d;
      const l1 = ((uy[2] - uy[0]) * (px - ux[2]) + (ux[0] - ux[2]) * (py - uy[2])) / d;
      if (l0 >= 0 && l1 >= 0 && l0 + l1 <= 1) { bary[0] = l0; bary[1] = l1; bary[2] = 1 - l0 - l1; return 0; }
    }
    let bd = Infinity;
    for (let e = 0; e < 3; e++) {
      const a = e, b = (e + 1) % 3;
      const ex = ux[b] - ux[a], ey = uy[b] - uy[a], L2 = ex * ex + ey * ey;
      const s = L2 > 1e-12 ? clamp(((px - ux[a]) * ex + (py - uy[a]) * ey) / L2, 0, 1) : 0;
      const dd = Math.hypot(px - (ux[a] + s * ex), py - (uy[a] + s * ey));
      if (dd < bd) { bd = dd; bary[0] = 0; bary[1] = 0; bary[2] = 0; bary[a] = 1 - s; bary[b] = s; }
    }
    return bd;
  };
  for (let t = 0; t < IDX.length / 3; t++) {
    const v = [IDX[t * 3], IDX[t * 3 + 1], IDX[t * 3 + 2]];
    const ux = v.map((k) => UV[k * 2] * S), uy = v.map((k) => UV[k * 2 + 1] * S);
    const x0 = Math.max(0, Math.floor(Math.min(...ux) - REACH)), x1 = Math.min(S - 1, Math.ceil(Math.max(...ux) + REACH));
    const y0 = Math.max(0, Math.floor(Math.min(...uy) - REACH)), y1 = Math.min(S - 1, Math.ceil(Math.max(...uy) + REACH));
    if ((x1 - x0) * (y1 - y0) > 250000) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * S + x;
      if (ok[i] === 2) continue;
      const dd = nearest(ux, uy, x + 0.5, y + 0.5);
      if (dd > REACH || dd >= best[i]) continue;
      best[i] = dd;
      tri[i] = t;
      if (!ok[i]) ok[i] = 1;
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = bary[0] * P[v[0] * 3 + k] + bary[1] * P[v[1] * 3 + k] + bary[2] * P[v[2] * 3 + k];
        nrm[i * 3 + k] = bary[0] * N[v[0] * 3 + k] + bary[1] * N[v[1] * 3 + k] + bary[2] * N[v[2] * 3 + k];
      }
    }
  }
  for (let i = 0; i < S * S; i++) if (ok[i] === 1 && best[i] < Infinity) moved += 1;
  return moved;
}

/**
 * Paint the master. Adds a material with a base-colour and a
 * metallic-roughness map and assigns it; mutates `doc`.
 *
 * `debugLabels` paints each region one flat colour instead, for checking
 * the boundaries against the sculpt.
 */
export async function paintSarah(doc, { cacheDir, stamp, root = '.', log = console.log, S = 2048, debugLabels = false }) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const surf = surfaceOf(prim, S, cacheDir, stamp, log);
  const { pos, nrm, ok, ao, standoff, tri } = surf;
  const moved = nearestSkirt(prim, S, pos, nrm, ok, tri);
  log(`${moved.toLocaleString()} skirt texels given to their nearest triangle`);
  const R = new Float32Array(S * S), G = new Float32Array(S * S), B = new Float32Array(S * S);
  const RO = new Float32Array(S * S), ME = new Float32Array(S * S);
  const counts = {};
  const front = frontDepth(pos, ok, S);
  const raisedAt = raisedField(prim.getAttribute('POSITION').getArray());
  const photo = await loadPhoto(root, FACE_PHOTO);
  PHOTO_FACE = true;
  // The painted skin takes the photograph's cheek, so the face has no seam.
  C.skin = photo.tone.map((v) => Math.round(v));
  for (const k of ['top', 'skirt', 'shoe', 'hair']) C[k] = photo.palette[k];
  log(`face and front projected from ${FACE_PHOTO.file}; skin rgb(${C.skin.join(', ')}), ${['top', 'skirt', 'shoe', 'hair'].map((k) => `${k} rgb(${C[k].join(', ')})`).join(', ')}`);
  let fromPhoto = 0;
  const DEBUG = { 1: [240, 190, 160], 2: [150, 80, 20], 3: [200, 20, 60], 4: [30, 30, 200], 5: [120, 120, 120], 6: [255, 255, 255],
    7: [255, 220, 0], 8: [0, 200, 60], 9: [0, 255, 255], 10: [255, 0, 255], 11: [255, 128, 0] };

  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const facing = nz / (Math.hypot(nx, ny, nz) || 1);
    const label = labelOf(x, y, z, nx, ny, nz, standoff[i], front, () => raisedAt(x, y, z, nx, ny, nz));
    counts[NAME[label]] = (counts[NAME[label]] ?? 0) + 1;
    let rgb, rough;
    if (debugLabels) { rgb = DEBUG[label]; rough = 0.8; } else {
      [rgb, rough] = colourOf(label, x, y, z, facing);
      let aoShare = AO_SHARE[label];
      let w = 0, pc = null;
      const arm = Math.abs(x) > 0.19 && y > 1.24;
      if (label === L.SKIN && z > 0 && y > 1.45 && y < 1.66 && polyDist(FACE, x, y) < -0.001) {
        // The face: its own landmark fit, which puts the features exactly.
        w = smooth(0.35, 0.65, facing) * smooth(0.001, 0.010, -polyDist(FACE, x, y));
        if (w > 0) { const [px, py] = photo.map(x, y); pc = photo.at(px, py); }
      } else if (!arm && PHOTO_GATE[label] && facing > 0.25) {
        const [px, py] = photo.warp(x, y);
        pc = photo.near(px, py, PHOTO_GATE[label]);
        // Cloth that faces up — the tops of the shoulders — is seen edge-on
        // by the camera and smears one pixel across it, so it needs to
        // face the camera squarely before it takes the photograph.
        if (pc) w = label === L.SKIN ? smooth(0.25, 0.55, facing) : smooth(0.45, 0.75, facing);
      }
      if (w > 0) {
        rgb = mix(rgb, pc, w);
        if (label === L.SKIN && w > 0.5) rough = 0.5;
        // The photograph already holds its own shading.
        aoShare *= 1 - w;
        fromPhoto += 1;
      }
      const occ = 1 - aoShare * (1 - ao[i]);
      rgb = rgb.map((v) => srgb(lin(clamp(v, 0, 255)) * occ));
    }
    R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
    RO[i] = rough; ME[i] = METAL[label] ?? 0;
  }
  log(`${fromPhoto.toLocaleString()} texels took the photograph`);
  // Grow every map into the empty page so a mip or a bilinear tap at an
  // island's edge reads its own colour, never the page.
  for (const a of [R, G, B, RO, ME]) gutter(a, ok, S, 8, 0);

  const rgb = Buffer.alloc(S * S * 3), mr = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    rgb[i * 3] = clamp(Math.round(R[i]), 0, 255); rgb[i * 3 + 1] = clamp(Math.round(G[i]), 0, 255); rgb[i * 3 + 2] = clamp(Math.round(B[i]), 0, 255);
    mr[i * 3] = 255; mr[i * 3 + 1] = clamp(Math.round(RO[i] * 255), 0, 255); mr[i * 3 + 2] = clamp(Math.round(ME[i] * 255), 0, 255);
  }
  const colourPng = await sharp(rgb, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer();
  const mrPng = await sharp(mr, { raw: { width: S, height: S, channels: 3 } }).resize(S / 2, S / 2, { kernel: 'lanczos3' }).png().toBuffer();
  const colourTex = doc.createTexture('sarah-colour').setMimeType('image/png').setImage(new Uint8Array(colourPng));
  const mrTex = doc.createTexture('sarah-roughness').setMimeType('image/png').setImage(new Uint8Array(mrPng));
  const mat = doc.createMaterial('Sarah')
    .setBaseColorTexture(colourTex).setBaseColorFactor([1, 1, 1, 1])
    .setMetallicRoughnessTexture(mrTex).setRoughnessFactor(1).setMetallicFactor(1);
  for (const p of mesh.listPrimitives()) p.setMaterial(mat);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`painted ${total.toLocaleString()} texels: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`).join(', ')}`);
  return { counts };
}
