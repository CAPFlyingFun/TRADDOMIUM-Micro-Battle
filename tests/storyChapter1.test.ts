/**
 * THE BEATS HAVE TO STILL FIT THE CHAPTER.
 *
 * `src/story/chapter1.ts` is a shape laid over `src/audio/audioManifest.ts`,
 * and the manifest MOVES: it is baked from `capflyingfun/tmb-story`, and
 * the last bake took chapter 1 from 88 lines to 85. A shape that has gone
 * stale against it is not a compile error and not a visible bug — it is a
 * beat that silently plays nothing, or a line no beat ever reaches. So the
 * fit is checked here rather than trusted.
 *
 * The first draft of this data came out of a language model, which is the
 * other reason these assertions exist in this form: "every id exactly
 * once, in order, none invented" is precisely what a plausible-looking
 * generated list gets wrong, and it is cheap to prove.
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_MANIFEST } from '../src/audio/audioManifest';
import { CHAPTER_1_BEATS, CHAPTER_1_CAMERAS, CHAPTER_1_LINES } from '../src/story/chapter1';

/** The manifest's chapter-1 voice lines, in its own order. */
const MANIFEST = AUDIO_MANIFEST.voice.filter((l) => l.chapters.includes(1)).map((l) => l.lineId);

describe('chapter 1 as beats', () => {
  it('accounts for every voice line the manifest carries, and invents none', () => {
    expect(AUDIO_MANIFEST.chapter).toBe(1);
    expect(MANIFEST.length).toBeGreaterThan(0);
    const claimed = new Set(CHAPTER_1_LINES);
    expect([...claimed].filter((id) => !MANIFEST.includes(id)), 'lines no manifest entry matches').toEqual([]);
    expect(MANIFEST.filter((id) => !claimed.has(id)), 'manifest lines no beat plays').toEqual([]);
  });

  it('plays each line exactly once', () => {
    expect(CHAPTER_1_LINES.length).toBe(new Set(CHAPTER_1_LINES).size);
    expect(CHAPTER_1_LINES.length).toBe(MANIFEST.length);
  });

  it('keeps the story\'s order — a beat is a RUN of the manifest, not a selection', () => {
    expect([...CHAPTER_1_LINES]).toEqual([...MANIFEST]);
  });

  it('names a camera that exists, for every beat', () => {
    const ids = new Set(CHAPTER_1_CAMERAS.map((c) => c.id));
    for (const beat of CHAPTER_1_BEATS) {
      expect(ids.has(beat.camera), `${beat.id} -> ${beat.camera}`).toBe(true);
    }
  });

  it('uses every camera it declares', () => {
    const used = new Set(CHAPTER_1_BEATS.map((b) => b.camera));
    expect(CHAPTER_1_CAMERAS.filter((c) => !used.has(c.id)).map((c) => c.id), 'declared but never cut to').toEqual([]);
  });

  it('cuts between a handful of angles rather than one per beat', () => {
    // The draft this replaced had 12 beats and 7 cameras, two of which
    // were the same shot under different names. The rule is not a count —
    // it is that angles are SHARED, which is what makes a scene read as
    // one room rather than as a slideshow.
    const used = new Set(CHAPTER_1_BEATS.map((b) => b.camera));
    expect(used.size).toBeLessThan(CHAPTER_1_BEATS.length);
    expect(used.size).toBeLessThanOrEqual(8);
  });

  it('never holds one angle past the point it stops being a shot', () => {
    // The generated draft sat an INSERT on the intercom panel for eleven
    // lines and a WIDE on the doorway for eleven more. An insert is a
    // punctuation mark; a minute of one is a still image. Inserts are held
    // to six lines and everything else to twelve.
    const shotOf = new Map(CHAPTER_1_CAMERAS.map((c) => [c.id, c.shot]));
    for (const beat of CHAPTER_1_BEATS) {
      const cap = shotOf.get(beat.camera) === 'insert' ? 6 : 12;
      expect(beat.lines.length, `${beat.id} on ${beat.camera}`).toBeLessThanOrEqual(cap);
      expect(beat.lines.length, `${beat.id} is empty`).toBeGreaterThan(0);
    }
  });

  it('gives every beat a distinct id, a title and a reason', () => {
    const ids = CHAPTER_1_BEATS.map((b) => b.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const beat of CHAPTER_1_BEATS) {
      expect(beat.id, `${beat.id} is not lower-kebab`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      const words = beat.title.trim().split(/\s+/);
      expect(words.length, `${beat.id} title "${beat.title}"`).toBeGreaterThanOrEqual(2);
      expect(words.length, `${beat.id} title "${beat.title}"`).toBeLessThanOrEqual(4);
      expect(beat.title, `${beat.id} title carries a colon`).not.toContain(':');
      expect(beat.why.trim().length, `${beat.id} why`).toBeGreaterThan(20);
    }
  });

  it('describes every camera well enough to place it', () => {
    const ids = CHAPTER_1_CAMERAS.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const camera of CHAPTER_1_CAMERAS) {
      expect(camera.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(camera.subject.trim().length, `${camera.id} subject`).toBeGreaterThan(10);
      expect(camera.placement.trim().length, `${camera.id} placement`).toBeGreaterThan(30);
    }
  });

  it('carries no pose — a camera here is a brief, not a transform', () => {
    // The moment this file holds coordinates it is a second floor plan,
    // and the two will disagree. Placement is prose on purpose.
    for (const camera of CHAPTER_1_CAMERAS) {
      expect(Object.keys(camera).sort()).toEqual(['id', 'placement', 'shot', 'subject']);
    }
  });
});
