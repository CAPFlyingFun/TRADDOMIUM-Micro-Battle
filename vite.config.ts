import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * The commit this build came from, or 'local' when there is no checkout
 * to ask (a tarball, a bare CI image). A missing hash is a normal
 * outcome, not a failure — see `src/env.d.ts` for why the hash matters.
 */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

const HEAD = commit();

/**
 * THE RELAY THE BUILD SHIPS WITH.
 *
 * Baked in as `__RELAY_URL__` (see `src/env.d.ts` for why a constant and
 * not a fetched config), defaulting to the deployed relay so the ordinary
 * `npm run build` that reaches GitHub Pages is the build with online
 * rooms in it. `TRADDOMIUM_RELAY_URL` overrides it, and an EMPTY value is
 * a deliberate no-relay build — the honest mock, exactly as it shipped in
 * Phase 1.5 — so `TRADDOMIUM_RELAY_URL= npm run build` is how a fork
 * builds a game with no online play rather than one pointed at somebody
 * else's server.
 *
 * `??` and not `||`, because '' is an answer.
 */
const LIVE_RELAY = 'https://traddomium-relay.joshua-622.workers.dev';
const RELAY_URL = process.env.TRADDOMIUM_RELAY_URL ?? LIVE_RELAY;

const stampJson = (): string =>
  `${JSON.stringify({ version, commit: HEAD, built: new Date().toISOString() }, null, 2)}\n`;

/**
 * WHAT IS LIVE, published as a file the app can fetch.
 *
 * The running build knows its own commit (`__BUILD_COMMIT__`); it cannot
 * know what the SERVER has without asking, and that question is the whole
 * of an update check. A file rather than an API because GitHub Pages is a
 * static host; a few dozen bytes rather than the manifest because Vite
 * content-hashes every other asset, so once `index.html` is fresh so is
 * everything downstream of it.
 *
 * Also served in dev, because `generateBundle` never runs there and the
 * update check would otherwise be the one feature you cannot try while
 * developing it.
 */
const versionStamp: Plugin = {
  name: 'traddomium-version-stamp',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: stampJson() });
  },
  configureServer(server) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(stampJson());
    });
  },
};

export default defineConfig({
  // Relative base so the build works from a GitHub Pages project path.
  base: './',
  plugins: [versionStamp],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(HEAD),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __RELAY_URL__: JSON.stringify(RELAY_URL),
  },
  build: {
    // three alone is ~600 kB minified; the default 500 kB warning would
    // fire on every build and say nothing about this project.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Node by default: core modules must run without a DOM (§2.6). A test
    // that needs one opts in with `// @vitest-environment jsdom` at its top.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
