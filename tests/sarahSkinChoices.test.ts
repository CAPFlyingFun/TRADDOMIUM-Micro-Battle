import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SKIN_CHOICES, SKIN_ORIGINAL_IMAGE, SKIN_SWATCHES, SKIN_TEXTURE_CM, hexRgb, nextSkin, skinBrushLine, skinGpuMb, skinLine, skinNote, skinStrengthLine, skinTextureLine } from '../src/sarahlab/skinChoices';
import { STUDIO_SECTIONS } from '../src/sarahlab/studioLayout';

const PUBLIC = join(__dirname, '..', 'public');

describe("Sarah's skin choices (Joshua, 2026-10-24: switch between the enhanced skins, upload, paint)", () => {
  it('starts on the body file\'s own map, which downloads nothing', () => {
    expect(SKIN_CHOICES[0].id).toBe('original');
    expect(SKIN_CHOICES[0].path).toBeNull();
  });

  it('ships every candidate as a small WebP of the size it says, square like her atlas', async () => {
    for (const c of SKIN_CHOICES) {
      if (!c.path) continue;
      const file = join(PUBLIC, c.path);
      expect(existsSync(file), c.path).toBe(true);
      expect(statSync(file).size, `${c.path} stays a light download`).toBeLessThan(1024 * 1024);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([c.size, c.size]);
    }
    const original = await sharp(join(PUBLIC, SKIN_ORIGINAL_IMAGE)).metadata();
    expect([original.format, original.width, original.height]).toEqual(['webp', 2048, 2048]);
  });

  it('SKIN steps through them in order and comes round, with UPLOAD only once there is one', () => {
    const seen = [SKIN_CHOICES[0].id as string];
    let id = nextSkin('original', false);
    while (id !== 'original') { seen.push(id); id = nextSkin(id, false); }
    expect(seen).toEqual(SKIN_CHOICES.map((c) => c.id));
    expect(nextSkin('upscale', true)).toBe('upload');
    expect(nextSkin('upload', true)).toBe('original');
    expect(nextSkin('upload', false)).toBe('original');
  });

  it('says what each costs on the GPU: the 4K upscale is four times the others', () => {
    expect(skinGpuMb(2048)).toBe(21);
    expect(skinGpuMb(4096)).toBe(85);
    expect(skinNote('upscale', null, 'ready', false)).toContain('85 MB');
    expect(skinNote('original', null, 'ready', false)).toContain('as approved');
    expect(skinNote('ai', null, 'loading', false)).toMatch(/loading/i);
    expect(skinNote('ai', null, 'failed', false)).toMatch(/could not/);
    expect(skinNote('original', null, 'ready', true)).toContain('SAVE PNG');
  });

  it('names an upload by its size, and asks whether a picture that is not square is her atlas', () => {
    const up = { name: 'mine.png', width: 2048, height: 1024 };
    expect(skinLine('upload', up)).toBe('SKIN · UPLOAD · 2048×1024');
    expect(skinNote('upload', up, 'ready', false)).toContain('not square');
    expect(skinNote('upload', { ...up, height: 2048 }, 'ready', false)).not.toContain('not square');
    expect(skinLine('bazaart', null)).toBe('SKIN · BAZAART · 2048');
  });

  it('reads the brush in her units, and its colours as channels', () => {
    expect(skinBrushLine(0.4, false, false)).toBe('BRUSH · 4 mm · soft edge');
    expect(skinBrushLine(2.5, true, true)).toContain('ERASING');
    expect(skinStrengthLine(0.5)).toBe('STRENGTH · 50% a dab');
    expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexRgb('nonsense')).toEqual(hexRgb(SKIN_SWATCHES[0].hex));
    for (const s of SKIN_SWATCHES) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('says how big a painted picture is on her, as a tile or a stamp (Joshua: "upload custom paint textures like with the clothing")', () => {
    expect(skinTextureLine(6, false, 'stripes.png', true)).toBe('TEXTURE SIZE · repeats every 6.0 cm · stripes.png');
    expect(skinTextureLine(12, true, 'star.png', true)).toBe('TEXTURE SIZE · a 12 cm stamp · star.png');
    expect(skinTextureLine(6, false, 'x.png', false)).toContain('painting colour');
    expect(SKIN_TEXTURE_CM.min).toBeGreaterThan(0);
    expect(SKIN_TEXTURE_CM.initial).toBeGreaterThanOrEqual(SKIN_TEXTURE_CM.min);
    expect(SKIN_TEXTURE_CM.initial).toBeLessThanOrEqual(SKIN_TEXTURE_CM.max);
  });

  it('has a FACE section in the studio for them', () => {
    expect(STUDIO_SECTIONS.map((s) => s.id)).toContain('face');
  });
});
