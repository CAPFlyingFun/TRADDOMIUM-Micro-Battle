import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHUNK_SPAN, chunkAt, chunkKey, chunkOrigin, sameChunk,
  type ChunkId, type WorldPoint } from './coords';
import { toLocal } from './origin';
import { groundHeight, reliefScale } from './heightfield';
import { BARE, BUILT, GRASS, SHRUB, TREE, WATER, coverAt, haveVeg } from './landcover';
import { lakeLevel } from './lakes';
import { riverAt } from './rivers';

/**
 * WHAT SHE ACTUALLY WALKS THROUGH.
 *
 * Beyond Extinction's landscaping is a forest: streamed billboard trees
 * placed from these same ESA rasters, sized for a human looking at a
 * hillside. That is the right layer for TMB's DISTANCE, and it is not
 * this one.
 *
 * At ten millimetres long the near field is not trees. A blade of
 * grass is three millimetres wide and a hundred long — a third of her
 * width and TEN TIMES her length. A pebble is a boulder. A fallen twig
 * is a log she must go round. None of that exists in BE because a
 * human standing in the same spot cannot see any of it, which is why
 * this is the one landscaping layer with nothing to port and
 * everything to build.
 *
 * WHAT THE RASTERS DECIDE is the mix, never the placement: whether a
 * neighbourhood is jungle floor or open pasture or bare rock, and how
 * thick. One raster pixel is 146 metres. Where each blade stands comes
 * from a hash of its own grid cell, so the same patch of Kauaʻi grows
 * the same grass on every device, after every reload, forever — the
 * rule chunk addressing already follows (coords.ts).
 *
 * STREAMED ON THE TERRAIN'S OWN CHUNKS, and only the near ring of them:
 * at this density a chunk holds hundreds of blades, and past a few
 * metres a blade is a subpixel line that costs a draw call to alias.
 *
 * WATER IS NOT A PLACE TO GROW. The hydrography decides that, not the
 * raster's water class — 1,121 real reaches and 111 real lakes at
 * metre resolution against a 146-metre pixel. Nothing sprouts in a
 * carved channel or under a lake's waterline.
 */

/** Chunks either side of hers that grow anything. 5x5 of 512 units. */
const RING = 2;
/** Candidate sites per chunk edge. 24x24 = 576 tries per chunk. */
const TRIES = 24;
/** Past this the blades are subpixel; they fade rather than pop. */
export const COVER_FADE = 900;

/** One kind of thing that grows, and how much of the mix it takes. */
interface Sprig {
  readonly name: string;
  /** Share of sites in each cover class, 0 to 1. */
  readonly share: Partial<Record<number, number>>;
}

/**
 * The mix, per ESA class.
 *
 * Grass under an open sky and grass under a canopy are different
 * plants at her scale: pasture is blades, jungle floor is litter and
 * stems with far less light to grow in. Bare rock grows pebbles only,
 * which is what bare rock is.
 */
const SPRIGS: readonly Sprig[] = [
  {
    name: 'blade',
    share: { [GRASS]: 0.72, [SHRUB]: 0.45, [TREE]: 0.3, [BARE]: 0.02, [BUILT]: 0.25 },
  },
  {
    name: 'pebble',
    share: { [GRASS]: 0.12, [SHRUB]: 0.2, [TREE]: 0.18, [BARE]: 0.5, [BUILT]: 0.2 },
  },
  {
    name: 'twig',
    share: { [GRASS]: 0.04, [SHRUB]: 0.12, [TREE]: 0.3, [BARE]: 0.02, [BUILT]: 0.05 },
  },
];

/**
 * A hash that is stable forever, on any device.
 *
 * The same integer mixing the terrain's own noise uses. Not
 * `Math.random`: two players standing in the same clearing must see the
 * same clearing, and she must find the same twig where she left it.
 */
function hash(x: number, z: number, salt: number): number {
  let h = (x | 0) * 374_761_393 + (z | 0) * 668_265_263 + salt * 1_442_695_041;
  h = (h ^ (h >>> 13)) * 1_274_126_177;
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

/**
 * A blade of grass, as three crossed quads.
 *
 * Real proportions: 3 mm across, 100 mm tall — 0.3 by 10 world units,
 * ten times her length. Crossed rather than billboarded because she
 * walks BETWEEN them: a billboard seen from underneath is a paper strip
 * turning to face her, and at this scale she is underneath constantly.
 */
function bladeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const turn of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const quad = new THREE.PlaneGeometry(0.3, 10, 1, 3);
    quad.translate(0, 5, 0);
    quad.rotateY(turn);
    parts.push(quad);
  }
  return mergeInto(parts);
}

