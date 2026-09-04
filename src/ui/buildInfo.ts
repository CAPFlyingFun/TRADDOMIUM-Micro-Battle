/**
 * What this build IS, read once from the constants `vite.config.ts` defines
 * (see `src/env.d.ts` for why the commit matters more than the version).
 *
 * Read defensively rather than bare: Vite replaces the identifiers at build
 * time and vitest defines them as globals, but a test runner that does
 * neither must not crash the About screen over a label. The fallbacks are
 * honest words, never a made-up number.
 */

function stamp(read: () => string, fallback: string): string {
  try {
    const value = read();
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export interface BuildInfo {
  readonly version: string;
  readonly commit: string;
  /** YYYY-MM-DD, the day the bundle was built. */
  readonly date: string;
  /**
   * The relay this build talks to, '' when it was built without one.
   *
   * It lives here and not in `net/relayConfig.ts` for the same reason the
   * `?relay=` override lives in `app/registerScenes.ts`: the relay
   * COMPILES `src/net/` (worker/ imports it whole), and a build-time
   * constant of the browser bundle does not exist there. Core is handed
   * the address; it never names it.
   */
  readonly relayUrl: string;
}

export const BUILD_INFO: BuildInfo = {
  version: stamp(() => __APP_VERSION__, 'unversioned'),
  commit: stamp(() => __BUILD_COMMIT__, 'local'),
  date: stamp(() => __BUILD_DATE__, 'unknown date'),
  // '' is the honest no-relay build, so it is both the value and the fallback.
  relayUrl: stamp(() => __RELAY_URL__, ''),
};

/** The one-line stamp footers show: `v1.0.0-alpha.1 · e799284`. */
export function buildStamp(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version} · ${info.commit}`;
}
