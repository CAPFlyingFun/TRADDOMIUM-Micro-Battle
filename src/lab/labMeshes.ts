/**
 * THE BENCH, DRAWN: the Creature Lab's cubic metre as meshes.
 *
 * Everything here is a picture of what `creatures/labWorld.ts` already
 * IS. The floor is SAMPLED from `labGroundAt` at half-centimetre steps,
 * so the uneven patch and the puddle's dish appear exactly where the
 * animals feel them and never where a second copy of the numbers put
 * them; the block, the plants, the litter, the puddle and the protein
 * spot stand at the world's own spots (`BLOCK`, `LAB_PLANTS`,
 * `LITTER_CORNER`, `PUDDLE`, `PROTEIN_SPOT`). A mesh that disagreed
 * with the query the brain reads would show an aphid feeding on air.
 *
 * WALLS AND UNDERSIDE ARE DRAWN AND NOT WALKABLE. The block is a box
 * with six faces so a player can see what Phase D will make climbable
 * (the brief's §6 and §14: "top → down wall → underneath → around
 * corner → back upward"); today only its top is ground (`labWorld.ts`,
 * "ITS TOP IS THE GROUND over its footprint and that is all it is"). The
 * bounds are four faint panes and a gold wire cube: there is no wall to
 * walk into — containment is the brain's (`inwardTarget`) — and the
 * panes only say where the box ends.
 *
 * PRIMITIVE GEOMETRY IN THE FLORA'S COLOURS. The island's plants are
 * `flora/WorldObjects.ts`'s streamed instanced families and are not
 * instantiated here (a bubble of 16 m cells around a 1 m bench would be
 * the island's grass, not the Lab's five plants); a tuft, a flower on a
 * stem, a broadleaf on a stem, a shrub and a fern are built from cones,
 * cylinders, discs and spheres, wearing the flora's own palette
 * (`WorldObjects.ts`: grass HSL 0.24/0.55, broadleaf 0.31/0.50/0.25,
 * fern 0.30/0.48, leaf litter 0.075/0.45/0.28, twig 0.09/0.35/0.24, the
 * stem greens and the petal whites) so the bench reads as the same
 * island at arm's length.
 *
 * THE RENDER BOUNDARY IS ONE LINE. The geometry is built in the bench's
 * own frame — the box's centre at (0, 0), heights absolute — so every
 * `.wx`/`.wz` the builders read is a BENCH coordinate, not a rendered
 * one: the bench sits on the world origin, and nothing here subtracts a
 * world coordinate from another or hands one to the GPU raw. The whole
 * group is then placed once through `origin.toLocal` (`place`), as every
 * renderer places what it draws, and re-placed if the origin ever moves.
 *
 * Lighting is the Performance World's at its simplest: one sun and one
 * hemisphere, no shadow map (`PerformanceWorldScene.ts`, "The sun, and
 * the sky it hangs in"), because a bench lit by a lone directional light
 * has its north faces black.
 */
