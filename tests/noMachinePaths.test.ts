/**
 * NOTHING IN THIS REPO MAY NAME A PATH ON ONE MACHINE.
 *
 * Written after an absolute path — the checkout directory of the machine
 * a test was authored on — reached `main`, passed every local check
 * because that machine was the one running them, and then failed on the
 * CI runner, whose checkout is somewhere else entirely. The build job
 * gates the deploy, so the consequence was not a red tick: it was that
 * the feature Joshua was waiting for never reached his phone, and the
 * deployed site sat a version behind while he looked for it.
 *
 * That is the whole argument for this file. A hardcoded machine path is
 * invisible to a typecheck, invisible to a review that is reading for
 * logic, and it works perfectly right up until it runs anywhere else —
 * so the only thing that catches it is a test that goes looking.
 *
 * The portable forms are `process.cwd()` under vitest (the repo root),
 * or resolving from `import.meta.url` — though NOT via `fileURLToPath`
 * in a jsdom test, where the global URL is jsdom's and it is refused.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOOK_IN = ['src', 'tests', 'scripts', 'worker'];

/**
 * The shapes of an absolute path on the three kinds of machine this
 * could be written on. Built from pieces so that this file does not
 * match itself — the test that forbids a pattern must not be the first
 * thing it finds.
 */
const HOME = `/${'home'}/`;
const USERS = `/${'Users'}/`;
const WINDOWS = /[A-Z]:\\\\?(?:Users|home)\\/;

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js|json)$/.test(entry)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

const sources = LOOK_IN.flatMap((dir) => {
  const full = path.join(ROOT, dir);
  try {
    return statSync(full).isDirectory() ? filesUnder(full) : [];
  } catch {
    return [];
  }
});

describe('no file names a path on one machine', () => {
  it('has something to check', () => {
    // A scan that found nothing passes for the wrong reason.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('NAMES NO ABSOLUTE HOME DIRECTORY, because it would work here and nowhere else', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === path.join(ROOT, 'tests', 'noMachinePaths.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        if (line.includes(HOME) || line.includes(USERS) || WINDOWS.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
