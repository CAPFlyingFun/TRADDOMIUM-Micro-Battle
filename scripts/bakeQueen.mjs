/**
 * SPLIT THE QUEEN'S WINGS OFF, ONCE, AT BAKE TIME.
 *
 * She is one model and stays one model — that is the whole point of
 * this. A dealated queen is not a different ant, she is the same ant
 * without her wings, and swapping meshes at the moment she sheds them
 * would mean two assets to keep in step forever, two rigs, two sets of
 * mandibles, and a visible pop.
 *
 * THE MODEL ARRIVED AS A SINGLE MESH. Meshy's auto-rig produces one
 * primitive, one material, one skin and bones named Bone_000 upward —
 * nothing says "wing" anywhere in it. So there were no wing meshes to
 * hide, and the first job is to make some.
 *
 * WHICH BONES ARE THE WINGS. Not guessed and not hand-listed: measured
 * from the geometry each bone actually owns. On this rig the wings are
 * unmistakable once you look at where the vertices are —
 *
 *   wings   bind Y 1.13 to 1.48,  reach out to |X| 2.49
 *   legs    bind Y 0.04 to 0.84,  reach out to |X| 1.38
 *   body    bind Y up to 1.03,    reach out to |X| 0.35
 *
 * — four chains of three bones, which is exactly the four wings a
 * queen has. The rule below is that separation written down, with a
 * sanity check after it, because a silent misclassification would show
 * up as an ant with no thorax rather than as an error.
 *
 * A TRIANGLE GOES WITH THE WINGS ONLY IF ALL THREE of its corners are
 * mostly wing-weighted. Vertices where the wing root blends into the
 * thorax therefore stay with the body, so hiding the wings leaves the
 * thorax whole and a small stub at each wing base. That is not a
 * compromise — a queen who has shed her wings keeps the scars, and the
 * stubs are what those look like.
 *
 * Output: two meshes, "queen_body" and "queen_wings", sharing one
 * skeleton, one material and one set of vertex attributes. The game
 * hides a mesh; it does nothing clever at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const IN = process.argv[2];
const OUT = process.argv[3];

/** A bone is a wing bone above this height in the bind pose. */
const WING_MIN_Y = 1.05;
/** ...and only if the geometry it owns reaches this far out sideways. */
const WING_MIN_REACH = 1.2;
/** How much of a vertex has to be wing for the vertex to be wing. */
const WING_MAJORITY = 0.5;

const file = readFileSync(IN);
if (file.readUInt32LE(0) !== 0x46546C67) throw new Error(`${IN} is not a GLB`);

let at = 12;
let json = null;
let bin = null;
while (at < file.length) {
  const len = file.readUInt32LE(at);
  const kind = file.readUInt32LE(at + 4);
  const body = file.subarray(at + 8, at + 8 + len);
  if (kind === 0x4E4F534A) json = JSON.parse(body.toString('utf8'));
  else if (kind === 0x004E4942) bin = body;
  at += 8 + len;
}
if (!json || !bin) throw new Error('GLB is missing a chunk');

const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const WIDE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(index) {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const wide = WIDE[a.type];
  const size = SIZE[a.componentType];
  const stride = view.byteStride || wide * size;
  const start = (view.byteOffset || 0) + (a.byteOffset || 0);
  const rows = [];
  for (let r = 0; r < a.count; r += 1) {
    const row = [];
    for (let c = 0; c < wide; c += 1) {
      const o = start + r * stride + c * size;
      row.push(
        a.componentType === 5126 ? bin.readFloatLE(o)
          : a.componentType === 5125 ? bin.readUInt32LE(o)
            : a.componentType === 5123 ? bin.readUInt16LE(o)
              : bin.readUInt8(o),
      );
    }
    rows.push(row);
  }
  return rows;
}

const mesh = json.meshes[0];
if (json.meshes.length !== 1 || mesh.primitives.length !== 1) {
  throw new Error(
    `expected one mesh of one primitive, found ${json.meshes.length} meshes`,
  );
}
const prim = mesh.primitives[0];
const skin = json.skins[0];
const ibm = readAccessor(skin.inverseBindMatrices);

// A bone's bind position is the translation of the INVERSE of its
// inverse-bind matrix: for a rigid transform, -(R transposed) * t.
const bindY = skin.joints.map((_, i) => {
  const m = ibm[i];
  return -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]);
});

