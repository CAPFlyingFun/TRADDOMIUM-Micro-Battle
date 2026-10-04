/**
 * PAINT OUT THE LOGO THE SCANNER TRIED TO PRINT ON JACK'S SHIRT.
 *
 * Jack's master has a chest logo on his polo that was meant to read TOMBS
 * and reads "TOIARG" over a line of unreadable tagline. Joshua, 2026-09-29,
 * choosing between the two fixes: paint over it rather than repair the text,
 * "which would probably be quicker". It is also the honest one — the
 * printing is 60 x 30 mm on a 2048 atlas of hundreds of islands, so a
 * repaired logo would be the badge's problem again (`printBadge.mjs` says
 * why), and the story already puts TOMBS on the card round his neck.
 *
 * HOW. The logo is found in SPACE, not in the atlas. Inside a box on the
 * chest, a texel is SHIRT when its colour is close to the shirt's own median
 * and a HOLE when it is a letter or the grey halo round one: the scan
 * blurred the printing, so every stroke carries a fringe two or three
 * millimetres wide that is neither white nor navy, and a fill keyed on
 * brightness alone left it behind as a smudge. Each hole is refilled with
 * the distance-weighted average of the nearest SHIRT texels, gathered in 3D.
 * That keeps the shirt's own light — the folds across his chest are broader
 * than a stroke, so they survive a fill from a few millimetres away — and it
 * works across UV seams, which a fill in the image cannot.
 *
 * Only texels genuinely INSIDE a triangle are used as a source. The bleed
 * skirt round each island holds whatever the texturer padded it with, and
 * sampling it is what turned the first fill brown.
 *
 * EVERY MAP IS FILLED, not only the colour. The master's roughness map
 * printed the letters too (163 against the shirt's 190, a satin logo on a
 * matte polo), and a clean colour under a shiny word still reads as a grey
 * smudge the moment a light catches it. The normal map is filled the same
 * way so the letters leave no relief. Maps of another size are rasterised
 * at their own size and read the hole mask through the UVs they share.
 *
 * THE ROUGHNESS LOGO IS NOT THE COLOUR LOGO. It is a solid satin block
 * roughly 65 x 20 mm, wider than the lettering and taller than it (read off
 * the master: 150-175 inside, 188-194 on the polo all round), so a fill
 * through the colour's letter mask left the block standing between the
 * letters. That map therefore also judges its OWN texels: anything in the
 * box further than `ROUGH_TOL` from the polo's median roughness is a hole,
 * and only texels within it are a source.
 *
 * Deterministic: no randomness, so two bakes are byte-identical.
 */
import sharp from 'sharp';
import { rasterize } from './humanSurface.mjs';

/** A shirt texel is within this RGB distance of the shirt's median colour. */
const SHIRT_NEAR = 16;
/** A letter is at least this much brighter than the shirt's median. */
const LETTER_LIFT = 40;
/** The halo: non-shirt texels within this distance of a letter are holes too. */
const GROW = 0.005;
/** And everything within this distance of a letter, whatever its colour. */
const EDGE = 0.0015;
/**
 * THE FILL IS A BROAD AVERAGE, NOT THE NEAREST RING. The texels right round
 * a letter are the printing's dark shadow side — the scan drew the logo with
 * a darker rim — so filling from the nearest shirt copied that rim inwards
 * and left a brown ghost of the word. The ring is skipped, and what is left
 * is weighted by a Gaussian of `FILL_SIGMA` out to `FILL_RADII`, widening
 * only if nothing is found.
 */
const RING = 0.0025, FILL_SIGMA = 0.005;
const FILL_RADII = [0.015, 0.025, 0.04];
/** A margin of shirt round the box, to fill the box's own edge from. */
const MARGIN = 0.012;
const CELL = 0.002;
/** How far from the polo's median roughness (0-255, green) is still polo. */
const ROUGH_TOL = 8;

function hashGrid(ids, pos, cell) {
  const g = new Map();
  for (const i of ids) {
    const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
    let a = g.get(k); if (!a) { a = []; g.set(k, a); } a.push(i);
  }
  return g;
}

function near(g, pos, cell, x, y, z, r, visit) {
  const n = Math.ceil(r / cell);
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
  for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let c = -n; c <= n; c++) {
    const list = g.get(`${cx + a},${cy + b},${cz + c}`);
    if (!list) continue;
    for (const j of list) {
      const d = Math.hypot(pos[j * 3] - x, pos[j * 3 + 1] - y, pos[j * 3 + 2] - z);
      if (d <= r) visit(j, d);
    }
  }
}

async function readRaw(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
  return { data, S: info.width, ch: info.channels };
}

/** The texels of a sheet that lie in the box (plus margin) and face forward. */
function inBox(sheet, S, box, margin) {
  const { pos, nrm, ok } = sheet;
  const out = [];
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < box.x0 - margin || x > box.x1 + margin || y < box.y0 - margin || y > box.y1 + margin || z < box.zMin) continue;
    if (nrm[i * 3 + 2] < 0.2 * Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2])) continue;
    out.push(i);
  }
  return out;
}

