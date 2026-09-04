/**
 * The persistence service scenes receive in `SceneContext`: one backing
 * store and a way to open typed documents on it. Owning the backing here
 * means a test can hand every scene an in-memory root and the scene never
 * knows the difference.
 */
import { defineStore, type KeyValueStore, type Store, type StoreSpec, type Versioned } from './store';

export interface StorageRoot {
  readonly kv: KeyValueStore;
  open<T extends Versioned>(spec: StoreSpec<T>): Store<T>;
}

export function createStorageRoot(kv: KeyValueStore): StorageRoot {
  return {
    kv,
    open: (spec) => defineStore(spec, kv),
  };
}
