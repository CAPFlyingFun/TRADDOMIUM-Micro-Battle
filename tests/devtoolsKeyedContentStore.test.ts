/**
 * KeyedContentStore: the overlay wins over baked and persists; export and
 * import round-trip; anything malformed is refused whole and leaves the
 * overlay untouched; a meddled persisted entry is dropped on read while
 * its neighbours survive.
 */
import { describe, expect, it } from 'vitest';
import { createKeyedContentStore, type KeyedContentSpec } from '../src/devtools/KeyedContentStore';
import { finiteNumber, isRecord, memoryKeyValueStore } from '../src/persistence/store';

interface Caste {
  readonly name: string;
  readonly hp: number;
}

/** Clamps hp (a number a little out of range is a tuning slip), throws on a missing or mistyped field. */
function sanitizeCaste(raw: unknown): Caste {
  if (!isRecord(raw)) throw new Error('caste must be an object');
  if (typeof raw.name !== 'string' || raw.name === '') throw new Error('name must be a non-empty string');
  if (typeof raw.hp !== 'number' || !Number.isFinite(raw.hp)) throw new Error('hp must be a finite number');
  return { name: raw.name, hp: finiteNumber(raw.hp, 1, 1, 1000) };
}

const BAKED: Readonly<Record<string, Caste>> = {
  worker: { name: 'Worker', hp: 10 },
  soldier: { name: 'Soldier', hp: 30 },
};

const SPEC: KeyedContentSpec<Caste> = { key: 'castes', version: 3, baked: BAKED, sanitize: sanitizeCaste };

