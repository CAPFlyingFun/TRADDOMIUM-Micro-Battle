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
