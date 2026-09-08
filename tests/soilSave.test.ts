import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore, type KeyValueStore } from '../src/persistence/store';
import { LocalSoloSession, restorableStateOf, soloSlotSpec } from '../src/session/LocalSoloSession';
import { SOLO_SAVE_KEY, SOLO_SAVE_VERSION, soloSaveSpec } from '../src/session/SoloSave';
import { world } from '../src/world/coords';
import type { SoilEditsSave } from '../src/world/soilTypes';

const knowsMap = (id: string): boolean => id === 'kauai';
const camera = { at: world(120, -340), height: 55, yaw: 0.4, pitch: -0.2 };
const edits: SoilEditsSave = { version: 1, strokes: [[1, 2, 3, 4, 2, 3, 0.5]] };

/** A fresh adapter over the same serialized bytes models closing and reopening the app. */
function jsonStorage(): { open(): KeyValueStore; raw(key: string): string | null } {
  const bytes = new Map<string, string>();
  return {
    open: () => ({
      get: (key) => bytes.get(key) ?? null,
      set: (key, value) => bytes.set(key, value),
      remove: (key) => bytes.delete(key),
    }),
    raw: (key) => bytes.get(key) ?? null,
  };
}

describe('solo soil persistence', () => {
  it('round-trips edits through JSON and restores them after a restart', async () => {
    const storage = jsonStorage();
    const first = new LocalSoloSession(defineStore(soloSaveSpec(knowsMap), storage.open()), 'kauai');
    await first.save({ camera, terrainEdits: edits });

    const restarted = new LocalSoloSession(defineStore(soloSaveSpec(knowsMap), storage.open()), 'kauai');
    expect(restorableStateOf(restarted)).toEqual({ camera, terrainEdits: edits });
    expect(JSON.parse(storage.raw(SOLO_SAVE_KEY) ?? '{}')).toEqual({
      version: SOLO_SAVE_VERSION,
      savedAt: expect.any(String),
      mapId: 'kauai',
      camera,
      terrainEdits: edits,
    });
  });

  it('keeps edits when omitted, retains them on leave, and clears them with an explicit empty snapshot', async () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(soloSaveSpec(knowsMap), kv);
    const session = new LocalSoloSession(store, 'kauai');
    await session.save({ camera, terrainEdits: edits });
    await session.save({ camera: { ...camera, height: 80 } });
    await session.leave();
    expect(store.read().terrainEdits).toEqual(edits);

    await session.save({ camera, terrainEdits: { version: 1, strokes: [] } });
    expect(store.read().terrainEdits).toEqual({ version: 1, strokes: [] });
  });

  it('loads an alpha.26 document without adding an undefined key', () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({
      version: 2, savedAt: '2026-09-08T00:00:00.000Z', mapId: 'kauai', camera,
    }));
    const save = defineStore(soloSaveSpec(knowsMap), kv).read();
    expect(save).toEqual({ version: 2, savedAt: '2026-09-08T00:00:00.000Z', mapId: 'kauai', camera });
    expect('terrainEdits' in save).toBe(false);
  });

  it('drops a malformed edit document while preserving valid camera data and stripping unknown keys', () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({
      version: 2, savedAt: '2026-09-08T00:00:00.000Z', mapId: 'kauai', camera,
      terrainEdits: { version: 1, strokes: [[1, 2, 3, 40, 2, 3, 0.5]] },
      secret: 'discard me',
    }));
    const save = defineStore(soloSaveSpec(knowsMap), kv).read();
    expect(save.camera).toEqual(camera);
    expect(save.terrainEdits).toBeUndefined();
    expect(save).not.toHaveProperty('secret');
  });

  it('keeps soil edits isolated between save slots', async () => {
    const kv = memoryKeyValueStore();
    const slot1 = new LocalSoloSession(defineStore(soloSlotSpec(1, knowsMap), kv), 'kauai');
    const slot2 = new LocalSoloSession(defineStore(soloSlotSpec(2, knowsMap), kv), 'kauai');
    await slot1.save({ camera, terrainEdits: edits });
    await slot2.save({ camera, terrainEdits: { version: 1, strokes: [] } });
    expect(slot1.load()?.terrainEdits).toEqual(edits);
    expect(slot2.load()?.terrainEdits).toEqual({ version: 1, strokes: [] });
  });
});
