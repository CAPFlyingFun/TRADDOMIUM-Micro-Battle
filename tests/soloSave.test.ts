/**
 * A SAVE IS UNTRUSTED INPUT, and a stronger case of it than settings.
 *
 * A settings file that has been meddled with costs a bad camera angle.
 * A save that has been meddled with is a queen standing in the sea, or
 * a run that looks restored and is not — which is worse than no save
 * at all, because it is not obvious that anything went wrong.
 *
 * So the tests are mostly about refusing things, and the round trip is
 * stated in the terms that matter: the same place, to the centimetre.
 */
import { describe, expect, it } from 'vitest';
import {
  SAVE_VERSION, SLOTS, STORE, dropSave, exportSave, importSave, latestSave,
  listSaves, livedFor, readSave, writeSave, type Snapshot, type Store,
} from '../src/game/save';

function store(): Store & { raw(): string | null } {
  const held = new Map<string, string>();
  return {
    getItem: (k) => held.get(k) ?? null,
    setItem: (k, v) => { held.set(k, v); },
    raw: () => held.get(STORE) ?? null,
  };
}

const SNAP: Snapshot = {
  region: 'Līhuʻe',
  at: { wx: -412_345.67, wz: 238_901.23, heading: 1.234, agl: 1_280 },
  body: { stage: 1, winged: true },
  meters: { stamina: 0.62, thirst: 0.41 },
  elapsed: 903.5,
  playedSeconds: 4_210,
};

describe('the round trip', () => {
  it('puts her back where she was, to the centimetre', () => {
    const s = store();
    writeSave(s, SNAP, 's_one', '2026-08-23T10:00:00.000Z');
    const back = latestSave(s)!;
    expect(back.at.wx).toBe(SNAP.at.wx);
    expect(back.at.wz).toBe(SNAP.at.wz);
    expect(back.at.heading).toBeCloseTo(SNAP.at.heading, 9);
    expect(back.meters.thirst).toBeCloseTo(0.41, 9);
    expect(back.elapsed).toBeCloseTo(903.5, 6);
  });

  it('survives being written out as text and read back', () => {
    // THE PHONE-TO-DESKTOP PATH. Not built, but the format must not be
    // the thing that stops it: a save is a document, not a browser
    // record, so moving one later is a transport change.
    const s = store();
    const save = writeSave(s, SNAP, 's_one', '2026-08-23T10:00:00.000Z');
    const carried = importSave(exportSave(save))!;
    expect(carried).toEqual(save);
  });

  it('keeps the creation date when a slot is written again', () => {
    const s = store();
    writeSave(s, SNAP, 's_one', '2026-08-23T10:00:00.000Z');
    const again = writeSave(s, SNAP, 's_one', '2026-08-23T12:00:00.000Z');
    expect(again.createdAt).toBe('2026-08-23T10:00:00.000Z');
    expect(again.updatedAt).toBe('2026-08-23T12:00:00.000Z');
    expect(listSaves(s)).toHaveLength(1);
  });
});

describe('what it refuses', () => {
  it('a save from another version', () => {
    expect(readSave({ ...good(), saveVersion: SAVE_VERSION + 1 })).toBeNull();
    expect(readSave({ ...good(), saveVersion: SAVE_VERSION - 1 })).toBeNull();
  });

  it('a position that is not on this island', () => {
    // REFUSED, NOT CLAMPED. Dragging a wild coordinate to the nearest
    // coastline would silently invent a run somewhere she has never
    // been, and it would look like it worked.
    expect(readSave({ ...good(), at: { ...good().at, wx: 9e9 } })).toBeNull();
    expect(readSave({ ...good(), at: { ...good().at, wz: Number.NaN } })).toBeNull();
    expect(readSave({ ...good(), at: {} })).toBeNull();
  });

  it('a save with no identity', () => {
    expect(readSave({ ...good(), saveId: '' })).toBeNull();
    expect(readSave({ ...good(), saveId: 42 })).toBeNull();
  });

  it('rubbish of every shape', () => {
    for (const junk of [null, undefined, 7, 'save', [], {}]) {
      expect(readSave(junk)).toBeNull();
    }
  });

  it('and a store full of it, without taking the good ones with it', () => {
    const s = store();
    s.setItem(STORE, JSON.stringify([good(), { nonsense: true }, null, 5]));
    expect(listSaves(s)).toHaveLength(1);
  });

  it('and a store that is not even JSON', () => {
    const s = store();
    s.setItem(STORE, '{{{');
    expect(listSaves(s)).toEqual([]);
    expect(latestSave(s)).toBeNull();
  });
});

describe('what it repairs instead', () => {
  it('clamps a meter that has been edited past its ends', () => {
    // A thirst of 4 is a typo, not a different world — the run is
    // still hers and still where she left it, so it is mended.
    const back = readSave({ ...good(), meters: { stamina: 9, thirst: -3 } })!;
    expect(back.meters.stamina).toBe(1);
    expect(back.meters.thirst).toBe(0);
  });

  it('fills in a missing map and region rather than losing the run', () => {
    const back = readSave({ ...good(), mapId: undefined, region: undefined })!;
    expect(back.mapId).toBe('kauai');
    expect(back.region).toBe('Kauaʻi');
  });
});

describe('the slots', () => {
  it('offer the newest first and keep only so many', () => {
    const s = store();
    for (let i = 0; i < SLOTS + 3; i++) {
      writeSave(s, SNAP, `s_${i}`, `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`);
    }
    const kept = listSaves(s);
    expect(kept).toHaveLength(SLOTS);
    expect(kept[0].saveId).toBe(`s_${SLOTS + 2}`);
  });

  it('can be thrown away one at a time', () => {
    const s = store();
    writeSave(s, SNAP, 's_a', '2026-08-23T10:00:00.000Z');
    writeSave(s, SNAP, 's_b', '2026-08-23T11:00:00.000Z');
    dropSave(s, 's_b');
    expect(listSaves(s).map((x) => x.saveId)).toEqual(['s_a']);
  });

  it('and a write that the browser refuses does not end the run', () => {
    // A full or private-mode store throws. She keeps playing.
    const angry: Store = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
    };
    expect(() => writeSave(angry, SNAP, 's_one', 'now')).not.toThrow();
  });
});

describe('the slot label', () => {
  it('reads as time lived', () => {
    expect(livedFor(0)).toBe('0m');
    expect(livedFor(59)).toBe('0m');
    expect(livedFor(600)).toBe('10m');
    expect(livedFor(3_600)).toBe('1h 00m');
    expect(livedFor(8_040)).toBe('2h 14m');
  });
});

function good() {
  return {
    saveVersion: SAVE_VERSION,
    saveId: 's_one',
    mapId: 'kauai',
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:00:00.000Z',
    playedSeconds: 100,
    region: 'Līhuʻe',
    at: { wx: 1_000, wz: 2_000, heading: 0.5, agl: 0 },
    body: { stage: 1, winged: true },
    meters: { stamina: 0.5, thirst: 0.5 },
    elapsed: 100,
  };
}
