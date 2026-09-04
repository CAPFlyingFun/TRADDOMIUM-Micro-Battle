import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import {
  DEFAULT_DISPLAY_NAME, MAX_DISPLAY_NAME, PLAYER_PROFILE_SPEC, loadProfile, setDisplayName,
} from '../src/session/PlayerProfile';

describe('PlayerProfile', () => {
  it('mints a device id once and keeps it', () => {
    const store = defineStore(PLAYER_PROFILE_SPEC, memoryKeyValueStore());
    let minted = 0;
    const uuid = (): string => `id-${++minted}`;
    const first = loadProfile(store, uuid);
    expect(first).toEqual({ version: 1, deviceId: 'id-1', displayName: DEFAULT_DISPLAY_NAME });
    const again = loadProfile(store, uuid);
    expect(again.deviceId).toBe('id-1');
    expect(minted).toBe(1);
  });

  it('uses the platform uuid by default', () => {
    const store = defineStore(PLAYER_PROFILE_SPEC, memoryKeyValueStore());
    expect(loadProfile(store).deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('trims, bounds and defaults the display name without touching the id', () => {
    const store = defineStore(PLAYER_PROFILE_SPEC, memoryKeyValueStore());
    loadProfile(store, () => 'dev');
    expect(setDisplayName(store, '  Queen  ').displayName).toBe('Queen');
    expect(setDisplayName(store, '   ').displayName).toBe(DEFAULT_DISPLAY_NAME);
    expect(setDisplayName(store, 'x'.repeat(MAX_DISPLAY_NAME + 1)).displayName).toBe(DEFAULT_DISPLAY_NAME);
    expect(store.read().deviceId).toBe('dev');
  });
});
