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
  brow: [96, 54, 38],
  top: [106, 11, 40],
  skirt: [22, 22, 27],
  shoe: [104, 106, 116],
  sole: [226, 224, 218],
  band: [24, 24, 28],
  strap: [26, 28, 33],
  card: [238, 238, 236],
  holder: [196, 202, 208],
  clip: [150, 152, 158],
  lip: [192, 106, 108],
  teeth: [236, 230, 216],
  sclera: [236, 232, 226],
  iris: [92, 118, 138],
  irisRim: [40, 52, 64],
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

/** The neck's vertical axis, and the collar's height round it by bearing
 * (0 = straight ahead, +90 = her left). A crew neck: 1.345 at the front,
 * rising over the collarbones to 1.44 at the sides and back. */
const NECK = { x: 0.004, z: -0.015 };
const NECKLINE = [[-180, 1.445], [-120, 1.445], [-90, 1.44], [-65, 1.425], [-50, 1.40], [-35, 1.372], [-20, 1.352], [0, 1.345],
  [20, 1.352], [35, 1.372], [50, 1.40], [65, 1.425], [90, 1.44], [120, 1.445], [180, 1.445]];

/** The top's hem by depth: low under the bump, level across the back. */
const HEM = [[-0.25, 0.965], [-0.06, 0.962], [-0.02, 0.95], [0.02, 0.93], [0.06, 0.905], [0.10, 0.878], [0.135, 0.855], [0.25, 0.85]];
const SKIRT_HEM = 0.590;

/** Sleeve hems, slanted: [x at the top of the arm, y there, x underneath, y there]. */
const SLEEVE = { left: [0.250, 1.400, 0.220, 1.295], right: [-0.263, 1.390, -0.237, 1.290] };
/** The wrist bands, as |x| ranges. */
const BAND = { left: [0.607, 0.641], right: [-0.638, -0.602] };

/** The shoes' collars round each ankle, by bearing: tongue high at the
 * front, dipping under the ankle bones, the heel tab at the back. */
const SHOE_COLLAR = [[-180, 0.093], [-135, 0.080], [-90, 0.072], [-45, 0.090], [0, 0.115], [45, 0.090], [90, 0.072], [135, 0.080], [180, 0.093]];
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
/** The nape and throat are skin within this of the neck's axis; the
 * ponytail hangs outside it. */
const NECK_SKIN_R = 0.068;

/** The card and its clip. */
const CARD = { x0: -0.040, x1: 0.040, y0: 1.095, y1: 1.180, zMin: 0.135 };
const CLIP = { x0: -0.016, x1: 0.016, y0: 1.172, y1: 1.215, zMin: 0.120 };

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
const IRIS_R = 0.0056, PUPIL_R = 0.0022;
const BROWS = [
  [[-0.012, 1.5815], [-0.022, 1.5875], [-0.034, 1.5900], [-0.046, 1.5885], [-0.057, 1.5830]],
  [[0.012, 1.5815], [0.022, 1.5875], [0.034, 1.5900], [0.046, 1.5885], [0.057, 1.5830]],
];
const LIP_TOP = [m(370, 300), m(420, 250), m(520, 228), m(650, 222), m(760, 228), m(800, 232), m(840, 226), m(960, 220), m(1080, 228), m(1160, 262), m(1175, 300)];
const SEAM = [m(390, 350), m(500, 352), m(650, 355), m(800, 352), m(950, 345), m(1080, 332), m(1150, 315)];
const TEETH_LOW = [m(420, 360), m(470, 395), m(560, 425), m(700, 440), m(800, 445), m(950, 440), m(1050, 410), m(1100, 370), m(1140, 325)];
const LIP_LOW = [m(440, 380), m(520, 450), m(640, 495), m(800, 510), m(960, 495), m(1060, 450), m(1110, 380)];
const UPPER_LIP = [...LIP_TOP, ...[...SEAM].reverse()];
const TEETH = [...SEAM, ...[...TEETH_LOW].reverse()];
const LOWER_LIP = [...TEETH_LOW, ...[...LIP_LOW].reverse()];

// ------------------------------------------------------------ classification

function labelOf(x, y, z, nx, ny, nz, standoff) {
  const facing = nz / (Math.hypot(nx, ny, nz) || 1);
  // The card and its clip hang in front of everything.
  if (z > CARD.zMin && y > CARD.y0 && y < CARD.y1 && x > CARD.x0 && x < CARD.x1) return facing > 0.8 ? L.CARD : L.HOLDER;
  if (z > CLIP.zMin && y > CLIP.y0 && y < CLIP.y1 && x > CLIP.x0 && x < CLIP.x1) return L.CLIP;

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

  // Legs and feet.
  if (y < SKIRT_HEM) {
    if (y < 0.16) {
      // Each ankle's axis: the centroid of the leg between 130 and 160 mm.
      const ax = x > 0 ? 0.081 : -0.079, az = -0.032;
      const deg = Math.atan2(x - ax, z - az) * 180 / Math.PI;
      if (y < SOLE_TOP || (z > 0.12 && y < 0.03)) return L.SOLE;
      if (y < interpAngle(SHOE_COLLAR, x > 0 ? deg : -deg)) return L.SHOE;
    }
    return L.SKIN;
  }
  if (y < interp(HEM, z)) return L.SKIRT;

  // The torso up to the collar, and whatever hangs on it.
  const dx = x - NECK.x, dz = z - NECK.z, rNeck = Math.hypot(dx, dz);
  const deg = Math.atan2(dx, dz) * 180 / Math.PI;
  const collar = interpAngle(NECKLINE, deg);
  const thin = standoff < 0.008;
  if (thin && y > 1.17 && y < 1.50 && ((z > 0 && Math.abs(x) < 0.085) || (rNeck < 0.10 && y > 1.36))) return L.STRAP;
  if (y < collar) {
    // The ponytail lies over her left shoulder: thin against the body.
    if (x > 0.02 && y > 1.30 && standoff < 0.045) return L.HAIR;
    return L.TOP;
  }

  // Head and neck.
  if (z > -0.035 && facing > -0.1 && polyDist(FACE, x, y) < 0) return L.SKIN;
  const hairline = interp(SIDE_HAIRLINE[side], z);
  if (y < hairline) {
    if (rNeck < NECK_SKIN_R) return L.SKIN;
    // The ears: in front of the axis, at the sides, below the hairline.
    if (z > -0.055 && Math.abs(x) > 0.055 && y > 1.49) return L.SKIN;
  }
  if (y < 1.455 && rNeck < NECK_SKIN_R + 0.004) return L.SKIN;
  return L.HAIR;
}

