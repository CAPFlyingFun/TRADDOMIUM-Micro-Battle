/**
 * CHAPTER 1 AS BEATS: what the chapter is made of, and where to stand.
 *
 * A chapter is 85 voice lines in `src/audio/audioManifest.ts` and nothing
 * else — no shape, no pauses, no idea who to look at. This file is the
 * shape: an ordered list of BEATS, each owning a run of those lines and
 * naming a CAMERA to watch them from.
 *
 * IT IS PURE DATA AND IT IS CORE. No three, no DOM: a renderer reads it,
 * and so could a server. What it holds are `lineId`s — the manifest's own
 * stable handles — and camera IDENTITIES, never poses. A pose belongs to
 * whoever knows where the furniture is (`world/tombs/plan.ts`); this file
 * only says which of a handful of angles a beat wants, in words a reader
 * can check against the floor plan.
 *
 * WHERE IT CAME FROM. A first pass was drafted by GPT-5.5 through
 * `.github/workflows/ask-chatgpt.yml` against the manuscript and the
 * manifest, then verified line by line and edited here. What the draft
 * got right was the hard part — every line assigned exactly once, in
 * order, nothing invented — and `tests/storyChapter1.test.ts` is what
 * keeps that true as the manifest moves. What it got wrong was pacing:
 * it held an insert on the intercom panel for eleven lines and a wide on
 * the doorway for eleven more, and it gave one camera two names. Both
 * are fixed here, which is why there are fourteen beats and not twelve.
 *
 * THE MANIFEST IS AUTHORITATIVE. If a line is added, removed or reordered
 * upstream, this file is stale and the test says so rather than the game
 * quietly skipping a beat.
 */

/** How a beat is framed. The words are the renderer's brief, not a transform. */
export type Shot = 'wide' | 'medium' | 'close' | 'over-shoulder' | 'insert';

export interface BeatCamera {
  /** Stable id. Beats name a camera by this, and REUSE is the point. */
  readonly id: string;
  /** Who or what is in frame. */
  readonly subject: string;
  /** Where it stands and what it looks at, against the laboratory's own plan. */
  readonly placement: string;
  readonly shot: Shot;
}

export interface Beat {
  readonly id: string;
  /** Two to four words. What a player would call this moment. */
  readonly title: string;
  /** `lineId`s from the voice manifest, in the story's order. */
  readonly lines: readonly string[];
  /** A `BeatCamera.id`. */
  readonly camera: string;
  /** One sentence: what this beat is for. */
  readonly why: string;
}

/**
 * SEVEN ANGLES FOR FOURTEEN BEATS. A scene player wants a handful to cut
 * between, not one per beat: four of these are used more than once, and
 * the three that are not are each a specific moment the chapter turns on
 * — the panel, the doorway and the lean-in.
 */
export const CHAPTER_1_CAMERAS: readonly BeatCamera[] = Object.freeze([
  Object.freeze({ id: "jack-console-medium", subject: "Jack at his workstation, and whoever is standing over it", placement: "In the open floor south of Jack's desk, looking north at the desk, his chair and the monitor.", shot: "medium" }),
  Object.freeze({ id: "monitor-insert", subject: "The monitor face, and the hands at the keyboard under it", placement: "Close at Jack's desk, over the keyboard and into the screen's glow.", shot: "insert" }),
  Object.freeze({ id: "intercom-insert", subject: "The intercom unit on Jack's desk", placement: "Low at the desk's edge, close on the unit and its push-to-talk button to the left of his keyboard, with Jack's reaching hand coming into frame.", shot: "insert" }),
  Object.freeze({ id: "east-door-wide", subject: "The doorway, and the length of room between it and the workstations", placement: "Among the north workstations, looking east at the sliding door, so anyone entering comes in behind Jack.", shot: "wide" }),
  Object.freeze({ id: "over-shoulder-screen", subject: "The screen past Jack, with Sarah leaning into the frame", placement: "Behind Jack's right shoulder at his chair, looking down the line of his arm to the monitor.", shot: "over-shoulder" }),
  Object.freeze({ id: "north-workstations-wide", subject: "Both north desks and the aisle between them", placement: "Well south in the room, square to the north wall, both workstations and the floor between them in frame.", shot: "wide" }),
  Object.freeze({ id: "two-console-medium", subject: "Jack and Sarah side by side, a console each", placement: "In the aisle behind the two north desks, both monitors and both faces in one frame.", shot: "medium" }),
]);

