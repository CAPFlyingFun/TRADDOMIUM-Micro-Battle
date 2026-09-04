/**
 * The solo save is read as untrusted input: known keys, finite clamped
 * numbers, wrong version refused, unknown map refused. And a
 * LocalSoloSession's save/load round-trips a camera pose in WORLD
 * coordinates.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import { LocalSoloSession } from '../src/session/LocalSoloSession';
import {
  DEFAULT_CAMERA_POSE, SOLO_SAVE_KEY, SOLO_SAVE_SPEC, SOLO_SAVE_VERSION, hasSoloSave, sanitizeCameraPose, soloSaveSpec,
} from '../src/session/SoloSave';
import { ISLAND_SPAN, world } from '../src/world/coords';

const pose = { at: world(831_250, -1_968_750), height: 120, yaw: 1.25, pitch: -0.4 };

describe('SoloSave document', () => {
  it('is version 2 and carries the camera', () => {
    expect(SOLO_SAVE_VERSION).toBe(2);
    expect(SOLO_SAVE_SPEC.defaults).toMatchObject({ version: 2, savedAt: null, mapId: '', camera: DEFAULT_CAMERA_POSE });
  });

  it('clamps every camera number to the island and reads garbage as the default pose', () => {
    expect(sanitizeCameraPose(pose, DEFAULT_CAMERA_POSE)).toEqual(pose);
    expect(sanitizeCameraPose({ at: { wx: 1e9, wz: -1e9 }, height: -5, yaw: 100, pitch: 9 }, DEFAULT_CAMERA_POSE)).toEqual({
      at: { wx: ISLAND_SPAN / 2, wz: -ISLAND_SPAN / 2 }, height: 0, yaw: Math.PI * 2, pitch: Math.PI / 2,
    });
    expect(sanitizeCameraPose({ at: { wx: 'far', wz: Number.NaN }, height: 'up' }, DEFAULT_CAMERA_POSE)).toEqual(DEFAULT_CAMERA_POSE);
    expect(sanitizeCameraPose(null, DEFAULT_CAMERA_POSE)).toEqual(DEFAULT_CAMERA_POSE);
  });

  it('refuses a version-1 save rather than guessing at it', () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({ version: 1, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty' }));
    expect(defineStore(SOLO_SAVE_SPEC, kv).read().savedAt).toBeNull();
    expect(hasSoloSave(kv)).toBe(false);
  });

  it('refuses a map this build does not know, through the caller-supplied predicate', () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({ version: 2, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'atlantis', camera: pose }));
    const known = soloSaveSpec((id) => id === 'perf-empty');
    expect(defineStore(known, kv).read()).toEqual({ version: 2, savedAt: null, mapId: '', camera: DEFAULT_CAMERA_POSE });
    expect(hasSoloSave(kv, known)).toBe(false);
    // The same bytes read fine by a build that knows the map.
    expect(defineStore(soloSaveSpec((id) => id === 'atlantis'), kv).read().camera).toEqual(pose);
    expect(hasSoloSave(kv, soloSaveSpec(() => true))).toBe(true);
  });

  it('hasSoloSave is false on an empty store and true after a save', async () => {
    const kv = memoryKeyValueStore();
    expect(hasSoloSave(kv)).toBe(false);
    await new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'perf-empty').save({ camera: pose });
    expect(hasSoloSave(kv)).toBe(true);
  });
});

describe('LocalSoloSession save/load', () => {
  it('round-trips the camera pose in world coordinates', async () => {
    const store = defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore());
    const session = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:00:00.000Z');
    expect(session.load()).toBeNull();
    await session.save({ camera: pose });
    expect(session.load()).toEqual({ version: 2, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty', camera: pose });
  });

  it('a flush without state keeps the pose already on disk', async () => {
    const store = defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore());
    const session = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:00:00.000Z');
    await session.save({ camera: pose });
    const later = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:05:00.000Z');
    await later.leave();
    expect(later.load()).toEqual({ version: 2, savedAt: '2026-09-04T12:05:00.000Z', mapId: 'perf-empty', camera: pose });
  });

  it('load() is null for a save from a different map', async () => {
    const store = defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore());
    await new LocalSoloSession(store, 'perf-empty').save({ camera: pose });
    expect(new LocalSoloSession(store, 'kauai').load()).toBeNull();
  });
});
