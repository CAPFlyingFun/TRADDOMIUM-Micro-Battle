/**
 * The one store every editor uses for authored content (ARCHITECTURE §8):
 * a stat editor, a spawn editor, an animation viewer's clip list — each
 * is baked defaults from the repo plus whatever someone changed on this
 * device, and each needs to get those changes out again. Beyond
 * Extinction had three hand-copied stores for exactly this, and they had
 * drifted from one another. This is the single implementation.
 *
 * Three layers, one rule:
 *
 *   baked     Readonly<Record<string, T>> from the repo. Never written.
 *   overlay   this device's changes, persisted as ONE versioned document
 *             through the persistence `KeyValueStore`. Wins over baked
 *             for any id it holds, and may hold ids baked does not (a
 *             spawn editor adds spawn points; it does not only edit them).
 *   export    the overlay as text, self-describing (`key` + `version`),
 *             so a phone's changes can travel to another device or into
 *             the repo as the next baked defaults.
 *
 * Export carries the OVERLAY, not the merged table, because the point of
 * exporting is to carry out what changed; the baked half is already in
 * the repo. Import REPLACES the overlay rather than merging into it, so
 * that what a file says is what the device holds afterwards, with no
 * ghosts from an earlier session underneath.
 *
 * `sanitize` is the caller's one validator, used with two policies at two
 * boundaries: on the READ of the persisted overlay an entry it throws on
 * is dropped (baked stands behind it, and a meddled document should cost
 * a stat, not a boot — the persistence module's rule); on IMPORT and on
 * `set` the throw surfaces as a rejection, because a person is there to
 * hear it and a silently half-imported file is worse than a refused one.
 * Every rejection leaves the overlay exactly as it was.
 *
 * Pure: nothing from three, the DOM or the network. Tests use an
 * in-memory `KeyValueStore`.
 */
import { defineStore, isRecord, type KeyValueStore, type Versioned } from '../persistence/store';

export interface KeyedContentSpec<T> {
  /** Storage key of the overlay document, and the export's identity — an import for a different key is refused. */
  readonly key: string;
  /** Bump when T's shape changes; an overlay from another version is ignored on read and refused on import. */
  readonly version: number;
  readonly baked: Readonly<Record<string, T>>;
  /**
   * Turn untrusted JSON into a valid T, or THROW with a reason a person
   * can act on. Clamp where a clamp is the right answer (a number a
   * little out of range); throw where it is not (a missing field, the
   * wrong type). Must return a fresh value: the store keeps what it gets.
   */
  readonly sanitize: (raw: unknown) => T;
}

export interface KeyedContentStore<T> {
  readonly key: string;
  readonly version: number;
  /** Every id in baked or overlay, sorted. */
  ids(): string[];
  has(id: string): boolean;
  /** The overlay's value if it has one, else baked's. Throws on an unknown id: a typo must never read as a default. */
  get(id: string): T;
  isOverridden(id: string): boolean;
  /** Sanitizes, then writes the overlay and persists it. Throws (and changes nothing) if `sanitize` does. */
  set(id: string, value: T): void;
  /** Drop the overlay entry, so `get(id)` reads baked again. A no-op for an id the overlay does not hold. */
  reset(id: string): void;
  resetAll(): void;
  /** A copy of the overlay. */
  overrides(): Readonly<Record<string, T>>;
  /** The overlay as a pretty-printed, self-describing JSON document. */
  exportJson(): string;
  /** Replaces the overlay with the document's entries and returns how many. Throws, changing nothing, on anything malformed. */
  importJson(text: string): number;
}

/** What is persisted and what is exported: the same document, so an export is readable by eye and by this store alike. */
interface OverlayDocument<T> extends Versioned {
  readonly key: string;
  readonly entries: Readonly<Record<string, T>>;
}

