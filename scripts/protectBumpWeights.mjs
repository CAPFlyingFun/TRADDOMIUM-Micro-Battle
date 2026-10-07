/**
 * SARAH'S BUMP BELONGS TO HER PELVIS, NOT HER THIGHS.
 *
 * Joshua, 2026-10-07 (with ChatGPT, reviewing PR #10): "her late-pregnancy
 * belly looks good while standing, but when she transitions into the seated
 * pose, the belly/lower torso appears to deform, flatten, cave inward" —
 * and: "identify the actual bone/weighting cause rather than hiding it with
 * pose adjustments."
 *
 * THE CAUSE, measured on the toon master as Meshy authored it
 * (`art/humans/Sarah-Toon.glb`, the front of the torso, in bands of height):
 *
 *   lower bump   root 56-62%  RIGHT THIGH 14-20%  LEFT THIGH 11-17%  spine 7-13%
 *   middle bump  root 58%     thighs 13%           spine 29%
 *   upper bump   root 41%     thighs 7%            spine 50%
 *
 * A quarter to a third of the lower bump is skinned to the THIGH bones. Seat
 * her and the thighs swing 88° forward, and that share of every vertex swings
 * with them: posed through the game's own seated pose and skinned on the CPU,
 * the lower bump moved 9.8 cm on average and its front fell from 18.7 cm to
 * 11.2 cm ahead of the hips — the belly visibly collapsing into her lap. It
 * is not the pose and it is not the camera: it is the auto-rigger treating a
 * pregnant belly as the top of the legs, because on most bodies that is
 * where the legs begin.
 *
 * THE FIX moves the thigh share of the bump onto the pelvis (the hips' own
 * parent), which carries the torso, and leaves everything else alone:
 *
 *   - only vertices IN FRONT of the hip line (`FRONT_FROM`..`FRONT_TO` ahead
 *     of it, faded) — the seat, the hips' sides and the buttocks keep their
 *     thigh weights, which the seated pose needs;
 *   - only ABOVE the groin crease (`CREASE_FROM`..`CREASE_TO` above the hip
 *     joints, faded) — the crease itself still folds with the thigh, which
 *     is what a real lap does;
 *   - only the LEG ROOT bones (the hips). Knees and ankles never reach here.
 *
 * Measured from the skeleton and the mesh, never by name or by body.
 * Distances are metres on the master (1.700 m tall).
 *
 * A module, not a command; imported by `bakeHumans.mjs` for bodies whose
 * entry sets `protectBump`.
 */

export const FRONT_FROM = 0.03;
export const FRONT_TO = 0.07;
export const CREASE_FROM = -0.01;
export const CREASE_TO = 0.07;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function jointPositions(skin) {
  const m = skin.getInverseBindMatrices().getArray();
  const out = [];
  for (let o = 0; o < m.length; o += 16) {
    const t = [m[o + 12], m[o + 13], m[o + 14]];
    const s2 = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    out.push([
      -(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]) / s2,
      -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]) / s2,
      -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]) / s2,
    ]);
  }
  return out;
}

/** The pelvis (first joint with three children) and its two downward children, the hips. */
function pelvisAndHips(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3);
  if (pelvis < 0) return null;
  const hips = kids[pelvis].filter((c) => at[c][1] < at[pelvis][1] + 1e-6 && kids[c].length > 0)
    .sort((a, b) => at[a][1] - at[b][1]).slice(0, 2);
  return hips.length === 2 ? { pelvis, hips } : null;
}

export function protectBumpWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const found = pelvisAndHips(skin, at);
  if (!found) { log('bump: no pelvis with two hips found; weights left as authored'); return; }
  const { pelvis, hips } = found;
  const hipY = (at[hips[0]][1] + at[hips[1]][1]) / 2;
  const hipZ = (at[hips[0]][2] + at[hips[1]][2]) / 2;
  const legRoot = new Set(hips);
  let moved = 0, touched = 0, total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      if (!P || !J || !W) continue;
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      for (let v = 0; v < P.getCount(); v += 1) {
        P.getElement(v, p);
        const k = smoothstep(FRONT_FROM, FRONT_TO, p[2] - hipZ) * smoothstep(CREASE_FROM, CREASE_TO, p[1] - hipY);
        if (k <= 0) continue;
        J.getElement(v, j);
        W.getElement(v, w);
        const sum = new Map();
        let lift = 0;
        for (let i = 0; i < 4; i += 1) {
          if (!(w[i] > 0)) continue;
          let wi = w[i];
          if (legRoot.has(j[i])) { lift += wi * k; wi *= 1 - k; }
          sum.set(j[i], (sum.get(j[i]) ?? 0) + wi);
        }
        if (lift <= 0) continue;
        sum.set(pelvis, (sum.get(pelvis) ?? 0) + lift);
        const top = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const s = top.reduce((acc, e) => acc + e[1], 0) || 1;
        J.setElement(v, [0, 1, 2, 3].map((i) => (top[i] ? top[i][0] : 0)));
        W.setElement(v, [0, 1, 2, 3].map((i) => (top[i] ? top[i][1] / s : 0)));
        moved += lift;
        touched += 1;
      }
      total += P.getCount();
    }
  }
  log(`bump: thigh weight lifted onto the pelvis on ${touched.toLocaleString()} of ${total.toLocaleString()} vertices (${moved.toFixed(0)} vertex-weights moved)`);
}
