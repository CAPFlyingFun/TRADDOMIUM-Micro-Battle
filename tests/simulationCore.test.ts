/**
 * THE SIMULATION CORE MUST KEEP RUNNING WITHOUT A BROWSER.
 *
 * docs/SESSION_ARCHITECTURE.md wants one game core under two
 * authorities: local for Solo, a server for Multiplayer. Whether that
 * is a two-week job or a rewrite comes down to one property — can the
 * code that decides what is TRUE run somewhere other than a tab?
 *
 * Measured today, it can. Every module below imports nothing from
 * three, touches no DOM, reads no localStorage and calls no fetch, so
 * a Node process could evaluate the same island, the same flight
 * model and the same survival maths that the client does. That is the
 * whole trust boundary, and it already exists — by accident of good
 * habits rather than by decision, which is exactly the kind of
 * property that quietly stops being true.
 *
 * So it is a decision now. A module listed here may not reach for the
 * browser; if a feature needs to, the feature splits — the deciding
 * half stays, the drawing half goes to a scene.
 *
 * This is not a networking test and does not pretend multiplayer is
 * close. It protects the one thing that would make multiplayer
 * possible without building the game twice.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * WHAT DECIDES, as opposed to what draws.
 *
 * PlayerAnt and queenModel are deliberately absent: one is a rig and
 * the other loads a mesh, and both are honestly renderer code. The
 * heightfield they stand on is not.
 */
const CORE = [
  'src/world/heightfield.ts',
  'src/world/kauai.ts',
  'src/world/lakes.ts',
  'src/world/rivers.ts',
  'src/world/hydro.ts',
  'src/world/coords.ts',
  'src/world/origin.ts',
  'src/world/geo.ts',
  'src/world/swell.ts',
  'src/world/surf.ts',
  'src/world/water.ts',
  'src/world/spawn.ts',
  'src/weather/windField.ts',
  'src/ant/flight.ts',
  'src/ant/castes.ts',
  'src/ant/locomotion.ts',
  'src/ant/pace.ts',
  'src/ant/stamina.ts',
  'src/ant/telemetry.ts',
  'src/ant/thirst.ts',
  'src/ant/wander.ts',
  'src/ant/wingbeat.ts',
  'src/ant/grace.ts',
];

/** Strip comments, so prose about a "streamed window" is not a hit. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the simulation core runs without a browser', () => {
  it.each(CORE)('%s imports no renderer', (path) => {
    expect(code(path)).not.toMatch(/from ['"]three['"]/);
  });

  it.each(CORE)('%s touches no browser', (path) => {
    const body = code(path);
    for (const forbidden of [
      /\bdocument\b/, /\bwindow\s*\./, /\blocalStorage\b/,
      /\bsessionStorage\b/, /\bnavigator\b/, /\bfetch\s*\(/,
    ]) {
      expect(body).not.toMatch(forbidden);
    }
  });

  it('and the list has not quietly emptied itself', () => {
    // A guard that guards nothing passes forever. If the core is
    // refactored, this number moves deliberately.
    expect(CORE.length).toBeGreaterThanOrEqual(23);
    for (const path of CORE) expect(code(path).length).toBeGreaterThan(200);
  });
});
