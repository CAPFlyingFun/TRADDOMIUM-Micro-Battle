/**
 * WHAT A RIG IS MADE OF, FOUND BY MEASUREMENT — because the rigs name
 * nothing.
 *
 * Every bone in the three GLBs is called `Bone_0NN` (measured, see the
 * report in the Phase 7 fauna commit): 17 in a single chain for the
 * earthworm, 57 for the aphid, 55 for the housefly. There is no "wing",
 * no "antenna", no "leg" to look up, and the auto-rigger that made them
 * will name the next animal the same way. So this file reads STRUCTURE
 * — which bones have no bone children, which sit lowest in the body's
 * own frame, which hang in mirrored ±X pairs — and hands the renderer a
 * description it can pose from. The technique is TCS's `Critter.findLegs`
 * (a donor of method, not of code): six leg tips are the six lowest tips,
 * paired by the sign of X and ranked along Z; the coxa is the last bone
 * before the chain joins the thorax hub. Wings and antennae are found the
 * same way, by where they are rather than what they are called.
 *
 * ─── the body frame, not the world's ────────────────────────────────
 *
 * Every question here is asked in the RIG'S OWN FRAME, with the template
 * standing at the identity before it is scaled or placed. TCS learned
 * this the hard way: asked in world space, "is this foot on the left?"
 * became "is this foot east of the origin?", and every leg of every
 * creature on the island answered yes. The template is measured once,
 * and the answers are names and rest quaternions that every clone
 * resolves for itself.
 *
 * ─── the spine, and the number it is checked against ────────────────
 *
 * `measureSpine` is the renderer's own reading of the rig's body length
 * in the GLB's units: for a chained species the sum of the distances
 * between successive chain bones (hierarchy order — the table lists
 * the worm's chain by NAME, and the file's hierarchy runs
 * `Bone_000 → Bone_016 → … → Bone_001`, so `chainOf` re-orders by
 * parentage rather than trusting either); for a legged species the
 * extent, along the longest horizontal axis, of the bones that lie near
 * the median plane — legs and wings splay off it in mirrored pairs, a
 * body does not. `FaunaView` compares that reading, scaled, with the
 * cited length and WARNS when it is off; it never quietly corrects the
 * table, because a table nobody can trust is worse than a warning.
 *
 * ─── the skin ───────────────────────────────────────────────────────
 *
 * `dressRig` is the TCS lesson carried over: glTF packs roughness and
 * metalness into one map, the loader sets both factors to 1 and lets
 * the map multiply them down, and the exporter baked a roughness range
 * that tops out at 0.46 — so every animal shipped as wet plastic. The
 * packed map goes, and that part of the lesson still stands.
 *
 * THE NORMAL MAP STAYS, and the rule that dropped it is worth reading
 * back: "the packed map and the normal map cost texture memory and
 * change nothing on a body a few millimetres long seen by an ant". True
 * of the aphid at 2.5 mm and the fly at 6.5. Never true of the WORM,
 * which is 150 mm and now grows to 248 (`creatures/species.lengthRangeMm`)
 * — sixty aphids long — and which the game has since given the player two
 * ways to put a camera against: the soil cutaway and the finder's GO.
 * Joshua, 2026-09-08: "the glb worm looks kind of bad so small". It was
 * not the model. The file ships a baked normal with the segment rings and
 * the wrinkles on it, 36 KB of them, and this function was deleting them
 * on load and leaving a smooth tube wearing a flat colour.
 *
 * `keepNormal` is the switch rather than a silent always, because the
 * original reasoning still holds somewhere: a rung that cannot afford
 * three texture fetches an animal should still be able to say so.
 *
 * Reads no world coordinate: everything here is a rig at the identity.
 */
import * as THREE from 'three';

/**
 * How rough a damp animal is. GAME TUNING informed by biology, carried
 * from TCS: a worm breathes through wet skin and should keep a little
 * sheen; fully matte reads as clay.
 */
export const CREATURE_ROUGHNESS = 0.72;

/**
 * How far off the median plane a bone may sit and still count as body,
 * as a fraction of the rig's width. TCS's threshold; legs and wings sit
 * well outside it on all three rigs (measured: the aphid's nearest leg
 * bone at 0.16 of its width, its body bones under 0.1).
 */
export const MEDIAN_BAND = 0.12;

