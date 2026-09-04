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
}

export const BUILD_INFO: BuildInfo = {
  version: stamp(() => __APP_VERSION__, 'unversioned'),
  commit: stamp(() => __BUILD_COMMIT__, 'local'),
  date: stamp(() => __BUILD_DATE__, 'unknown date'),
};

/** The one-line stamp footers show: `v1.0.0-alpha.1 · e799284`. */
export function buildStamp(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version} · ${info.commit}`;
}
