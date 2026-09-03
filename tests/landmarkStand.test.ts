/**
 * THE STAND'S TWO CADENCES.
 *
 * What is DRAWN and what is SOLID live in the same object and rebuild
 * on completely different schedules, because their reaches differ by
 * four orders of magnitude:
 *
 *   drawn   FAR_REACH   20,000 units, rebuilt when she leaves a
 *                       2,048-unit lattice cell.
 *   solid    SOLID_REACH  2,000 units — SMALLER THAN THE CELL.
 *
 * That last line is the whole file. A solid built where she entered a
 * cell runs out behind her before she leaves it, so riding the cell
 * would let her walk through every trunk in the far half of every cell
 * she crosses — which is what "it did clip a tree here and there" was
 * on the device. The solid therefore re-centres on HER, every
 * SOLID_STEP.
 *
 * No renderer here: an InstancedMesh needs no GL context to be built,
 * and nothing below draws anything.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadIsland } from './support/island';
import { geoToWorld } from '../src/world/geo';
import { decodeVeg, forgetVeg } from '../src/world/landcover';
import { PITCH, cellOf, landmarksNear } from '../src/world/landmarks';
import {
  LandmarkStand, SOLID_REACH, SOLID_STEP,
} from '../src/world/LandmarkStand';
import { world } from '../src/world/coords';
import { groundHeight } from '../src/world/heightfield';

const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });

function vegBytes(): ArrayBuffer {
  const buf = readFileSync('public/kauai-veg.bin');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Where the solid reaches, measured rather than read off a field. */
function solidIds(stand: LandmarkStand): string[] {
  return stand.trunks.all.map((t) => t.id).sort();
}

describe('the stand follows her at two speeds', () => {
  beforeAll(() => { loadIsland(); decodeVeg(vegBytes()); }, 120000);
  afterAll(() => { forgetVeg(); });

  it('the solid cannot ride the lattice cell, because it is smaller than one', () => {
    // Not a tuning preference — the arithmetic that makes the second
    // cadence necessary. If SOLID_REACH ever grows past the cell, this
    // whole mechanism can go.
    expect(SOLID_REACH).toBeLessThan(2_048);
    expect(SOLID_STEP).toBeLessThan(SOLID_REACH);
  });

  it('re-centres the solid on her without leaving the cell', () => {
    // Trees are a cell apart, so a named spot is as likely as not to
    // have none within reach. Start beside a real one, and start near
    // the LOW CORNER of its cell so a walk long enough to change the
    // set still does not leave the cell — which is the entire thing
    // being tested.
    const reach = (at: { wx: number; wz: number }): string[] => landmarksNear(at, SOLID_REACH)
      .filter((t) => Math.hypot(t.at.wx - at.wx, t.at.wz - at.wz) <= SOLID_REACH)
      .map((t) => t.id).sort();
    // Presence is 0.6 and the reach is nearly a whole cell, so plenty
    // of pairs inside one cell see exactly the same trees. Find one
    // that does not, rather than assuming the first is.
    let from = null as ReturnType<typeof world> | null;
    let on = null as ReturnType<typeof world> | null;
    for (const tree of landmarksNear(WAILUA, 30_000)) {
      const cell = cellOf(tree.at);
      const a = world(cell.cx * PITCH + 200, cell.cz * PITCH + 200);
      const b = world(a.wx + 1_500, a.wz + 1_500);
      if (cellOf(b).cx !== cell.cx || cellOf(b).cz !== cell.cz) continue;
      const seen = reach(a);
      if (seen.length > 0 && String(seen) !== String(reach(b))) { from = a; on = b; break; }
    }
    if (!from || !on) throw new Error('no two spots in one cell see different trees');

    const stand = new LandmarkStand(new THREE.Scene());
    stand.follow(from);
    const first = solidIds(stand);
    expect(first.length).toBeGreaterThan(0);

    stand.follow(on);
    const second = solidIds(stand);

    // Every trunk she can now reach is solid, and that is NOT the set
    // she started with — which is what riding the cell would have left
    // her holding.
    expect(second).toEqual(reach(on));
    expect(second).not.toEqual(first);
    stand.dispose();
  });

  it('leaves the solid alone for a step too small to matter', () => {
    const tree = landmarksNear(WAILUA, 30_000)[0];
    const from = world(tree.at.wx + 500, tree.at.wz);
    const stand = new LandmarkStand(new THREE.Scene());
    stand.follow(from);
    const before = solidIds(stand);
    expect(before.length).toBeGreaterThan(0);
    stand.follow(world(from.wx + SOLID_STEP / 2, from.wz));
    expect(solidIds(stand)).toEqual(before);
    stand.dispose();
  });

  it('whatever is nearest is solid, at every pace across a cell', () => {
    // The failure this is written against: she is halfway across a
    // cell and the tree in front of her was never put in the field, so
    // she walks through it. The walk stays INSIDE one cell throughout,
    // because a cell boundary would rebuild the stand and hide exactly
    // the bug being looked for.
    // Pick a cell where the walk actually GOES somewhere: the tree it
    // ends up nearest must be out of range from where it began, or the
    // first field would have covered the whole walk and the test would
    // pass however the stand behaves.
    const paces = 4;
    const end = (c: { cx: number; cz: number }) => world(
      c.cx * PITCH + 100 + SOLID_STEP * paces, c.cz * PITCH + 100 + SOLID_STEP * paces,
    );
    const start = landmarksNear(WAILUA, 30_000).map((t) => cellOf(t.at)).find((c) => {
      const a = world(c.cx * PITCH + 100, c.cz * PITCH + 100);
      const b = end(c);
      const near = landmarksNear(b, SOLID_REACH)
        .map((t) => ({ t, d: Math.hypot(t.at.wx - b.wx, t.at.wz - b.wz) }))
        .filter((x) => x.d <= SOLID_REACH)
        .sort((x, y) => x.d - y.d)[0];
      return near !== undefined
        && Math.hypot(near.t.at.wx - a.wx, near.t.at.wz - a.wz) > SOLID_REACH;
    });
    if (!start) throw new Error('no cell where a walk reaches a tree it did not start with');

    const stand = new LandmarkStand(new THREE.Scene());
    let at = world(start.cx * PITCH + 100, start.cz * PITCH + 100);
    stand.follow(at);
    let checked = 0;
    for (let i = 0; i < paces; i++) {
      at = world(at.wx + SOLID_STEP, at.wz + SOLID_STEP);
      const now = cellOf(at);
      expect({ cx: now.cx, cz: now.cz }).toEqual({ cx: start.cx, cz: start.cz });
      stand.follow(at);
      const nearest = landmarksNear(at, SOLID_REACH)
        .map((t) => ({ id: t.id, d: Math.hypot(t.at.wx - at.wx, t.at.wz - at.wz) }))
        .filter((t) => t.d <= SOLID_REACH)
        .sort((a, b) => a.d - b.d)[0];
      if (!nearest) continue;
      expect(solidIds(stand)).toContain(nearest.id);
      checked++;
    }
    // The walk has to have MET something, or it proved nothing.
    expect(checked).toBeGreaterThan(2);
    stand.dispose();
  });
});


