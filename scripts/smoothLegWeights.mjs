/**
 * SARAH'S KNEES AND ANKLES, re-weighted so they bend instead of tearing.
 *
 * Her Lab3 master was rigged with hard edges: the ankle's share of a
 * vertex falls from 0.74 to 0.01 inside one 5 cm band of her calf, the
 * knee's does the same at the knee, and a few calf vertices 10–15 cm up
 * the leg belong almost wholly to the FOOT. Standing, none of it shows.
 * Walking, it does: every bend of a knee or an ankle opens the skin along
 * that edge into a staircase of notches and flaps, and the stray vertices
 * swing out with the foot as spikes (measured by bending one joint at a
 * time on the unposed body: the hip alone is clean, the knee tears behind
 * the knee, the ankle tears the lower calf). Jack's master blends across
 * both joints and does not need this.
 *
 * So each leg's hip, knee and ankle weights are rebuilt from HEIGHT, which
 * is exact here because her legs stand vertical in the bind. The thigh
 * (hip joint) gives way to the shin (knee joint) across ±`KNEE_BLEND`
 * of the knee, and the shin to the foot (ankle joint) across
 * ±`ANKLE_BLEND` of the ankle, each along a smoothstep — linear-blend
 * skinning over a band that wide folds a hinge like skin rather than
 * like a cut.
 *
 * WHAT IS LEFT ALONE: anything with weight on a bone outside that leg's
 * three (the pelvis, the other leg, the toes), anything outside the leg's
 * own radius (the skirt), and everything above `THIGH_TOP` below the hip
 * joint (the crotch and the top of the thigh, which the master blends into
 * the pelvis itself and which pose cleanly).
 *
 * A module, not a command; imported by `bakeHumans.mjs`, which runs it on
 * the bodies whose entry asks for it.
 */

/** Blend half-widths, in the bind's units (0.85 m each). GAME TUNING:
 * about 5 cm and 4 cm on the body, a little under a knee's and an ankle's
 * own depth, measured against renders of a 40° bend of each. */
export const KNEE_BLEND = 0.06;
export const ANKLE_BLEND = 0.05;
/** How far below the hip joint the rebuild starts, bind units. */
export const THIGH_TOP = 0.12;
/** How far from the leg's own axis a vertex may be and still be leg. */
export const LEG_RADIUS = 0.13;
/** The same, across the ankle's band, where anything wider is the shoe. */
export const ANKLE_RADIUS = 0.08;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Rest positions of the skin's joints: the translation of each inverse bind matrix's inverse. */
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

/**
 * Each leg as [toe, ankle, knee, hip] joint indices: from the lowest joint
 * on each side of the body, up through its parents.
 */
function legChains(skin, at) {
  const joints = skin.listJoints();
  const parent = new Map();
  joints.forEach((j, i) => j.listChildren().forEach((c) => {
    const k = joints.indexOf(c);
    if (k >= 0) parent.set(k, i);
  }));
  const legs = [];
  for (const side of [-1, 1]) {
    let lowest = -1;
    for (let i = 0; i < at.length; i += 1) {
      if (Math.sign(at[i][0]) !== side) continue;
      if (lowest < 0 || at[i][1] < at[lowest][1]) lowest = i;
    }
    const chain = [lowest];
    while (chain.length < 4 && parent.has(chain[chain.length - 1])) chain.push(parent.get(chain[chain.length - 1]));
    if (chain.length === 4) legs.push(chain);
  }
  return legs;
}

export function smoothLegWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const legs = legChains(skin, at);
  let changed = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      if (!P || !J || !W) continue;
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      for (let v = 0; v < P.getCount(); v += 1) {
        P.getElement(v, p);
        J.getElement(v, j);
        W.getElement(v, w);
        for (const [, ankle, knee, hip] of legs) {
          const axisX = at[knee][0], axisZ = at[knee][2];
          if (Math.hypot(p[0] - axisX, p[2] - axisZ) > LEG_RADIUS) continue;
          if (p[1] > at[hip][1] - THIGH_TOP || p[1] < at[ankle][1] - ANKLE_BLEND) continue;
          if (p[1] < at[ankle][1] + ANKLE_BLEND && Math.hypot(p[0] - at[ankle][0], p[2] - at[ankle][2]) > ANKLE_RADIUS) continue;
          let own = 0;
          for (let k = 0; k < 4; k += 1) if (j[k] === hip || j[k] === knee || j[k] === ankle) own += w[k];
          if (own < 0.999) continue;
          const shin = smoothstep(at[knee][1] + KNEE_BLEND, at[knee][1] - KNEE_BLEND, p[1]);
          const foot = smoothstep(at[ankle][1] + ANKLE_BLEND, at[ankle][1] - ANKLE_BLEND, p[1]);
          J.setElement(v, [hip, knee, ankle, 0]);
          W.setElement(v, [1 - shin, shin * (1 - foot), shin * foot, 0]);
          changed += 1;
          break;
        }
      }
    }
  }
  log(`legs re-weighted from height across the knees and ankles: ${changed.toLocaleString()} vertices`);
}
