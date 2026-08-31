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
 *
 * THE DISCOVERY MASK IS TESTED FROM THE OTHER END. It is the one field
 * whose loss is survivable — fog is knowledge, and knowledge can be
 * walked back into — so the question asked of it is never "is it
 * refused" on its own but "is it refused WITHOUT taking her position
 * with it". A blob big enough to fill a phone's localStorage must cost
 * the player a dark map and nothing else.
 */
import { readFileSync } from 'node:fs';
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

/** A mask in `discovery.ts`'s shape: tag, grid size, base64url runs. */
const MASK = 'd1:384:gLAB_-xyz09';

/**
 * The longest blob the encoder can honestly make, spelled out here so
 * the ceiling in `save.ts` is pinned by something independent of it.
 *
 * 384 x 384 cells, one byte each in the raw fallback, base64url'd at
 * four characters per three bytes, behind a `d1r:384:` header.
 */
const BIGGEST = `d1r:384:${'A'.repeat(Math.ceil((384 * 384 * 4) / 3))}`;

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

  it('carries the fog she has lifted out as text and back', () => {
    // THE SAME GUARD AS ABOVE, and it is the one that matters for a new
    // field: `toEqual` catches a field that `writeSave` emits and
    // `readSave` never names, which is silent — the save looks written,
    // reloads clean, and the island is black again.
    const s = store();
    const save = writeSave(
      s, { ...SNAP, discovery: MASK }, 's_one', '2026-08-23T10:00:00.000Z',
    );
    expect(save.discovery).toBe(MASK);
    const carried = importSave(exportSave(save))!;
    expect(carried).toEqual(save);
    expect(carried.discovery).toBe(MASK);
    expect(latestSave(s)!.discovery).toBe(MASK);
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

describe('the fog', () => {
  it('is simply absent in a save written before the map existed', () => {
    // `good()` is the pre-map document, unchanged. It must still open,
    // and it must open as an unexplored island rather than as an error:
    // this is the save on Joshua's phone.
    const back = readSave(good())!;
    expect(back).not.toBeNull();
    expect(back.discovery).toBeUndefined();
    expect(back.at.wx).toBe(1_000);
  });

  it('survives at the largest size the encoder can produce', () => {
    // The raw fallback for a fully-alternating mask. Bigger than any
    // real one and still a legitimate document, so the bound has to sit
    // above it rather than at some round number that felt safe.
    const back = readSave({ ...good(), discovery: BIGGEST })!;
    expect(back.discovery).toBe(BIGGEST);
  });

  it('is dropped when it is longer than any mask could be', () => {
    // AND THE RUN IS UNHARMED. A blob that would not fit the store is
    // exactly the case where refusing the whole save would be worst:
    // she would lose her position to protect her map.
    const over = BIGGEST + 'A'.repeat(64);
    const back = readSave({ ...good(), discovery: over })!;
    expect(back).not.toBeNull();
    expect(back.discovery).toBeUndefined();
    expect(back.at.wx).toBe(1_000);
    expect(back.at.wz).toBe(2_000);
    expect(back.meters.thirst).toBe(0.5);
    expect(back.elapsed).toBe(100);
  });

  it('is dropped when it is not a string at all, at the same cost', () => {
    for (const junk of [42, true, null, {}, ['d1:384:AA'], { cells: [1, 0] }]) {
      const back = readSave({ ...good(), discovery: junk })!;
      expect(back).not.toBeNull();
      expect(back.discovery).toBeUndefined();
      expect(back.at.wx).toBe(1_000);
    }
  });

  it('is dropped when it is a string of the wrong shape', () => {
    // save.ts does not decode the mask, so shape is all the suspicion
    // it can afford — enough to keep a JSON fragment, a path or
    // anything with whitespace in it out of the field.
    for (const junk of ['', 'hello', '{"cells":[1,0]}', 'd1:384:', 'd1 384 AA',
      '../../etc/passwd', 'd1:384:AA==']) {
      const back = readSave({ ...good(), discovery: junk })!;
      expect(back).not.toBeNull();
      expect(back.discovery).toBeUndefined();
    }
  });
});

describe('the version number', () => {
  it('is still 1, and moving it would throw away every save there is', () => {
    // PINNED ON PURPOSE. `readSave` refuses a version it does not know,
    // by design, so a bump is not a migration — it is a decision that
    // every colony currently on a phone stops existing. Adding an
    // OPTIONAL field is not that decision: an old document is still
    // fully understood, it just says nothing about the fog. If this
    // line has to change, the reason belongs beside it.
    expect(SAVE_VERSION).toBe(1);
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

/**
 * ONE COLONY, ONE SLOT, HOWEVER MANY SITTINGS.
 *
 * `IslandScene.slot` was `readonly` and minted fresh per scene, and
 * `resume()` never adopted the id it had just loaded — so every
 * CONTINUE wrote a SECOND slot for the same colony. Since only the five
 * newest survive (pinned above), five sittings with one colony filled
 * every slot with it and evicted the others; and because CONTINUE
 * always offers the newest, nothing on screen would ever have said so.
 */
describe('resuming a colony does not eat the other slots', () => {
  it('writes back to the id it loaded, so a second colony survives', () => {
    const s = store();
    writeSave(s, SNAP, 'lihue', '2026-08-31T00:00:00.000Z');
    writeSave(s, SNAP, 'napali', '2026-08-31T00:01:00.000Z');
    // Four more sittings with the newest colony — one over the limit,
    // which is where the old behaviour lost Nāpali.
    for (let i = 0; i < 4; i++) {
      const found = latestSave(s);
      expect(found).not.toBeNull();
      writeSave(s, SNAP, found!.saveId, `2026-08-31T01:0${i}:00.000Z`);
    }
    expect(listSaves(s).map((save) => save.saveId).sort()).toEqual(['lihue', 'napali']);
  });

  it('and minting a new id every sitting is what would have lost it', () => {
    // The old behaviour, written out, so the test above is visibly
    // about something rather than passing by construction.
    const s = store();
    writeSave(s, SNAP, 'lihue', '2026-08-31T00:00:00.000Z');
    writeSave(s, SNAP, 'napali', '2026-08-31T00:01:00.000Z');
    for (let i = 0; i < 4; i++) {
      writeSave(s, SNAP, `fresh-${i}`, `2026-08-31T01:0${i}:00.000Z`);
    }
    expect(listSaves(s).map((save) => save.saveId)).not.toContain('lihue');
  });

  it('and the scene adopts that id when it resumes', () => {
    // The rule lives in a class that needs a WebGL context, so it is
    // read off the source, the same way the map's architecture is held.
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).toContain('this.slot = save.saveId;');
    // And the field must not go back to being readonly, or the line
    // above cannot compile and someone will "fix" it by deleting it.
    expect(scene).not.toContain('private readonly slot');
  });
});