const position = readAccessor(prim.attributes.POSITION);
const joints = readAccessor(prim.attributes.JOINTS_0);
const weights = readAccessor(prim.attributes.WEIGHTS_0);

// How far out each bone's own geometry reaches, which is what tells a
// wing from a leg far better than the bone's own position does.
const reach = skin.joints.map(() => 0);
for (let v = 0; v < position.length; v += 1) {
  for (let k = 0; k < 4; k += 1) {
    if (weights[v][k] < WING_MAJORITY) continue;
    const bone = joints[v][k];
    reach[bone] = Math.max(reach[bone], Math.abs(position[v][0]));
  }
}

const isWingBone = skin.joints.map(
  (_, i) => bindY[i] >= WING_MIN_Y && reach[i] >= WING_MIN_REACH,
);

// WHICH WING IS WHICH, worked out here so the game never has to guess.
//
// Each wing is a chain of three bones and the ROOT of that chain is the
// one to rotate: turning it sweeps the whole wing, exactly as the
// shoulder does. Roots are the wing bones nothing else in the wing set
// is the parent of. Left and right come from the sign of X. Fore and
// hind come from Z — the forewing roots sit further toward the head
// than the hindwing roots do, which on this model is the LARGER Z.
const parentOf = new Map();
for (const [i, node] of json.nodes.entries()) {
  for (const child of node.children ?? []) parentOf.set(child, i);
}
const bindPos = skin.joints.map((_, i) => {
  const m = ibm[i];
  return {
    x: -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]),
    z: -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]),
  };
});
const wingJoints = new Set(skin.joints.filter((_, i) => isWingBone[i]));
const roots = skin.joints
  .map((joint, i) => ({ joint, i }))
  .filter(({ joint, i }) => isWingBone[i] && !wingJoints.has(parentOf.get(joint)));

if (roots.length !== 4) {
  throw new Error(`found ${roots.length} wing roots, expected four wings`);
}
// Two on each side; on each side the one nearer the head is the fore.
const named = {};
for (const side of [-1, 1]) {
  const pair = roots
    .filter(({ i }) => Math.sign(bindPos[i].x) === side)
    .sort((a, b) => bindPos[b.i].z - bindPos[a.i].z);
  if (pair.length !== 2) throw new Error('wings are not two a side');
  const hand = side < 0 ? 'left' : 'right';
  named[`${hand}Fore`] = json.nodes[pair[0].joint].name;
  named[`${hand}Hind`] = json.nodes[pair[1].joint].name;
}
const wingBones = isWingBone.filter(Boolean).length;
if (wingBones < 6 || wingBones > 20) {
  throw new Error(
    `found ${wingBones} wing bones, which is not four wings' worth — `
    + 'the rig has changed and the rule needs revisiting',
  );
}

// A vertex is wing if most of it is held by wing bones.
const wingVert = new Uint8Array(position.length);
let wingVerts = 0;
for (let v = 0; v < position.length; v += 1) {
  let share = 0;
  for (let k = 0; k < 4; k += 1) {
    if (isWingBone[joints[v][k]]) share += weights[v][k];
  }
  if (share > WING_MAJORITY) {
    wingVert[v] = 1;
    wingVerts += 1;
  }
}

const index = readAccessor(prim.indices).map((r) => r[0]);
const bodyTris = [];
const wingTris = [];
for (let t = 0; t < index.length; t += 3) {
  const a = index[t];
  const b = index[t + 1];
  const c = index[t + 2];
  // ALL THREE, so the blend at the wing root stays with the thorax and
  // hiding the wings never opens a hole in her back.
  if (wingVert[a] && wingVert[b] && wingVert[c]) wingTris.push(a, b, c);
  else bodyTris.push(a, b, c);
}

if (wingTris.length === 0) throw new Error('no wing triangles found');
if (bodyTris.length === 0) throw new Error('every triangle came out as wing');

// Two index buffers appended to the binary chunk, and two meshes that
// share every attribute, the material and the skin.
const wide = position.length > 65535 ? 4 : 2;
function indexBuffer(list) {
  const buf = Buffer.alloc(list.length * wide);
  list.forEach((v, i) => (wide === 4 ? buf.writeUInt32LE(v, i * 4) : buf.writeUInt16LE(v, i * 2)));
  return buf;
}
const bodyBuf = indexBuffer(bodyTris);
const wingBuf = indexBuffer(wingTris);
const pad = (n) => (4 - (n % 4)) % 4;

