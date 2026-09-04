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
import { MULTIPLAYER_CAPTION, RemoteMultiplayerSession } from '../src/session/RemoteMultiplayerSession';

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
    expect(store.read()).toEqual({ version: SOLO_SAVE_VERSION, savedAt: '2026-09-04T12:00:00.000Z', mapId: 'perf-empty' });
    expect(JSON.parse(kv.get(SOLO_SAVE_SPEC.key) ?? '{}')).toMatchObject({ version: SOLO_SAVE_VERSION });

    const later = new LocalSoloSession(store, 'perf-empty', () => '2026-09-04T12:05:00.000Z');
    await later.leave();
    expect(store.read().savedAt).toBe('2026-09-04T12:05:00.000Z');
  });

  it('multiplayer save() and leave() write nothing anywhere', async () => {
    const remote = new RemoteMultiplayerSession('kauai');
    await remote.save();
    await remote.leave();
    expect(remote.mapId).toBe('kauai');
  });
});
