/**
 * The browser adapter — the ONLY file in persistence/ allowed to touch
 * `window`.
 *
 * `localStorage` can be absent or can throw on every call (Safari private
 * mode, a hardened embed, a full quota), and a game must still boot. So a
 * failing store degrades to memory for the rest of the session: settings
 * work until reload rather than nothing working at all.
 */
import { memoryKeyValueStore, type KeyValueStore } from './store';

export function localStorageKeyValueStore(): KeyValueStore {
  const memory = memoryKeyValueStore();
  let backing: Storage | null;
  try {
    backing = typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    backing = null;
  }
  if (!backing) return memory;
  const storage = backing;
  return {
    get(key) {
      try {
        return storage.getItem(key);
      } catch {
        return memory.get(key);
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    remove(key) {
      try {
        storage.removeItem(key);
      } catch {
        memory.remove(key);
      }
    },
  };
}