/** One leg: which bone swings, from which rest, about which axis, in which half of the tripod. */
export interface LegSpec {
  /** The coxa — the bone at the body, the one the gait turns. */
  readonly coxa: string;
  /** The tip — the foot. */
  readonly tip: string;
  readonly rest: THREE.Quaternion;
  /** The body's vertical, expressed in the coxa's PARENT frame: the axis a splayed leg protracts about. */
  readonly axis: THREE.Vector3;
  /** +1 on the +X side, −1 on the −X side. */
  readonly side: number;
  /** 0 front … 2 hind, counted within its own side. */
  readonly rank: number;
  /** 0 or 1: which half of the alternating tripod. */
  readonly phase: number;
}

/** One wing: the hinge bone, its rest, and the body's up and forward in its parent's frame. */
export interface WingSpec {
  readonly bone: string;
  readonly tip: string;
  readonly rest: THREE.Quaternion;
  readonly side: number;
  readonly up: THREE.Vector3;
  readonly forward: THREE.Vector3;
}

/** One antenna: the root bone of the feeler, its rest, and the body's up in its parent's frame. */
export interface AntennaSpec {
  readonly bone: string;
  readonly tip: string;
  readonly rest: THREE.Quaternion;
  readonly side: number;
  readonly up: THREE.Vector3;
}

/** The worm's chain, root first, with what each bone needs to be aimed. */
export interface ChainSpec {
  readonly bones: readonly string[];
  /** The direction of bone i+1's rest offset, in bone i's own frame (unit). One per bone but the last. */
  readonly dirs: readonly THREE.Vector3[];
  /** The rest length of that offset, rig units. One per bone but the last. */
  readonly lengths: readonly number[];
  /** How far the chain's axis sits above the skin's underside at rest, rig units — the lift that lays the belly on the ground. */
  readonly lift: number;
}

export interface RigAnatomy {
  readonly legs: readonly LegSpec[];
  readonly wings: readonly WingSpec[];
  readonly antennae: readonly AntennaSpec[];
  readonly chain: ChainSpec | null;
  /** The body length in rig units, measured as the header says. */
  readonly spine: number;
  /** The skinned mesh's bounding box at rest, bone-aware, rig units; the bones' box when there is no skinned mesh. */
  readonly box: THREE.Box3;
  /** Triangles in the rig's meshes — for the HUD and the report, since a rig's cost is its triangles. */
  readonly triangles: number;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export function isBone(node: THREE.Object3D): node is THREE.Bone {
  return (node as THREE.Bone).isBone === true;
}

export function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((n) => { if (isBone(n)) out.push(n); });
  return out;
}

function boneChildren(bone: THREE.Object3D): THREE.Bone[] {
  return bone.children.filter(isBone);
}

/** A bone's position in the rig root's frame. The root must be at the identity with its world matrices current. */
function positionOf(bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(bone.matrixWorld);
}

/** A rig-frame direction expressed in a bone's parent frame — the frame its own quaternion is applied in. */
function inParentFrame(bone: THREE.Bone, root: THREE.Object3D, direction: THREE.Vector3): THREE.Vector3 {
  const parent = bone.parent ?? root;
  parent.getWorldQuaternion(_q).invert();
  return direction.clone().applyQuaternion(_q).normalize();
}

/** The tip a chain runs to: follow single bone children until the chain ends or branches. */
function tipOf(bone: THREE.Bone): THREE.Bone {
  let at = bone;
  for (;;) {
    const kids = boneChildren(at);
    if (kids.length !== 1) return at;
    at = kids[0];
  }
}

/** The bone with the most bone children — the thorax, where the legs and wings join. Null for a chain. */
export function hubOf(bones: readonly THREE.Bone[]): THREE.Bone | null {
  let best: THREE.Bone | null = null;
  let most = 1;
  for (const b of bones) {
    const n = boneChildren(b).length;
    if (n > most) { most = n; best = b; }
  }
  return best;
}

/**
 * THE SIX LEGS, WITHOUT A NAME. The six lowest bone tips in the body
 * frame; each walked up to the joint at the body; paired by the sign
 * of X and ranked along Z within its own side, so the tripod comes out
 * front-left/mid-right/hind-left against the other three. Fewer than
 * six tips is no legs at all — a worm, or a placeholder.
 */
