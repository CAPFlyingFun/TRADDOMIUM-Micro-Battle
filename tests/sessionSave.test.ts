/**
 * Save and continue through the session seam: a solo save round-trips
 * the camera in WORLD coordinates; the menu's CONTINUE is offered only
 * for a save this build can open (known version, known map, finite
 * numbers); and what a session can restore is asked of the seam, so the
 * multiplayer mock honestly answers "nothing". The solo caption is pinned
 * because it is the one line that promises where progress goes.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import {
  LocalSoloSession, SOLO_SAVE_SPEC, hasSoloSave, restorableStateOf, savedSoloGame, soloSaveSpec,
} from '../src/session/LocalSoloSession';
import { RemoteMultiplayerSession } from '../src/session/RemoteMultiplayerSession';
import { DEFAULT_CAMERA_POSE, SOLO_SAVE_KEY, SOLO_SAVE_VERSION } from '../src/session/SoloSave';
import { world } from '../src/world/coords';

const pose = { at: world(1_250, -980), height: 40, yaw: 0.6, pitch: -0.25 };
const knowsPerf = (id: string): boolean => id === 'perf-empty';
const at = (iso: string) => (): string => iso;

describe('solo caption', () => {
  it('says where progress goes, and nothing the build cannot keep', () => {
    const solo = new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore()), 'perf-empty');
    expect(solo.caption).toContain('Progress is saved on this device');
    expect(solo.caption).toContain('Pausing stops the world');
    expect(solo.caption).not.toMatch(/online|cloud|sync/i);
  });
});

describe('save → hasSoloSave → load', () => {
  it('round-trips the camera pose in world coordinates', async () => {
    const kv = memoryKeyValueStore();
    const session = new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'perf-empty', at('2026-09-04T12:00:00.000Z'));
    expect(hasSoloSave(kv)).toBe(false);
    expect(session.load()).toBeNull();

    await session.save({ camera: pose });
    expect(hasSoloSave(kv)).toBe(true);
    expect(session.load()).toEqual({ version: SOLO_SAVE_VERSION, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty', camera: pose });
    // A second session on the same store — the next visit — reads the same pose back.
    expect(new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'perf-empty').load()?.camera).toEqual(pose);
  });

  it('sanitize refuses non-finite numbers: the pose on disk reads as the default, not as NaN', async () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({
      version: SOLO_SAVE_VERSION, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty',
      camera: { at: { wx: 'NaN', wz: null }, height: Infinity, yaw: 'east', pitch: [] },
    }));
    const session = new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'perf-empty');
    expect(session.load()?.camera).toEqual(DEFAULT_CAMERA_POSE);
    for (const n of Object.values(session.load()?.camera.at ?? {})) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('savedSoloGame — what CONTINUE offers', () => {
  it('is null on an empty store and agrees with hasSoloSave', () => {
    const kv = memoryKeyValueStore();
    expect(savedSoloGame(kv, knowsPerf)).toBeNull();
    expect(hasSoloSave(kv, soloSaveSpec(knowsPerf))).toBe(false);
  });

  it('after a save, offers a session on the save\'s own map whose load() yields the pose', async () => {
    const kv = memoryKeyValueStore();
    await new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'perf-empty', at('2026-09-04T12:00:00.000Z')).save({ camera: pose });

    const saved = savedSoloGame(kv, knowsPerf, at('2026-09-04T13:00:00.000Z'));
    expect(saved).not.toBeNull();
    expect(saved?.mapId).toBe('perf-empty');
    expect(saved?.savedAt).toBe('2026-09-04T12:00:00.000Z');
    expect(saved?.session.mapId).toBe('perf-empty');
    expect(saved?.session.mode).toBe('solo');
    expect(saved?.session.load()?.camera).toEqual(pose);
    expect(hasSoloSave(kv, soloSaveSpec(knowsPerf))).toBe(true);

    // The offered session writes back to the same slot, with its own clock.
    await saved?.session.leave();
    expect(savedSoloGame(kv, knowsPerf)?.savedAt).toBe('2026-09-04T13:00:00.000Z');
  });

  it('refuses a save on a map this build does not have: PLAY alone, never a CONTINUE into nothing', async () => {
    const kv = memoryKeyValueStore();
    await new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'atlantis').save({ camera: pose });
    expect(hasSoloSave(kv)).toBe(true);
    expect(savedSoloGame(kv, knowsPerf)).toBeNull();
    expect(hasSoloSave(kv, soloSaveSpec(knowsPerf))).toBe(false);
    // The same bytes are a game again in a build that has the map.
    expect(savedSoloGame(kv, (id) => id === 'atlantis')?.mapId).toBe('atlantis');
  });

  it('refuses a save from another version rather than guessing at it', () => {
    const kv = memoryKeyValueStore();
    kv.set(SOLO_SAVE_KEY, JSON.stringify({ version: 1, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty' }));
    expect(savedSoloGame(kv, knowsPerf)).toBeNull();
  });
});

describe('restorableStateOf — asked of the seam', () => {
  it('is the saved camera for a solo session with a save on its map', async () => {
    const store = defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore());
    const session = new LocalSoloSession(store, 'perf-empty');
    expect(restorableStateOf(session)).toBeNull();
    await session.save({ camera: pose });
    expect(restorableStateOf(session)).toEqual({ camera: pose });
    // The save names another map: nothing to restore here.
    expect(restorableStateOf(new LocalSoloSession(store, 'kauai'))).toBeNull();
  });

  it('is null for no session and for the multiplayer mock, which holds nothing', () => {
    expect(restorableStateOf(null)).toBeNull();
    expect(restorableStateOf(new RemoteMultiplayerSession('perf-empty'))).toBeNull();
  });
});
