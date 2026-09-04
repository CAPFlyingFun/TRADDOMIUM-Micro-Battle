/**
 * The ten registries of ARCHITECTURE §7, as empty typed shells: the right
 * kinds, nothing registered, nothing wired, and — until
 * `tests/simulationCore.test.ts` lands — a source-text check that
 * `src/data` imports nothing from three, the DOM, storage or the network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ABILITIES, BIOMES, CASTE_STATS, CASTES, DAMAGE_TYPES, DATA_REGISTRIES, GROWTH_STAGES, ITEMS,
  RESOURCES, SPECIES, SPECIES_STATS, VEGETATION, WATER_TYPES,
  type AbilityEntry, type CasteEntry, type CasteStat, type ItemEntry, type WaterTypeEntry,
} from '../src/data/registries';
import { createRegistry } from '../src/data/schema';

const KINDS = [
  'species', 'castes', 'growthStages', 'abilities', 'items',
  'resources', 'biomes', 'vegetation', 'waterTypes', 'damageTypes',
] as const;

describe('the registries', () => {
  it('are the ten kinds the spec names, in its order, each exactly once', () => {
    expect(DATA_REGISTRIES.map((r) => r.kind)).toEqual([...KINDS]);
    expect(new Set(DATA_REGISTRIES).size).toBe(KINDS.length);
  });

  it('are reachable by name as well as by the list', () => {
    expect([SPECIES, CASTES, GROWTH_STAGES, ABILITIES, ITEMS, RESOURCES, BIOMES, VEGETATION, WATER_TYPES, DAMAGE_TYPES])
      .toEqual([...DATA_REGISTRIES]);
  });

  it('ship empty — Phase 0 is the pattern, not the content', () => {
    for (const registry of DATA_REGISTRIES) {
      expect(registry.list(), registry.kind).toEqual([]);
      expect(registry.wired, registry.kind).toEqual([]);
    }
  });

  it('declare no stat vocabulary yet, because no live system consumes one', () => {
    expect(SPECIES_STATS).toEqual([]);
    expect(CASTE_STATS).toEqual([]);
    for (const registry of DATA_REGISTRIES) expect(registry.stats, registry.kind).toEqual([]);
  });
});

describe('the entry shapes', () => {
  it('accept a well-formed caste, ability, item and water type', () => {
    // Fresh registries rather than the singletons, so the "ship empty"
    // test above cannot depend on the order these run in.
    const castes = createRegistry<CasteStat, CasteEntry>('castes', CASTE_STATS);
    const abilities = createRegistry<never, AbilityEntry>('abilities', []);
    const items = createRegistry<never, ItemEntry>('items', []);
    const water = createRegistry<never, WaterTypeEntry>('waterTypes', []);
    castes.register({ id: 'worker', name: 'Worker', speciesId: 'fire-ant', lifeStates: ['adult'], abilities: ['dig'], stats: {} });
    abilities.register({ id: 'dig', name: 'Dig', built: false, stats: {} });
    items.register({ id: 'seed', name: 'Seed', massMg: 2, stats: {} });
    water.register({ id: 'sea', name: 'Sea', saline: true, stats: {} });
    expect(castes.get('worker').lifeStates).toEqual(['adult']);
    expect(abilities.get('dig').built).toBe(false);
    expect(items.get('seed').massMg).toBe(2);
    expect(water.get('sea').saline).toBe(true);
  });

  it('refuse a growth curve on a kind that does not grow — where a number belongs, with teeth', () => {
    const items = createRegistry<never, ItemEntry>('items', []);
    expect(() => items.register({ id: 'seed', name: 'Seed', massMg: 2, stats: { mass: { curve: [1, 1, 1, 1, 1] } } }))
      .toThrow(/items "seed": stats not in the items vocabulary: mass/);
  });

  it('hold a caste to its declared life states even while its vocabulary is empty', () => {
    const castes = createRegistry<CasteStat, CasteEntry>('castes', CASTE_STATS);
    castes.register({ id: 'queen', name: 'Queen', speciesId: 'fire-ant', lifeStates: ['alate', 'founding'], abilities: [], stats: {} });
    expect(castes.get('queen').lifeStates).toContain('founding');
  });
});

describe('the import boundary', () => {
  const dir = fileURLToPath(new URL('../src/data/', import.meta.url));
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  /** Comments are prose and may say "document"; only code is held to the boundary. */
  const codeOf = (file: string): string =>
    readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('covers the two modules', () => {
    expect(sources.sort()).toEqual(['registries.ts', 'schema.ts']);
  });

  it('imports nothing from three, the DOM, storage or the network', () => {
    for (const file of sources) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/from\s+['"]three/);
      expect(code, file).not.toMatch(/\b(document|window|localStorage|sessionStorage|indexedDB|navigator)\b/);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(/\bWebSocket\b/);
    }
  });

  it('imports only from within src/data', () => {
    for (const file of sources) {
      for (const match of codeOf(file).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/^\.\/(schema|registries)$/);
      }
    }
  });
});
