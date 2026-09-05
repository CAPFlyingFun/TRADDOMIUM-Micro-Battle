/**
 * THE STEP THAT NOW SITS BETWEEN A SLOT AND A WORLD.
 *
 * NEW GAME asks WHERE before it opens anything (`map/SpawnMapScene.ts`),
 * so every probe that reaches the world through the front door has to
 * walk that screen — and they all walked it the same way, which is why
 * this is one file rather than three copies drifting apart. Same reason
 * `probePng.mjs` exists.
 *
 * IT DOES WHAT A PLAYER DOES and skips nothing. There is no query
 * parameter that jumps the map, deliberately: a probe that could skip a
 * step a player cannot is a probe measuring a different program
 * (CLAUDE.md).
 *
 * BOTH PATHS ARE REAL. With a survey the screen shows the island and a
 * region must be picked; without one it says so and offers "Begin
 * anyway", which starts where the world otherwise would. A probe run
 * against a build whose survey failed to download should still reach the
 * world, and report which of the two it got.
 */

const MAP = '[data-role="spawn-map"]';
const START = '[data-action="spawn-start"]';

/**
 * Walk the spawn map: pick `region` if it is on offer, then begin.
 *
 * @param page      the Playwright page, already at the spawn map
 * @param region    the region id to choose, e.g. 'anini'
 * @param log       where to report which path was taken
 * @param timeout   how long to wait for the screen and the survey
 * @returns         'chosen' when a region was picked, 'default' when the
 *                  build had no map to choose from
 */
export async function chooseSpawn(page, region, log, timeout = 300_000) {
  await page.waitForSelector(START, { state: 'attached', timeout });

  const marker = page.locator(`[data-action="spawn:${region}"]`);
  // The markers appear only once the survey has been read and searched,
  // which on a phone-sized download is seconds after the screen itself.
  try {
    await marker.waitFor({ state: 'attached', timeout });
  } catch {
    // No island. The screen says why; take the honest way through and
    // say which path this run measured, because the two start in
    // different places and a reader must not have to guess which.
    const start = page.locator(START);
    if (await start.isDisabled()) {
      throw new Error('the spawn map offered neither a region nor a way to begin — the route is a dead end');
    }
    log(`no island on the spawn map; beginning at the world's default (asked for "${region}")`);
    await start.click({ timeout: 10_000 });
    return 'default';
  }

  await marker.click({ timeout: 10_000 });
  const start = page.locator(START);
  if (await start.isDisabled()) {
    throw new Error(`choosing "${region}" did not enable BEGIN; the map is showing a region it cannot start`);
  }
  log(`spawn map: chose "${region}"`);
  await start.click({ timeout: 10_000 });
  return 'chosen';
}

export { MAP as SPAWN_MAP_SELECTOR, START as SPAWN_START_SELECTOR };
