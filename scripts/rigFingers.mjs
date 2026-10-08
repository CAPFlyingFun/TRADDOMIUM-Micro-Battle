/**
 * FINGERS FOR A MITTEN RIG — bones and weights for five fingers on each hand,
 * placed from the hand's own mesh.
 *
 * Joshua, 2026-10-07: "is it possible for you or Claude to rig each finger for
 * Sarah? I've regenerated Sarah like two more times... and still not doing each
 * finger although it looks exactly the same like Jack." Meshy rigs her hands as
 * mittens: a wrist and one hand bone, nothing past it (29 joints; Jack's toon
 * master has 69, five three-jointed fingers a hand). Her MESH has five separate
 * fingers; only the bones are missing.
 *
 * WHY NOT JACK'S BONES, COPIED ACROSS. The two hands are not posed alike in the
 * bind: Jack's is flat, palm down, fingers spread across z; Sarah's is turned
 * 90 degrees, palm forward, thumb up, the four fingers stacked in y and closed
 * together. Jack's chains moved onto her hand would sit between her fingers.
 * So each chain is measured from her own fingers, and only the SHAPE of a
 * chain comes from a hand's anatomy: four joints a finger (knuckle, middle,
 * end, tip) and four the thumb (base, knuckle, end, tip), as Jack's are.
 *
 * HOW A FINGER IS FOUND. The hand's vertices (those skinned to the wrist and
 * hand bones), welded by position because UV seams split the mesh into
 * islands, are cut by planes across the hand, from the fingertips back toward
 * the wrist. Beyond the web, each finger is its own connected piece; walking
 * the cut back, pieces merge two at a time, and each finger is the piece it
 * was just before it merged. Five pieces is the hand, and the one that
 * merges last and furthest from the others is the thumb. A hand where five
 * do not come out is left a mitten, and the bake says so.
 *
 * THE CHAIN: the finger's centreline (centroids of slices along its own
 * length, so a curled finger is followed), extended back into the palm to the
 * knuckle by `KNUCKLE_BACK` of the visible finger — a finger's knuckle is
 * inside the palm, behind the web. Joints sit at `JOINTS` of the length.
 *
 * THE WEIGHTS: a finger's vertices go to its three bones by how far along the
 * chain they lie, blended across each joint over `BLEND` of the length; the
 * palm in front of each knuckle fades onto that finger's first bone, so the
 * knuckle bends the palm's edge with it; the thumb's base bone takes the ball
 * of the thumb. Nothing outside the hand is touched.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for bodies whose entry
 * sets `rigFingers`. Bones are APPENDED after the master's own joints, so every
 * existing joint index, and every weight that names one, is unchanged.
 */
import * as THREE from 'three';

/** Where the joints of a finger sit, as fractions of knuckle-to-tip (a hand's proportions). */
export const JOINTS = [0, 0.48, 0.77, 1];
/** How far behind its web a finger's knuckle is, as a fraction of the visible finger. */
export const KNUCKLE_BACK = 0.32;
/** Blend across each joint, as a fraction of the chain's length either side. */
export const BLEND = 0.07;
/** A piece smaller than this many welded vertices is a nail or a crease, not a finger. */
const MIN_PIECE = 30;
/** The cut moves back this far per step, metres on the master. */
const STEP = 0.002;

const NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function jointPositions(skin) {
  const m = skin.getInverseBindMatrices().getArray();
  const out = [];
  for (let o = 0; o < m.length; o += 16) {
    const M = new THREE.Matrix4().fromArray(Array.from(m.slice(o, o + 16))).invert();
    out.push(new THREE.Vector3().setFromMatrixPosition(M));
  }
  return out;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The hands: each childless joint at the far end of an arm, with its parent the wrist. */
function findHands(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().filter((c) => joints.includes(c)));
  const hands = [];
  for (const sign of [1, -1]) {
    let best = -1;
    for (let i = 0; i < joints.length; i += 1) {
      if (sign * at[i].x <= 0) continue;
      if (best < 0 || sign * at[i].x > sign * at[best].x) best = i;
    }
    if (best < 0) continue;
    const parent = joints.indexOf(joints[best].getParentNode());
    if (parent < 0) continue;
    // A hand that already has fingers: the furthest joint is a fingertip, and a few
    // joints up from it is a hand bone that branches into four or more.
    let up = best, fingered = false;
    for (let k = 0; k < 5 && up >= 0; k += 1) {
      if (kids[up].length >= 4) { fingered = true; break; }
      up = joints.indexOf(joints[up].getParentNode());
    }
    hands.push({ sign, end: best, wrist: parent, mitten: !fingered && kids[best].length === 0 });
  }
  return hands;
}

