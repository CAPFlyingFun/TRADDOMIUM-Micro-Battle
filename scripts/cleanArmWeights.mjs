/**
 * ARMS THAT FOLLOW THEIR OWN BONES (Joshua, 2026-10-13: seated, "part of the arm is
 * skewed... v1 had the same issue"). A master rigged with its arms DOWN (Sarah v2)
 * has its elbows beside her waist and its hands beside her hips, and the auto-rig
 * and the weight passes after it gave that skin a share of the spine, the pelvis and
 * the thighs, which do not move with the arm. Standing that is invisible; sitting,
 * with the arm raised forward, those vertices stay behind and stretch the elbow into
 * a fin. So on the arm, the share of any bone that is not the arm's is faded out
 * along the upper arm: kept at the shoulder (where the arm really does join the
 * chest), gone from `CLEAN_FROM` of the way to the elbow, and none at all on the
 * forearm and hand. The freed weight goes to the arm's own bones, in proportion.
 */
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/** Along the upper arm (0 shoulder, 1 elbow): non-arm weight kept fully before
 * KEEP_TO, none after CLEAN_FROM. GAME TUNING. */
export const KEEP_TO = 0.15;
export const CLEAN_FROM = 0.45;
/** Skin is cleaned only where the arm owns most of it, and (above the elbow) within
 * this distance of the shoulder-to-elbow line, metres. */
export const ARM_MAJORITY = 0.5;
export const ON_ARM_M = 0.065;
/** Off the arm's line, the arm's share is kept within CHEST_KEEP_M and gone past
 * CHEST_FREE_M, metres. GAME TUNING. */
export const CHEST_KEEP_M = 0.06;
export const CHEST_FREE_M = 0.11;

export function cleanArmWeights(doc, parts, at, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().filter((c) => joints.includes(c)).map((c) => joints.indexOf(c)));
  const isArm = (k) => parts.part[k] === 'arms' || parts.part[k] === 'upperArm';
  const shoulders = parts.part.map((p, k) => (p === 'upperArm' ? k : -1)).filter((k) => k >= 0)
    .map((k) => ({ s: at[k], e: at[kids[k][0] ?? k] }));
  if (!shoulders.length) return;
  let cleaned = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), P = prim.getAttribute('POSITION');
    if (!J || !W || !P) continue;
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0], v = [0, 0, 0];
    for (let i = 0; i < J.getCount(); i += 1) {
      J.getElement(i, j); W.getElement(i, w);
      let arm = 0, other = 0;
      for (let k = 0; k < 4; k += 1) if (w[k] > 0) { if (isArm(j[k])) arm += w[k]; else other += w[k]; }
      if (arm < ARM_MAJORITY || other <= 0) continue;
      P.getElement(i, v);
      const side = shoulders.reduce((b, c) => (Math.abs(Math.sign(c.s.x) - Math.sign(v[0])) < Math.abs(Math.sign(b.s.x) - Math.sign(v[0])) ? c : b));
      const ax = side.e.x - side.s.x, ay = side.e.y - side.s.y, az = side.e.z - side.s.z, l2 = ax * ax + ay * ay + az * az || 1;
      const t = ((v[0] - side.s.x) * ax + (v[1] - side.s.y) * ay + (v[2] - side.s.z) * az) / l2;
      // only skin ON the arm: the side of her chest under the armpit, which also carries
      // some arm, lies well off the arm's line and keeps every bone it has
      const px = side.s.x + ax * t - v[0], py = side.s.y + ay * t - v[1], pz = side.s.z + az * t - v[2];
      if (t < 1 && Math.hypot(px, py, pz) > ON_ARM_M) continue;
      const keep = smooth(CLEAN_FROM, KEEP_TO, t);
      if (keep >= 0.999) continue;
      const freed = other * (1 - keep);
      for (let k = 0; k < 4; k += 1) if (w[k] > 0) w[k] = isArm(j[k]) ? w[k] * (1 + freed / arm) : w[k] * keep;
      const sum = w[0] + w[1] + w[2] + w[3]; for (let k = 0; k < 4; k += 1) w[k] /= sum;
      W.setElement(i, w); cleaned += 1;
    }
  }
  // AND THE OTHER WAY: HER CHEST FREED OF HER ARMS (Joshua, 2026-10-13: seated, "the
  // breasts... a small chunk is missing"). The auto-rig gave the front of her chest
  // and her breasts a share of the upper arms; when an arm comes forward and down to
  // rest on her thigh, that share drags part of the breast with it and tears its
  // inner edge. Skin well off the arm's own line keeps none of the arm: full arm
  // weight is kept within `CHEST_KEEP_M` of the line (the armpit stretches with the
  // arm, as it should), none past `CHEST_FREE_M`, the freed share going to the body's
  // own bones there, in proportion
  const chest = joints.findIndex((_, k) => kids[k].length >= 3 && kids[k].some((c) => parts.part[c] === 'head'));
  let freedChest = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), P = prim.getAttribute('POSITION');
    if (!J || !W || !P) continue;
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0], v = [0, 0, 0];
    for (let i = 0; i < J.getCount(); i += 1) {
      J.getElement(i, j); W.getElement(i, w);
      let arm = 0, other = 0;
      for (let k = 0; k < 4; k += 1) if (w[k] > 0) { if (isArm(j[k])) arm += w[k]; else other += w[k]; }
      if (arm <= 0 || arm >= ARM_MAJORITY) continue;
      P.getElement(i, v);
      let best = Infinity;
      for (const side of shoulders) {
        const ax = side.e.x - side.s.x, ay = side.e.y - side.s.y, az = side.e.z - side.s.z, l2 = ax * ax + ay * ay + az * az || 1;
        const t = Math.max(0, Math.min(1, ((v[0] - side.s.x) * ax + (v[1] - side.s.y) * ay + (v[2] - side.s.z) * az) / l2));
        best = Math.min(best, Math.hypot(side.s.x + ax * t - v[0], side.s.y + ay * t - v[1], side.s.z + az * t - v[2]));
      }
      const keep = smooth(CHEST_FREE_M, CHEST_KEEP_M, best);
      if (keep >= 0.999) continue;
      const freed = arm * (1 - keep);
      if (other > 0) { for (let k = 0; k < 4; k += 1) if (w[k] > 0) w[k] = isArm(j[k]) ? w[k] * keep : w[k] * (1 + freed / other); }
      else if (chest >= 0) { for (let k = 0; k < 4; k += 1) w[k] *= keep; let slot = w.indexOf(Math.min(...w)); j[slot] = chest; w[slot] += freed; J.setElement(i, j); }
      const sum = w[0] + w[1] + w[2] + w[3]; for (let k = 0; k < 4; k += 1) w[k] /= sum;
      W.setElement(i, w); freedChest += 1;
    }
  }
  log(`arms: ${cleaned.toLocaleString('en-US')} arm vertices freed of the spine, pelvis and thighs below the shoulder; ${freedChest.toLocaleString('en-US')} chest and breast vertices freed of the arms`);
}
