/**
 * THE LAB PROBE'S COPY OF THE APP'S NAMES AND NUMBERS.
 *
 * `scripts/probe-lab.mjs` drives the built game by the `data-action`
 * and `data-field` names the Creature Lab's overlay wears, and judges
 * "nothing teleported" against the species' own rates — and it is a
 * plain .mjs script that cannot import the TypeScript that owns any of
 * that. So it holds literals, and this pins them, the way
 * `tests/probeShotConstants.test.ts` pins the shot probe's save key:
 * a probe measuring a stale rate, or pressing a button by a name the
 * lab no longer answers to, would fail in a way that reads as the lab
 * being broken rather than the probe being wrong.
 *
 * Three kinds of pin. The APP's names (the hub's `tool:` prefix, the
 * menu's actions, the keys the thumbs use) and NUMBERS (body lengths,
 * climb and flee rates, the fall, the sim dt cap, the behaviour
 * vocabulary) are checked against their owning modules directly. The
 * LAB's own names — `lab:possess:<id>`, `lab-<creature>` and the rest —
 * are checked against the lab's source text when `src/lab/` is in the
 * tree, and skipped by name when it is not: the probe and the lab were
 * written in parallel against one written contract, and this is the
 * check that they met.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION } from '../src/app/actions';
import { SIM_DT_CAP } from '../src/app/FrameClock';
import { KEYS } from '../src/control/PlayerDemand';
import { DROP_MM_S } from '../src/creatures/demand';
import { CREATURE_SPECIES, type CreatureId } from '../src/creatures/species';
import { BEHAVIOURS } from '../src/creatures/state';
import { toolAction } from '../src/devtools/DevTool';

const ROOT = process.cwd();
const PROBE = path.join(ROOT, 'scripts', 'probe-lab.mjs');
const LAB_DIR = path.join(ROOT, 'src', 'lab');
const source = readFileSync(PROBE, 'utf8');

/** The five the lab holds, in the brief's order. */
const LAB_CREATURES: CreatureId[] = ['queen', 'worker', 'earthworm', 'aphid', 'housefly'] as CreatureId[];

/** `const NAME = '…';` in the script. */
function stringLiteral(name: string): string {
  const hit = new RegExp(`const ${name} = '([^']*)';`).exec(source);
  if (hit === null) throw new Error(`probe-lab.mjs has no const ${name}`);
  return hit[1];
}

/** `const NAME = { key: 'text' | number, … };`, one line or many, as key → value. */
function objectLiteral(name: string): Record<string, string | number> {
  const hit = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(source);
  if (hit === null) throw new Error(`probe-lab.mjs has no const ${name} = { … }`);
  const out: Record<string, string | number> = {};
  for (const m of hit[1].matchAll(/(\w+):\s*(?:'([^']*)'|(-?\d+(?:\.\d+)?))/g)) {
    out[m[1]] = m[2] !== undefined ? m[2] : Number(m[3]);
  }
  return out;
}

