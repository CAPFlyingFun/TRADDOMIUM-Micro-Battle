/**
 * THE LOADING SCREEN'S TOTAL MUST BE TRUE BEFORE ANYTHING ARRIVES.
 *
 * It used to be a guess per file, corrected as each response's
 * Content-Length landed, and Joshua watched the consequence: "when I
 * first started the loading it said 5.0mb, but then dropped to 4.6mb
 * after about 2 seconds."
 *
 * Two things made that happen. The per-file guesses were poor even
 * though they averaged well — snow.jpg is 143 KB under 445,000 and
 * grass.jpg 84 KB over — so the total lurched by that much as files
 * landed in whatever order the browser finished them. And the
 * correction can arrive far too late: fetchBytes only trusts a
 * Content-Length when the response carries no content-encoding (quite
 * right, since the stream yields DECOMPRESSED bytes and the header
 * counts compressed ones), so a compressed response keeps its guess
 * for the entire download and snaps to the truth at the very end.
 *
 * The sizes are baked now. These tests are what stops the bake going
 * stale — a re-encoded texture with an unchanged manifest is exactly
 * the same bug with an extra step, and nothing else in the build would
 * notice.
 */
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_BYTES, assetBytes } from '../src/ui/assetSizes';
import { BAND_FILES } from '../src/world/terrainMaterial';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

describe('the baked asset sizes', () => {
  it('match the files actually in public/', () => {
    const entries = Object.entries(ASSET_BYTES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, bytes] of entries) {
      expect(statSync(PUBLIC + path).size, `${path} has been re-encoded`).toBe(bytes);
    }
  });

  it('cover every band the terrain asks for', () => {
    // A band added without re-running the bake falls back to the old
    // 445,000 guess and puts the drift straight back.
    for (const name of BAND_FILES) {
      expect(assetBytes(`kauai-tex/${name}.jpg`), `no baked size for ${name}`)
        .toBeGreaterThan(0);
    }
    // And nothing baked that has since been deleted from the folder.
    const shipped = new Set(readdirSync(PUBLIC + 'kauai-tex'));
    for (const path of Object.keys(ASSET_BYTES)) {
      if (!path.startsWith('kauai-tex/')) continue;
      expect(shipped).toContain(path.slice('kauai-tex/'.length));
    }
  });

  it('cover the queen', () => {
    expect(assetBytes('models/queen-winged.glb')).toBeGreaterThan(1_000_000);
  });

  it('answer null for something nobody baked', () => {
    // The callers fall back to their old guess on null, so this has to
    // stay a null rather than a zero or an undefined weight.
    expect(assetBytes('kauai-tex/lava.jpg')).toBeNull();
  });
});