/**
 * `spec.box` bounds the logo in bind-pose metres: x0..x1, y0..y1, and zMin,
 * the depth in front of which the chest lies. Mutates `doc`.
 */
export async function clearShirtLogo(doc, spec, { log = () => {} } = {}) {
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const mat = prim.getMaterial();
  const box = spec.box;
  const colourTex = mat.getBaseColorTexture();
  const col = await readRaw(colourTex);
  const S = col.S, C = col.ch, img = col.data;
  const sheet = rasterize(prim, S, 2);
  const { pos } = sheet;
  const around = inBox(sheet, S, box, MARGIN);
  if (!around.length) throw new Error('clearShirtLogo: no shirt found in the box — the box is wrong');

  // The shirt's median colour, per channel, over everything in reach.
  const median = [0, 1, 2].map((k) => {
    const v = around.map((i) => img[i * C + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const dist = (i) => Math.hypot(img[i * C] - median[0], img[i * C + 1] - median[1], img[i * C + 2] - median[2]);
  const bright = (i) => (img[i * C] + img[i * C + 1] + img[i * C + 2]) / 3 - (median[0] + median[1] + median[2]) / 3;
  const inside = (i) => {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  };

  const grid = hashGrid(around, pos, CELL);
  const hole = new Uint8Array(S * S);
  let letters = 0;
  for (const i of around) {
    if (!inside(i) || bright(i) < LETTER_LIFT) continue;
    letters += 1;
    hole[i] = 1;
    near(grid, pos, CELL, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], GROW, (j, d) => {
      if (d <= EDGE || dist(j) > SHIRT_NEAR) hole[j] = 1;
    });
  }
  // A source is shirt-coloured, not a hole, and inside a triangle.
  const source = new Uint8Array(S * S);
  for (const i of around) if (!hole[i] && sheet.ok[i] === 2 && dist(i) <= SHIRT_NEAR) source[i] = 1;
  for (const i of around) {
    if (!hole[i]) continue;
    near(grid, pos, CELL, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], RING, (j) => { source[j] = 0; });
  }
  const holes = around.filter((i) => hole[i]).length;

  /** Fill one map. Maps of another size read the mask through the shared UVs. */
  const fillMap = async (tex, label, own = null) => {
    const m = await readRaw(tex);
    const Sm = m.S, ch = m.ch;
    const sh = Sm === S ? sheet : rasterize(prim, Sm, 2);
    const ids = Sm === S ? around : inBox(sh, Sm, box, MARGIN);
    const toColour = (j) => Math.min(S - 1, Math.floor(((j / Sm) | 0) * S / Sm)) * S + Math.min(S - 1, Math.floor((j % Sm) * S / Sm));
    // `own` = [channel, tolerance]: this map also judges its own texels
    // against its own median over the same patch of shirt.
    let off = () => false;
    if (own) {
      const [k, tol] = own;
      const v = ids.map((j) => m.data[j * ch + k]).sort((a, b) => a - b);
      const med = v[v.length >> 1];
      off = (j) => Math.abs(m.data[j * ch + k] - med) > tol;
    }
    const inBoxOnly = (j) => {
      const x = sh.pos[j * 3], y = sh.pos[j * 3 + 1];
      return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
    };
    const mHole = [], mSrc = [];
    for (const j of ids) {
      const c = toColour(j);
      if (hole[c] || (own && inBoxOnly(j) && off(j))) mHole.push(j);
      else if (source[c] && sh.ok[j] === 2 && !off(j)) mSrc.push(j);
    }
    const g = hashGrid(mSrc, sh.pos, CELL);
    const out = Buffer.from(m.data);
    let done = 0;
    for (const j of mHole) {
      for (const r of FILL_RADII) {
        let w = 0; const s = new Float64Array(ch);
        near(g, sh.pos, CELL, sh.pos[j * 3], sh.pos[j * 3 + 1], sh.pos[j * 3 + 2], r, (q, d) => {
          const k = Math.exp(-(d * d) / (2 * FILL_SIGMA * FILL_SIGMA));
          for (let c = 0; c < ch; c++) s[c] += m.data[q * ch + c] * k;
          w += k;
        });
        if (w > 0) {
          for (let c = 0; c < ch; c++) out[j * ch + c] = Math.round(s[c] / w);
          done += 1;
          break;
        }
      }
    }
    tex.setImage(new Uint8Array(await sharp(out, { raw: { width: Sm, height: Sm, channels: ch } }).png().toBuffer())).setMimeType('image/png');
    return `${label} ${done}/${mHole.length}`;
  };

  const report = [await fillMap(colourTex, 'colour')];
  if (mat.getNormalTexture()) report.push(await fillMap(mat.getNormalTexture(), 'normal'));
  if (mat.getMetallicRoughnessTexture()) report.push(await fillMap(mat.getMetallicRoughnessTexture(), 'roughness', [1, ROUGH_TOL]));
  log(`shirt logo painted out: shirt rgb(${median.join(',')}), ${letters} letter texels and their halo = ${holes} holes; refilled ${report.join(', ')}`);
  return { median, letters, holes };
}