import * as THREE from 'three';
import {
  BLOCK, BUMP, LAB_FLOOR, LAB_HALF, LAB_PLANTS, LAB_SIZE, LITTER_CORNER, PROTEIN_SPOT, PUDDLE, labGroundAt,
} from '../creatures/labWorld';
import { world, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';
import { valueNoise } from '../world/random';

// ---------------------------------------------------------------------------
// Numbers. GAME TUNING throughout: a bench is a picture.
// ---------------------------------------------------------------------------

/** Floor vertices every half centimetre: four samples per bump wavelength (`BUMP.wavelength` is 2 cm), so the patch reads as bumps and not as aliasing. */
export const FLOOR_STEP = 0.5;

/** The Performance World's sky and bounced ground, so the bench is lit like the island. */
export const HORIZON = '#9db6c6';
export const GROUND_BOUNCE = '#4a4335';
export const SUN_COLOUR = 0xfff4e0;
export const SUN_INTENSITY = 1.15;
export const SKY_INTENSITY = 1.0;

/** TCS gold, for the bounds. */
const GOLD = 0xc9a94a;

/** Flat-shaded basalt for the block: a shade lighter than the island's stones so its faces read apart. */
const BLOCK_COLOUR = new THREE.Color().setHSL(0.06, 0.06, 0.42);
const ROCK_COLOUR = new THREE.Color().setHSL(0.06, 0.08, 0.34);
/** Bare soil, a warm brown; the puddle's bed is the same soil wet — darker; the bump patch a touch paler where it is worn. */
const SOIL = new THREE.Color().setHSL(0.07, 0.32, 0.29);
const SOIL_WET = new THREE.Color().setHSL(0.07, 0.36, 0.19);
const SOIL_WORN = new THREE.Color().setHSL(0.08, 0.28, 0.33);
/** The flora's palette (`flora/WorldObjects.ts`). */
const GRASS = new THREE.Color().setHSL(0.24, 0.55, 0.36);
const SHRUB = new THREE.Color().setHSL(0.27, 0.5, 0.29);
const BROADLEAF = new THREE.Color().setHSL(0.31, 0.5, 0.25);
const FERN = new THREE.Color().setHSL(0.3, 0.48, 0.23);
const LITTER = new THREE.Color().setHSL(0.075, 0.45, 0.28);
const TWIG = new THREE.Color().setHSL(0.09, 0.35, 0.24);
const STEM_GREEN = new THREE.Color(0.35, 0.5, 0.25);
const PETAL = new THREE.Color(1, 0.9, 0.35);
const PETAL_RIM = new THREE.Color(1, 1, 0.92);
/** Standing fresh water, seen from above: a blue-grey glaze over the dish. */
const WATER = 0x4a7f9a;
/** The protein test resource (`labWorld.ts`, a `carrion` site): a dark morsel, so a worker's choice can be watched. */
const CARRION = 0x5a1e1a;

/** Where the twig lies and the rock sits: open floor, clear of every spot the world names. */
export const TWIG_SPOT: WorldPoint = world(10, 38);
export const ROCK_SPOT: WorldPoint = world(-38, 10);
export const TWIG_LENGTH = 14;
export const LITTER_RADIUS = 8;

/** A hair above the floor, so a flat disc on it never z-fights. */
const LIFT = 0.05;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface LabOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

export interface LabMeshes {
  /** Everything, placed. Add it to the scene; `dispose` removes nothing from the scene, it only frees the GPU. */
  readonly group: THREE.Group;
  readonly floor: THREE.Mesh;
  readonly block: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.HemisphereLight;
  /** Re-place the group after an origin rebase. The bench never moves; the origin might. */
  place(): void;
  dispose(): void;
}

interface Owned {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

function lambert(owned: Owned, colour: THREE.Color | number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: colour, ...extra });
  owned.materials.push(material);
  return material;
}

function keep<G extends THREE.BufferGeometry>(owned: Owned, geometry: G): G {
  owned.geometries.push(geometry);
  return geometry;
}

/**
 * THE FLOOR: a grid sampled from the world's own ground, coloured by
 * what the ground is there — wet in the dish, worn on the patch, soil
 * everywhere else, mottled by the island's value noise so it is not one
 * flat brown. The block's footprint is left in the grid (its top is the
 * ground there) and the block mesh stands over it.
 */
