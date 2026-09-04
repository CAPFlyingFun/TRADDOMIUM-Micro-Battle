/**
 * Three solo save slots: three independent documents, slot 1 on Phase 1's
 * key so no device loses its game to the feature, one corrupt slot costing
 * only itself, and the two verbs that open one — `resume`, which must keep
 * the save, and `newSoloGame`, which must throw it away.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import {
  LocalSoloSession, newSoloGame, resumeSoloSlot, restorableStateOf, savedSoloGame, toolSoloSlot,
} from '../src/session/LocalSoloSession';
import { SOLO_SAVE_KEY } from '../src/session/SoloSave';
import {
  SOLO_SLOTS, SOLO_SLOT_COUNT, clearSoloSlot, firstEmptySoloSlot, isSoloSlot, newestSoloSlot, occupiedSoloSlots,
  readSoloSlots, soloSlotKey, soloSlotSpec, type SoloSlot,
} from '../src/session/SoloSlots';
import { world } from '../src/world/coords';

const MAP = 'perf-empty';
const knowsPerf = (id: string): boolean => id === MAP;
const at = (iso: string) => (): string => iso;
const pose = (wx: number) => ({ at: world(wx, 0), height: 12, yaw: 0.5, pitch: -0.1 });

/** Write a game into one slot, as a session on that slot would. */
async function put(kv: ReturnType<typeof memoryKeyValueStore>, slot: SoloSlot, iso: string, wx = 0): Promise<void> {
  const store = defineStore(soloSlotSpec(slot, knowsPerf), kv);
  await new LocalSoloSession(store, MAP, at(iso)).save({ camera: pose(wx) });
}

describe('slot identity', () => {
  it('has three slots, and slot 1 keeps the single-save key so an existing game becomes slot 1', () => {
    expect(SOLO_SLOTS).toEqual([1, 2, 3]);
    expect(SOLO_SLOT_COUNT).toBe(3);
    expect(soloSlotKey(1)).toBe(SOLO_SAVE_KEY);
    expect(soloSlotKey(2)).toBe(`${SOLO_SAVE_KEY}.2`);
    expect(soloSlotKey(3)).toBe(`${SOLO_SAVE_KEY}.3`);
    expect(new Set(SOLO_SLOTS.map(soloSlotKey)).size).toBe(SOLO_SLOT_COUNT);
  });

  it('guards a slot number that came from a screen', () => {
    expect(isSoloSlot(1)).toBe(true);
    expect(isSoloSlot(3)).toBe(true);
    expect(isSoloSlot(0)).toBe(false);
    expect(isSoloSlot(4)).toBe(false);
    expect(isSoloSlot(Number.NaN)).toBe(false);
    expect(isSoloSlot(1.5)).toBe(false);
  });

  it('a Phase 1 device with one save reads it as slot 1, with 2 and 3 empty', async () => {
    const kv = memoryKeyValueStore();
    // Exactly what Phase 1 wrote: the one document at SOLO_SAVE_KEY.
    await new LocalSoloSession(defineStore(soloSlotSpec(1, knowsPerf), kv), MAP, at('2026-09-04T12:00:00.000Z'))
      .save({ camera: pose(7) });
    expect(kv.get(SOLO_SAVE_KEY)).not.toBeNull();

    const slots = readSoloSlots(kv, knowsPerf);
    expect(slots.map((s) => s.savedAt)).toEqual(['2026-09-04T12:00:00.000Z', null, null]);
    expect(resumeSoloSlot(kv, knowsPerf, 1)?.session.load()?.camera).toEqual(pose(7));
  });
});

describe('reading the slots', () => {
  it('reads three empty slots on a fresh device', () => {
    const kv = memoryKeyValueStore();
    const slots = readSoloSlots(kv, knowsPerf);
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3]);
    expect(slots.every((s) => s.savedAt === null && s.mapId === '')).toBe(true);
    expect(occupiedSoloSlots(slots)).toEqual([]);
    expect(newestSoloSlot(slots)).toBeNull();
    expect(savedSoloGame(kv, knowsPerf)).toBeNull();
    expect(firstEmptySoloSlot(slots)?.slot).toBe(1);
  });

  it('keeps the three games apart: writing one leaves the others exactly as they were', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, '2026-09-01T10:00:00.000Z', 11);
    await put(kv, 2, '2026-09-02T10:00:00.000Z', 22);
    await put(kv, 3, '2026-09-03T10:00:00.000Z', 33);
    for (const slot of SOLO_SLOTS) {
      expect(resumeSoloSlot(kv, knowsPerf, slot)?.session.load()?.camera).toEqual(pose(slot * 11));
    }
    await put(kv, 2, '2026-09-04T10:00:00.000Z', 99);
    expect(resumeSoloSlot(kv, knowsPerf, 1)?.session.load()?.camera).toEqual(pose(11));
    expect(resumeSoloSlot(kv, knowsPerf, 2)?.session.load()?.camera).toEqual(pose(99));
    expect(resumeSoloSlot(kv, knowsPerf, 3)?.session.load()?.camera).toEqual(pose(33));
  });

  it('one corrupt slot costs that slot only', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, '2026-09-01T10:00:00.000Z', 11);
    await put(kv, 3, '2026-09-03T10:00:00.000Z', 33);
    kv.set(soloSlotKey(2), '{not json at all');

    const slots = readSoloSlots(kv, knowsPerf);
    expect(slots.map((s) => s.savedAt !== null)).toEqual([true, false, true]);
    expect(resumeSoloSlot(kv, knowsPerf, 2)).toBeNull();
    expect(resumeSoloSlot(kv, knowsPerf, 3)?.savedAt).toBe('2026-09-03T10:00:00.000Z');
  });

  it('a slot on a map this build does not have reads as empty, never as a game that cannot be opened', async () => {
    const kv = memoryKeyValueStore();
    await new LocalSoloSession(defineStore(soloSlotSpec(2, () => true), kv), 'atlantis', at('2026-09-02T10:00:00.000Z'))
      .save({ camera: pose(5) });
    expect(readSoloSlots(kv, knowsPerf)[1]?.savedAt).toBeNull();
    expect(resumeSoloSlot(kv, knowsPerf, 2)).toBeNull();
    // The same bytes are a game again in a build that has the map.
    expect(resumeSoloSlot(kv, (id) => id === 'atlantis', 2)?.mapId).toBe('atlantis');
  });
});

