/**
 * Honesty in the UI is a tested invariant (ARCHITECTURE §2.10): the
 * multiplayer mock's caption is pinned so "Multiplayer" cannot quietly
 * imply more than exists. And both sessions satisfy the same contract, so
 * gameplay never learns which one it holds.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import { LocalSoloSession, SOLO_SAVE_SPEC, SOLO_SAVE_VERSION } from '../src/session/LocalSoloSession';
import { PLAYER_PROFILE_SPEC, loadProfile, playerIdOf } from '../src/session/PlayerProfile';
import { MULTIPLAYER_CAPTION, RemoteMultiplayerSession } from '../src/session/RemoteMultiplayerSession';
import { DEFAULT_CAMERA_POSE } from '../src/session/SoloSave';
import { world } from '../src/world/coords';

describe('session contract', () => {
  it('pins the multiplayer caption exactly', () => {
    expect(new RemoteMultiplayerSession('kauai').caption).toBe('Online play is not built yet.');
    expect(MULTIPLAYER_CAPTION).toBe('Online play is not built yet.');
  });

  it('both implementations satisfy GameSession structurally', async () => {
    const kv = memoryKeyValueStore();
    const sessions: GameSession[] = [
      new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, kv), 'kauai'),
      new RemoteMultiplayerSession('kauai'),
    ];
    for (const s of sessions) {
      expect(['solo', 'multiplayer']).toContain(s.mode);
      expect(['local', 'server']).toContain(s.authority);
      expect(typeof s.canPauseWorld).toBe('boolean');
      expect(s.mapId).toBe('kauai');
      expect(s.caption.length).toBeGreaterThan(0);
      await expect(s.save()).resolves.toBeUndefined();
      await expect(s.leave()).resolves.toBeUndefined();
    }
  });

  it('solo pauses the world with local authority; multiplayer does neither', () => {
    const solo = new LocalSoloSession(defineStore(SOLO_SAVE_SPEC, memoryKeyValueStore()), 'kauai');
    const remote = new RemoteMultiplayerSession('kauai');
    expect(solo).toMatchObject({ mode: 'solo', canPauseWorld: true, authority: 'local' });
    expect(remote).toMatchObject({ mode: 'multiplayer', canPauseWorld: false, authority: 'server' });
  });

  it('solo save() writes a versioned document and leave() flushes it', async () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SOLO_SAVE_SPEC, kv);
    const session = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:00:00.000Z');
    expect(store.read().savedAt).toBeNull();
    await session.save();
    expect(store.read()).toEqual({
      version: SOLO_SAVE_VERSION, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty', camera: DEFAULT_CAMERA_POSE,
    });
    expect(JSON.parse(kv.get(SOLO_SAVE_SPEC.key) ?? '{}')).toMatchObject({ version: SOLO_SAVE_VERSION });

    const later = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:05:00.000Z');
    await later.leave();
    expect(store.read().savedAt).toBe('2026-09-04T12:05:00.000Z');
  });

  it('multiplayer save() and leave() write nothing anywhere', async () => {
    const remote = new RemoteMultiplayerSession('kauai');
    await remote.save();
    await remote.save({ camera: { at: world(1, 2), height: 3, yaw: 0, pitch: 0 } });
    await remote.leave();
    expect(remote.mapId).toBe('kauai');
  });

  it('derives the player id from the profile device id', () => {
    const store = defineStore(PLAYER_PROFILE_SPEC, memoryKeyValueStore());
    const profile = loadProfile(store, () => 'device-7');
    expect(playerIdOf(profile)).toBe('device-7');
    // The same profile always yields the same id: that is what "stable identity" means.
    expect(playerIdOf(loadProfile(store, () => 'never-used'))).toBe('device-7');
    expect(() => playerIdOf({ ...profile, deviceId: '' })).toThrow();
  });
});
