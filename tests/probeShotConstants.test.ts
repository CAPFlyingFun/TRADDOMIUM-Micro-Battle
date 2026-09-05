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

const source = readFileSync(path.join(process.cwd(), 'scripts', 'probe-shot.mjs'), 'utf8');

/** The value of a `const NAME = '…';` or `const NAME = 2;` in the script. */
function literal(name: string): string {
  const hit = new RegExp(`const ${name} = '?([^';\\n]+)'?;`).exec(source);
  if (hit === null) throw new Error(`probe-shot.mjs has no const ${name}`);
  return hit[1];
}

describe('probe:shot agrees with the app about where a save lives', () => {
  it('names the same storage key', () => {
    expect(literal('SAVE_KEY')).toBe(SOLO_SAVE_KEY);
  });

  it('names the same save version', () => {
    expect(Number(literal('SAVE_VERSION'))).toBe(SOLO_SAVE_VERSION);
  });

  it('names the same world, which is the one that already caught this', () => {
    expect(literal('MAP_ID')).toBe(PERF_WORLD_MAP_ID);
  });
});
