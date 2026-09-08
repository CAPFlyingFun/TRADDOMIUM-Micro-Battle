// @vitest-environment jsdom
/**
 * ONE SWEEP OF THE ANTENNAE, assembled: the pulse, the gather, the
 * selection and the two renderers driven the way a scene drives them,
 * with small fake `ObjectSource` closures instead of the streaming
 * world.
 *
 *   the sweep is anchored where it was SENT: flying away neither drags
 *     the light along nor lights the forest ahead of the camera
 *   the objects are gathered ONCE, at the ping; the animals are re-read
 *     every frame, because they move
 *   a second ping mid-sweep is refused and changes nothing at all
 *   a cell the streamer has not reached is skipped, never invented
 *   nothing is lit before the front reaches it
 *   the renderers empty on the frame the light dies, and cost nothing
 *     after it
 *   reset puts the light out with no camera in the call
 *   the cost line is the pulse's own numbers and the renderers' own
 *   dispose is idempotent and lets go of what it made
 *
 * WHY THE DOM IS HERE AT ALL. `SenseLabels` paints a word onto a canvas,
 * so the whole assembly needs a `document`. jsdom has no canvas backend;
 * the renderer's own test covers the paint, and here `getContext`
 * answers null — the path that file already handles — so a sweep of two
 * dozen names does not fill this run with not-implemented notices.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EARTHWORM, newCreature, unitsOfMm, type CreatureId, type CreatureState } from '../src/creatures';
import { SenseSweep } from '../src/sense/SenseSweep';
import { CYCLE_SECONDS, LIT_SECONDS, SENSE_RADIUS, SWEEP_SECONDS } from '../src/sense/pulse';
import type { ObjectSource } from '../src/sense/candidates';
import { FILL_SHAPE, FILL_SWELL, type SenseLens } from '../src/sense/SenseFills';
import { LABEL_CAP } from '../src/sense/SenseLabels';
import { world, type LocalPoint, type WorldPoint } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';
import { UNITS_PER_METRE } from '../src/world/dem';
import { classify, type Habitat } from '../src/world/habitat';
import type { CoverMix } from '../src/world/landcover';
import { CELL_SPAN, cellKey, type ObjectCellId } from '../src/world/objects/cells';
import { OBJECT_FAMILIES, type ObjectFamily } from '../src/world/objects/families';
import type { CellPopulation, FamilyBatch } from '../src/world/objects/populate';

const M = UNITS_PER_METRE;
const GROUND = 12_500;

/** A real habitat, because `CellPopulation` carries one; nothing in the sweep reads it. */
const TREE_MIX: CoverMix = { tree: 1, shrub: 0, grass: 0, bare: 0, water: 0, wetland: 0, canopy: 0.9, river: 0 };
const FOREST: Habitat = classify(TREE_MIX, 200 * M, 8, 5000 * M, false, null);

/**
 * The middle of a cell far from the origin, so the arithmetic runs at
 * true scale: a sweep's whole six metres then sits inside ONE cell, and
 * the cell count a test asserts on is the streamer's and not the
 * geometry's accident.
 */
const HERE: WorldPoint = world(1000 * CELL_SPAN + CELL_SPAN / 2, -3 * CELL_SPAN + CELL_SPAN / 2);
const HOME_CELL: ObjectCellId = { cx: 1000, cz: -3 };

/** Somewhere else entirely — where a player who sent a ping and then flew off ends up. */
const AWAY: WorldPoint = world(HERE.wx + 50_000, HERE.wz);

const FOV = (60 * Math.PI) / 180;
const HEIGHT_PX = 430;

/**
 * Where a point `dx` east and `dz` south of the anchor is DRAWN.
 *
 * Through `toLocal` rather than as a distance from the anchor, because
 * the floating origin snaps to its own lattice: the local frame's zero
 * is near the anchor, never exactly on it, and a test that assumed
 * otherwise would be pinning the snap instead of the placement.
 */