/** `const NAME = ['a', 'b', …];` as its strings. */
function arrayLiteral(name: string): string[] {
  const hit = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(source);
  if (hit === null) throw new Error(`probe-lab.mjs has no const ${name} = [ … ]`);
  return [...hit[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** Every source file under src/lab/, concatenated: the lab's own words, wherever it keeps them. */
function labSource(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(LAB_DIR);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

describe('scripts/probe-lab.mjs is a script node will run', () => {
  it('parses', () => {
    const result = spawnSync(process.execPath, ['--check', PROBE], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});

describe('probe-lab.mjs agrees with the app about how the lab is reached', () => {
  it('opens the lab by the hub\'s own tool action', () => {
    expect(stringLiteral('TOOL_ID')).toBe('lab.creatures');
    // The probe builds `tool:<id>` itself; the prefix is DevTool.ts's to say.
    expect(/const toolAction = \(id\) => `tool:\$\{id\}`;/.test(source)).toBe(true);
    expect(toolAction('lab.creatures')).toBe('tool:lab.creatures');
  });

  it('presses the menu by the actions the app names', () => {
    const action = objectLiteral('ACTION');
    expect(action.newGame).toBe(ACTION.newGame);
    expect(action.editors).toBe(ACTION.editors);
  });

  it('drives the possessed body by keys the thumbs module reads, and never Space', () => {
    const key = objectLiteral('KEY');
    expect(KEYS.ahead).toContain(key.ahead);
    expect(KEYS.up).toContain(key.up);
    expect(KEYS.down).toContain(key.down);
    // A focused button clicks on Space; the probe's header says why it is never pressed.
    expect(source).not.toMatch(/keyboard\.(down|up|press)\('Space'\)/);
    expect(Object.values(key)).not.toContain('Space');
  });
});

describe('probe-lab.mjs judges a teleport by the species\' own numbers', () => {
  it('names the five the lab holds, in the brief\'s order', () => {
    expect(arrayLiteral('CREATURES')).toEqual(LAB_CREATURES);
  });

  it('caps a frame at the sim dt the clock caps it at', () => {
    expect(/const SIM_DT_CAP = ([\d.]+);/.exec(source)?.[1]).toBe(String(SIM_DT_CAP));
  });

  it('carries each species\' cited body length', () => {
    const lengths = objectLiteral('BODY_LENGTH_MM');
    for (const id of LAB_CREATURES) expect(lengths[id], id).toBe(CREATURE_SPECIES[id].lengthMm);
  });

  it('bounds a height change by the wing\'s climb, the aphid\'s fall, or the flee pace', () => {
    const vertical = objectLiteral('HONEST_VERTICAL_MM_S');
    for (const id of LAB_CREATURES) {
      const s = CREATURE_SPECIES[id];
      const expected = s.flight !== null ? s.flight.climbMmS : s.medium === 'plant' ? DROP_MM_S : s.pace.fleeMmS;
      expect(vertical[id], id).toBe(expected);
    }
  });

  it('bounds a move across the floor by the burst in the air or the flee pace on the ground', () => {
    const plane = objectLiteral('HONEST_PLANE_MM_S');
    for (const id of LAB_CREATURES) {
      const s = CREATURE_SPECIES[id];
      const expected = s.flight !== null ? s.flight.burstMmS : s.pace.fleeMmS;
      expect(plane[id], id).toBe(expected);
    }
  });

  it('parses the whole behaviour vocabulary, so no word the overlay prints goes unread', () => {
    expect(arrayLiteral('BEHAVIOURS')).toEqual([...BEHAVIOURS]);
    for (const word of ['wander', 'flee', 'burrow', 'surface', 'takeoff', 'fly', 'attack']) {
      expect(arrayLiteral('MOVING_WORDS')).toContain(word);
    }
    expect(arrayLiteral('AIR_WORDS')).toEqual(['takeoff', 'fly', 'hover', 'land']);
    expect(arrayLiteral('NON_PREDATORS')).toEqual(['earthworm', 'aphid', 'housefly']);
  });
});

describe('probe-lab.mjs covers the brief\'s acceptance list (§39)', () => {
  it('saves the shots the brief numbers, and the two Creature Lab D added', () => {
    for (const name of [
      '1-all-five', '2-queen-controlled', '3-worm', '4-fly', '5-aphid', '5-aphid-model', '6-worker', '7-observer', '8-worm-underground',
      '9-queen-wall', '9-queen-underside', '10-queen-release',
    ]) {
      expect(source, name).toContain(`shot(page, '${name}')`);
    }
  });

  it('no longer logs shots 9 and 10 as SKIPPED: surface traversal is built', () => {
    expect(source).not.toMatch(/SKIPPED \(deferred to Creature Lab D/);
    expect(source).toContain("(c) => c?.surface === 'on wall'");
    expect(source).toContain("(c) => c?.surface === 'on ceiling'");
  });
});

describe('probe-lab.mjs and the lab agree on the overlay\'s names', () => {
  const labPresent = existsSync(LAB_DIR);

  it.skipIf(!labPresent)('every lab action the probe presses is one the lab wears', () => {
    const lab = labSource();
    const action = objectLiteral('ACTION');
    for (const [key, value] of Object.entries(action)) {
      if (typeof value !== 'string' || !value.startsWith('lab:')) continue;
      expect(lab, `${key} = "${value}"`).toContain(value);
    }
    // `lab:possess:<id>` is built per creature; the lab must name the prefix or every id.
    const possess = LAB_CREATURES.every((id) => lab.includes(`lab:possess:${id}`)) || lab.includes('lab:possess:');
    expect(possess, 'the lab names lab:possess:<id>').toBe(true);
  });

  it.skipIf(!labPresent)('every field the probe reads is one the lab writes', () => {
    const lab = labSource();
    const field = objectLiteral('FIELD');
    for (const [key, value] of Object.entries(field)) expect(lab, `${key} = "${value}"`).toContain(String(value));
    const perCreature = LAB_CREATURES.every((id) => lab.includes(`lab-${id}`)) || /`lab-\$\{/.test(lab);
    expect(perCreature, 'the lab names lab-<creature>').toBe(true);
  });

  it.skipIf(labPresent)('src/lab/ is not in the tree yet: the DOM-contract pins are waiting for it', () => {
    expect(labPresent).toBe(false);
  });
});
