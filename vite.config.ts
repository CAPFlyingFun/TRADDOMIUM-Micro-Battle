import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
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

/**
 * A CONTENT REVISION FOR EVERY FILE IN `public/`, BECAUSE VITE DOES NOT
 * HASH THOSE — and the day that mattered is worth writing down.
 *
 * Vite content-hashes everything it bundles: `index-ByLXqhBP.js` is a
 * filename no cache has ever seen, so a new build is fetched by
 * construction. Files in `public/` are COPIED VERBATIM and keep a stable
 * path — `v1/models/sarah.glb` is the same URL it was last release — so
 * a browser is entitled to go on serving the copy it already has, and a
 * phone does.
 *
 * That asymmetry produced the worst possible symptom: Joshua's device
 * showed the NEW build stamp (`aa815ae`, read from `__BUILD_COMMIT__`,
 * which is baked into the hashed bundle) while drawing the OLD badge
 * (from a cached `models/jack.glb`). Code and art were from different
 * releases, and the version line said everything was fine. Two hours
 * went into re-measuring art that was already correct on the server.
 *
 * WHY A PER-FILE HASH AND NOT THE COMMIT. `?v=${HEAD}` on every asset
 * would work and would re-download all 52 MB of `public/` on every
 * deploy — the island's DEM, the sky, the water maps, every rig — for
 * the sake of one changed GLB, onto the phone this game is tested on.
 * A per-file content hash busts exactly what changed and leaves the rest
 * in the cache, which is what a content hash is for.
 *
 * The map costs about 4 kB in the bundle for 109 files. It is EMPTY in
 * dev, where the dev server serves `public/` fresh anyway and a query
 * string would only make the network tab harder to read.
 */
function publicRevisions(): Record<string, string> {
  const root = 'public';
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Keyed by the path a caller passes to `assetUrl` — POSIX
      // separators, relative to `public/`, no leading slash — so the
      // lookup is the caller's own string and needs no normalising.
      const key = relative(root, full).split(sep).join(posix.sep);
      out[key] = createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 8);
    }
  };
  try {
    walk(root);
  } catch {
    // No `public/` is a normal outcome for a consumer of this config; an
    // empty map simply means no asset carries a revision.
    return {};
  }
  return out;
}

const PUBLIC_REV = publicRevisions();

/**
 * WHAT EACH PUBLIC FILE COSTS TO LOAD, in bytes, for the loading meter (Joshua, 2026-10-20: "the indicator should
 * track the actual assets required for the selected character and outfit... 15.0 MB / 30.0 MB").
 *
 * A file's own size, except a `.gltf`, which costs its own JSON PLUS every external buffer and image it names: the
 * shirts are a few kB of JSON over twenty-odd parts of 2-5 MB, and a meter that knew only the JSON would reach 100%
 * before the shirt had begun. Keyed exactly like `__PUBLIC_REV__`. The sizes are the DECODED bytes the browser
 * hands the page, which is what a stream counts whether or not the server compressed the response; that is why the
 * meter reads this rather than Content-Length.
 */
function publicSizes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(PUBLIC_REV)) out[key] = statSync(join('public', key)).size;
  for (const key of Object.keys(out)) {
    if (!key.endsWith('.gltf')) continue;
    try {
      const json = JSON.parse(readFileSync(join('public', key), 'utf8')) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      const deps = new Set<string>();
      for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
        if (item.uri && !item.uri.startsWith('data:')) deps.add(posix.normalize(posix.join(posix.dirname(key), decodeURIComponent(item.uri))));
      }
      for (const dep of deps) out[key] += out[dep] ?? 0;
    } catch {
      // an unreadable gltf costs what it weighs; the meter then under-counts it rather than the build failing
    }
  }
  return out;
}

const PUBLIC_SIZE = publicSizes();

const stampJson = (): string =>
  `${JSON.stringify({ version, commit: HEAD, built: new Date().toISOString() }, null, 2)}\n`;

/**
 * WHAT IS LIVE, published as a file the app can fetch.
 *
 * The running build knows its own commit (`__BUILD_COMMIT__`); it cannot
 * know what the SERVER has without asking, and that question is the whole
 * of an update check. A file rather than an API because GitHub Pages is a
 * static host; a few dozen bytes rather than the manifest because Vite
 * content-hashes everything it BUNDLES, so once `index.html` is fresh so
 * is everything downstream of it — with one exception that cost a device
 * pass, and that `__PUBLIC_REV__` below now covers: `public/`.
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
  server: { allowedHosts: ['terminal.local'] },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(HEAD),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __RELAY_URL__: JSON.stringify(RELAY_URL),
    __PUBLIC_REV__: JSON.stringify(PUBLIC_REV),
    __PUBLIC_SIZE__: JSON.stringify(PUBLIC_SIZE),
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