const drawnAt = (dx: number, dz = 0): LocalPoint => toLocal(world(HERE.wx + dx, HERE.wz + dz));

/** A lens 60° tall on a 430-pixel phone screen, standing over the anchor unless it is moved. */
function lens(at: LocalPoint = drawnAt(0)): SenseLens {
  return { fovRadians: FOV, heightPx: HEIGHT_PX, at: new THREE.Vector3(at.lx, GROUND + 40, at.lz) };
}

interface Site {
  readonly wx: number;
  readonly wz: number;
  readonly size?: number;
}

/** One family's sites as the parallel typed arrays a real population holds. */
function batchOf(family: ObjectFamily, sites: readonly Site[]): FamilyBatch {
  const n = sites.length;
  const zeros = (): Float32Array => new Float32Array(n);
  return {
    family,
    count: n,
    wx: Float64Array.from(sites.map((s) => s.wx)),
    wz: Float64Array.from(sites.map((s) => s.wz)),
    size: Float32Array.from(sites.map((s) => s.size ?? 20)),
    girth: zeros(),
    spin: zeros(),
    lean: zeros(),
    leanDir: zeros(),
    tint: zeros(),
    rank: zeros(),
    variant: new Uint8Array(n),
    site: new Uint32Array(n),
    ids: null,
  };
}

/** A cell holding twigs and nothing else: one family is enough to count with. */
function populationOf(cell: ObjectCellId, sites: readonly Site[]): CellPopulation {
  const batches = {} as Record<ObjectFamily, FamilyBatch>;
  for (const family of OBJECT_FAMILIES) batches[family] = batchOf(family, family === 'twig' ? sites : []);
  return { cell, key: cellKey(cell), habitat: FOREST, batches, total: sites.length };
}

interface Plot {
  readonly source: ObjectSource;
  /** Every cell the sweep asked about, in the order it asked. */
  readonly asked: string[];
}

/**
 * The world, as the two read-only queries the scene hands in. A cell
 * with no entry answers NULL — the streamer has not reached it — which
 * is the case the sweep must skip rather than invent.
 */
function plotOf(cells: Readonly<Record<string, readonly Site[]>>): Plot {
  const asked: string[] = [];
  return {
    asked,
    source: {
      populationAt: (cell) => {
        const key = cellKey(cell);
        asked.push(key);
        const sites = cells[key];
        return sites === undefined ? null : populationOf(cell, sites);
      },
      groundAt: () => GROUND,
    },
  };
}

/** A twig `dx` east of the anchor, in the anchor's own cell. */
const twig = (dx: number, dz = 0): Site => ({ wx: HERE.wx + dx, wz: HERE.wz + dz });

function creature(id: string, species: CreatureId, at: WorldPoint): CreatureState {
  return newCreature({ id, species, cellKey: cellKey(HOME_CELL), at, height: GROUND, heading: 0, phase: 0 });
}

const fillsGroup = (s: SenseSweep): THREE.Group => s.group.children[0] as THREE.Group;
const labelsGroup = (s: SenseSweep): THREE.Group => s.group.children[1] as THREE.Group;
const mesh = (s: SenseSweep): THREE.InstancedMesh => fillsGroup(s).children[0] as THREE.InstancedMesh;
const filled = (s: SenseSweep): number => mesh(s).count;
const named = (s: SenseSweep): number => labelsGroup(s).children.filter((c) => c.visible).length;