function buildFloor(owned: Owned): THREE.Mesh {
  const n = Math.round(LAB_SIZE / FLOOR_STEP) + 1;
  const positions = new Float32Array(n * n * 3);
  const colours = new Float32Array(n * n * 3);
  const tint = new THREE.Color();
  let v = 0;
  for (let j = 0; j < n; j += 1) {
    const z = -LAB_HALF + j * FLOOR_STEP;
    for (let i = 0; i < n; i += 1) {
      const x = -LAB_HALF + i * FLOOR_STEP;
      const at = world(x, z);
      const y = labGroundAt(at);
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      const inDish = Math.hypot(x - PUDDLE.at.wx, z - PUDDLE.at.wz) < PUDDLE.radius;
      const onPatch = Math.abs(x - BUMP.at.wx) <= BUMP.size / 2 && Math.abs(z - BUMP.at.wz) <= BUMP.size / 2;
      tint.copy(inDish ? SOIL_WET : onPatch ? SOIL_WORN : SOIL);
      // A gentle mottle, ±8 % of the lightness, from the same noise the bumps are.
      const mottle = (valueNoise(x / 6, z / 6, 0x50e1) - 0.5) * 0.16;
      tint.offsetHSL(0, 0, mottle);
      colours[v * 3] = tint.r;
      colours[v * 3 + 1] = tint.g;
      colours[v * 3 + 2] = tint.b;
      v += 1;
    }
  }
  const index: number[] = [];
  for (let j = 0; j + 1 < n; j += 1) {
    for (let i = 0; i + 1 < n; i += 1) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = keep(owned, new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, lambert(owned, 0xffffff, { vertexColors: true }));
  mesh.name = 'lab:floor';
  return mesh;
}

/** The central test block: six faces and its edges, standing on the floor over its footprint. */
function buildBlock(owned: Owned, group: THREE.Group): THREE.Mesh {
  const geometry = keep(owned, new THREE.BoxGeometry(BLOCK.size, BLOCK.height, BLOCK.size));
  const mesh = new THREE.Mesh(geometry, lambert(owned, BLOCK_COLOUR, { flatShading: true }));
  mesh.name = 'lab:block';
  mesh.position.set(BLOCK.at.wx, LAB_FLOOR + BLOCK.height / 2, BLOCK.at.wz);
  group.add(mesh);
  const edges = keep(owned, new THREE.EdgesGeometry(geometry));
  const line = new THREE.LineSegments(edges, lineMaterial(owned, GOLD, 0.35));
  line.name = 'lab:block-edges';
  line.position.copy(mesh.position);
  group.add(line);
  return mesh;
}

function lineMaterial(owned: Owned, colour: number, opacity: number): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity });
  owned.materials.push(material);
  return material;
}

/** A grass tuft: a ring of thin cones leaning outward, each a little different in height and shade. */
function buildGrass(owned: Owned, at: WorldPoint, size: number): THREE.Group {
  const tuft = new THREE.Group();
  tuft.name = 'lab:plant:grass';
  const blades = 9;
  const tint = new THREE.Color();
  for (let i = 0; i < blades; i += 1) {
    const f = i / blades;
    const height = size * (0.65 + 0.35 * valueNoise(i * 3.1, 0, 0x6a55));
    const geometry = keep(owned, new THREE.ConeGeometry(0.22, height, 4));
    geometry.translate(0, height / 2, 0);
    tint.copy(GRASS).offsetHSL(0.02 * (f - 0.5), 0, 0.06 * (valueNoise(i * 1.7, 1, 0x6a55) - 0.5));
    const blade = new THREE.Mesh(geometry, lambert(owned, tint));
    const angle = f * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6);
    blade.rotation.set(Math.sin(angle) * 0.35, 0, -Math.cos(angle) * 0.35);
    tuft.add(blade);
  }
  tuft.position.set(at.wx, labGroundAt(at), at.wz);
  return tuft;
}

