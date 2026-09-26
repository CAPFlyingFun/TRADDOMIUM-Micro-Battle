/**
 * THE DIALOGUE PANE'S WORDS.
 *
 * The pane quotes and never composes: the speaker is the manifest's
 * `characterName`, the words are its `text`, the beat is
 * `story/chapter1.ts`'s title. So what is testable here is the FRAMING —
 * when each line is empty, what the counter reads at the ends of the
 * chapter, and that the button says which way it goes.
 *
 * The empty cases are the ones that matter. The pane's whole existence
 * is keyed on them: an empty readout is how it knows to be absent, and a
 * pane that showed an empty quotation instead would be this HUD's own
 * forbidden thing — an unavailable action that looks functional.
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_MANIFEST } from '../src/audio/audioManifest';
import { beatOfLine } from '../src/story/chapter1';
import {
  AUDIO_LABEL, PREV_LABEL, TOMBS_ACTION, TOMBS_FIELD,
  audioLabel, beatLine, dialogueLine, progressLine, speakerLine,
} from '../src/tombs/tombsTool';

describe('the dialogue pane', () => {
  it('has an action to step back and a field for each of its three lines', () => {
    expect(TOMBS_ACTION.prevLine).toBe('tombs:line:prev');
    // Distinct from every other action: a collision would make one
    // control silently do another's job.
    const actions = Object.values(TOMBS_ACTION);
    expect(actions.length).toBe(new Set(actions).size);
    expect([TOMBS_FIELD.beat, TOMBS_FIELD.speaker, TOMBS_FIELD.line])
      .toEqual(['tombs-beat', 'tombs-speaker', 'tombs-line']);
    const fields = Object.values(TOMBS_FIELD);
    expect(fields.length).toBe(new Set(fields).size);
  });

  it('says which way the button goes, like every other control here', () => {
    expect(audioLabel(false)).toBe(AUDIO_LABEL);
    expect(audioLabel(true)).not.toBe(AUDIO_LABEL);
    expect(audioLabel(true).length).toBeGreaterThan(0);
    expect(PREV_LABEL.length).toBeGreaterThan(0);
  });

  it('reads empty when there is nothing to say, which is how the pane knows to be absent', () => {
    expect(beatLine('')).toBe('');
    expect(beatLine('   ')).toBe('');
    expect(speakerLine('')).toBe('');
    expect(dialogueLine('   ')).toBe('');
    expect(progressLine(0, 85)).toBe('');
  });

  it('counts one-based and out of the whole', () => {
    expect(progressLine(1, 85)).toBe('1 / 85');
    expect(progressLine(85, 85)).toBe('85 / 85');
  });

  it('never prints a counter that has broken rather than a chapter that has not started', () => {
    expect(progressLine(-3, 85)).toBe('');
    expect(progressLine(4, 0)).toBe('');
    expect(progressLine(Number.NaN, 85)).toBe('');
    expect(progressLine(4, Number.POSITIVE_INFINITY)).toBe('');
    // Past the end clamps rather than lying: a chapter cannot be 90/85.
    expect(progressLine(90, 85)).toBe('85 / 85');
  });

  it('upper-cases the beat and leaves the script alone', () => {
    expect(beatLine('The Smarter Scientist')).toBe('THE SMARTER SCIENTIST');
    // The words are the manuscript's. Nothing here re-cases or trims
    // inside them, only at the ends.
    expect(dialogueLine('  No. That\'s why I\'m calling the smarter scientist.  '))
      .toBe('No. That\'s why I\'m calling the smarter scientist.');
    expect(speakerLine(' Sarah Bennett ')).toBe('Sarah Bennett');
  });
});

describe('what the pane will actually be handed', () => {
  it('finds a beat for every line of the chapter it plays', () => {
    // The pane prints the counter alone when a line has no beat, which is
    // the honest fallback for chapters 2-6. Chapter 1 has all fourteen,
    // so every one of its lines should find one.
    const missing = AUDIO_MANIFEST.voice
      .filter((l) => l.chapters.includes(1))
      .filter((l) => beatOfLine(l.lineId) === null)
      .map((l) => l.lineId);
    expect(missing).toEqual([]);
  });

  it('has a speaker and words for every line, so no line renders blank', () => {
    for (const line of AUDIO_MANIFEST.voice) {
      expect(speakerLine(line.characterName), line.lineId).not.toBe('');
      expect(dialogueLine(line.text), line.lineId).not.toBe('');
    }
  });

  it('gives an unknown line no beat rather than the first one', () => {
    expect(beatOfLine('not-a-line')).toBeNull();
  });
});