/** Where a fill was drawn, in the local frame. */
function fillAt(s: SenseSweep, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh(s).getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

/** How big it was drawn: half-extents, since the hull is a unit sphere. */
function fillScale(s: SenseSweep, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh(s).getMatrixAt(i, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale;
}

/** Drive the sweep to full hold — everything the antennae reached, lit and steady. */
function held(s: SenseSweep, creatures: readonly CreatureState[] = [], at = lens()): void {
  s.update(creatures, 1, at);
}

type WithContext = { getContext: (id: string) => unknown };
const prototype = HTMLCanvasElement.prototype as unknown as WithContext;
let realGetContext: (id: string) => unknown;

beforeAll(() => {
  realGetContext = prototype.getContext;
  prototype.getContext = (): unknown => null;
});

afterAll(() => {
  prototype.getContext = realGetContext;
});

const sweeps: SenseSweep[] = [];

/** The origin is rebased near the anchor, the way a world at true scale keeps it. */
beforeEach(() => {
  setOrigin(HERE);
});

afterEach(() => {
  for (const s of sweeps) s.dispose();
  sweeps.length = 0;
  setOrigin(world(0, 0));
});

function sweepOver(plot: Plot, radius?: number): SenseSweep {
  const s = new SenseSweep({ objects: plot.source, radius });
  sweeps.push(s);
  return s;
}

describe('the anchor', () => {
  it('gathers around the point the ping was sent from, not around the camera', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100), twig(-200, 150)] });
    const sweep = sweepOver(plot);

    expect(sweep.ping(HERE)).toBe(true);
    // Only the cells the ANCHOR reaches were even asked about.
    expect(plot.asked).toEqual([cellKey(HOME_CELL)]);
    held(sweep);
    expect(filled(sweep)).toBe(2);
  });

  it('holds the light where it was sent while the camera flies away', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);
    // One animal beside the anchor and one beside the place the camera
    // is about to fly to, fifty metres out.
    const near = creature('worm-near', 'earthworm', world(HERE.wx + 200, HERE.wz));
    const far = creature('worm-far', 'earthworm', AWAY);

    sweep.ping(HERE);
    held(sweep, [near, far], lens());
    const first = fillAt(sweep, 0).clone();
    expect(sweep.cost.sighted).toBe(2);

    // The camera leaves. `update` takes no origin, so there is nothing
    // for it to re-anchor to: the same two things stay lit, the one out
    // at the camera never joins them, and the fills do not move.
    for (let f = 0; f < 5; f += 1) sweep.update([near, far], 1 / 60, lens(toLocal(AWAY)));
    expect(sweep.cost.sighted).toBe(2);
    expect(fillAt(sweep, 0).x).toBeCloseTo(first.x, 6);
    expect(fillAt(sweep, 0).z).toBeCloseTo(first.z, 6);
    // Nothing lit up where the camera went: every fill is still inside
    // the sweep's reach OF THE ANCHOR.
    const home = drawnAt(0);
    for (let i = 0; i < filled(sweep); i += 1) {
      const at = fillAt(sweep, i);
      expect(Math.hypot(at.x - home.lx, at.z - home.lz)).toBeLessThanOrEqual(SENSE_RADIUS);
    }
  });
});

describe('the two schedules', () => {
  it('walks the cells once at the ping and not again while the sweep lasts', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);

    sweep.ping(HERE);
    expect(plot.asked).toHaveLength(1);
    for (let f = 0; f < 60; f += 1) sweep.update([], 1 / 60, lens());
    expect(plot.asked).toHaveLength(1);
    expect(filled(sweep)).toBe(1);
  });

  it('re-reads the animals every frame, because they move', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);
    const worm = creature('worm', 'earthworm', world(HERE.wx + 200, HERE.wz));

    sweep.ping(HERE);
    held(sweep, [worm]);
    expect(sweep.cost.things).toBe(2);
    expect(sweep.cost.sighted).toBe(2);

    // It crawls out of reach — six metres is the whole sweep — and both
    // the candidate and the sighting go with it on the next frame, with
    // no second gather: an animal outside the radius is not offered at
    // all, where a twig outside it was never gathered.
    worm.at = world(HERE.wx + SENSE_RADIUS + 100, HERE.wz);
    sweep.update([worm], 1 / 60, lens());
    expect(sweep.cost.things).toBe(1);
    expect(sweep.cost.sighted).toBe(1);
    expect(plot.asked).toHaveLength(1);

    // And back again: the animals are a fact of the frame, not of the ping.
    worm.at = world(HERE.wx + 200, HERE.wz);
    sweep.update([worm], 1 / 60, lens());
    expect(sweep.cost.things).toBe(2);
    expect(sweep.cost.sighted).toBe(2);
  });

  it('fills an animal at the cited body length and names it', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [] });
    const sweep = sweepOver(plot);
    const worm = creature('worm', 'earthworm', world(HERE.wx + 100, HERE.wz));

    sweep.ping(HERE);
    held(sweep, [worm]);
    expect(sweep.cost.sighted).toBe(1);
    expect(filled(sweep)).toBe(1);
    expect(named(sweep)).toBe(1);
    // The whole chain in one number: the species table's 150 mm through
    // `candidates`, the selection and the fill's own posture. Nothing on
    // the way may decide an animal is a different size.
    const span = unitsOfMm(EARTHWORM.lengthMm) * FILL_SWELL;
    expect(fillScale(sweep, 0).x).toBeCloseTo((span * FILL_SHAPE.creature.girth) / 2, 4);
    expect(fillScale(sweep, 0).y).toBeCloseTo((span * FILL_SHAPE.creature.rise) / 2, 4);
  });
});

