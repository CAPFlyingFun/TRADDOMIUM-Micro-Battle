/**
 * THE ANTENNAE'S FILLS, without a GPU: three's scene graph and the
 * sightings a sweep would hand it.
 *
 *   a fill stands where its sighting stands, seated on the ground
 *   it is the thing's own size, in the thing's kind's posture
 *   the colour is the kind's and the alpha is the strength; nothing
 *     else decides how bright anything is
 *   too small to see is still drawn — but the floor grows the shape and
 *     never moves the thing
 *   the cap keeps the nearest to the SWEEP
 *   it is flat and unlit, and it stops at the world rather than
 *     reaching through it
 *   an origin shift moves the fills with the world
 *   an empty sweep draws nothing at all
 *   dispose lets go of everything
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILL_CAP,
  FILL_OPACITY,
  FILL_RENDER_ORDER,
  FILL_SHAPE,
  FILL_SWELL,
  MIN_FILL_PIXELS,
  SEE_THROUGH_WORLD,
  SenseFills,
  type SenseLens,
} from '../src/sense/SenseFills';
import { SENSE_COLOURS, SENSE_KINDS, type SenseKind, type Sighting } from '../src/sense/senseTypes';
import { world, type LocalPoint, type WorldPoint } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';

const GROUND = 1000;
const FOV = (60 * Math.PI) / 180;
const HEIGHT_PX = 430;
/** The world size of one pixel at one unit of distance, on the test's screen. */
const PER_PIXEL = (2 * Math.tan(FOV / 2)) / HEIGHT_PX;

/** A lens 60° tall on a 430-pixel phone screen, standing at the sweep's own height. */
function lens(at = new THREE.Vector3(0, GROUND, 0)): SenseLens {
  return { fovRadians: FOV, heightPx: HEIGHT_PX, at };
}

interface ThingOptions {
  readonly size?: number;
  readonly height?: number;
  readonly strength?: number;
  readonly distance?: number;
}

function seen(id: string, kind: SenseKind, wx: number, wz: number, o: ThingOptions = {}): Sighting {
  return {
    id,
    kind,
    name: id.toUpperCase(),
    at: world(wx, wz),
    height: o.height ?? GROUND,
    size: o.size ?? 20,
    distance: o.distance ?? Math.hypot(wx, wz),
    strength: o.strength ?? 1,
  };
}

const meshOf = (view: SenseFills): THREE.InstancedMesh => view.group.children[0] as THREE.InstancedMesh;
const drawn = (view: SenseFills): number => meshOf(view).count;

/** Where a fill was put, how big it was drawn, and the colour and alpha it carries. */
function fillAt(view: SenseFills, i: number): {
  pos: THREE.Vector3;
  scale: THREE.Vector3;
  colour: THREE.Color;
  alpha: number;
} {
  const mesh = meshOf(view);
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, q, scale);
  const tint = mesh.geometry.getAttribute('color');
  // Working-space floats both sides: `Color(r, g, b)` converts nothing,
  // which is what makes this comparable with `setHex`'s sRGB decode.
  const colour = new THREE.Color(tint.getX(i), tint.getY(i), tint.getZ(i));
  return { pos, scale, colour, alpha: tint.getW(i) };
}

/** What the view should have drawn for one sighting, computed the long way round. */
function expected(s: Sighting, camera = new THREE.Vector3(0, GROUND, 0)): { y: number; rx: number; ry: number } {
  const shape = FILL_SHAPE[s.kind];
  const local = toLocal(s.at);
  const y = s.height + (s.size * shape.rise) / 2;
  const range = new THREE.Vector3(local.lx, y, local.lz).distanceTo(camera);
  const span = Math.max(s.size, range * PER_PIXEL * MIN_FILL_PIXELS) * FILL_SWELL;
  return { y, rx: (span * shape.girth) / 2, ry: (span * shape.rise) / 2 };
}

afterEach(() => {
  setOrigin(world(0, 0));
});

