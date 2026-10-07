/**
 * THE TOMBS BADGE, ON ITS OWN — the card and its clip, cut out of Joshua's
 * Meshy lanyard and baked into `public/models/badge.glb` in a frame a body
 * can hang it from.
 *
 * Joshua, 2026-10-07 (release `New-Jack-and-Sarah-Pixar-Models`): "I
 * separated the badges from the body, so the badge could be like a soft
 * body or something to hang and move more freely." Until now the card was
 * part of each scan's skin and moved exactly as rigidly as the chest it
 * was welded to; `printBadge.mjs` existed to repaint it in place.
 *
 * WHAT THE MASTER IS, measured (`art/humans/Badge-Toon.glb`):
 *
 *   12.35 MB · 154,390 tris · one mesh, no skin · 2K colour, normal,
 *   metal-rough · ±0.56 x ±0.92 x ±0.95 in its own arbitrary units
 *
 * It is the WHOLE LANYARD, laid out flat as a photograph of one would be —
 * a loop and a hanging card in one plane — and that plane is TILTED 45
 * DEGREES ABOUT X: the card's normal is (0, 0.709, 0.706) and the strap's
 * top is at (y +0.9, z -0.95). A loop laid flat cannot be put round a
 * neck without bending it, and a rigid strap through a collarbone is the
 * one result worse than no strap. So THE CARD AND THE CLIP ARE KEPT and
 * the loop is not: what hangs the card is drawn at run time, from the
 * wearer's own neck, as two ribbons (`view/HumanBadge.ts`).
 *
 * THE FRAME IT IS BAKED INTO, which is the contract with the runtime:
 *
 *   - metres, the card WIDTH_M across;
 *   - the origin is the PIVOT: the clip's ring, where the two straps meet
 *     and where the whole card turns when it swings;
 *   - +y up, so the card hangs along -y;
 *   - +z is the printed face, and the card's BACK is at z = 0, so a pivot
 *     placed on a shirt hangs a card that rests on it rather than in it.
 *
 * The numbers below were read off slices of the rotated master (40 bands
 * along y, each band's x and z extent): the card is x -0.135..0.264 and
 * y -1.314..-0.857 (a dense band of 8,501 vertices at -0.86 is the holder's
 * top rim), the clip is the narrow column x 0.004..0.123 up to y -0.60, and
 * from -0.53 upward the two straps diverge.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';

/** The rotation that stands the master up: +45 degrees about x. */
const TILT = Math.PI / 4;
/** Where the clip's ring is, in the ROTATED master's units. */
const PIVOT = { x: 0.0645, y: -0.595, z: 0.005 };
/** Anything above this (rotated units) is lanyard, not badge. */
const CUT_Y = -0.585;
/** The card's width in the rotated master, x -0.135..0.264. */
const CARD_WIDTH_UNITS = 0.399;
/**
 * The card's real width. GAME TUNING inside a real range: a CR80 card is
 * 54 mm and a holder round one about 60-65 mm. 62 mm keeps the toon
 * proportions of the master (its card is squarer than CR80) at a size that
 * reads as a badge on a chest rather than a placard.
 */
export const BADGE_WIDTH_M = 0.062;
/** About 30,000 triangles: below that the holder's rim and the plastic face facet visibly. */
const SIMPLIFY_RATIO = 0.4;

/**
 * Bake the badge master into `out`. `io` is the bake's NodeIO, already
 * registered for meshopt.
 */
export async function bakeBadge(io, from, out, sharp, log) {
  await MeshoptSimplifier.ready;
  const doc = await io.read(from);
  const root = doc.getRoot();
  const scale = BADGE_WIDTH_M / CARD_WIDTH_UNITS;
  const c = Math.cos(TILT), s = Math.sin(TILT);

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const n = pos.getCount();
      const P = new Float32Array(n * 3);
      const N = nrm ? new Float32Array(n * 3) : null;
      const keep = new Uint8Array(n);
      const v = [0, 0, 0];
      for (let i = 0; i < n; i += 1) {
        pos.getElement(i, v);
        const y = v[1] * c - v[2] * s;
        const z = v[1] * s + v[2] * c;
        keep[i] = y <= CUT_Y ? 1 : 0;
        P[i * 3] = (v[0] - PIVOT.x) * scale;
        P[i * 3 + 1] = (y - PIVOT.y) * scale;
        P[i * 3 + 2] = (z - PIVOT.z) * scale;
        if (N) {
          nrm.getElement(i, v);
          N[i * 3] = v[0];
          N[i * 3 + 1] = v[1] * c - v[2] * s;
          N[i * 3 + 2] = v[1] * s + v[2] * c;
        }
      }
      pos.setArray(P);
      if (N) nrm.setArray(N);
      // A triangle survives only if all three corners are badge: the cut
      // runs through strap, so nothing of the card is near it.
      const idx = prim.getIndices().getArray();
      const kept = [];
      for (let t = 0; t < idx.length; t += 3) {
        if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) kept.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      prim.getIndices().setArray(n > 65535 ? new Uint32Array(kept) : new Uint16Array(kept));
      log(`kept ${(kept.length / 3).toLocaleString()} of ${(idx.length / 3).toLocaleString()} triangles below the clip`);
    }
  }
  // The node matrix is identity in the master; the frame lives in the vertices.
  for (const node of root.listNodes()) node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // One-sided: a card is seen from its front and its back, and both are
  // real faces of the mesh, so double-sided only doubles the fill.
  for (const m of root.listMaterials()) m.setDoubleSided(false);

  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: 0.002, lockBorder: false }),
    prune(),
  );
  for (const [slot, size] of [['baseColorTexture', 1024], ['normalTexture', 1024], ['metallicRoughnessTexture', 256]]) {
    await doc.transform(textureCompress({
      encoder: sharp, targetFormat: 'webp', slots: new RegExp(`^${slot}$`),
      resize: [size, size], resizeFilter: 'lanczos3', quality: slot === 'baseColorTexture' ? 88 : 85,
    }));
  }
  await doc.transform(meshopt({ encoder: (await import('meshoptimizer')).MeshoptEncoder, level: 'medium' }), prune());
  await io.write(out, doc);
  const tris = root.listMeshes().flatMap((m) => m.listPrimitives())
    .reduce((k, p) => k + p.getIndices().getCount() / 3, 0);
  log(`${Math.round(tris).toLocaleString()} triangles, ${BADGE_WIDTH_M * 1000} mm wide, pivot at the clip`);
}