describe('a refused ping', () => {
  it('changes nothing: no gather, no new anchor, nothing dropped', () => {
    const plot = plotOf({
      [cellKey(HOME_CELL)]: [twig(100)],
      // The cell the second ping would reach, full of things it must not find.
      [cellKey({ cx: 1031, cz: -3 })]: [{ wx: AWAY.wx, wz: AWAY.wz }, { wx: AWAY.wx + 50, wz: AWAY.wz }],
    });
    const sweep = sweepOver(plot);

    expect(sweep.ping(HERE)).toBe(true);
    sweep.update([], SWEEP_SECONDS / 2, lens());
    const asked = plot.asked.length;
    const before = fillAt(sweep, 0).clone();

    // Mid-sweep: refused, and the refusal is the whole of what happens.
    expect(sweep.ready).toBe(false);
    expect(sweep.ping(AWAY)).toBe(false);
    expect(plot.asked).toHaveLength(asked);
    held(sweep);
    expect(filled(sweep)).toBe(1);
    expect(fillAt(sweep, 0).x).toBeCloseTo(before.x, 6);

    // Still refused through the fade and the cooldown.
    sweep.update([], LIT_SECONDS, lens());
    expect(sweep.lit).toBe(false);
    expect(sweep.ready).toBe(false);
    expect(sweep.cost.readyIn).toBeGreaterThan(0);
    expect(sweep.ping(HERE)).toBe(false);
    expect(plot.asked).toHaveLength(asked);
  });

  it('accepts the next ping once the antennae have recovered, and gathers again', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);

    sweep.ping(HERE);
    sweep.update([], CYCLE_SECONDS, lens());
    expect(sweep.ready).toBe(true);
    expect(sweep.cost.readyIn).toBe(0);
    expect(sweep.ping(HERE)).toBe(true);
    expect(plot.asked).toHaveLength(2);
  });
});