export function findLegs(root: THREE.Object3D, bones: readonly THREE.Bone[] = bonesOf(root)): LegSpec[] {
  root.updateMatrixWorld(true);
  const tips = bones.filter((b) => boneChildren(b).length === 0);
  if (tips.length < 6) return [];
  const at = new Map<THREE.Bone, THREE.Vector3>();
  for (const t of tips) at.set(t, positionOf(t, new THREE.Vector3()));
  const feet = [...tips].sort((a, b) => at.get(a)!.y - at.get(b)!.y).slice(0, 6);
  // Front is +Z on every rig here (the head chains run to +Z, measured);
  // rank 0 is the foot furthest forward on its side.
  const legs: LegSpec[] = [];
  for (const foot of feet) {
    let coxa: THREE.Bone = foot;
    for (;;) {
      const up = coxa.parent;
      if (up === null || !isBone(up)) break;
      if (boneChildren(up).length > 1) break;
      coxa = up;
    }
    const p = at.get(foot)!;
    const side = p.x >= 0 ? 1 : -1;
    const rank = feet.filter((o) => (at.get(o)!.x >= 0 ? 1 : -1) === side && at.get(o)!.z > p.z).length;
    legs.push({
      coxa: coxa.name,
      tip: foot.name,
      rest: coxa.quaternion.clone(),
      axis: inParentFrame(coxa, root, _v.set(0, 1, 0)),
      side,
      rank,
      phase: ((side === 1 ? 1 : 0) + rank) % 2,
    });
  }
  return legs;
}

/**
 * The best mirror of a bone: on the other side of X, at about the same
 * distance out, height and station. Null when nothing pairs.
 */
function mirrorOf(of: THREE.Bone, among: readonly THREE.Bone[], at: (b: THREE.Bone) => THREE.Vector3, width: number, height: number): THREE.Bone | null {
  const p = at(of);
  let best: THREE.Bone | null = null;
  let score = Infinity;
  for (const other of among) {
    if (other === of) continue;
    const o = at(other);
    if (Math.sign(o.x) === Math.sign(p.x) || o.x === 0) continue;
    const s = Math.abs(Math.abs(o.x) - Math.abs(p.x)) / Math.max(1e-6, width)
      + Math.abs(o.y - p.y) / Math.max(1e-6, height)
      + Math.abs(o.z - p.z) / Math.max(1e-6, width);
    if (s < score) { score = s; best = other; }
  }
  // A pair is two things at nearly the same place on opposite sides; a leg
  // and an antenna are not a pair however the arithmetic scores them.
  return score < 0.5 ? best : null;
}

/**
 * THE WINGS: the mirrored pair of the hub's own children that are not
 * legs and not body — the pair whose tips sit highest. On the housefly
 * that is `Bone_022`/`Bone_024` (tips `Bone_021`/`Bone_023`, the two
 * highest points on the rig, folded back over the abdomen). The aphid's
 * hub has only legs and the two body chains under it, so it has none —
 * and this returns none without being told the species cannot fly.
 */
export function findWings(root: THREE.Object3D, bones: readonly THREE.Bone[], legs: readonly LegSpec[]): WingSpec[] {
  const hub = hubOf(bones);
  if (hub === null) return [];
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const b of bones) box.expandByPoint(positionOf(b, _v));
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const centreX = (box.min.x + box.max.x) / 2;
  const coxae = new Set(legs.map((l) => l.coxa));
  const pos = new Map<THREE.Bone, THREE.Vector3>();
  const at = (b: THREE.Bone): THREE.Vector3 => {
    let p = pos.get(b);
    if (p === undefined) { p = positionOf(b, new THREE.Vector3()); pos.set(b, p); }
    return p;
  };
  const candidates = boneChildren(hub).filter((b) => !coxae.has(b.name) && Math.abs(at(tipOf(b)).x - centreX) > width * MEDIAN_BAND);
  if (candidates.length < 2) return [];
  const tipAt = (b: THREE.Bone): THREE.Vector3 => at(tipOf(b));
  const highest = [...candidates].sort((a, b) => tipAt(b).y - tipAt(a).y)[0];
  const mirror = mirrorOf(highest, candidates, tipAt, width, height);
  if (mirror === null) return [];
  return [highest, mirror].map((bone) => ({
    bone: bone.name,
    tip: tipOf(bone).name,
    rest: bone.quaternion.clone(),
    side: tipAt(bone).x >= centreX ? 1 : -1,
    up: inParentFrame(bone, root, _v.set(0, 1, 0)),
    forward: inParentFrame(bone, root, _v.set(0, 0, 1)),
  }));
}