describe('newestSoloSlot — what RESUME names', () => {
  it('is the most recently stamped occupied slot', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, '2026-09-01T10:00:00.000Z');
    await put(kv, 3, '2026-09-03T10:00:00.000Z');
    expect(newestSoloSlot(readSoloSlots(kv, knowsPerf))?.slot).toBe(3);
    expect(savedSoloGame(kv, knowsPerf)?.slot).toBe(3);

    await put(kv, 2, '2026-09-05T10:00:00.000Z');
    expect(savedSoloGame(kv, knowsPerf)?.slot).toBe(2);
    expect(savedSoloGame(kv, knowsPerf)?.savedAt).toBe('2026-09-05T10:00:00.000Z');
  });

  it('a stamp that does not parse is still a game, but never wins "newest"', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, 'some-time-last-tuesday');
    expect(readSoloSlots(kv, knowsPerf)[0]?.savedAt).toBe('some-time-last-tuesday');
    // The only game there is, so it is the one RESUME offers.
    expect(savedSoloGame(kv, knowsPerf)?.slot).toBe(1);

    await put(kv, 2, '2026-09-02T10:00:00.000Z');
    expect(savedSoloGame(kv, knowsPerf)?.slot).toBe(2);
  });
});

describe('newSoloGame — the only function that throws a game away', () => {
  it('clears the slot it opens, so the world has nothing to restore', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 2, '2026-09-02T10:00:00.000Z', 42);
    expect(restorableStateOf(resumeSoloSlot(kv, knowsPerf, 2)?.session ?? null)).toEqual({ camera: pose(42) });

    const fresh = newSoloGame(kv, knowsPerf, 2, MAP, at('2026-09-06T10:00:00.000Z'));
    expect(fresh.load()).toBeNull();
    expect(restorableStateOf(fresh)).toBeNull();
    expect(readSoloSlots(kv, knowsPerf)[1]?.savedAt).toBeNull();

    // And it is a real session: its first save fills the slot again.
    await fresh.save({ camera: pose(1) });
    expect(readSoloSlots(kv, knowsPerf)[1]?.savedAt).toBe('2026-09-06T10:00:00.000Z');
  });

  it('touches no other slot', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, '2026-09-01T10:00:00.000Z', 11);
    await put(kv, 3, '2026-09-03T10:00:00.000Z', 33);
    newSoloGame(kv, knowsPerf, 2, MAP);
    expect(readSoloSlots(kv, knowsPerf).map((s) => s.savedAt !== null)).toEqual([true, false, true]);
    expect(resumeSoloSlot(kv, knowsPerf, 1)?.session.load()?.camera).toEqual(pose(11));
  });

  it('resume keeps the save; only clearSoloSlot and newSoloGame remove one', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 1, '2026-09-01T10:00:00.000Z', 11);
    expect(resumeSoloSlot(kv, knowsPerf, 1)?.session.load()?.camera).toEqual(pose(11));
    expect(readSoloSlots(kv, knowsPerf)[0]?.savedAt).toBe('2026-09-01T10:00:00.000Z');
    clearSoloSlot(kv, 1);
    expect(readSoloSlots(kv, knowsPerf)[0]?.savedAt).toBeNull();
  });
});

describe('toolSoloSlot — which slot a dev tool opens', () => {
  it('continues the game already on that map rather than forking a second one', async () => {
    const kv = memoryKeyValueStore();
    await put(kv, 2, '2026-09-02T10:00:00.000Z');
    expect(toolSoloSlot(kv, knowsPerf, MAP)).toBe(2);
  });

  it('takes an empty slot when no game is on that map, so it replaces nothing', () => {
    const kv = memoryKeyValueStore();
    expect(toolSoloSlot(kv, knowsPerf, MAP)).toBe(1);
  });

  it('with every slot full of games on other maps, falls back to the newest', async () => {
    const kv = memoryKeyValueStore();
    const other = (id: string): boolean => id === 'atlantis' || id === MAP;
    for (const [slot, iso] of [[1, '2026-09-01'], [2, '2026-09-05'], [3, '2026-09-03']] as const) {
      await new LocalSoloSession(defineStore(soloSlotSpec(slot, other), kv), 'atlantis', at(`${iso}T10:00:00.000Z`))
        .save({ camera: pose(slot) });
    }
    expect(toolSoloSlot(kv, other, MAP)).toBe(2);
  });
});