/** Principal axis of a set of points (power iteration on the covariance). */
function axisOf(points) {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  c.multiplyScalar(1 / points.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i += 1) for (let k = 0; k < 3; k += 1) C[i * 3 + k] += d[i] * d[k];
  }
  let v = new THREE.Vector3(1, 0.3, 0.2).normalize();
  for (let it = 0; it < 50; it += 1) {
    v = new THREE.Vector3(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[3] * v.x + C[4] * v.y + C[5] * v.z, C[6] * v.x + C[7] * v.y + C[8] * v.z).normalize();
  }
  return { centre: c, axis: v };
}

/** Nearest point on a polyline: arc-length fraction along it, and distance. */
function onPolyline(p, line, lengths, total) {
  let best = { u: 0, d: Infinity };
  let run = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i], b = line[i + 1], ab = b.clone().sub(a), l2 = ab.lengthSq();
    const t = l2 > 0 ? Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / l2)) : 0;
    const q = a.clone().addScaledVector(ab, t), d = q.distanceTo(p);
    if (d < best.d) best = { u: (run + t * lengths[i]) / total, d };
    run += lengths[i];
  }
  return best;
}

export function rigFingers(doc, { log = () => {} } = {}) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const hands = findHands(skin, at).filter((h) => h.mitten);
  if (!hands.length) { log('fingers: the hands already have fingers; left as authored'); return; }
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getAttribute('JOINTS_0'));
  const joints = skin.listJoints();
  const ibm = Array.from(skin.getInverseBindMatrices().getArray());
  let added = 0;

  for (const hand of hands) {
    const wrist = at[hand.wrist], end = at[hand.end];
    const dir = end.clone().sub(wrist).normalize();
    const own = new Set([hand.wrist, hand.end]);

    // The hand's vertices, welded by position across every primitive.
    const verts = []; // { prim, index, p, rep }
    const byKey = new Map();
    for (const prim of prims) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      for (let i = 0; i < P.getCount(); i += 1) {
        J.getElement(i, j); W.getElement(i, w);
        let s = 0;
        for (let k = 0; k < 4; k += 1) if (own.has(j[k])) s += w[k];
        if (s < 0.5) continue;
        P.getElement(i, p);
        if (Math.sign(p[0]) !== hand.sign) continue;
        const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
        if (!byKey.has(key)) byKey.set(key, byKey.size);
        verts.push({ prim, index: i, p: new THREE.Vector3(...p), rep: byKey.get(key) });
      }
    }
    const nodes = byKey.size;
    const pos = new Array(nodes);
    for (const v of verts) pos[v.rep] = v.p;
    const adj = Array.from({ length: nodes }, () => new Set());
    for (const prim of prims) {
      const lookup = new Map();
      for (const v of verts) if (v.prim === prim) lookup.set(v.index, v.rep);
      const I = prim.getIndices().getArray();
      for (let t = 0; t < I.length; t += 3) {
        const a = lookup.get(I[t]), b = lookup.get(I[t + 1]), c = lookup.get(I[t + 2]);
        if (a === undefined || b === undefined || c === undefined) continue;
        adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
      }
    }
    const s = pos.map((p) => p.clone().sub(wrist).dot(dir));
    const sMax = Math.max(...s);

    // Cut back from the fingertips; each finger is the piece it was just before it merged.
    const label = new Int32Array(nodes).fill(-1);
    const pieces = new Map(); // id -> Set of nodes
    const composite = new Set(); // pieces that already hold two fingers or more
    let nextId = 0;
    const done = []; // finished fingers: { nodes, cut }
    const order = [...pos.keys()].sort((a, b) => s[b] - s[a]);
    let k = 0;
    for (let cut = sMax - STEP; cut > 0 && done.length < 5; cut -= STEP) {
      // add every vertex beyond this cut, joining it to its neighbours' pieces
      for (; k < order.length && s[order[k]] > cut; k += 1) {
        const v = order[k];
        const around = new Set();
        for (const u of adj[v]) if (label[u] >= 0) around.add(label[u]);
        const big = [...around].filter((id) => pieces.get(id).size >= MIN_PIECE);
        if (big.length >= 2) {
          // two pieces meet: each that is still ONE finger is finished as it stood
          for (const id of big) if (!composite.has(id)) done.push({ nodes: new Set(pieces.get(id)), cut: cut + STEP });
        }
        let keep;
        if (around.size === 0) { keep = nextId++; pieces.set(keep, new Set()); }
        else {
          keep = [...around].sort((a, b) => pieces.get(b).size - pieces.get(a).size)[0];
          const merged = big.length >= 2 || [...around].some((id) => composite.has(id));
          for (const id of around) {
            if (id === keep) continue;
            for (const u of pieces.get(id)) { label[u] = keep; pieces.get(keep).add(u); }
            pieces.delete(id);
            composite.delete(id);
          }
          if (merged) composite.add(keep);
        }
        label[v] = keep;
        pieces.get(keep).add(v);
      }
    }
    // The finger whose piece merged last (the cut furthest back) is the thumb only
    // if it is the shortest reach along the hand; otherwise the merge order decides.
    const fingers = done.slice(0, 5);
    if (fingers.length < 5) {
      log(`fingers: ${hand.sign > 0 ? '+x' : '-x'} hand: ${fingers.length} fingers found, not 5; left a mitten`);
      continue;
    }
    // The thumb: the piece that reaches least far along the hand.
    const reach = (f) => Math.max(...[...f.nodes].map((v) => s[v]));
    fingers.sort((a, b) => reach(a) - reach(b));
    const thumb = fingers[0];
    // The other four, from the thumb's side outward.
    const tc = axisOf([...thumb.nodes].map((v) => pos[v])).centre;
    const rest = fingers.slice(1).map((f) => ({ ...f, c: axisOf([...f.nodes].map((v) => pos[v])).centre }));
    rest.sort((a, b) => a.c.distanceTo(tc) - b.c.distanceTo(tc));
    const ordered = [thumb, ...rest];

    // THE KNUCKLE LINE. A finger that parts from its neighbour late (a pinky against
    // the ring finger) shows little of itself past the web, so its knuckle cannot be
    // measured back from what shows. The four knuckles sit together across the palm:
    // `KNUCKLE_BACK` of the longest finger's showing length behind where the last of
    // them parts from the palm.
    const palmEdge = Math.min(...rest.map((f) => f.cut));
    const longest = Math.max(...rest.map((f) => reach(f)));
    const knuckleS = palmEdge - KNUCKLE_BACK * (longest - palmEdge);

    // Chains.
    const chains = ordered.map((f, n) => {
      const pts = [...f.nodes].map((v) => pos[v]);
      const { centre, axis } = axisOf(pts);
      // point the axis from base to tip
      const far = pts.reduce((a, p) => (p.clone().sub(wrist).length() > a.clone().sub(wrist).length() ? p : a));
      if (far.clone().sub(centre).dot(axis) < 0) axis.negate();
      const t = pts.map((p) => p.clone().sub(centre).dot(axis));
      const t0 = Math.min(...t), t1 = Math.max(...t), len = t1 - t0;
      // centreline: centroids of slices
      const SL = 8, line = [];
      for (let i = 0; i < SL; i += 1) {
        const lo = t0 + (len * i) / SL, hi = t0 + (len * (i + 1)) / SL;
        const sl = pts.filter((p, q) => t[q] >= lo && t[q] <= hi);
        if (!sl.length) continue;
        line.push(sl.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / sl.length));
      }
      const tip = centre.clone().addScaledVector(axis, t1);
      line.push(tip);
      // back into the palm to the knuckle, along the finger's own axis: the four
      // fingers' knuckles on one line across the palm (below), the thumb's base near
      // the wrist, 1.1 of its visible length back
      const knuckle = n === 0
        ? line[0].clone().addScaledVector(axis, -len * 1.1)
        : line[0].clone().addScaledVector(axis, -(line[0].clone().sub(wrist).dot(dir) - knuckleS) / Math.max(0.3, axis.dot(dir)));
      line.unshift(knuckle);
      const lengths = [];
      for (let i = 0; i < line.length - 1; i += 1) lengths.push(line[i].distanceTo(line[i + 1]));
      const total = lengths.reduce((a, b) => a + b, 0);
      const at = (u) => {
        let run = 0;
        for (let i = 0; i < lengths.length; i += 1) {
          if (run + lengths[i] >= u * total || i === lengths.length - 1) {
            const k = lengths[i] > 0 ? (u * total - run) / lengths[i] : 0;
            return line[i].clone().lerp(line[i + 1], Math.min(1, Math.max(0, k)));
          }
          run += lengths[i];
        }
        return tip.clone();
      };
      return { name: NAMES[n], nodes: f.nodes, line, lengths, total, web: (n === 0 ? 1.1 : KNUCKLE_BACK) * len / total, joints: JOINTS.map(at) };
    });

    // A knuckle is INSIDE the palm: halfway through its thickness. The palm's normal is
    // across the hand's length and across the row of finger bases; each knuckle (and the
    // thumb's base) is put on the palm's middle plane along it.
    const fingerBase = (ch) => ch.line[1];
    const spread = fingerBase(chains[4]).clone().sub(fingerBase(chains[1])).normalize();
    const normal = new THREE.Vector3().crossVectors(dir, spread).normalize();
    const palm = [];
    for (let v = 0; v < nodes; v += 1) if (!chains.some((ch) => ch.nodes.has(v)) && s[v] > 0.25 * sMax) palm.push(pos[v]);
    const mid = palm.reduce((a, p) => a + p.dot(normal), 0) / Math.max(1, palm.length);
    for (const ch of chains) {
      const K = ch.line[0];
      K.addScaledVector(normal, mid - K.dot(normal));
      ch.lengths[0] = ch.line[0].distanceTo(ch.line[1]);
      ch.total = ch.lengths.reduce((a, b) => a + b, 0);
      ch.joints = JOINTS.map((u) => {
        let run = 0;
        for (let i = 0; i < ch.lengths.length; i += 1) {
          if (run + ch.lengths[i] >= u * ch.total || i === ch.lengths.length - 1) {
            const k = ch.lengths[i] > 0 ? (u * ch.total - run) / ch.lengths[i] : 0;
            return ch.line[i].clone().lerp(ch.line[i + 1], Math.min(1, Math.max(0, k)));
          }
          run += ch.lengths[i];
        }
        return ch.line[ch.line.length - 1].clone();
      });
      ch.web = ch.lengths[0] / ch.total;
    }

    // Bones: four nodes a finger, a chain of children off the hand bone, APPENDED.
    const handNode = joints[hand.end];
    const side = hand.sign > 0 ? 'L' : 'R'; // the body faces +z, so its left is +x
    for (const ch of chains) {
      ch.bones = [];
      let parent = handNode;
      for (let i = 0; i < ch.joints.length; i += 1) {
        const node = doc.createNode(`${ch.name}${i + 1}_${side}`);
        const parentWorld = new THREE.Matrix4().fromArray(parent.getWorldMatrix());
        // THE BONE'S OWN AXES, as every other bone in these rigs has them (and as
        // Blender and every skeleton viewer read them): local +Y along the bone, to
        // the next joint, the tip carrying on its finger's last direction. A node
        // left unturned would point +Y at the sky, and a viewer draws every finger
        // bone standing straight up (Joshua, 2026-10-07: "the finger bones end up not
        // straight, but upwards"). Skinning does not care either way; tools do.
        // Local +Z is the palm's normal, so a curl is a turn about local X.
        const next = ch.joints[Math.min(i + 1, ch.joints.length - 1)];
        const prev = ch.joints[Math.max(i - 1, 0)];
        const along = (i < ch.joints.length - 1 ? next.clone().sub(ch.joints[i]) : ch.joints[i].clone().sub(prev)).normalize();
        const xAxis = new THREE.Vector3().crossVectors(along, normal);
        if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
        xAxis.normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, along).normalize();
        const world = new THREE.Matrix4().makeBasis(xAxis, along, zAxis).setPosition(ch.joints[i]);
        const local = parentWorld.clone().invert().multiply(world);
        const tr = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        local.decompose(tr, q, sc);
        node.setTranslation(tr.toArray()).setRotation(q.toArray()).setScale(sc.toArray());
        parent.addChild(node);
        skin.addJoint(node);
        ibm.push(...world.clone().invert().toArray());
        ch.bones.push(joints.length + added);
        added += 1;
        parent = node;
      }
    }

    // Weights.
    const fingerOf = new Int32Array(nodes).fill(-1);
    chains.forEach((ch, n) => { for (const v of ch.nodes) fingerOf[v] = n; });
    const weightFor = (rep) => {
      const p = pos[rep];
      const f = fingerOf[rep];
      // a finger's own vertex: its three bones by how far along it lies
      if (f >= 0) {
        const ch = chains[f], { u } = onPolyline(p, ch.line, ch.lengths, ch.total);
        return alongChain(ch, u, 1);
      }
      // the palm: in front of a knuckle, fading onto that finger
      let best = null;
      for (const ch of chains) {
        const hit = onPolyline(p, ch.line, ch.lengths, ch.total);
        if (!best || hit.d < best.hit.d) best = { ch, hit };
      }
      const { ch, hit } = best;
      const reachM = ch.name === 'thumb' ? 0.022 : 0.016;
      const near = 1 - smooth(reachM * 0.5, reachM, hit.d);
      if (near <= 0 || hit.u <= 0.02) return null;
      return alongChain(ch, hit.u, near * (ch.name === 'thumb' ? 0.8 : smooth(0, ch.web, hit.u)));
    };
    function alongChain(ch, u, amount) {
      const w = new Map();
      const add = (b, x) => { if (x > 0) w.set(b, (w.get(b) || 0) + x * amount); };
      const [, j1, j2] = JOINTS;
      const b = ch.bones;
      const k1 = smooth(j1 - BLEND, j1 + BLEND, u), k2 = smooth(j2 - BLEND, j2 + BLEND, u);
      add(b[0], 1 - k1);
      add(b[1], k1 * (1 - k2));
      add(b[2], k2);
      return { map: w, amount };
    }

    let touched = 0;
    for (const v of verts) {
      const got = weightFor(v.rep);
      if (!got) continue;
      const J = v.prim.getAttribute('JOINTS_0'), W = v.prim.getAttribute('WEIGHTS_0');
      const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      J.getElement(v.index, j); W.getElement(v.index, w);
      const sum = new Map();
      for (let i = 0; i < 4; i += 1) if (w[i] > 0) sum.set(j[i], (sum.get(j[i]) || 0) + w[i] * (1 - got.amount));
      for (const [b, x] of got.map) sum.set(b, (sum.get(b) || 0) + x);
      const top = [...sum].sort((a, c) => c[1] - a[1]).slice(0, 4);
      const tot = top.reduce((a, e) => a + e[1], 0) || 1;
      J.setElement(v.index, [0, 1, 2, 3].map((i) => (top[i] ? top[i][0] : 0)));
      W.setElement(v.index, [0, 1, 2, 3].map((i) => (top[i] ? top[i][1] / tot : 0)));
      touched += 1;
    }
    const lens = chains.map((c) => `${c.name} ${(c.total * 100).toFixed(1)}`).join(', ');
    log(`fingers: ${side} hand: 5 fingers, 20 joints added; ${touched.toLocaleString()} vertices re-weighted (cm knuckle-to-tip: ${lens})`);
  }

  // The joint indices may now pass 255: widen JOINTS_0 to 16 bits where needed.
  if (added) {
    const acc = skin.getInverseBindMatrices();
    acc.setArray(new Float32Array(ibm));
    for (const prim of prims) {
      const J = prim.getAttribute('JOINTS_0');
      if (joints.length + added > 255 && !(J.getArray() instanceof Uint16Array)) J.setArray(new Uint16Array(J.getArray()));
    }
  }
}