/** A pebble: a squashed low-poly lump about a body length across. */
function pebbleGeometry(): THREE.BufferGeometry {
  const rock = new THREE.IcosahedronGeometry(0.55, 0);
  rock.scale(1, 0.62, 1);
  rock.translate(0, 0.3, 0);
  return rock;
}

/** A twig: a thin box the length of three queens. */
function twigGeometry(): THREE.BufferGeometry {
  const stick = new THREE.CylinderGeometry(0.16, 0.11, 3.4, 5, 1);
  stick.rotateZ(Math.PI / 2);
  stick.translate(0, 0.16, 0);
  return stick;
}

/** Merge without pulling in BufferGeometryUtils for three shapes. */
function mergeInto(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let points = 0;
  let indices = 0;
  for (const part of parts) {
    points += part.getAttribute('position').count;
    indices += part.getIndex()!.count;
  }
  const position = new Float32Array(points * 3);
  const normal = new Float32Array(points * 3);
  const uv = new Float32Array(points * 2);
  const index = new Uint16Array(indices);
  let atPoint = 0;
  let atIndex = 0;
  for (const part of parts) {
    const p = part.getAttribute('position');
    const n = part.getAttribute('normal');
    const t = part.getAttribute('uv');
    const i = part.getIndex()!;
    position.set(p.array as Float32Array, atPoint * 3);
    normal.set(n.array as Float32Array, atPoint * 3);
    uv.set(t.array as Float32Array, atPoint * 2);
    for (let k = 0; k < i.count; k++) index[atIndex + k] = i.getX(k) + atPoint;
    atPoint += p.count;
    atIndex += i.count;
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

/**
 * Whether anything may grow at this exact spot.
 *
 * Exported because it is the rule, not an implementation detail: the
 * hydrography decides where water is, and nothing grows in water.
 */
export function canGrow(wx: number, wz: number): boolean {
  const cover = coverAt(wx, wz);
  if (cover.kind === WATER || cover.kind === 0) return false;
  const ground = groundHeight(wx, wz);
  if (ground <= 0) return false;
  const river = riverAt(wx, wz);
  if (river && river.off <= river.width / 2) return false;
  const lake = lakeLevel(wx, wz);
  if (lake !== null && lake * reliefScale() > ground) return false;
  return true;
}

/** How many of each sprig a class wants, as a share of TRIES-squared. */
export function mixFor(kind: number, canopy: number): number[] {
  return SPRIGS.map((sprig) => {
    const share = sprig.share[kind] ?? 0;
    // Canopy thickens litter and thins the sun-hungry blades.
    if (sprig.name === 'blade') return share * (1 - canopy * 0.45);
    if (sprig.name === 'twig') return share * (0.5 + canopy);
    return share;
  });
}

interface Patch {
  readonly id: ChunkId;
  readonly meshes: THREE.InstancedMesh[];
}

export class GroundCover {
  private readonly patches = new Map<string, Patch>();
  private readonly shapes: THREE.BufferGeometry[];
  private readonly materials: THREE.MeshStandardMaterial[];
  private at: ChunkId | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.shapes = [bladeGeometry(), pebbleGeometry(), twigGeometry()];
    this.materials = [
      new THREE.MeshStandardMaterial({
        color: 0x6f8f3e, roughness: 0.85, side: THREE.DoubleSide,
      }),
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: 0x6b5334, roughness: 0.95 }),
    ];
  }

  /**
   * Swap a procedural shape for a real model once it lands.
   *
   * The pebble and the twig are Thronemound's — real scanned props that
   * already exist rather than two more lumps to model. Measured and
   * scaled to the size the procedural stand-in occupied, so the mix and
   * the density stay exactly as tuned.
   */
  wear(which: 'pebble' | 'twig', model: THREE.Object3D, want: number): void {
    const slot = which === 'pebble' ? 1 : 2;
    const found: THREE.BufferGeometry[] = [];
    model.updateWorldMatrix(true, true);
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      const copy = part.geometry.clone();
      copy.applyMatrix4(part.matrixWorld);
      found.push(copy);
    });
    if (!found.length) return;
    const geometry = found.length === 1 ? found[0] : mergeInto(found);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!(longest > 0)) return;
    geometry.scale(want / longest, want / longest, want / longest);
    // Stand it on its own base, so it sits ON the ground rather than
    // half in it — the same thing loadQueen does for the same reason.
    geometry.computeBoundingBox();
    geometry.translate(0, -geometry.boundingBox!.min.y, 0);
    this.shapes[slot].dispose();
    this.shapes[slot] = geometry;
    // Anything already built is holding the old shape.
    this.clear();
    this.at = null;
  }

  /** Grow the ring around her; let what she has left go. */
  follow(at: WorldPoint): void {
    if (!haveVeg()) return;
    const here = chunkAt(at);
    if (this.at && sameChunk(here, this.at)) {
      this.place();
      return;
    }
    this.at = here;

    const wanted = new Set<string>();
    for (let dz = -RING; dz <= RING; dz++) {
      for (let dx = -RING; dx <= RING; dx++) {
        const id: ChunkId = { cx: here.cx + dx, cz: here.cz + dz };
        const key = chunkKey(id);
        wanted.add(key);
        if (this.patches.has(key)) continue;
        const grown = this.grow(id);
        if (grown) this.patches.set(key, grown);
      }
    }
    for (const [key, patch] of this.patches) {
      if (wanted.has(key)) continue;
      for (const mesh of patch.meshes) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
      this.patches.delete(key);
    }
    this.place();
  }

  /**
   * Re-seat every patch against the current origin.
   *
   * Computed from the chunk's GLOBAL address every time, never stored —
   * the TerrainStream rule, so there is no local position to go stale.
   */
  place(): void {
    for (const patch of this.patches.values()) {
      const seat = toLocal(chunkOrigin(patch.id));
      for (const mesh of patch.meshes) mesh.position.set(seat.lx, 0, seat.lz);
    }
  }

  /** How many instances are standing — for the probes and the budget. */
  get sprigs(): number {
    let total = 0;
    for (const patch of this.patches.values()) {
      for (const mesh of patch.meshes) total += mesh.count;
    }
    return total;
  }

  dispose(): void {
    this.clear();
    for (const shape of this.shapes) shape.dispose();
    for (const material of this.materials) material.dispose();
  }

  private clear(): void {
    for (const patch of this.patches.values()) {
      for (const mesh of patch.meshes) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    this.patches.clear();
  }

  /** Scatter one chunk. Positions are LOCAL to the chunk's corner. */
  private grow(id: ChunkId): Patch | null {
    const corner = chunkOrigin(id);
    const step = CHUNK_SPAN / TRIES;
    const held: { at: THREE.Matrix4 }[][] = SPRIGS.map(() => []);
    const spot = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const where = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let r = 0; r < TRIES; r++) {
      for (let c = 0; c < TRIES; c++) {
        // Jittered inside its own cell, so the grid never reads as one.
        const jx = hash(id.cx * TRIES + c, id.cz * TRIES + r, 1);
        const jz = hash(id.cx * TRIES + c, id.cz * TRIES + r, 2);
        const wx = corner.wx + (c + jx) * step;
        const wz = corner.wz + (r + jz) * step;
        if (!canGrow(wx, wz)) continue;

        const cover = coverAt(wx, wz);
        const mix = mixFor(cover.kind, cover.canopy);
        const roll = hash(id.cx * TRIES + c, id.cz * TRIES + r, 3);
        let running = 0;
        let chose = -1;
        for (let s = 0; s < mix.length; s++) {
          running += mix[s];
          if (roll < running) { chose = s; break; }
        }
        if (chose < 0) continue;

        const y = groundHeight(wx, wz);
        const spin = hash(id.cx * TRIES + c, id.cz * TRIES + r, 4) * Math.PI * 2;
        const size = 0.7 + hash(id.cx * TRIES + c, id.cz * TRIES + r, 5) * 0.7;
        where.set(wx - corner.wx, y, wz - corner.wz);
        turn.setFromAxisAngle(up, spin);
        scale.set(size, size, size);
        held[chose].push({ at: new THREE.Matrix4().compose(where, turn, scale) });
      }
    }

    const meshes: THREE.InstancedMesh[] = [];
    for (let s = 0; s < SPRIGS.length; s++) {
      const rows = held[s];
      if (!rows.length) continue;
      const mesh = new THREE.InstancedMesh(this.shapes[s], this.materials[s], rows.length);
      rows.forEach((row, i) => mesh.setMatrixAt(i, row.at));
      mesh.instanceMatrix.needsUpdate = true;
      // The patch moves with the origin and is smaller than any view.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    if (!meshes.length) return null;
    void spot;
    return { id, meshes };
  }
}

/** Fetch the two Thronemound props. Absent is fine — shapes stand in. */
export function loadProps(
  cover: GroundCover, base: string,
): void {
  const loader = new GLTFLoader();
  const take = (file: string, which: 'pebble' | 'twig', want: number) => {
    loader.load(
      `${base}models/${file}`,
      (gltf) => cover.wear(which, gltf.scene, want),
      undefined,
      () => {},
    );
  };
  // A pebble about a body length across; a twig about three.
  take('rock.glb', 'pebble', 1.1);
  take('twig.glb', 'twig', 3.4);
}