/**
 * THE ANTENNAE: on a secondary hub — the head, where the feelers and
 * mouthparts join — the mirrored pair with the highest tips. The aphid's
 * head hub `Bone_005` carries three low mouthpart chains and two high
 * feelers (`Bone_051`/`Bone_056`); the housefly's `Bone_002` carries the
 * proboscis and two short feelers (`Bone_050`/`Bone_052`). A rig with no
 * second hub has none.
 */
export function findAntennae(root: THREE.Object3D, bones: readonly THREE.Bone[], legs: readonly LegSpec[]): AntennaSpec[] {
  const main = hubOf(bones);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const b of bones) box.expandByPoint(positionOf(b, _v));
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const tips = new Set(legs.map((l) => l.tip));
  const pos = new Map<THREE.Bone, THREE.Vector3>();
  const at = (b: THREE.Bone): THREE.Vector3 => {
    let p = pos.get(b);
    if (p === undefined) { p = positionOf(b, new THREE.Vector3()); pos.set(b, p); }
    return p;
  };
  const tipAt = (b: THREE.Bone): THREE.Vector3 => at(tipOf(b));
  let found: AntennaSpec[] = [];
  let best = -Infinity;
  for (const hub of bones) {
    if (hub === main) continue;
    const kids = boneChildren(hub).filter((b) => !tips.has(tipOf(b).name));
    if (kids.length < 2) continue;
    const highest = [...kids].sort((a, b) => tipAt(b).y - tipAt(a).y)[0];
    const mirror = mirrorOf(highest, kids, tipAt, width, height);
    if (mirror === null) continue;
    const y = tipAt(highest).y;
    if (y <= best) continue;
    best = y;
    found = [highest, mirror].map((bone) => ({
      bone: bone.name,
      tip: tipOf(bone).name,
      rest: bone.quaternion.clone(),
      side: tipAt(bone).x >= 0 ? 1 : -1,
      up: inParentFrame(bone, root, _v.set(0, 1, 0)),
    }));
  }
  return found;
}

/**
 * The chain the table names, in HIERARCHY order, root first — whatever
 * order the names were listed in. A bone aimed at "the next bone" has to
 * mean its child, and the worm's file runs `Bone_000 → Bone_016 → … →
 * Bone_001` while the table lists `Bone_000 … Bone_016`.
 */
export function chainOf(root: THREE.Object3D, names: readonly string[]): THREE.Bone[] {
  const wanted = new Set(names);
  const byName = new Map<string, THREE.Bone>();
  for (const b of bonesOf(root)) if (wanted.has(b.name)) byName.set(b.name, b);
  if (byName.size === 0) return [];
  // The root: a named bone whose parent is not a named bone.
  let head: THREE.Bone | null = null;
  for (const b of byName.values()) {
    const p = b.parent;
    if (p === null || !isBone(p) || !byName.has(p.name)) { head = b; break; }
  }
  if (head === null) return [];
  const out: THREE.Bone[] = [head];
  let at = head;
  for (;;) {
    const next = boneChildren(at).find((c) => byName.has(c.name));
    if (next === undefined) break;
    out.push(next);
    at = next;
  }
  return out;
}

/** Bone-aware bounding box of the rig's skinned meshes at their current pose; the bones' box when there is none. */
export function rigBox(root: THREE.Object3D, bones: readonly THREE.Bone[]): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let skinned = 0;
  root.traverse((n) => {
    const mesh = n as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh !== true) return;
    mesh.computeBoundingBox();
    if (mesh.boundingBox !== null) { box.union(mesh.boundingBox); skinned += 1; }
  });
  if (skinned === 0) for (const b of bones) box.expandByPoint(positionOf(b, _v));
  return box;
}

/** Triangles across the rig's meshes. */
export function trianglesOf(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const g = mesh.geometry;
    tris += g.index !== null ? g.index.count / 3 : g.getAttribute('position').count / 3;
  });
  return tris;
}

/**
 * The rig's body length in its own units — see the header. `chainNames`
 * is the species' chain or null for a rig posed by its legs.
 */