const extra = [bodyBuf, Buffer.alloc(pad(bodyBuf.length)), wingBuf, Buffer.alloc(pad(wingBuf.length))];
const bodyOffset = bin.length;
const wingOffset = bodyOffset + bodyBuf.length + pad(bodyBuf.length);
const newBin = Buffer.concat([bin, ...extra]);

json.bufferViews.push({ buffer: 0, byteOffset: bodyOffset, byteLength: bodyBuf.length });
json.bufferViews.push({ buffer: 0, byteOffset: wingOffset, byteLength: wingBuf.length });
const bodyView = json.bufferViews.length - 2;
const wingView = json.bufferViews.length - 1;
json.accessors.push({
  bufferView: bodyView, componentType: wide === 4 ? 5125 : 5123,
  count: bodyTris.length, type: 'SCALAR',
});
json.accessors.push({
  bufferView: wingView, componentType: wide === 4 ? 5125 : 5123,
  count: wingTris.length, type: 'SCALAR',
});
const bodyIndex = json.accessors.length - 2;
const wingIndex = json.accessors.length - 1;

json.meshes = [
  { name: 'queen_body', primitives: [{ ...prim, indices: bodyIndex }] },
  { name: 'queen_wings', primitives: [{ ...prim, indices: wingIndex }] },
];

// Carried IN THE ASSET, so the game reads a name instead of repeating
// this measurement at runtime and hoping for the same answer.
json.extras = {
  ...(json.extras ?? {}),
  wingRoots: named,
  wingBones: skin.joints.filter((_, i) => isWingBone[i]).map((j) => json.nodes[j].name),
};

// Both meshes hang off the same skin, so one skeleton drives both and
// the wings follow the thorax without anything having to sync them.
const meshNodeAt = json.nodes.findIndex((n) => n.mesh != null);
const meshNode = json.nodes[meshNodeAt];
meshNode.mesh = 0;
meshNode.name = 'queen_body';
json.nodes.push({
  name: 'queen_wings', mesh: 1, skin: meshNode.skin,
});
const wingNode = json.nodes.length - 1;

// A SIBLING OF THE BODY, wherever the body happens to live.
//
// The first attempt pushed this into the scene's root list, which was
// wrong and silently so: the mesh node is a CHILD of the armature, not
// a root, so the test never matched, the wings node was left
// unreachable from the scene, and the loader simply never built it. An
// ant with no wings and no error. Find the real parent instead, and
// fall back to the roots only if there genuinely is not one.
const parent = json.nodes.find((n) => n.children?.includes(meshNodeAt));
if (parent) parent.children.push(wingNode);
else {
  let placed = false;
  for (const scene of json.scenes) {
    if (scene.nodes.includes(meshNodeAt)) {
      scene.nodes.push(wingNode);
      placed = true;
    }
  }
  if (!placed) throw new Error('could not find where the body mesh hangs');
}
json.buffers[0].byteLength = newBin.length;

const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = Buffer.alloc(pad(jsonBuf.length), 0x20);
const binPad = Buffer.alloc(pad(newBin.length), 0);
const chunks = [
  Buffer.concat([jsonBuf, jsonPad]),
  Buffer.concat([newBin, binPad]),
];
const total = 12 + chunks.reduce((n, c) => n + 8 + c.length, 0);
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
let cursor = 12;
[[0x4E4F534A, chunks[0]], [0x004E4942, chunks[1]]].forEach(([kind, buf]) => {
  out.writeUInt32LE(buf.length, cursor);
  out.writeUInt32LE(kind, cursor + 4);
  buf.copy(out, cursor + 8);
  cursor += 8 + buf.length;
});
writeFileSync(OUT, out);

console.log(
  `${wingBones} wing bones, ${wingVerts.toLocaleString()} of `
  + `${position.length.toLocaleString()} vertices `
  + `(${Math.round((wingVerts / position.length) * 100)}%)`,
);
console.log(
  `body ${(bodyTris.length / 3).toLocaleString()} tris, `
  + `wings ${(wingTris.length / 3).toLocaleString()} tris`,
);
console.log('wing roots:', JSON.stringify(named));
