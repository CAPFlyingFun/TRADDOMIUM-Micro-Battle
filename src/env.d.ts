/**
 * Build-time constants injected by `vite.config.ts` (`define`).
 *
 * They exist so the running build can say what it IS. Joshua tests from
 * the deployed Pages build, where the only question that matters is "am
 * I looking at the change we just made, or the one before it?" — a
 * semver cannot answer that, a commit hash can. The About screen shows
 * both; the update check compares `__BUILD_COMMIT__` with `version.json`.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;

/**
 * THE RELAY THIS BUILD TALKS TO, baked in rather than fetched.
 *
 * Its default is the deployed relay (`vite.config.ts`), and
 * `TRADDOMIUM_RELAY_URL` at build time points a fork, a preview or a test
 * build somewhere else. Empty means this build has no online play at all,
 * which is an honest build, not a broken one.
 *
 * WHY A CONSTANT AND NOT A FETCHED CONFIG FILE. The address is known when
 * the build is made and never changes while it runs, so fetching it would
 * add a request that can fail, a state where the app does not yet know
 * what it is, and a second answer to "is there online play here?" — the
 * screen would have to guess whether to offer a room before the answer
 * arrived. A constant is decided at compile time, cannot fail, and lets
 * the build ANSWER that question synchronously (`src/net/relayConfig.ts`).
 * The one thing a constant cannot do is change without a redeploy, and
 * `?relay=` covers that: a developer points the running build at a local
 * relay from the address bar.
 */
declare const __RELAY_URL__: string;