export function createKeyedContentStore<T>(spec: KeyedContentSpec<T>, kv: KeyValueStore): KeyedContentStore<T> {
  const doc = defineStore<OverlayDocument<T>>(
    {
      key: spec.key,
      version: spec.version,
      defaults: { version: spec.version, key: spec.key, entries: {} },
      sanitize: (raw) => ({ version: spec.version, key: spec.key, entries: readLeniently(raw, spec.sanitize) }),
    },
    kv,
  );

  // A Map rather than a plain object: an imported file may name any key,
  // and `{}['__proto__'] = value` is a prototype write, not an entry.
  const overlay = new Map<string, T>(Object.entries(doc.read().entries));

  const persist = (): void => {
    if (overlay.size === 0) doc.clear();
    else doc.write({ version: spec.version, key: spec.key, entries: Object.fromEntries(overlay) });
  };

  const isBaked = (id: string): boolean => Object.hasOwn(spec.baked, id);

  return {
    key: spec.key,
    version: spec.version,

    ids() {
      return [...new Set([...Object.keys(spec.baked), ...overlay.keys()])].sort();
    },

    has(id) {
      return overlay.has(id) || isBaked(id);
    },

    get(id) {
      const overridden = overlay.get(id);
      if (overridden !== undefined) return overridden;
      if (isBaked(id)) return spec.baked[id];
      throw new Error(`No "${spec.key}" content with id "${id}" (known: ${this.ids().join(', ') || 'none'})`);
    },

    isOverridden(id) {
      return overlay.has(id);
    },

    set(id, value) {
      requireId(id);
      overlay.set(id, spec.sanitize(value));
      persist();
    },

    reset(id) {
      if (!overlay.delete(id)) return;
      persist();
    },

    resetAll() {
      overlay.clear();
      persist();
    },

    overrides() {
      return Object.fromEntries(overlay);
    },

    exportJson() {
      const exported: OverlayDocument<T> = { version: spec.version, key: spec.key, entries: Object.fromEntries(overlay) };
      return `${JSON.stringify(exported, null, 2)}\n`;
    },

    importJson(text) {
      const entries = readStrictly(text, spec);
      overlay.clear();
      for (const [id, value] of entries) overlay.set(id, value);
      persist();
      return entries.length;
    },
  };
}

/** An id is any non-empty string without surrounding whitespace; the shape of the content decides the rest. */
function requireId(id: string): void {
  if (id === '' || id.trim() !== id) throw new Error(`Content id "${id}" must be non-empty with no surrounding whitespace`);
}

/** READ policy: keep every entry that sanitizes, drop the rest without a word. Baked stands behind anything dropped. */
function readLeniently<T>(raw: unknown, sanitize: (raw: unknown) => T): Readonly<Record<string, T>> {
  const kept = new Map<string, T>();
  if (!isRecord(raw) || !isRecord(raw.entries)) return {};
  for (const [id, value] of Object.entries(raw.entries)) {
    try {
      requireId(id);
      kept.set(id, sanitize(value));
    } catch {
      // Dropped: this device's copy of one entry is unreadable, and the baked value is still there.
    }
  }
  return Object.fromEntries(kept);
}

/** IMPORT policy: the whole document is right, or none of it is taken. Every message names what was wrong. */
function readStrictly<T>(text: string, spec: KeyedContentSpec<T>): [string, T][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Import rejected: not valid JSON (${message(error)})`);
  }
  if (!isRecord(parsed)) throw new Error('Import rejected: the document is not a JSON object');
  if (parsed.key !== spec.key) {
    throw new Error(`Import rejected: this file holds "${String(parsed.key)}" content; this store holds "${spec.key}"`);
  }
  if (parsed.version !== spec.version) {
    throw new Error(`Import rejected: document version ${String(parsed.version)}, this build reads version ${spec.version}`);
  }
  if (!isRecord(parsed.entries)) throw new Error('Import rejected: "entries" is not an object of id → content');
  const entries: [string, T][] = [];
  for (const [id, value] of Object.entries(parsed.entries)) {
    try {
      requireId(id);
      entries.push([id, spec.sanitize(value)]);
    } catch (error) {
      throw new Error(`Import rejected: entry "${id}": ${message(error)}`);
    }
  }
  return entries;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
