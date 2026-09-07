/**
 * THE SHOT PROBE'S COPY OF THE APP'S CONSTANTS.
 *
 * `scripts/probe-shot.mjs` seeds a save document straight into
 * localStorage so a screenshot from Joshua's phone can be recreated from
 * the HUD numbers. To do that it has to name the storage key, the save
 * version and the world id — and it is a plain .mjs script that cannot
 * import the TypeScript that owns them.
 *
 * So it holds literals, and this pins them. It is not hypothetical: the
 * first run named the world "perf-world" instead of "perf-empty", the
 * save was refused as belonging to another world, the menu never offered
 * RESUME, and the probe timed out looking for a button — a failure that
 * reads as the app being broken rather than as the probe being wrong.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERF_WORLD_MAP_ID } from '../src/perf/perfTool';
import { SOLO_SAVE_KEY, SOLO_SAVE_VERSION } from '../src/session/SoloSave';

/** Every probe that seeds a save the way probe-shot does. `probe-objects` copied the trick and the literals; `probe-sky` and `probe-ecology` copied them again. */
const PROBES = ['probe-shot.mjs', 'probe-objects.mjs', 'probe-sky.mjs', 'probe-ecology.mjs'];

/** The value of a `const NAME = '…';` or `const NAME = 2;` in the script. */
function literal(source: string, file: string, name: string): string {
  const hit = new RegExp(`const ${name} = '?([^';\\n]+)'?;`).exec(source);
  if (hit === null) throw new Error(`${file} has no const ${name}`);
  return hit[1];
}

describe.each(PROBES)('%s agrees with the app about where a save lives', (file) => {
  const source = readFileSync(path.join(process.cwd(), 'scripts', file), 'utf8');

  it('names the same storage key', () => {
    expect(literal(source, file, 'SAVE_KEY')).toBe(SOLO_SAVE_KEY);
  });

  it('names the same save version', () => {
    expect(Number(literal(source, file, 'SAVE_VERSION'))).toBe(SOLO_SAVE_VERSION);
  });

  it('names the same world, which is the one that already caught this', () => {
    expect(literal(source, file, 'MAP_ID')).toBe(PERF_WORLD_MAP_ID);
  });
});
