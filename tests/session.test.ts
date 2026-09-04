/**
 * Honesty in the UI is a tested invariant (ARCHITECTURE §2.10): the
 * multiplayer mock's caption is pinned so "Multiplayer" cannot quietly
 * imply more than exists. And both sessions satisfy the same contract, so
 * gameplay never learns which one it holds.
 */
import { describe, expect, it } from 'vitest';
import type { MessageHandler, Transport, TransportState } from '../src/net';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import { LocalSoloSession, SOLO_SAVE_SPEC, SOLO_SAVE_VERSION } from '../src/session/LocalSoloSession';
import { PLAYER_PROFILE_SPEC, loadProfile, playerIdOf } from '../src/session/PlayerProfile';
import {
  MULTIPLAYER_CAPTION, RELAY_CLOSED_CAPTION, RELAY_CONNECTED_CAPTION, RELAY_CONNECTING_CAPTION,
  RemoteMultiplayerSession,
} from '../src/session/RemoteMultiplayerSession';
import { DEFAULT_CAMERA_POSE } from '../src/session/SoloSave';
import { world } from '../src/world/coords';

/**
 * A transport whose state the test sets by hand: the session's caption
 * must follow what the LINK reports and nothing else, so the test says
 * what the link reports.
 */
class StubTransport implements Transport {
  state: TransportState = 'closed';
  connects = 0;
  disconnects = 0;
  sent: unknown[] = [];

  async connect(): Promise<void> {
    this.connects += 1;
    this.state = 'open';
  }

  disconnect(): void {
    this.disconnects += 1;
    this.state = 'closed';
  }

  send(msg: unknown): void {
    this.sent.push(msg);
  }

  onMessage(_cb: MessageHandler): () => void {
    return () => {};
  }

  onClose(_cb: () => void): () => void {
    return () => {};
  }
}

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

  it('keeps the pinned caption while no relay is configured, whatever the transport could say', async () => {
    const remote = new RemoteMultiplayerSession('kauai');
    expect(remote.transport).toBeNull();
    expect(remote.caption).toBe('Online play is not built yet.');
    // Connecting a session with nowhere to connect to changes nothing and says nothing new.
    await expect(remote.connect()).resolves.toBeUndefined();
    expect(remote.caption).toBe('Online play is not built yet.');
  });

  it('speaks of the relay only when there is one, and only as the transport reports it', async () => {
    const link = new StubTransport();
    const remote = new RemoteMultiplayerSession('kauai', {
      relayUrl: 'wss://relay.example/room', createTransport: () => link,
    });
    expect(remote.caption).toBe(RELAY_CLOSED_CAPTION);
    link.state = 'connecting';
    expect(remote.caption).toBe(RELAY_CONNECTING_CAPTION);
    await remote.connect();
    expect(link.connects).toBe(1);
    expect(remote.caption).toBe(RELAY_CONNECTED_CAPTION);
    // None of the relay captions may be the pinned one: that line means
    // "there is no online play here", and here there is a link.
    for (const caption of [RELAY_CLOSED_CAPTION, RELAY_CONNECTING_CAPTION, RELAY_CONNECTED_CAPTION]) {
      expect(caption).not.toBe(MULTIPLAYER_CAPTION);
    }
    // A relay changes nothing about who owns the world.
    expect(remote).toMatchObject({ mode: 'multiplayer', canPauseWorld: false, authority: 'server' });
    await remote.leave();
    expect(link.disconnects).toBe(1);
    expect(remote.caption).toBe(RELAY_CLOSED_CAPTION);
  });

  it('refuses a relay address that is not a socket URL rather than hiding the typo behind the mock', () => {
    expect(() => new RemoteMultiplayerSession('kauai', { relayUrl: 'https://relay.example' })).toThrow(/relay URL/);
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