/** A flower: a stem, a rim of pale petals and a yellow head, the nectar site's height (`LAB_SITES`, `FLOWER.size`). */
function buildFlower(owned: Owned, at: WorldPoint, size: number): THREE.Group {
  const flower = new THREE.Group();
  flower.name = 'lab:plant:flower';
  const stem = new THREE.Mesh(keep(owned, new THREE.CylinderGeometry(0.12, 0.2, size, 6)), lambert(owned, STEM_GREEN));
  stem.position.y = size / 2;
  flower.add(stem);
  const rim = new THREE.Mesh(keep(owned, new THREE.CircleGeometry(2.4, 10)), lambert(owned, PETAL_RIM, { side: THREE.DoubleSide }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = size - 0.3;
  flower.add(rim);
  const head = new THREE.Mesh(keep(owned, new THREE.SphereGeometry(1.2, 8, 6)), lambert(owned, PETAL));
  head.position.y = size;
  flower.add(head);
  flower.position.set(at.wx, labGroundAt(at), at.wz);
  return flower;
}

/** A broadleaf: a stem with two leaves, one at the top and one at the honeydew host's height, for the aphid to sit under. */
function buildBroadleaf(owned: Owned, at: WorldPoint, size: number): THREE.Group {
  const plant = new THREE.Group();
  plant.name = 'lab:plant:broadleaf';
  const stem = new THREE.Mesh(keep(owned, new THREE.CylinderGeometry(0.2, 0.32, size, 6)), lambert(owned, STEM_GREEN));
  stem.position.y = size / 2;
  plant.add(stem);
  const leafMaterial = lambert(owned, BROADLEAF, { side: THREE.DoubleSide });
  const leaf = (y: number, scale: number, turn: number): void => {
    const geometry = keep(owned, new THREE.CircleGeometry(4.5 * scale, 14));
    geometry.scale(1.35, 1, 1);
    const mesh = new THREE.Mesh(geometry, leafMaterial);
    // Laid flat, tipped a little, and hung off the stem so it reads as a leaf and not a plate.
    mesh.rotation.set(-Math.PI / 2 + 0.45, turn, 0);
    mesh.position.set(Math.sin(turn) * 3.5 * scale, y, Math.cos(turn) * 3.5 * scale);
    plant.add(mesh);
  };
  leaf(size, 1, 0.6);
  leaf(size * 0.6, 0.8, 3.4);
  plant.position.set(at.wx, labGroundAt(at), at.wz);
  return plant;
}

/** A shrub: a cluster of lumps on a short stem, the flora's shrub green. */
function buildShrub(owned: Owned, at: WorldPoint, size: number): THREE.Group {
  const shrub = new THREE.Group();
  shrub.name = 'lab:plant:shrub';
  const stem = new THREE.Mesh(keep(owned, new THREE.CylinderGeometry(0.5, 0.8, size * 0.4, 6)), lambert(owned, TWIG));
  stem.position.y = size * 0.2;
  shrub.add(stem);
  const lumps: readonly [number, number, number, number][] = [
    [0, 0.62, 0, 0.42], [0.28, 0.5, 0.1, 0.32], [-0.26, 0.52, -0.08, 0.3], [0.05, 0.48, -0.3, 0.3], [-0.05, 0.5, 0.3, 0.28],
  ];
  const tint = new THREE.Color();
  lumps.forEach(([x, y, z, r], i) => {
    tint.copy(SHRUB).offsetHSL(0, 0, 0.05 * (valueNoise(i, 2, 0x5a4b) - 0.5));
    const lump = new THREE.Mesh(keep(owned, new THREE.SphereGeometry(size * r, 10, 8)), lambert(owned, tint, { flatShading: true }));
    lump.position.set(x * size, y * size, z * size);
    shrub.add(lump);
  });
  shrub.position.set(at.wx, labGroundAt(at), at.wz);
  return shrub;
}

/** A fern: a whorl of fronds rising and arching outward from one crown. */
function buildFern(owned: Owned, at: WorldPoint, size: number): THREE.Group {
  const fern = new THREE.Group();
  fern.name = 'lab:plant:fern';
  const material = lambert(owned, FERN, { side: THREE.DoubleSide });
  const fronds = 7;
  for (let i = 0; i < fronds; i += 1) {
    const length = size * (0.8 + 0.2 * valueNoise(i, 3, 0x7e61));
    const geometry = keep(owned, new THREE.PlaneGeometry(1.6, length, 1, 4));
    // Taper toward the tip and bow the frond over.
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k += 1) {
      const t = (pos.getY(k) + length / 2) / length;
      pos.setX(k, pos.getX(k) * (1 - 0.7 * t));
      pos.setZ(k, -0.9 * length * t * t);
    }
    geometry.translate(0, length / 2, 0);
    geometry.computeVertexNormals();
    const frond = new THREE.Mesh(geometry, material);
    const angle = (i / fronds) * Math.PI * 2;
    frond.rotation.set(-0.5, angle, 0, 'YXZ');
    fern.add(frond);
  }
  fern.position.set(at.wx, labGroundAt(at), at.wz);
  return fern;
}

/** The litter corner: a disc of leaf brown and a scatter of flat leaves over it, where the litter site is. */
function buildLitter(owned: Owned): THREE.Group {
  const litter = new THREE.Group();
  litter.name = 'lab:litter';
  const disc = new THREE.Mesh(keep(owned, new THREE.CircleGeometry(LITTER_RADIUS, 18)), lambert(owned, LITTER));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = LIFT;
  litter.add(disc);
  const tint = new THREE.Color();
  for (let i = 0; i < 8; i += 1) {
    tint.copy(LITTER).offsetHSL(0.01 * (valueNoise(i, 4, 0x11e4) - 0.5), 0, 0.12 * (valueNoise(i, 5, 0x11e4) - 0.5));
    const leaf = new THREE.Mesh(keep(owned, new THREE.PlaneGeometry(2.2, 1.3)), lambert(owned, tint, { side: THREE.DoubleSide }));
    const angle = valueNoise(i, 6, 0x11e4) * Math.PI * 2;
    const r = (0.2 + 0.7 * valueNoise(i, 7, 0x11e4)) * LITTER_RADIUS;
    leaf.rotation.set(-Math.PI / 2 + 0.15, valueNoise(i, 8, 0x11e4) * Math.PI, 0, 'YXZ');
    leaf.position.set(Math.cos(angle) * r, LIFT * 3 + 0.2 * valueNoise(i, 9, 0x11e4), Math.sin(angle) * r);
    litter.add(leaf);
  }
  litter.position.set(LITTER_CORNER.wx, labGroundAt(LITTER_CORNER), LITTER_CORNER.wz);
  return litter;
}

/** A twig lying along the floor. */
function buildTwig(owned: Owned): THREE.Mesh {
  const geometry = keep(owned, new THREE.CylinderGeometry(0.35, 0.5, TWIG_LENGTH, 6));
  const twig = new THREE.Mesh(geometry, lambert(owned, TWIG));
  twig.name = 'lab:twig';
  twig.rotation.set(0, 0.5, Math.PI / 2, 'YXZ');
  twig.position.set(TWIG_SPOT.wx, labGroundAt(TWIG_SPOT) + 0.45, TWIG_SPOT.wz);
  return twig;
}

/** A rock, bedded a little into the floor, flat-shaded basalt. */
function buildRock(owned: Owned): THREE.Mesh {
  const geometry = keep(owned, new THREE.DodecahedronGeometry(3.2, 0));
  geometry.scale(1.2, 0.7, 1);
  const rock = new THREE.Mesh(geometry, lambert(owned, ROCK_COLOUR, { flatShading: true }));
  rock.name = 'lab:rock';
  rock.rotation.set(0.2, 0.7, 0.1);
  rock.position.set(ROCK_SPOT.wx, labGroundAt(ROCK_SPOT) + 1.6, ROCK_SPOT.wz);
  return rock;
}

/** The puddle: a glaze at the floor's level over the dish, which the floor mesh already shows below it. */
function buildPuddle(owned: Owned): THREE.Mesh {
  const geometry = keep(owned, new THREE.CircleGeometry(PUDDLE.radius, 28));
  const puddle = new THREE.Mesh(geometry, lambert(owned, WATER, { transparent: true, opacity: 0.55, depthWrite: false }));
  puddle.name = 'lab:puddle';
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(PUDDLE.at.wx, LAB_FLOOR + LIFT / 2, PUDDLE.at.wz);
  return puddle;
}

/** The protein test resource: a small dark morsel on the floor where the carrion site is. */
function buildProtein(owned: Owned): THREE.Mesh {
  const morsel = new THREE.Mesh(keep(owned, new THREE.SphereGeometry(0.9, 8, 6)), lambert(owned, CARRION, { flatShading: true }));
  morsel.name = 'lab:protein';
  morsel.scale.set(1.3, 0.6, 1);
  morsel.position.set(PROTEIN_SPOT.wx, labGroundAt(PROTEIN_SPOT) + 0.5, PROTEIN_SPOT.wz);
  return morsel;
}

/** The bounds: four faint panes and a wire cube. There is no wall to walk into; these only say where the box ends. */
function buildBounds(owned: Owned, group: THREE.Group): void {
  const pane = keep(owned, new THREE.PlaneGeometry(LAB_SIZE, LAB_SIZE));
  const material = lambert(owned, GOLD, { transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const mid = LAB_FLOOR + LAB_SIZE / 2;
  const faces: readonly [number, number, number, number][] = [
    [0, mid, -LAB_HALF, 0], [0, mid, LAB_HALF, Math.PI], [LAB_HALF, mid, 0, -Math.PI / 2], [-LAB_HALF, mid, 0, Math.PI / 2],
  ];
  for (const [x, y, z, turn] of faces) {
    const wall = new THREE.Mesh(pane, material);
    wall.name = 'lab:wall';
    wall.position.set(x, y, z);
    wall.rotation.y = turn;
    group.add(wall);
  }
  const cube = keep(owned, new THREE.EdgesGeometry(keep(owned, new THREE.BoxGeometry(LAB_SIZE, LAB_SIZE, LAB_SIZE))));
  const wire = new THREE.LineSegments(cube, lineMaterial(owned, GOLD, 0.5));
  wire.name = 'lab:bounds';
  wire.position.set(0, mid, 0);
  group.add(wire);
}

/** The plant for a family, at its spot, its size: the five the world names, by family id. */
function buildPlant(owned: Owned, family: string, at: WorldPoint, size: number): THREE.Object3D | null {
  switch (family) {
    case 'grass':
      return buildGrass(owned, at, size);
    case 'flower':
      return buildFlower(owned, at, size);
    case 'broadleaf':
      return buildBroadleaf(owned, at, size);
    case 'shrub':
      return buildShrub(owned, at, size);
    case 'fern':
      return buildFern(owned, at, size);
    default:
      return null;
  }
}

/** The bench's centre in world coordinates: the block stands on it, and the group is placed by it. */
const CENTRE: WorldPoint = world(0, 0);

export function buildLabMeshes(origin: LabOrigin = { toLocal: originToLocal }): LabMeshes {
  const owned: Owned = { geometries: [], materials: [] };
  const group = new THREE.Group();
  group.name = 'lab:bench';

  const floor = buildFloor(owned);
  group.add(floor);
  const block = buildBlock(owned, group);
  for (const plant of LAB_PLANTS) {
    const mesh = buildPlant(owned, plant.family, plant.at, plant.size);
    if (mesh !== null) group.add(mesh);
  }
  group.add(buildLitter(owned), buildTwig(owned), buildRock(owned), buildPuddle(owned), buildProtein(owned));
  buildBounds(owned, group);

  // The sun's bearing is the Performance World's (200, 400, 100), brought down to the bench's scale.
  const sun = new THREE.DirectionalLight(SUN_COLOUR, SUN_INTENSITY);
  sun.position.set(60, 120, 30);
  sun.name = 'lab:sun';
  const sky = new THREE.HemisphereLight(HORIZON, GROUND_BOUNCE, SKY_INTENSITY);
  sky.name = 'lab:sky';
  group.add(sun, sky);

  const place = (): void => {
    const here = origin.toLocal(CENTRE);
    group.position.set(here.lx, 0, here.lz);
  };
  place();

  return {
    group,
    floor,
    block,
    sun,
    sky,
    place,
    dispose() {
      for (const g of owned.geometries) g.dispose();
      for (const m of owned.materials) m.dispose();
      owned.geometries.length = 0;
      owned.materials.length = 0;
      sun.dispose();
      sky.dispose();
    },
  };
}
