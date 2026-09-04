/**
 * Versioned, defensively-read documents over any key/value backing.
 *
 * PURE: no window, no localStorage. The browser adapter lives in
 * `localStorageStore.ts`; tests use an in-memory map.
 *
 * Every document carries its own `version` field, the way v0's SoloSave
 * carried `saveVersion`: a document exported as text stays
 * self-describing, and a reader can refuse one it does not understand
 * instead of guessing. `write()` stamps the version; `read()` NEVER
 * throws — missing, malformed and wrong-version documents all come back
 * as sanitized defaults, because a settings file that has been meddled
 * with should cost a bad camera angle, not a boot failure.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Versioned {
  readonly version: number;
}

export interface StoreSpec<T extends Versioned> {
  readonly key: string;
  readonly version: number;
  readonly defaults: T;
  /**
   * Turn untrusted parsed JSON into a valid T: known keys only, every
   * number finite and clamped. Must build a fresh value — it is also what
   * `read()` returns for the defaults, and callers may mutate the result.
   */
  readonly sanitize: (raw: unknown, defaults: T) => T;
}

export interface Store<T extends Versioned> {
  readonly key: string;
  readonly version: number;
  read(): T;
  write(value: T): void;
  clear(): void;
}

export function defineStore<T extends Versioned>(spec: StoreSpec<T>, kv: KeyValueStore): Store<T> {
  const fallback = (): T => spec.sanitize(spec.defaults, spec.defaults);
  return {
    key: spec.key,
    version: spec.version,
    read(): T {
      let text: string | null;
      try {
        text = kv.get(spec.key);
      } catch {
        return fallback();
      }
      if (text === null) return fallback();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fallback();
      }
      if (!isRecord(parsed) || parsed.version !== spec.version) return fallback();
      try {
        return spec.sanitize(parsed, spec.defaults);
      } catch {
        return fallback();
      }
    },
    write(value: T): void {
      kv.set(spec.key, JSON.stringify({ ...value, version: spec.version }));
    },
    clear(): void {
      kv.remove(spec.key);
    },
  };
}

/** An in-memory backing: tests, and the browser fallback when storage is unavailable. */
export function memoryKeyValueStore(): KeyValueStore {
  const held = new Map<string, string>();
  return {
    get: (key) => held.get(key) ?? null,
    set: (key, value) => {
      held.set(key, value);
    },
    remove: (key) => {
      held.delete(key);
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sanitize helpers shared by every document. */
export function finiteNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function boundedString(value: unknown, fallback: string, maxLength = 256): string {
  return typeof value === 'string' && value.length <= maxLength ? value : fallback;
}