describe('what the sweep can and cannot see', () => {
  it('skips a cell the streamer has not reached rather than inventing one', () => {
    // Hard against the eastern edge of its cell, so the sweep's six
    // metres cross into the next one.
    const edge = world(1000 * CELL_SPAN + CELL_SPAN - 50, -3 * CELL_SPAN + CELL_SPAN / 2);
    const mine: readonly Site[] = [{ wx: edge.wx - 100, wz: edge.wz }];
    const next: readonly Site[] = [{ wx: edge.wx + 150, wz: edge.wz }];
    const here = cellKey({ cx: 1000, cz: -3 });
    const beyond = cellKey({ cx: 1001, cz: -3 });

    const thin = plotOf({ [here]: mine });
    const unloaded = sweepOver(thin);
    unloaded.ping(edge);
    held(unloaded);
    // The far cell WAS asked about and answered null; nothing came back
    // from it, and nothing was made up in its place.
    expect(thin.asked).toContain(beyond);
    expect(unloaded.cost.things).toBe(1);
    expect(filled(unloaded)).toBe(1);

    // The same sweep over a world whose streamer HAS reached it: the
    // second twig is plainly inside the radius, so it is the population
    // that was missing and not the reach.
    const full = plotOf({ [here]: mine, [beyond]: next });
    const loaded = sweepOver(full);
    loaded.ping(edge);
    held(loaded);
    expect(loaded.cost.things).toBe(2);
    expect(filled(loaded)).toBe(2);
  });

  it('lights nothing before the front has reached it', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100), twig(500)] });
    const sweep = sweepOver(plot);
    sweep.ping(HERE);

    // An eighth of a second: the front is 75 units out and the nearer
    // twig is at 100. Both are gathered; neither is lit.
    sweep.update([], 0.1, lens());
    expect(sweep.lit).toBe(true);
    expect(sweep.cost.things).toBe(2);
    expect(sweep.cost.sighted).toBe(0);
    expect(filled(sweep)).toBe(0);
    expect(named(sweep)).toBe(0);

    // The front passes the near one.
    sweep.update([], 0.1, lens());
    expect(sweep.cost.sighted).toBe(1);
    expect(fillAt(sweep, 0).x).toBeCloseTo(drawnAt(100).lx, 4);

    // And then the far one.
    sweep.update([], 0.5, lens());
    expect(sweep.cost.sighted).toBe(2);
  });
});

describe('the light going out', () => {
  it('empties both renderers on the frame it dies, and costs nothing after it', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100), twig(-150, 80)] });
    const sweep = sweepOver(plot);
    const worm = creature('worm', 'earthworm', world(HERE.wx + 200, HERE.wz));

    sweep.ping(HERE);
    held(sweep, [worm]);
    expect(filled(sweep)).toBe(3);
    expect(named(sweep)).toBe(3);

    // Past the fade. The pulse says it is over; the renderers only know
    // what they were last handed, so this is the frame that has to tell
    // them — or the forest stays lit for ever.
    sweep.update([worm], LIT_SECONDS, lens());
    expect(sweep.lit).toBe(false);
    expect(filled(sweep)).toBe(0);
    expect(named(sweep)).toBe(0);
    expect(sweep.cost.fills).toBe(0);
    expect(sweep.cost.labels).toBe(0);
    expect(sweep.cost.sighted).toBe(0);
    // What was gathered is let go of with it.
    expect(sweep.cost.things).toBe(0);

    // Every dark frame after that is the early out: nothing drawn,
    // nothing asked of the world.
    const asked = plot.asked.length;
    for (let f = 0; f < 30; f += 1) sweep.update([worm], 1 / 60, lens());
    expect(filled(sweep)).toBe(0);
    expect(named(sweep)).toBe(0);
    expect(plot.asked).toHaveLength(asked);
  });

  it('reset puts the light out at once, with no camera in the call', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);

    sweep.ping(HERE);
    held(sweep);
    expect(filled(sweep)).toBe(1);

    sweep.reset();
    expect(filled(sweep)).toBe(0);
    expect(named(sweep)).toBe(0);
    expect(sweep.lit).toBe(false);
    expect(sweep.ready).toBe(true);
    expect(sweep.cost.things).toBe(0);
    expect(sweep.cost.gatherMs).toBe(0);

    // And it is ready to be sent again immediately: a reset is a
    // teardown, not a cooldown.
    expect(sweep.ping(HERE)).toBe(true);
    held(sweep);
    expect(filled(sweep)).toBe(1);
  });
});

