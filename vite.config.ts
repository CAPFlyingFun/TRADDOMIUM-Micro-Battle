import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * The commit this build came from.
 *
 * Joshua tests from the deployed Pages build, where the only question
 * that matters is "am I looking at the change we just made, or the one
 * before it?" A semver cannot answer that — a hash can.
 *
 * Not every build has a git checkout to ask (a tarball, a bare CI
 * image), so a missing hash is a normal outcome, not a failure.
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
 * WHAT IS LIVE, published as a file the app can ask about.
 *
 * The running build knows what IT is (`__BUILD_COMMIT__`). It cannot
 * know what the SERVER has without asking, and that question is the
 * whole of the update check: fetch this, compare the commit, and if
 * they differ there is a newer build sitting on Pages that the browser
 * has not picked up.
 *
 * A FILE RATHER THAN AN API because GitHub Pages is a static host, and
 * a few dozen bytes rather than the whole manifest because the app only
 * needs the identity — Vite content-hashes every other asset, so once
 * `index.html` is fresh, everything downstream of it is too.
 */
const stamp = {
  name: 'traddomium-version-stamp',
  generateBundle(this: { emitFile: (f: unknown) => void }) {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${JSON.stringify({
        version, commit: HEAD, built: new Date().toISOString(),
      }, null, 2)}\n`,
    });
  },
  // The dev server never runs `generateBundle`, so without this the
  // update check is the one feature you cannot try while developing it.
  configureServer(server: {
    middlewares: { use: (path: string, fn: (
      req: unknown, res: { setHeader: (k: string, v: string) => void; end: (s: string) => void },
    ) => void) => void };
  }) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ version, commit: HEAD, built: new Date().toISOString() }));
    });
  },
};

// Relative base so the build works from a GitHub Pages project path.
export default defineConfig({
  base: './',
  plugins: [stamp],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(HEAD),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