export const CHAPTER_1_BEATS: readonly Beat[] = Object.freeze([
  Object.freeze({
    id: "warning-tone", title: "Warning Tone", camera: "jack-console-medium",
    why: "Wakes Jack into the alarm and opens the chapter.",
    lines: Object.freeze([
      "system-884c6f5a459a",
      "jack-bennett-2b8704441765",
    ]),
  }),
  Object.freeze({
    id: "network-monitor", title: "Network Monitor", camera: "monitor-insert",
    why: "The intrusion moves faster than he can trace it.",
    lines: Object.freeze([
      "jack-bennett-85dfddc7134b",
      "jack-bennett-492f4059781a",
      "jack-bennett-b9c31e4c82cf",
      "system-610b0d021f1b",
      "jack-bennett-549daf1f1de8",
      "jack-bennett-27b114bdd284",
    ]),
  }),
  Object.freeze({
    id: "tombs-directory", title: "TOMBS Directory", camera: "monitor-insert",
    why: "A generic breach becomes a breach of the protected project.",
    lines: Object.freeze([
      "system-a6ce88995aab",
      "jack-bennett-ecf78584ec95",
      "jack-bennett-2ffc77da7b3f",
    ]),
  }),
  Object.freeze({
    id: "calling-sarah", title: "Calling Sarah", camera: "intercom-insert",
    why: "He reaches for the intercom and gets static before he gets Sarah.",
    lines: Object.freeze([
      "jack-bennett-a8a6aa7ae3b3",
      "jack-bennett-45ac1e9fe1de",
      "sarah-bennett-284f0b08b165",
    ]),
  }),
  Object.freeze({
    id: "the-smarter-scientist", title: "The Smarter Scientist", camera: "jack-console-medium",
    why: "He talks her into coming, back at the desk rather than staring at a speaker grille.",
    lines: Object.freeze([
      "jack-bennett-3141593a1c9d",
      "sarah-bennett-c0ca574b594a",
      "jack-bennett-a376700976d7",
      "sarah-bennett-81ff0dc894cf",
      "jack-bennett-3d94cfec7c01",
      "sarah-bennett-5a071d01be77",
      "jack-bennett-632f5041e805",
      "sarah-bennett-2a350447dd17",
    ]),
  }),
  Object.freeze({
    id: "file-opened", title: "A File Opened", camera: "monitor-insert",
    why: "The cursor moves on its own and Boundary control opens.",
    lines: Object.freeze([
      "jack-bennett-31ac40401ca8",
      "system-49a4bf38c005",
      "jack-bennett-9b850bb838a8",
    ]),
  }),
  Object.freeze({
    id: "sarah-stepped-inside", title: "Sarah Stepped Inside", camera: "east-door-wide",
    why: "Sarah arrives and stops just inside the door, where the prose keeps her.",
    lines: Object.freeze([
      "sarah-bennett-41421ed41839",
      "jack-bennett-6aa0f73ed972",
      "sarah-bennett-e240820580d9",
      "jack-bennett-1ecaa1e81e25",
      "sarah-bennett-da6d3f2466a2",
    ]),
  }),
  Object.freeze({
    id: "over-his-shoulder", title: "Over His Shoulder", camera: "over-shoulder-screen",
    why: "She crosses the room and leans in, which is the shot the prose actually describes.",
    lines: Object.freeze([
      "jack-bennett-5658c97ddd78",
      "sarah-bennett-ecb1ce66f7bc",
      "jack-bennett-fa0505b74e44",
      "sarah-bennett-d26997d1aa80",
      "jack-bennett-050e0785c171",
      "sarah-bennett-ea3f24b4acf1",
    ]),
  }),
  Object.freeze({
    id: "it-unlocked-itself", title: "It Unlocked Itself", camera: "jack-console-medium",
    why: "Jack briefs her, and the terminal unlocking itself is the fact neither can explain.",
    lines: Object.freeze([
      "jack-bennett-5520e22c887a",
      "sarah-bennett-d446f7575941",
      "jack-bennett-4b4b13be3859",
      "sarah-bennett-65056aba0745",
      "jack-bennett-d97b90a6d54e",
      "sarah-bennett-a1dc5fafa6a9",
      "sarah-bennett-1ebe0c684d41",
      "jack-bennett-92ce22fee124",
      "jack-bennett-9cc3304964a3",
    ]),
  }),
  Object.freeze({
    id: "another-chair", title: "Another Chair", camera: "north-workstations-wide",
    why: "Sarah takes the seat and Jack fetches another, which re-blocks the room for two consoles.",
    lines: Object.freeze([
      "sarah-bennett-8c46e3a53152",
      "jack-bennett-01f2a89496de",
      "sarah-bennett-bf55452b11b2",
      "jack-bennett-a5c6ccccd8ca",
    ]),
  }),
  Object.freeze({
    id: "too-clean", title: "Too Clean", camera: "two-console-medium",
    why: "Both logs are spotless, and that is the thing that frightens her.",
    lines: Object.freeze([
      "sarah-bennett-ad67f921e02e",
      "jack-bennett-f3736d27f9d7",
      "sarah-bennett-563ad9289e68",
      "jack-bennett-211b122503c9",
      "sarah-bennett-6fe63af821c3",
      "jack-bennett-2a98eedf112f",
      "sarah-bennett-5965a9732934",
      "jack-bennett-57a1f5dfe461",
      "sarah-bennett-7cb92747650b",
      "jack-bennett-6de493fd3169",
      "sarah-bennett-deff6b10a48b",
      "jack-bennett-29c879a5b799",
    ]),
  }),
  Object.freeze({
    id: "eleven-at-night", title: "Eleven At Night", camera: "two-console-medium",
    why: "The one warm stretch in the chapter, and what it puts at stake.",
    lines: Object.freeze([
      "jack-bennett-e61a5b7e36cd",
      "sarah-bennett-e9ec137bc087",
      "jack-bennett-c1ff018af109",
      "sarah-bennett-4db8c4b299cf",
      "jack-bennett-48aebe4e6970",
      "sarah-bennett-0e24152e8551",
      "jack-bennett-753cad07ca15",
      "jack-bennett-941e93bf213e",
      "sarah-bennett-dc90fc8720b4",
      "jack-bennett-a8fc65386727",
      "sarah-bennett-b4465ab7292c",
    ]),
  }),
  Object.freeze({
    id: "new-warning-tone", title: "New Warning Tone", camera: "monitor-insert",
    why: "The array asks to initialize and refuses to be cancelled.",
    lines: Object.freeze([
      "system-f6a28699a3b1",
      "sarah-bennett-415320486988",
      "jack-bennett-a40ffc6ce592",
      "sarah-bennett-13bbe7381eb1",
      "system-0fe0cf2a5742",
      "jack-bennett-5d311a6c90d7",
    ]),
  }),
  Object.freeze({
    id: "access-revoked", title: "Access Revoked", camera: "jack-console-medium",
    why: "Only Jack can revoke Jack, and Jack did not.",
    lines: Object.freeze([
      "system-28a18477a67e",
      "sarah-bennett-85c20ef1167a",
      "jack-bennett-308767fde297",
      "sarah-bennett-d5bc7656345e",
      "sarah-bennett-ed9388bef578",
      "jack-bennett-77753d8b9f45",
      "jack-bennett-13662115397f",
    ]),
  }),
]);

/** Every line the chapter accounts for, in order — what a test compares against the manifest. */
export const CHAPTER_1_LINES: readonly string[] = Object.freeze(CHAPTER_1_BEATS.flatMap((b) => [...b.lines]));

/**
 * THE BEAT A LINE BELONGS TO, or null for a line this chapter does not
 * carry. Linear over fourteen beats, which is cheaper than the Map that
 * would have to be kept in step with them.
 */
export function beatOfLine(lineId: string): Beat | null {
  for (const beat of CHAPTER_1_BEATS) if (beat.lines.includes(lineId)) return beat;
  return null;
}