// ------------------------------------------------------------------- colour

function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** The painted face over the skin: returns [rgb, roughness] or null. */
function faceAt(x, y, z, facing, base) {
  if (z < 0.02 || facing < 0.15 || y < 1.47 || y > 1.60 || Math.abs(x) > 0.07) return null;
  const f = 0.0006;                                 // feather, metres
  let c = base, r = null;
  // Brows.
  for (const b of BROWS) {
    const d = lineDist(b, x, y);
    const t = clamp((Math.abs(x) - 0.012) / 0.045, 0, 1);
    const half = 0.0021 * (1 - 0.55 * t);
    const a = 1 - smooth(half - f, half + f, d);
    if (a > 0) {
      const g = 0.75 + 0.5 * noise3(x * 3000, y * 600, 0);
      c = mix(c, C.brow.map((v) => v * g), a * 0.85);
    }
  }
  // Eyes: sclera inside the opening, iris and pupil, a lash line above.
  for (const eye of EYES) {
    const d = polyDist(eye.open, x, y);
    const lashD = lineDist(eye.lid, x, y);
    const lash = (1 - smooth(0.0006, 0.0016, lashD)) * (d > -0.0012 ? 1 : 0);
    if (d < f) {
      const a = 1 - smooth(-f, f, d);
      const rr = Math.hypot(x - eye.c[0], y - eye.c[1]);
      let ec = C.sclera;
      ec = mix(ec, mix(C.iris, C.irisRim, smooth(IRIS_R * 0.55, IRIS_R, rr)), 1 - smooth(IRIS_R - 0.0003, IRIS_R + 0.0003, rr));
      ec = mix(ec, C.pupil, 1 - smooth(PUPIL_R - 0.0002, PUPIL_R + 0.0002, rr));
      // A catchlight, up and to her left, as a real eye would hold one.
      const cl = Math.hypot(x - (eye.c[0] + 0.0018), y - (eye.c[1] + 0.0020));
      ec = mix(ec, [250, 250, 250], 1 - smooth(0.0004, 0.0008, cl));
      c = mix(c, ec, a);
      if (a > 0.5) r = 0.12;
    }
    if (lash > 0) c = mix(c, C.lash, lash * 0.9);
  }
  // Lips and teeth.
  const dt = polyDist(TEETH, x, y);
  if (dt < f) { c = mix(c, C.teeth, 1 - smooth(-f, f, dt)); r = 0.3; }
  for (const lip of [UPPER_LIP, LOWER_LIP]) {
    const d = polyDist(lip, x, y);
    if (d < 0.0012) {
      const a = 1 - smooth(-0.0006, 0.0012, d);
      c = mix(c, C.lip, a);
      if (a > 0.5) r = 0.35;
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
      const fc = faceAt(x, y, z, facing, c);
      if (fc) { c = fc[0]; if (fc[1] !== null) r = fc[1]; }
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

// ---------------------------------------------------------------- the pass

/**
 * Paint the master. Adds a material with a base-colour and a
 * metallic-roughness map and assigns it; mutates `doc`.
 *
 * `debugLabels` paints each region one flat colour instead, for checking
 * the boundaries against the sculpt.
 */
export async function paintSarah(doc, { cacheDir, stamp, log = console.log, S = 2048, debugLabels = false }) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const surf = surfaceOf(prim, S, cacheDir, stamp, log);
  const { pos, nrm, ok, ao, standoff } = surf;
  const R = new Float32Array(S * S), G = new Float32Array(S * S), B = new Float32Array(S * S);
  const RO = new Float32Array(S * S), ME = new Float32Array(S * S);
  const counts = {};
  const DEBUG = { 1: [240, 190, 160], 2: [150, 80, 20], 3: [200, 20, 60], 4: [30, 30, 200], 5: [120, 120, 120], 6: [255, 255, 255],
    7: [255, 220, 0], 8: [0, 200, 60], 9: [0, 255, 255], 10: [255, 0, 255], 11: [255, 128, 0] };

  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const facing = nz / (Math.hypot(nx, ny, nz) || 1);
    const label = labelOf(x, y, z, nx, ny, nz, standoff[i]);
    counts[NAME[label]] = (counts[NAME[label]] ?? 0) + 1;
    let rgb, rough;
    if (debugLabels) { rgb = DEBUG[label]; rough = 0.8; } else {
      [rgb, rough] = colourOf(label, x, y, z, facing);
      const occ = 1 - AO_SHARE[label] * (1 - ao[i]);
      rgb = rgb.map((v) => srgb(lin(clamp(v, 0, 255)) * occ));
    }
    R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
    RO[i] = rough; ME[i] = METAL[label] ?? 0;
  }
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
