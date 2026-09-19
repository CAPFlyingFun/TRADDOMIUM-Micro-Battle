/**
 * THE CACHE BUG THIS PINS ACTUALLY HAPPENED, and it wasted a device pass.
 *
 * On 2026-09-19 Joshua's phone showed build stamp `aa815ae` — the commit
 * that fixed both TOMBS badges — while still drawing the OLD badge. Both
 * halves were true at once, and the reason is an asymmetry in what Vite
 * hashes: `__BUILD_COMMIT__` rides inside `index-<hash>.js`, a filename no
 * cache has ever seen, so the CODE was certain to be fresh; `public/` is
 * copied verbatim and `models/jack.glb` is the same URL it was last
 * release, so the ART was entitled to come from the cache, and did.
 *
 * The deployed files were correct the whole time. Nothing was wrong on the
 * server, which is exactly what made it expensive: the version line said
 * the fix had landed, so the search went back into the bake.
 *
 * `assetUrl` now appends a per-file content revision from
 * `__PUBLIC_REV__` (`vite.config.ts` builds it; its header says why
 * per-file rather than per-commit — the alternative re-downloads 52 MB of
 * island for one changed model). These tests hold the two properties that
 * make that safe:
 *
 *   - a file that CHANGED gets a URL no cache has seen;
 *   - a file with no entry still gets a URL THAT RESOLVES, because a
 *     missing revision must cost a query string and never the asset.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { assetUrl } from '../src/assets/assets';

/** The revision map as the build sees it. Vitest shares `vite.config.ts`'s defines. */
function revisions(): Record<string, string> {
  try {
    return __PUBLIC_REV__;
  } catch {
    return {};
  }
}

describe('assetUrl carries a content revision', () => {
  it('stamps a real public file with its own content hash', () => {
    const path = 'models/jack.glb';
    const rev = revisions()[path];
    // The map is built from `public/`, which is present in a checkout. If
    // it ever is not, say so rather than passing vacuously.
    expect(existsSync(`public/${path}`), 'public/models/jack.glb is in the repository').toBe(true);
    expect(typeof rev, `${path} has a revision`).toBe('string');

    const expected = createHash('sha1').update(readFileSync(`public/${path}`)).digest('hex').slice(0, 8);
    expect(rev).toBe(expected);
    expect(assetUrl(path)).toContain(`?r=${expected}`);
  });

  it('gives every public file a distinct-by-content revision', () => {
    const map = revisions();
    const paths = Object.keys(map);
    expect(paths.length, 'the build found files in public/').toBeGreaterThan(50);
    for (const path of paths) {
      expect(map[path], `${path} revision is 8 hex characters`).toMatch(/^[0-9a-f]{8}$/);
    }
    // Two files with the same bytes SHOULD share a revision — that is a
    // content hash working, not a collision — so this asserts the useful
    // property instead: the models, which are what changed, differ.
    expect(map['models/jack.glb']).not.toBe(map['models/sarah.glb']);
  });

  it('leaves an unknown path alone rather than inventing a revision', () => {
    // Dev, vitest without the define, a file added after the build: all of
    // these must produce a URL that still resolves.
    const url = assetUrl('models/not-a-real-file.glb');
    expect(url).not.toContain('?r=');
    expect(url.endsWith('models/not-a-real-file.glb')).toBe(true);
  });

  it('strips a leading slash before looking the revision up', () => {
    // The map is keyed by the path a caller passes, with no leading
    // slash. A caller that writes one must still get the revision, or the
    // stamp silently stops applying for that call site.
    const withSlash = assetUrl('/models/jack.glb');
    const without = assetUrl('models/jack.glb');
    expect(withSlash).toBe(without);
    expect(withSlash).toContain('?r=');
  });

  it('never throws, whatever the path', () => {
    for (const path of ['', '/', 'a/b/c.bin', '../escape', 'models/jack.glb?already=1']) {
      expect(() => assetUrl(path)).not.toThrow();
    }
  });
});