describe('SenseFills', () => {
  it('draws nothing at all when the sweep has found nothing', () => {
    const view = new SenseFills();
    view.update([], lens());
    expect(drawn(view)).toBe(0);
    expect(view.drawn).toBe(0);
    view.dispose();
  });

  it('stands a fill where its sighting stands, seated on the ground rather than buried in it', () => {
    const view = new SenseFills();
    const list = [
      seen('worm', 'creature', 100, 0, { size: 15 }),
      seen('sprout', 'plant', 0, 250, { size: 30 }),
      seen('twig', 'material', -400, 0, { size: 40, height: GROUND + 12 }),
    ];
    view.update(list, lens());
    expect(drawn(view)).toBe(3);
    expect(view.drawn).toBe(3);
    // In the order given — under the cap there is nothing to choose
    // between, and the sort is only paid when the cap bites.
    expect(fillAt(view, 0).pos.x).toBeCloseTo(100, 3);
    expect(fillAt(view, 0).pos.z).toBeCloseTo(0, 3);
    expect(fillAt(view, 1).pos.z).toBeCloseTo(250, 3);
    expect(fillAt(view, 2).pos.x).toBeCloseTo(-400, 3);
    // Half its own rise above the height it was given, so the hull sits
    // ON the ground: a fill sunk to the waist would mark the soil.
    for (const [i, s] of list.entries()) {
      expect(fillAt(view, i).pos.y).toBeCloseTo(expected(s).y, 3);
      expect(fillAt(view, i).pos.y).toBeGreaterThan(s.height);
    }
    view.dispose();
  });

  it('is drawn at the thing\'s own size: twice the thing, twice the fill', () => {
    const view = new SenseFills();
    // The same spot, so nothing but the size differs — and far enough
    // out at 40 and 80 units that the pixel floor cannot reach either.
    const small = seen('stone', 'material', 100, 0, { size: 40 });
    const large = seen('rock', 'material', 100, 0, { size: 80 });
    view.update([small, large], lens());
    const a = fillAt(view, 0);
    const b = fillAt(view, 1);
    expect(b.scale.x / a.scale.x).toBeCloseTo(2, 4);
    expect(a.scale.x).toBeCloseTo(expected(small).rx, 3);
    expect(a.scale.y).toBeCloseTo(expected(small).ry, 3);
    // Round about the vertical axis: no heading is invented for a stone.
    expect(a.scale.z).toBeCloseTo(a.scale.x, 4);
    view.dispose();
  });

  it('wears the kind\'s posture, and every kind\'s longest proportion is the thing\'s longest axis', () => {
    const view = new SenseFills();
    const size = 60;
    view.update(SENSE_KINDS.map((kind, i) => seen(kind, kind, 120 + i, 0, { size })), lens());
    for (const [i, kind] of SENSE_KINDS.entries()) {
      const shape = FILL_SHAPE[kind];
      expect(Math.max(shape.girth, shape.rise), `${kind} is not measured on its longest axis`).toBe(1);
      const fill = fillAt(view, i);
      expect(fill.scale.y / fill.scale.x).toBeCloseTo(shape.rise / shape.girth, 4);
    }
    // What grows stands up; a body and a twig lie along the ground.
    expect(FILL_SHAPE.plant.rise).toBeGreaterThan(FILL_SHAPE.plant.girth);
    expect(FILL_SHAPE.creature.girth).toBeGreaterThan(FILL_SHAPE.creature.rise);
    expect(FILL_SHAPE.material.girth).toBeGreaterThan(FILL_SHAPE.material.rise);
    view.dispose();
  });

  it('takes its colour from SENSE_COLOURS by kind, and from nothing else', () => {
    const view = new SenseFills();
    view.update(SENSE_KINDS.map((kind, i) => seen(kind, kind, 100 + i * 10, 0)), lens());
    for (const [i, kind] of SENSE_KINDS.entries()) {
      const want = new THREE.Color().setHex(SENSE_COLOURS[kind]);
      const got = fillAt(view, i).colour;
      expect(got.r).toBeCloseTo(want.r, 5);
      expect(got.g).toBeCloseTo(want.g, 5);
      expect(got.b).toBeCloseTo(want.b, 5);
    }
    view.dispose();
  });

  it('lets the sighting\'s strength decide how bright it is, and nothing else', () => {
    const view = new SenseFills();
    view.update(
      [
        seen('a', 'creature', 100, 0, { strength: 1 }),
        seen('b', 'creature', 110, 0, { strength: 0.4 }),
        seen('c', 'creature', 120, 0, { strength: 0 }),
      ],
      lens(),
    );
    expect(fillAt(view, 0).alpha).toBeCloseTo(1, 5);
    expect(fillAt(view, 1).alpha).toBeCloseTo(0.4, 5);
    expect(fillAt(view, 2).alpha).toBeCloseTo(0, 5);
    // Distance, size and kind change none of it.
    const far = fillAt(view, 1);
    expect(far.colour.getHex()).toBe(fillAt(view, 0).colour.getHex());
    // FILL_OPACITY is the ceiling the strength multiplies, held on the
    // one material — the shader's `diffuseColor = vec4(diffuse, opacity)
    // * vColor`, which is why the alpha lives in the colour attribute.
    const material = meshOf(view).material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBe(FILL_OPACITY);
    expect(material.opacity).toBeLessThan(1);
    view.dispose();
  });

  it('never lets a caller\'s arithmetic make a fill brighter than the pulse', () => {
    const view = new SenseFills();
    view.update([seen('a', 'creature', 100, 0, { strength: 4 }), seen('b', 'creature', 110, 0, { strength: -2 })], lens());
    expect(fillAt(view, 0).alpha).toBe(1);
    expect(fillAt(view, 1).alpha).toBe(0);
    view.dispose();
  });

  it('THE POINT OF IT: a 2.5 mm aphid is still drawn — the floor grows the shape and never moves the thing', () => {
    const view = new SenseFills();
    // 2.5 mm, two metres off: under half a pixel drawn honestly, which
    // is the case Joshua asked for by name.
    const aphid = seen('aphid', 'creature', 200, 0, { size: 0.25 });
    view.update([aphid], lens());
    const fill = fillAt(view, 0);
    const want = expected(aphid);
    expect(fill.scale.x).toBeCloseTo(want.rx, 3);
    // Plainly bigger than the animal, and the pixels asked for.
    expect(fill.scale.x).toBeGreaterThan(aphid.size * 4);
    // And it grew AROUND the aphid: the centre is still the one its true
    // size gives, not one lifted by the floor.
    expect(fill.pos.y).toBeCloseTo(GROUND + (aphid.size * FILL_SHAPE.creature.rise) / 2, 4);
    view.dispose();
  });

  it('a thing big enough to see is drawn at its own size, floor or no floor', () => {
    const view = new SenseFills();
    const twig = seen('twig', 'material', 60, 0, { size: 50 });
    view.update([twig], lens());
    const shape = FILL_SHAPE.material;
    expect(fillAt(view, 0).scale.x).toBeCloseTo((twig.size * shape.girth * FILL_SWELL) / 2, 3);
    view.dispose();
  });

  it('keeps the nearest to the SWEEP when there are more sightings than fills', () => {
    const view = new SenseFills();
    const many: Sighting[] = [];
    // Furthest first, so an unsorted slice would keep exactly the wrong ones.
    for (let i = FILL_CAP + 40; i > 0; i -= 1) many.push(seen(`t${i}`, 'material', i * 10, 0));
    view.update(many, lens());
    expect(drawn(view)).toBe(FILL_CAP);
    expect(view.drawn).toBe(FILL_CAP);
    expect(fillAt(view, 0).pos.x).toBeCloseTo(10, 3);
    // The far ones are the ones that went: the last kept is the cap'th nearest.
    expect(fillAt(view, FILL_CAP - 1).pos.x).toBeCloseTo(FILL_CAP * 10, 3);
    view.dispose();
  });

  it('is flat and unlit, and carries its alpha per instance', () => {
    const view = new SenseFills();
    const mesh = meshOf(view);
    const material = mesh.material as THREE.MeshBasicMaterial;
    // MeshBasicMaterial: no light reaches it, by construction. Untoned
    // and unfogged, so neither the exposure nor the island's haze can
    // decide how bright a sense is.
    expect(material.type).toBe('MeshBasicMaterial');
    expect(material.toneMapped).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.transparent).toBe(true);
    // three's own condition for USE_COLOR_ALPHA — `vertexColors` with a
    // four-component `color` attribute — and an INSTANCED one, so the
    // four numbers are per fill rather than per vertex.
    expect(material.vertexColors).toBe(true);
    const tint = mesh.geometry.getAttribute('color');
    expect(tint.itemSize).toBe(4);
    expect((tint as THREE.InstancedBufferAttribute).isInstancedBufferAttribute).toBe(true);
    expect(tint.count).toBe(FILL_CAP);
    expect(mesh.frustumCulled).toBe(false);
    view.dispose();
  });

  it('stops at the world instead of reaching through it: a sense, not a wallhack', () => {
    // The finder's pins ignore depth on purpose, because a pin's whole
    // job is to mark what cannot be seen. A fill is the thing itself lit
    // up, so it is depth tested — and the decision is a named constant
    // rather than a boolean to go hunting for.
    expect(SEE_THROUGH_WORLD).toBe(false);
    const view = new SenseFills();
    const material = meshOf(view).material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(!SEE_THROUGH_WORLD);
    // It does not occlude the fills behind it.
    expect(material.depthWrite).toBe(false);
    expect(meshOf(view).renderOrder).toBe(FILL_RENDER_ORDER);
    expect(FILL_RENDER_ORDER).toBeGreaterThan(1000);
    view.dispose();
  });

  it('moves its fills with the world when the origin shifts', () => {
    const view = new SenseFills({ origin: { toLocal: (at: WorldPoint): LocalPoint => toLocal(at) } });
    const twig = seen('twig', 'material', 5_000, 0, { size: 40 });
    view.update([twig], lens());
    expect(fillAt(view, 0).pos.x).toBeCloseTo(5_000, 2);
    // The origin snaps to a lattice, so the fill is asked to agree with
    // `toLocal` rather than with arithmetic done here — the point is
    // that it re-converts every frame.
    setOrigin(world(4_000, 0));
    view.update([twig], lens());
    expect(fillAt(view, 0).pos.x).toBeCloseTo(toLocal(twig.at).lx, 2);
    expect(fillAt(view, 0).pos.x).toBeLessThan(5_000);
    view.dispose();
  });

  it('clears the last frame when the pulse runs out', () => {
    const view = new SenseFills();
    view.update([seen('twig', 'material', 100, 0)], lens());
    expect(drawn(view)).toBe(1);
    view.update([], lens());
    expect(drawn(view)).toBe(0);
    expect(view.drawn).toBe(0);
    view.dispose();
  });

  it('dispose lets go of the mesh, its geometry and its material', () => {
    const view = new SenseFills();
    const mesh = meshOf(view);
    let freed = 0;
    mesh.geometry.addEventListener('dispose', () => { freed += 1; });
    (mesh.material as THREE.Material).addEventListener('dispose', () => { freed += 1; });
    view.dispose();
    expect(freed).toBe(2);
    expect(view.group.children).toHaveLength(0);
    // And it stops answering after that.
    view.update([seen('twig', 'material', 100, 0)], lens());
    expect(view.drawn).toBe(0);
  });

  it('is cheap: a full cap of fills is one pass and no allocation per sighting', () => {
    const view = new SenseFills();
    const many: Sighting[] = [];
    for (let i = 0; i < FILL_CAP; i += 1) many.push(seen(`t${i}`, 'material', (i % 16) * 100, Math.floor(i / 16) * 100));
    const started = performance.now();
    for (let f = 0; f < 60; f += 1) view.update(many, lens());
    const perFrame = (performance.now() - started) / 60;
    expect(drawn(view)).toBe(FILL_CAP);
    // Generous for a slow box; it is a matrix and four floats per fill.
    expect(perFrame).toBeLessThan(2);
    view.dispose();
  });
});

describe('the local-point rule', () => {
  it('reads no world coordinate at all: the position crosses through toLocal', () => {
    // The renderer directories' standing rule (`tests/viewBoundary.test.ts`
    // holds view/, terrain/, flora/, sky/ and fauna/ to it). A fill has
    // no distance of its own to measure — the sweep already handed it
    // one — so there is nothing here for a hand-rolled subtraction to
    // hide behind either.
    const source = new URL('../src/sense/SenseFills.ts', import.meta.url);
    const text = readFileSync(source, 'utf8');
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).not.toMatch(/\.w[xz]\b/);
    expect(body).toContain('this.toLocal(s.at)');
    // And it never reaches into the module that chooses the sightings.
    expect(body).not.toMatch(/from '\.\/select'/);
  });
});