export function measureSpine(root: THREE.Object3D, chainNames: readonly string[] | null, bones: readonly THREE.Bone[] = bonesOf(root)): number {
  root.updateMatrixWorld(true);
  if (chainNames !== null) {
    const chain = chainOf(root, chainNames);
    let sum = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 1; i < chain.length; i += 1) sum += positionOf(chain[i], b).distanceTo(positionOf(chain[i - 1], a));
    return sum;
  }
  const box = new THREE.Box3();
  for (const b of bones) box.expandByPoint(positionOf(b, _v));
  const width = box.max.x - box.min.x;
  const centreX = (box.min.x + box.max.x) / 2;
  const body = new THREE.Box3();
  for (const b of bones) {
    positionOf(b, _v);
    if (Math.abs(_v.x - centreX) <= width * MEDIAN_BAND) body.expandByPoint(_v);
  }
  if (body.isEmpty()) return 0;
  return Math.max(body.max.x - body.min.x, body.max.z - body.min.z);
}

/**
 * Everything the renderer needs to know about a template, measured once
 * with the template at the identity, before it is scaled.
 */
export function measureRig(root: THREE.Object3D, chainNames: readonly string[] | null): RigAnatomy {
  root.updateMatrixWorld(true);
  const bones = bonesOf(root);
  const legs = findLegs(root, bones);
  const wings = findWings(root, bones, legs);
  const antennae = findAntennae(root, bones, legs);
  const box = rigBox(root, bones);
  let chain: ChainSpec | null = null;
  if (chainNames !== null) {
    const ordered = chainOf(root, chainNames);
    if (ordered.length >= 2) {
      const dirs: THREE.Vector3[] = [];
      const lengths: number[] = [];
      let meanY = 0;
      for (let i = 0; i < ordered.length; i += 1) {
        meanY += positionOf(ordered[i], _v).y;
        if (i + 1 < ordered.length) {
          const offset = ordered[i + 1].position;
          lengths.push(offset.length());
          dirs.push(offset.clone().normalize());
        }
      }
      meanY /= ordered.length;
      chain = { bones: ordered.map((b) => b.name), dirs, lengths, lift: Math.max(0, meanY - box.min.y) };
    }
  }
  return { legs, wings, antennae, chain, spine: measureSpine(root, chainNames, bones), box, triangles: trianglesOf(root) };
}

/**
 * Put a loaded rig into the island's material language — see the
 * header. On the TEMPLATE, before cloning, because clones share the
 * material. Returns how many materials it touched, so a pass that
 * matched nothing can be noticed.
 */
export function dressRig(
  root: THREE.Object3D,
  roughness: number = CREATURE_ROUGHNESS,
  keepNormal = true,
): number {
  const done = new Set<THREE.Material>();
  root.traverse((n) => {
    const holder = n as THREE.Mesh;
    if (!holder.isMesh) return;
    const list = Array.isArray(holder.material) ? holder.material : [holder.material];
    for (const material of list) {
      const std = material as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial !== true || done.has(std)) continue;
      done.add(std);
      const drop = keepNormal
        ? (['roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const)
        : (['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const);
      for (const slot of drop) {
        const texture = std[slot];
        if (texture !== null && texture !== std.map) texture.dispose();
        std[slot] = null;
      }
      std.roughness = roughness;
      std.metalness = 0;
      std.needsUpdate = true;
    }
    // A posed rig leaves its bind-pose bounds behind; a worm laid along a
    // turn would be culled by the box it was exported in.
    holder.frustumCulled = false;
  });
  return done.size;
}

/**
 * The honest body a missing GLB gets: a box the species' own length,
 * standing on the ground, in the species' colour. In WORLD units — it
 * is not a rig and is not scaled like one.
 */
export function placeholderFor(lengthUnits: number, girth: number, colour: number): THREE.Object3D {
  const group = new THREE.Group();
  const thick = Math.max(0.01, lengthUnits * girth);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(thick, thick, lengthUnits),
    new THREE.MeshStandardMaterial({ color: colour, roughness: CREATURE_ROUGHNESS, metalness: 0 }),
  );
  mesh.position.y = thick / 2;
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}

/** Release every geometry, material and texture under a root. For a template, once. */
export function disposeRig(root: THREE.Object3D): void {
  const done = new Set<object>();
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    if (mesh.geometry && !done.has(mesh.geometry)) { done.add(mesh.geometry); mesh.geometry.dispose(); }
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material || done.has(material)) continue;
      done.add(material);
      const std = material as THREE.MeshStandardMaterial;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
        const texture = std[slot];
        if (texture && !done.has(texture)) { done.add(texture); texture.dispose(); }
      }
      material.dispose();
    }
  });
}
