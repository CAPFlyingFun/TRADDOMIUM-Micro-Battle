/**
 * WHAT THE GAME'S AUDIO IS, AS DATA — the shape `scripts/bakeAudio.mjs`
 * writes and `AudioEngine` reads, and the one place the four buses are
 * named.
 *
 * The clips are not ours and are not generated here. They were made for
 * the MANUSCRIPT, by `capflyingfun/tmb-story`, with ElevenLabs: 237
 * character and system lines and 32 sound assets, each already cached,
 * fingerprinted and cue-sheeted over there. Joshua's brief is to REUSE
 * them — "reuse existing ElevenLabs dialogue… VOICE/SFX/AMBIENCE/MUSIC
 * separated, Chapter 1 sample only" — so the bake COPIES the chapter-1
 * subset into `public/audio/` and writes this manifest beside it.
 * Nothing in this repository generates a clip, and no API key is needed
 * to build it.
 *
 * Chapter 1 is 88 voice lines (47 Jack, 34 Sarah, 7 system) at 1.84 MB
 * and 20 sound assets at 2.03 MB. The NARRATOR is deliberately not here:
 * 572 clips and 18 MB of audiobook, for a story the player is standing
 * inside rather than being read to. `tmb-story`'s own `game/dialogue.json`
 * already excludes it, which is why that file is what the bake reads.
 *
 * ─── FOUR BUSES, AND ONE OF THEM IS EMPTY ───────────────────────────
 *
 * `VOICE`, `SFX`, `AMBIENCE` and `MUSIC` are independent gains under one
 * master. The split is the point of the milestone: a player who cannot
 * hear the dialogue over a ventilation bed needs to turn ONE of them
 * down, and a mix that has already been balanced by asset (`gain`
 * below, carried over from the story repo's own measurements) only works
 * if the buses are actually separate.
 *
 * MUSIC HAS NO CONTENT. There is no score yet — not in this repository
 * and not in the story repository. The bus exists because the graph is
 * the thing being built and a fifth wire added later is a fifth wire
 * that was never tested; but the standing rule is that AN UNAVAILABLE
 * ACTION MUST NEVER LOOK FUNCTIONAL, so a Music slider that moves a gain
 * nothing is connected to would be exactly the dishonest control that
 * rule forbids. The manifest therefore reports what each bus CARRIES
 * (`busCounts`), and the UI is required to read it rather than assume.
 *
 * ─── the bed is a LOOP, the line is a SHOT ──────────────────────────
 *
 * `loop` is the asset's own property, not a decision at the call site: a
 * room tone is a loop because it was authored to loop seamlessly (the
 * story repo measured that), and a door slide is not. A caller that
 * could choose would eventually choose wrong.
 *
 * Pure data: no three, no DOM, no WebAudio. `mix.ts` is the arithmetic
 * over it and is pure too; `AudioEngine.ts` is the only file in
 * `src/audio/` allowed to touch the platform.
 */

/**
 * The four buses. A string union rather than an enum so a manifest is
 * plain JSON and a setting is a plain word in storage.
 */
export type Bus = 'voice' | 'sfx' | 'ambience' | 'music';

export const BUSES: readonly Bus[] = Object.freeze(['voice', 'sfx', 'ambience', 'music']);

/** What a person would call a bus, for a settings row. */
export const BUS_LABEL: Readonly<Record<Bus, string>> = Object.freeze({
  voice: 'Voice',
  sfx: 'Effects',
  ambience: 'Ambience',
  music: 'Music',
});

/**
 * One spoken or machine line.
 *
 * `lineId` is the story repository's own id and is stable across
 * regeneration: it is a hash of the text and the speaker, so a line that
 * is reworded becomes a different line rather than silently changing
 * under a cue that points at it.
 */
export interface VoiceLine {
  readonly lineId: string;
  /** `jack-bennett`, `sarah-bennett`, `system`. */
  readonly character: string;
  /** What a person would call the speaker: "Jack Bennett", "TOMBS / settlement systems". */
  readonly characterName: string;
  /** The words, for a caption and for a test that does not want to decode audio. */
  readonly text: string;
  /** Path under `public/`, e.g. `audio/voice/jack-bennett-2b8704441765.mp3`. */
  readonly url: string;
  /** Which chapters use the line. Chapter 1 is all this build carries. */
  readonly chapters: readonly number[];
}

/**
 * One sound asset: a bed, a sting, a bit of foley.
 *
 * `gain` is the story repository's `suggestedGain`, carried across
 * rather than re-guessed — those numbers are the result of somebody
 * listening to each asset against the others, and a fresh guess here
 * would throw that away.
 */
export interface SoundAsset {
  readonly assetId: string;
  /** The bus it plays on. Decided by the bake from the story repo's category and its loop flag. */
  readonly bus: Exclude<Bus, 'voice'>;
  /** The story repository's own grouping: `ambience`, `alarm`, `system`, `foley`, `interface`. */
  readonly category: string;
  readonly loop: boolean;
  readonly seconds: number;
  /** 0..1, the mix level this asset was authored to sit at. */
  readonly gain: number;
  /** Path under `public/`, e.g. `audio/sfx/sfx_lab_door_slide.mp3`. */
  readonly url: string;
  readonly chapters: readonly number[];
}

/**
 * Everything the bake produced, and the accounting that lets the UI be
 * honest about it.
 *
 * `busCounts` is not a convenience: it is how a settings panel knows
 * that MUSIC carries nothing and must not offer a working-looking
 * slider for it (the header). A UI that counted the arrays itself would
 * be a second copy of that rule.
 */
export interface AudioManifest {
  /** The chapter this build carries. 1, until the milestone says otherwise. */
  readonly chapter: number;
  readonly voice: readonly VoiceLine[];
  readonly sounds: readonly SoundAsset[];
  readonly busCounts: Readonly<Record<Bus, number>>;
  /** Total bytes of audio the build ships, for a HUD line and a budget check. */
  readonly bytes: number;
}

/** Does this bus carry anything at all? The one test a UI may make before drawing a control. */
export function busCarries(manifest: AudioManifest, bus: Bus): boolean {
  return (manifest.busCounts[bus] ?? 0) > 0;
}