describe('KeyedContentStore', () => {
  it('reads baked when nothing is overridden, and throws on an unknown id', () => {
    const store = createKeyedContentStore(SPEC, memoryKeyValueStore());
    expect(store.ids()).toEqual(['soldier', 'worker']);
    expect(store.get('worker')).toEqual({ name: 'Worker', hp: 10 });
    expect(store.has('worker')).toBe(true);
    expect(store.has('queen')).toBe(false);
    expect(store.isOverridden('worker')).toBe(false);
    expect(() => store.get('queen')).toThrow(/No "castes" content with id "queen" \(known: soldier, worker\)/);
    expect(store.overrides()).toEqual({});
  });

  it('overlay wins over baked, and persists to a second store on the same backing', () => {
    const kv = memoryKeyValueStore();
    const store = createKeyedContentStore(SPEC, kv);
    store.set('worker', { name: 'Worker', hp: 12 });
    expect(store.get('worker')).toEqual({ name: 'Worker', hp: 12 });
    expect(store.get('soldier')).toEqual(BAKED.soldier);
    expect(store.isOverridden('worker')).toBe(true);
    expect(store.isOverridden('soldier')).toBe(false);

    const again = createKeyedContentStore(SPEC, kv);
    expect(again.get('worker')).toEqual({ name: 'Worker', hp: 12 });
    expect(again.overrides()).toEqual({ worker: { name: 'Worker', hp: 12 } });
  });

  it('the overlay may add ids baked does not have', () => {
    const store = createKeyedContentStore(SPEC, memoryKeyValueStore());
    store.set('queen', { name: 'Queen', hp: 200 });
    expect(store.ids()).toEqual(['queen', 'soldier', 'worker']);
    expect(store.get('queen')).toEqual({ name: 'Queen', hp: 200 });
    store.reset('queen');
    expect(store.has('queen')).toBe(false);
  });

  it('set() sanitizes: clamps what can be clamped, refuses what cannot, and changes nothing when refusing', () => {
    const kv = memoryKeyValueStore();
    const store = createKeyedContentStore(SPEC, kv);
    store.set('worker', { name: 'Worker', hp: 5000 });
    expect(store.get('worker').hp).toBe(1000);
    expect(() => store.set('worker', { name: '', hp: 5 })).toThrow(/name must be a non-empty string/);
    expect(() => store.set('  ', { name: 'Spaced', hp: 5 })).toThrow(/Content id/);
    expect(store.get('worker').hp).toBe(1000);
    expect(createKeyedContentStore(SPEC, kv).get('worker').hp).toBe(1000);
  });

  it('reset() returns an id to baked; resetAll() clears the stored document', () => {
    const kv = memoryKeyValueStore();
    const store = createKeyedContentStore(SPEC, kv);
    store.set('worker', { name: 'Worker', hp: 12 });
    store.set('soldier', { name: 'Soldier', hp: 40 });
    store.reset('worker');
    expect(store.get('worker')).toEqual(BAKED.worker);
    expect(store.isOverridden('soldier')).toBe(true);
    store.reset('never-held');
    store.resetAll();
    expect(store.overrides()).toEqual({});
    expect(kv.get('castes')).toBeNull();
  });

  it('exports the overlay as a self-describing document and imports it back into a fresh store', () => {
    const source = createKeyedContentStore(SPEC, memoryKeyValueStore());
    source.set('worker', { name: 'Worker', hp: 12 });
    source.set('queen', { name: 'Queen', hp: 200 });

    const text = source.exportJson();
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      version: 3,
      key: 'castes',
      entries: { worker: { name: 'Worker', hp: 12 }, queen: { name: 'Queen', hp: 200 } },
    });

    const kv = memoryKeyValueStore();
    const target = createKeyedContentStore(SPEC, kv);
    target.set('soldier', { name: 'Soldier', hp: 99 });
    expect(target.importJson(text)).toBe(2);
    expect(target.overrides()).toEqual(source.overrides());
    // Import REPLACES the overlay: the earlier soldier override is gone, not merged under.
    expect(target.get('soldier')).toEqual(BAKED.soldier);
    expect(createKeyedContentStore(SPEC, kv).overrides()).toEqual(source.overrides());
    expect(createKeyedContentStore(SPEC, kv).exportJson()).toBe(text);
  });

  it('refuses a malformed import whole and leaves the overlay untouched', () => {
    const kv = memoryKeyValueStore();
    const store = createKeyedContentStore(SPEC, kv);
    store.set('worker', { name: 'Worker', hp: 12 });
    const before = store.overrides();
    const stored = kv.get('castes');

    const rejected: [string, RegExp][] = [
      ['{not json', /not valid JSON/],
      ['[1,2,3]', /not a JSON object/],
      ['null', /not a JSON object/],
      [JSON.stringify({ version: 3, key: 'spawns', entries: {} }), /holds "spawns" content; this store holds "castes"/],
      [JSON.stringify({ version: 2, key: 'castes', entries: {} }), /document version 2, this build reads version 3/],
      [JSON.stringify({ version: 3, key: 'castes', entries: [] }), /"entries" is not an object/],
      [JSON.stringify({ version: 3, key: 'castes' }), /"entries" is not an object/],
      [
        JSON.stringify({ version: 3, key: 'castes', entries: { soldier: { name: 'Soldier', hp: 40 }, bad: { hp: 1 } } }),
        /entry "bad": name must be a non-empty string/,
      ],
      [JSON.stringify({ version: 3, key: 'castes', entries: { '': { name: 'Nameless', hp: 1 } } }), /entry "": Content id/],
    ];
    for (const [text, reason] of rejected) {
      expect(() => store.importJson(text)).toThrow(reason);
      expect(store.overrides()).toEqual(before);
      expect(kv.get('castes')).toBe(stored);
    }
  });

  it('an import cannot write through a __proto__ key', () => {
    const store = createKeyedContentStore(SPEC, memoryKeyValueStore());
    store.importJson('{"version":3,"key":"castes","entries":{"__proto__":{"name":"Proto","hp":1}}}');
    expect(store.has('__proto__')).toBe(true);
    expect(store.get('__proto__')).toEqual({ name: 'Proto', hp: 1 });
    expect(({} as Record<string, unknown>).name).toBeUndefined();
    expect(Object.keys(store.overrides())).toEqual(['__proto__']);
  });

  it('drops a meddled persisted entry on read and keeps its neighbours', () => {
    const kv = memoryKeyValueStore();
    kv.set(
      'castes',
      JSON.stringify({
        version: 3,
        key: 'castes',
        entries: { worker: { name: 'Worker', hp: 'lots' }, soldier: { name: 'Soldier', hp: 45 }, '': { name: 'X', hp: 1 } },
      }),
    );
    const store = createKeyedContentStore(SPEC, kv);
    expect(store.get('worker')).toEqual(BAKED.worker);
    expect(store.get('soldier')).toEqual({ name: 'Soldier', hp: 45 });
    expect(store.ids()).toEqual(['soldier', 'worker']);
  });

  it('ignores a persisted overlay from another version', () => {
    const kv = memoryKeyValueStore();
    kv.set('castes', JSON.stringify({ version: 2, key: 'castes', entries: { worker: { name: 'Worker', hp: 99 } } }));
    expect(createKeyedContentStore(SPEC, kv).overrides()).toEqual({});
  });
});
