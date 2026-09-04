/**
 * A stored document is untrusted input. These tests are mostly about
 * refusing things: bad JSON, the wrong version, values outside their
 * range — and about `read()` never throwing for any of them.
 */
import { describe, expect, it } from 'vitest';
import {
  boundedString, defineStore, finiteNumber, memoryKeyValueStore, type StoreSpec, type Versioned,
} from '../src/persistence/store';

interface Doc extends Versioned {
  readonly volume: number;
  readonly name: string;
}

const SPEC: StoreSpec<Doc> = {
  key: 'test.doc',
  version: 2,
  defaults: { version: 2, volume: 0.5, name: 'default' },
  sanitize(raw, defaults) {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    return {
      version: 2,
      volume: finiteNumber(r.volume, defaults.volume, 0, 1),
      name: boundedString(r.name, defaults.name, 8),
    };
  },
};

describe('defineStore', () => {
  it('returns sanitized defaults when nothing is stored', () => {
    const store = defineStore(SPEC, memoryKeyValueStore());
    expect(store.read()).toEqual({ version: 2, volume: 0.5, name: 'default' });
  });

  it('returns a fresh defaults object each read (callers may mutate)', () => {
    const store = defineStore(SPEC, memoryKeyValueStore());
    expect(store.read()).not.toBe(store.read());
    expect(store.read()).not.toBe(SPEC.defaults);
  });

  it('round-trips a written document and stamps the version', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SPEC, kv);
    store.write({ version: 99, volume: 0.8, name: 'ant' });
    expect(JSON.parse(kv.get('test.doc') ?? '').version).toBe(2);
    expect(store.read()).toEqual({ version: 2, volume: 0.8, name: 'ant' });
  });

  it('never throws on malformed JSON, non-objects or arrays', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SPEC, kv);
    for (const bad of ['{not json', '42', 'null', '"text"', '[1,2,3]', '']) {
      kv.set('test.doc', bad);
      expect(store.read()).toEqual(SPEC.defaults);
    }
  });

  it('refuses a document from another version', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SPEC, kv);
    kv.set('test.doc', JSON.stringify({ version: 1, volume: 0.9, name: 'old' }));
    expect(store.read()).toEqual(SPEC.defaults);
    kv.set('test.doc', JSON.stringify({ volume: 0.9, name: 'unversioned' }));
    expect(store.read()).toEqual(SPEC.defaults);
  });

  it('sanitizes field by field: clamps numbers, drops non-finite, bounds strings, ignores unknown keys', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SPEC, kv);
    kv.set('test.doc', JSON.stringify({ version: 2, volume: 7, name: 'far-too-long-a-name', extra: true }));
    expect(store.read()).toEqual({ version: 2, volume: 1, name: 'default' });
    kv.set('test.doc', JSON.stringify({ version: 2, volume: -3, name: 'ok' }));
    expect(store.read()).toEqual({ version: 2, volume: 0, name: 'ok' });
    kv.set('test.doc', JSON.stringify({ version: 2, volume: 'loud', name: 5 }));
    expect(store.read()).toEqual({ version: 2, volume: 0.5, name: 'default' });
  });

  it('survives a backing store that throws', () => {
    const store = defineStore(SPEC, {
      get: () => {
        throw new Error('quota');
      },
      set: () => {},
      remove: () => {},
    });
    expect(store.read()).toEqual(SPEC.defaults);
  });

  it('clear() removes the document', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SPEC, kv);
    store.write({ version: 2, volume: 0.1, name: 'x' });
    store.clear();
    expect(kv.get('test.doc')).toBeNull();
    expect(store.read()).toEqual(SPEC.defaults);
  });
});