describe('the cost line', () => {
  it('reports the pulse phase, the recovery, the candidates and each renderer count', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);
    const worm = creature('worm', 'earthworm', world(HERE.wx + 150, HERE.wz));

    expect(sweep.cost.phase).toBe('ready');
    expect(sweep.cost.ready).toBe(true);
    expect(sweep.cost.readyIn).toBe(0);
    expect(sweep.cost.things).toBe(0);

    sweep.ping(HERE);
    // Wall clock: it may be under a microsecond on a fast box, so what
    // is pinned is that it is a real measurement of a walk that happened.
    expect(Number.isFinite(sweep.cost.gatherMs)).toBe(true);
    expect(sweep.cost.gatherMs).toBeGreaterThanOrEqual(0);

    sweep.update([worm], SWEEP_SECONDS / 2, lens());
    expect(sweep.cost.phase).toBe('sweep');
    expect(sweep.cost.things).toBe(2);

    held(sweep, [worm]);
    expect(sweep.cost.phase).toBe('hold');
    expect(sweep.cost.sighted).toBe(2);
    expect(sweep.cost.fills).toBe(filled(sweep));
    expect(sweep.cost.labels).toBe(named(sweep));
    expect(sweep.cost.ready).toBe(false);
    expect(sweep.cost.readyIn).toBeGreaterThan(0);

    sweep.update([worm], LIT_SECONDS, lens());
    expect(sweep.cost.phase).toBe('cooldown');
  });

  it('is the pulse the sweep was built with: a shorter reach is a shorter reach', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100), twig(400)] });
    const sweep = sweepOver(plot, 200);

    sweep.ping(HERE);
    held(sweep);
    // The 400 is outside a two-metre sweep and was never even gathered.
    expect(sweep.cost.things).toBe(1);
    expect(sweep.cost.sighted).toBe(1);
  });
});

describe('teardown', () => {
  it('dispose lets go of the fills, the labels and their textures, and is idempotent', () => {
    const plot = plotOf({ [cellKey(HOME_CELL)]: [twig(100)] });
    const sweep = sweepOver(plot);
    sweep.ping(HERE);
    held(sweep);
    expect(filled(sweep)).toBe(1);

    let freed = 0;
    const count = (): void => { freed += 1; };
    const fills = mesh(sweep);
    fills.geometry.addEventListener('dispose', count);
    (fills.material as THREE.Material).addEventListener('dispose', count);
    const sprites = labelsGroup(sweep).children as THREE.Sprite[];
    const plate = sprites[0].material.map;
    expect(plate).not.toBeNull();
    plate!.addEventListener('dispose', count);
    for (const sprite of sprites) sprite.material.addEventListener('dispose', count);

    sweep.dispose();
    // The fills' geometry and material, one plate, and a material per
    // label slot.
    expect(freed).toBe(3 + LABEL_CAP);
    expect(sweep.group.children).toHaveLength(0);

    // And nothing after it: a second dispose frees nothing twice, a ping
    // is refused, and a frame draws nothing.
    sweep.dispose();
    expect(freed).toBe(3 + LABEL_CAP);
    expect(sweep.ping(HERE)).toBe(false);
    sweep.update([], 1 / 60, lens());
    expect(sweep.cost.sighted).toBe(0);
    expect(sweep.lit).toBe(false);
  });
});

describe('the local-point rule', () => {
  it('reads no world coordinate at all: the anchor is passed on, never taken apart', () => {
    // The renderer directories' standing rule
    // (`tests/viewBoundary.test.ts` holds view/, terrain/, flora/, sky/
    // and fauna/ to it). The sweep holds a world point for ten seconds
    // and hands it to three modules; the moment it starts subtracting
    // one itself, the seam the two point types exist to keep shut is
    // open again.
    // `fileURLToPath(import.meta.url)` and not `new URL('..', …)`: under
    // jsdom the global `URL` is jsdom's, and node's own parser is the one
    // that can read it (`tests/senseLabels.test.ts` says the same).
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const text = readFileSync(path.join(root, 'src/sense/SenseSweep.ts'), 'utf8');
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).not.toMatch(/\.w[xz]\b/);
    expect(body).not.toMatch(/\.l[xz]\b/);
    // And it never keeps the selection's array, which is refilled under it.
    expect(body).not.toMatch(/this\.sightings\s*=/);
  });
});