describe('what she stands on is the flats, not the ring', () => {
  beforeAll(() => { loadIsland(); decodeVeg(vegBytes()); }, 120000);

  it('the stand hands the solid a SEAT profile thinner than its collision', () => {
    // Joshua: "ant is floating just about the tree trunk." The drawn
    // trunk is a polygon whose flats are tangent to the limb circle,
    // so a round profile through its CORNERS sits ringFactor proud of
    // the flat she is over — about a third of her own height on a real
    // trunk. She meets the corners and stands on the flats, and this
    // checks the STAND actually builds both rather than that the maths
    // could.
    const tree = landmarksNear(WAILUA, 30_000)[0];
    const stand = new LandmarkStand(new THREE.Scene());
    stand.follow(world(tree.at.wx + 300, tree.at.wz));
    const one = stand.trunks.all.find((t) => t.id === tree.id);
    expect(one).toBeDefined();
    expect(one!.seat).toBeDefined();
    for (let i = 0; i < one!.seat!.r.length; i++) {
      expect(one!.seat!.r[i]).toBeLessThan(one!.profile.r[i]);
    }
    stand.dispose();
  });

  it('so the depth she is seated by is shallower than the depth she collides by', () => {
    const tree = landmarksNear(WAILUA, 30_000)[0];
    const stand = new LandmarkStand(new THREE.Scene());
    stand.follow(world(tree.at.wx + 300, tree.at.wz));
    const y = groundHeight(tree.at.wx, tree.at.wz) + 100;
    // `depthAt` is the seat; `bump` is the collision. On the axis the
    // collision has to reach further out than the seat does.
    const seated = stand.trunks.depthAt(tree.at.wx, y, tree.at.wz);
    const hit = stand.trunks.bump(tree.at.wx, y, tree.at.wz, 0);
    expect(hit).not.toBeNull();
    expect(seated).toBeLessThan(hit!.depth);
    stand.dispose();
  });
});
