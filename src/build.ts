/**
 * WHICH BUILD IS THIS?
 *
 * Injected by Vite at build time (see vite.config.ts). Guarded because
 * these globals only exist under a Vite build — vitest runs the same
 * modules without them, and a bare reference would throw on import
 * rather than at the point anything actually wanted a version.
 */

declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;

function injected(value: () => string, fallback: string): string {
  try {
    return value();
  } catch {
    return fallback;
  }
}

export const VERSION = injected(() => __APP_VERSION__, '0.0.0');
export const COMMIT = injected(() => __BUILD_COMMIT__, 'dev');
export const BUILT = injected(() => __BUILD_DATE__, '');

/** What the settings panel prints at the bottom. */
export function buildStamp(): string {
  return BUILT ? `${COMMIT} · ${BUILT}` : COMMIT;
}
