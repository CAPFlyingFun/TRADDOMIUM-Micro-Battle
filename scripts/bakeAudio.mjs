/**
 * BAKE CHAPTER 1'S DIALOGUE AND SOUND OUT OF THE STORY REPOSITORY.
 *
 *     node scripts/bakeAudio.mjs
 *
 * Reads `capflyingfun/tmb-story`'s two game manifests, copies the chapter-1
 * subset into `public/audio/` and writes `src/audio/audioManifest.ts` beside
 * it. Nothing here generates a clip and no API key is needed to build this
 * repository — which is the whole point of the arrangement.
 *
 * ─── THE CLIPS ARE NOT OURS AND ARE NOT MADE HERE ───────────────────
 *
 * They were made for the MANUSCRIPT, with ElevenLabs, by the other
 * project: 237 character and system lines and 32 sound assets, each
 * already generated, cached, fingerprinted and cue-sheeted over there.
 * Joshua's brief is to REUSE them — "reuse existing ElevenLabs dialogue…
 * VOICE/SFX/AMBIENCE/MUSIC separated, Chapter 1 sample only" — so this is
 * a COPY and an accounting pass, nothing more.
 *
 * THE MASTERS ARE NEVER MODIFIED. Every source file is opened for reading
 * and the bytes are written to a destination under `public/`; there is no
 * code path here that opens anything under the story repository for
 * writing. On this machine the masters happen to be writable, so that is
 * a discipline rather than a permission, which is exactly why it is
 * stated instead of assumed.
 *
 * ─── IT IS A COPY, NOT A TRANSCODE, AND IT CHECKS THAT ──────────────
 *
 * All 108 chapter-1 files are already `.mp3`: 88 voice clips at 1,924,776
 * bytes (1.84 MB) and 20 sound assets at 2,126,115 bytes (2.03 MB), 3.86
 * MB together. There is no ffmpeg on this machine and none is needed.
 *
 * THAT IS TRUE OF CHAPTER 1 AND NOT OF THE SOURCE AS A WHOLE, which is
 * why the check below exists rather than a comment saying it is fine: of
 * the 32 sound assets, TWO are `.wav` — `amb_alarm_pulse` and
 * `amb_alarm_pulse_fast`, both procedural alarm beds, and both chapters 2
 * and 3. The day `CHAPTER` becomes 2 this script must refuse loudly, not
 * copy a WAV into `public/` for iOS Safari to decline at the first alarm
 * with the clip counted as `failed` and nobody knowing why. When that day
 * comes the fix is a transcode step here or an mp3 in the story
 * repository — a decision, made once, in daylight.
 *
 * The extension is checked AND the first bytes are, because a renamed
 * file is the failure a suffix cannot see. Both legal openings are
 * accepted: 107 of the 108 begin with an `ID3` tag, and one of them —
 * `amb_computer_lab`, the single asset whose `source` is `supplied`
 * rather than `generated` — begins at a bare MPEG frame sync (0xFF 0xF3).
 * A check that demanded ID3 would reject the one genuinely recorded
 * sound in the set.
 *
 * ─── WHICH BUS A SOUND PLAYS ON: THE LOOP, NOT THE FOLDER ───────────
 *
 * `src/audio/manifest.ts` owns the four buses; this script decides which
 * of them each sound asset belongs to, and the rule is:
 *
 *     a LOOPING bed is AMBIENCE, a ONE-SHOT is SFX.
 *
 * The story repository groups its assets by what they are ABOUT —
 * `ambience`, `alarm`, `system`, `foley`, `interface` — which is the
 * right grouping for a cue sheet and the wrong one for a mixer. A bus is
 * a fader a player reaches for, and what sends them reaching is a sound
 * that will not stop: the thing you turn down to hear dialogue is the
 * bed under it, whatever the bed is about.
 *
 * The two rules genuinely disagree, on 2 of the 20 chapter-1 assets, and
 * both disagreements go the same way:
 *
 *   amb_console_alarm_bed        category `alarm`   loops   -> ambience
 *   amb_tombs_array_power_rise   category `system`  loops   -> ambience
 *
 * By category the split is 2 ambience / 18 sfx; by loop it is 4 / 16.
 * Those two are a continuous alarm bed and a continuous array spin-up:
 * sounds a player listening to Jack would want under a bed fader, filed
 * by the manuscript under what they MEAN. Nothing runs the other way —
 * no asset categorised `ambience` is a one-shot — so the rule only ever
 * moves beds onto the bed fader.
 *
 * VOICE is not decided here at all: a voice line is a voice line, and
 * MUSIC is empty because no score exists in either repository. The
 * manifest reports `busCounts` so a settings panel can refuse to draw a
 * working-looking slider for a bus that carries nothing.
 *
 * ─── FLAT DIRECTORIES, NAMED BY ID ──────────────────────────────────
 *
 * `public/audio/voice/<lineId>.mp3` and `public/audio/sfx/<assetId>.mp3`.
 * The id is the stable key — the story repository derives it from the
 * text and the speaker, so a reworded line becomes a DIFFERENT id rather
 * than silently changing under a cue pointing at it — and it is what the
 * engine looks a clip up by. The masters are nested by speaker and by
 * category (`audio/clips/jack/…`, `audio/sfx/alarm/…`); carrying that
 * across would encode the other project's filing system into this build's
 * urls, so that a re-filing over there became a 404 over here.
 *
 * ─── IT PRUNES, BECAUSE A BUILD CANNOT NOTICE DEAD WEIGHT ───────────
 *
 * The bake OWNS `public/audio/` entirely. A second run with a narrower
 * chapter, a renamed line or a dropped asset deletes every file in there
 * it did not just write, and removes the directories that empties. Vite
 * copies `public/` verbatim and says nothing about what is in it: without
 * this, one chapter-2 experiment would ship its megabytes to every phone
 * for the rest of the project, and the only symptom would be a download
 * that was slightly too big forever.
 *
 * Unchanged files are left alone rather than rewritten, so a re-run does
 * not churn 108 modification times for nothing.
 *
 * ─── WHERE THE MANIFEST IS WRITTEN, AND WHAT THAT CROSSES ──────────
 *
 * `src/audio/audioManifest.ts`, because that is where this repository's
 * numbers live (ARCHITECTURE §7) and this is a registry of them: 108
 * urls, 20 authored gains and four bus counts.
 *
 * Two existing rules have a claim on that choice and it is worth being
 * plain about both rather than letting the integrator discover them.
 *
 *   - `tests/simulationCore` is the one that matters and it is SATISFIED.
 *     Core imports no three, no DOM, no storage, no network. The
 *     generated file imports a TYPE and nothing else, so the emitted
 *     module imports nothing at all from `src/audio/` and a server tick
 *     could carry it unchanged.
 *   - `tests/dataRegistries` asserts that `src/data` holds exactly
 *     `schema.ts` and `registries.ts` and imports only from itself. A
 *     third file there fails it whatever that file contains, so it has
 *     to be widened deliberately by whoever owns the tests — or this one
 *     constant, `OUT_MANIFEST`, moved. It is one line for exactly that
 *     reason.
 *
 * ─── ORDER IS THE STORY'S, NOT THE ALPHABET'S ───────────────────────
 *
 * The generated manifest keeps `dialogue.json`'s own order, which is
 * SCRIPT ORDER: the chapter opens on the system's "Warning. unauthorized
 * system access." and Jack's "What? Okay, I'm awake." Sorting by id would
 * throw that away to buy diff stability the source already provides — its
 * file is generated from the manuscript, so its order moves when the
 * manuscript moves, which is precisely when this file should move too.
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The chapter this build carries. ONE LINE, deliberately: the milestone
 * is "Chapter 1 sample only", and the next milestone should be this
 * number and a re-run — not a search through the script for every place
 * a 1 was written down.
 */
const CHAPTER = 1;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the masters live: `TMB_STORY_AUDIO`, or, with nothing set, the
 * story repository checked out beside this one — which is where it is on
 * Joshua's machine, so the ordinary case needs no setup at all.
 *
 * THE DEFAULT IS RELATIVE AND RESOLVED FROM THIS FILE, never written out
 * as an absolute path inside somebody's home directory, and that is not
 * fastidiousness. `tests/noMachinePaths` fails any file in `src`,
 * `tests`, `scripts` or `worker` that names one, because such a path
 * reached `main` once: it passed every local check on the machine it was
 * written on, then failed on the CI runner, whose checkout is somewhere
 * else entirely. The build job gates the deploy, so what it cost was not
 * a red tick — it was the version Joshua was waiting for never reaching
 * his phone. A path only one laptop can resolve belongs in an
 * environment variable or nowhere.
 *
 * It names the `audio` DIRECTORY, because that is the folder a person
 * would point at — but the `audio` field inside the manifests is
 * relative to the story repository's ROOT (`audio/clips/jack/….mp3`), so
 * clip paths resolve against the parent. Everything resolved that way is
 * then required to land back INSIDE the audio directory: these manifests
 * are data from another project, and data from another project does not
 * get to name a path this script will read.
 */
const SOURCE = resolve(process.env.TMB_STORY_AUDIO ?? resolve(ROOT, '..', 'capflyingfun', 'tmb-story', 'audio'));
const STORY_ROOT = dirname(SOURCE);

const OUT_AUDIO = join(ROOT, 'public', 'audio');
const OUT_VOICE = join(OUT_AUDIO, 'voice');
const OUT_SFX = join(OUT_AUDIO, 'sfx');
const OUT_MANIFEST = join(ROOT, 'src', 'audio', 'audioManifest.ts');

/** What the generated file tells a reader to run. Written once, used twice. */
const COMMAND = 'node scripts/bakeAudio.mjs';

const say = (line = '') => console.log(line === '' ? '' : `[bake:audio] ${line}`);
const complain = (line = '') => console.error(line === '' ? '' : `[bake:audio] ${line}`);
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
const repoPath = (abs) => relative(ROOT, abs).split(sep).join('/');

// ---------------------------------------------------------------------------
// Reading the masters
// ---------------------------------------------------------------------------

/**
 * `true` when these bytes open the way an MP3 opens: an `ID3` tag, or a
 * frame header, whose sync is eleven set bits — 0xFF then the top three
 * bits of the next byte. Both are in the chapter-1 set (see the header),
 * so both are accepted and nothing else is.
 */
function looksLikeMp3(data) {
  if (data.length < 3) return false;
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return true;
  return data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
}

/**
 * Read one clip named by a manifest, or record why it could not be read.
 *
 * Every fault is COLLECTED rather than thrown, so one run prints every
 * problem in the source instead of the first one; and nothing is written
 * anywhere until the list comes back empty.
 */
function readClip(relPath, what, faults) {
  const abs = resolve(STORY_ROOT, relPath);
  if (abs !== SOURCE && !abs.startsWith(SOURCE + sep)) {
    faults.push(`${what}: "${relPath}" resolves outside ${SOURCE}`);
    return null;
  }
  if (!relPath.toLowerCase().endsWith('.mp3')) {
    faults.push(`${what}: "${relPath}" is not an .mp3 — this bake copies and cannot transcode`);
    return null;
  }
  if (!existsSync(abs)) {
    faults.push(`${what}: "${relPath}" is named by the manifest and is not on disk`);
    return null;
  }
  const data = readFileSync(abs);
  if (!looksLikeMp3(data)) {
    faults.push(`${what}: "${relPath}" is named .mp3 but opens with neither an ID3 tag nor an MPEG frame sync`);
    return null;
  }
  return data;
}

/** One of the story repository's two game manifests, or a fault. */
function readManifest(name, faults) {
  const abs = join(SOURCE, 'game', name);
  if (!existsSync(abs)) {
    faults.push(`${abs} is missing — the story repository is there but its game manifests are not`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    faults.push(`${abs} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The bus rule
// ---------------------------------------------------------------------------

/**
 * A looping bed is AMBIENCE, a one-shot is SFX — the header says why the
 * asset's own `loop` flag decides this and its category does not.
 */
function busFor(asset) {
  return asset.loop ? 'ambience' : 'sfx';
}

// ---------------------------------------------------------------------------
// Writing, and owning what was written
// ---------------------------------------------------------------------------

/**
 * Write these bytes unless they are already there, and report which of
 * the three things happened. Comparing before writing keeps a re-run from
 * touching 108 modification times to produce a byte-identical tree.
 */
function put(dir, name, data) {
  const abs = join(dir, name);
  const had = existsSync(abs);
  if (had && readFileSync(abs).equals(data)) return { abs, state: 'unchanged' };
  writeFileSync(abs, data);
  return { abs, state: had ? 'replaced' : 'new' };
}

/** Every file under `dir`, absolute, deepest last. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs));
    else out.push(abs);
  }
  return out;
}

/** Remove every directory under `dir` that has nothing left in it, innermost first. */
function pruneEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(join(dir, entry.name));
  }
  if (dir !== OUT_AUDIO && readdirSync(dir).length === 0) rmdirSync(dir);
}

// ---------------------------------------------------------------------------
// The generated registry
// ---------------------------------------------------------------------------

/** A TypeScript string literal for arbitrary text. Double quotes, because the lines have apostrophes in them. */
const q = (text) => JSON.stringify(text);

function manifestSource(voice, sounds, busCounts, bytes, perCharacter) {
  const characters = [...perCharacter.entries()]
    .map(([, row]) => ` *   ${row.name.padEnd(26)} ${String(row.count).padStart(3)} lines   ${mb(row.bytes)}`)
    .join('\n');
  const buses = ['voice', 'sfx', 'ambience', 'music']
    .map((bus) => `${bus} ${busCounts[bus]}`)
    .join(', ');

  const lines = voice.map((line) => (
    `    { lineId: ${q(line.lineId)}, character: ${q(line.character)}, characterName: ${q(line.characterName)},`
    + ` text: ${q(line.text)}, url: ${q(line.url)}, chapters: [${line.chapters.join(', ')}] },`
  ));
  const assets = sounds.map((asset) => (
    `    { assetId: ${q(asset.assetId)}, bus: ${q(asset.bus)}, category: ${q(asset.category)},`
    + ` loop: ${asset.loop}, seconds: ${asset.seconds}, gain: ${asset.gain},`
    + ` url: ${q(asset.url)}, chapters: [${asset.chapters.join(', ')}] },`
  ));

  return `/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 *     ${COMMAND}
 *
 * Every edit made here is lost on the next bake. What a reader wants to
 * change is almost always in the story repository (the words, the clip,
 * the authored gain) or in \`scripts/bakeAudio.mjs\` (which chapter, which
 * bus); this file is only their sum, written down so the build needs
 * neither of them present.
 *
 * Chapter ${CHAPTER}, copied out of \`capflyingfun/tmb-story\` and into
 * \`public/audio/\`: ${voice.length} voice lines and ${sounds.length} sound assets, ${mb(bytes)} of mp3.
 *
${characters}
 *
 * Buses: ${buses}.
 *
 * MUSIC IS EMPTY, and that is not an oversight: no score exists in either
 * repository yet. \`busCarries()\` is how a settings panel asks before it
 * draws a fader, so that an unavailable action never looks functional.
 *
 * The bus of a sound is decided by the bake from the asset's own \`loop\`
 * flag, not from the story repository's category: a bed a player would
 * turn down to hear dialogue is AMBIENCE whether the manuscript files it
 * under \`alarm\`, \`system\` or \`ambience\`. The bake's header carries the
 * two assets where those rules disagree.
 *
 * \`src/data\` is where the numbers live (ARCHITECTURE §7) and this is a
 * registry of them. The import is TYPE-ONLY and is erased at build, so
 * nothing in \`data/\` carries a runtime dependency on \`src/audio/\` — only
 * the compiler links the shape.
 */
import type { AudioManifest } from '../audio/manifest';

export const AUDIO_MANIFEST: AudioManifest = {
  chapter: ${CHAPTER},
  voice: [
${lines.join('\n')}
  ],
  sounds: [
${assets.join('\n')}
  ],
  busCounts: { voice: ${busCounts.voice}, sfx: ${busCounts.sfx}, ambience: ${busCounts.ambience}, music: ${busCounts.music} },
  bytes: ${bytes},
};
`;
}

// ---------------------------------------------------------------------------

function refuseMissingSource() {
  complain(`no story audio at ${SOURCE}`);
  complain('');
  complain('Chapter 1\'s dialogue and sound are NOT generated in this repository and no');
  complain('API key will make them appear here. They are made for the manuscript by');
  complain('capflyingfun/tmb-story, with ElevenLabs, and cached in that repository:');
  complain('');
  complain('  <tmb-story>/audio/game/dialogue.json   237 lines, narration excluded');
  complain('  <tmb-story>/audio/game/sfx.json         32 sound assets');
  complain('  <tmb-story>/audio/clips/, /audio/sfx/   the mp3s themselves');
  complain('');
  complain('Clone or check out that repository, then point this bake at its audio folder:');
  complain('');
  complain(`  TMB_STORY_AUDIO=/path/to/tmb-story/audio ${COMMAND}`);
  complain('');
  complain('Nothing has been written. public/audio/ and src/audio/audioManifest.ts are');
  complain('untouched, so a build with an older bake in place still works.');
  process.exitCode = 1;
}

function main() {
  if (!existsSync(SOURCE) || !statSync(SOURCE).isDirectory()) {
    refuseMissingSource();
    return;
  }

  const faults = [];
  const dialogue = readManifest('dialogue.json', faults);
  const sfx = readManifest('sfx.json', faults);
  if (faults.length > 0) {
    for (const fault of faults) complain(fault);
    process.exitCode = 1;
    return;
  }

  const inChapter = (entry) => Array.isArray(entry.chapters) && entry.chapters.includes(CHAPTER);

  // Read and check EVERYTHING before writing anything: a bake that fails
  // half way leaves `public/audio/` describing neither the old chapter nor
  // the new one, and the manifest is the only thing that would say so.
  const voice = [];
  for (const line of dialogue.lines.filter(inChapter)) {
    const data = readClip(line.audio, `voice ${line.lineId}`, faults);
    if (data === null) continue;
    voice.push({
      lineId: line.lineId,
      character: line.character,
      characterName: line.characterName,
      text: line.text,
      url: `audio/voice/${line.lineId}.mp3`,
      chapters: line.chapters,
      data,
    });
  }

  const sounds = [];
  for (const asset of sfx.assets.filter(inChapter)) {
    const data = readClip(asset.audio, `sound ${asset.assetId}`, faults);
    if (data === null) continue;
    sounds.push({
      assetId: asset.assetId,
      bus: busFor(asset),
      category: asset.category,
      loop: asset.loop === true,
      seconds: asset.durationSeconds,
      gain: asset.suggestedGain,
      url: `audio/sfx/${asset.assetId}.mp3`,
      chapters: asset.chapters,
      data,
    });
  }

  if (faults.length > 0) {
    complain(`${faults.length} problem(s) in the masters — NOTHING was written:`);
    for (const fault of faults) complain(`  ${fault}`);
    complain('');
    complain('A .wav here is not a bug in the masters: two of the story repository\'s 32');
    complain('assets are procedural WAV alarm beds used by chapters 2 and 3. This bake');
    complain('copies and cannot transcode, so it refuses rather than shipping a clip the');
    complain('browser will decline. Add an mp3 over there, or add a transcode step here.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_VOICE, { recursive: true });
  mkdirSync(OUT_SFX, { recursive: true });

  const owned = new Set();
  const written = [];
  let bytes = 0;
  for (const line of voice) {
    const result = put(OUT_VOICE, `${line.lineId}.mp3`, line.data);
    owned.add(result.abs);
    written.push({ ...result, size: line.data.length, what: line.character });
    bytes += line.data.length;
  }
  for (const asset of sounds) {
    const result = put(OUT_SFX, `${asset.assetId}.mp3`, asset.data);
    owned.add(result.abs);
    written.push({ ...result, size: asset.data.length, what: asset.bus });
    bytes += asset.data.length;
  }

  // Everything in `public/audio/` that this run did not write is weight the
  // build would otherwise ship forever. See the header.
  const pruned = [];
  for (const abs of filesUnder(OUT_AUDIO)) {
    if (owned.has(abs)) continue;
    pruned.push({ abs, size: statSync(abs).size });
    unlinkSync(abs);
  }
  pruneEmptyDirs(OUT_AUDIO);

  const perCharacter = new Map();
  for (const line of voice) {
    const row = perCharacter.get(line.character) ?? { name: line.characterName, count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += line.data.length;
    perCharacter.set(line.character, row);
  }

  const busCounts = { voice: voice.length, sfx: 0, ambience: 0, music: 0 };
  for (const asset of sounds) busCounts[asset.bus] += 1;

  const source = manifestSource(voice, sounds, busCounts, bytes, perCharacter);
  const manifestChanged = !existsSync(OUT_MANIFEST) || readFileSync(OUT_MANIFEST, 'utf8') !== source;
  if (manifestChanged) writeFileSync(OUT_MANIFEST, source);

  // ---- the report ----

  say(`chapter ${CHAPTER} from ${SOURCE}`);
  say('');
  say(`VOICE  ${voice.length} lines`);
  for (const [character, row] of perCharacter) {
    say(`  ${character.padEnd(16)} ${String(row.count).padStart(3)} lines   ${mb(row.bytes).padStart(8)}   ${row.name}`);
  }
  say('');
  say(`SOUND  ${sounds.length} assets, by bus — a looping bed is ambience, a one-shot is sfx`);
  for (const bus of ['ambience', 'sfx']) {
    const rows = sounds.filter((asset) => asset.bus === bus);
    const size = rows.reduce((n, asset) => n + asset.data.length, 0);
    const categories = [...new Set(rows.map((asset) => asset.category))].sort().join(', ');
    say(`  ${bus.padEnd(16)} ${String(rows.length).padStart(3)} assets  ${mb(size).padStart(8)}   categories: ${categories}`);
  }
  const moved = sounds.filter((asset) => asset.bus === 'ambience' && asset.category !== 'ambience');
  say(`  the categories and the buses disagree on ${moved.length} of ${sounds.length}: `
    + `${moved.map((asset) => `${asset.assetId} (${asset.category}, loops)`).join('; ') || 'none'}`);
  say('');
  say(`BUSES  voice ${busCounts.voice}, sfx ${busCounts.sfx}, ambience ${busCounts.ambience}, `
    + `music ${busCounts.music}${busCounts.music === 0 ? ' (no score exists yet — busCarries() says so)' : ''}`);
  say('');
  say(`FILES  ${written.length} owned, ${mb(bytes)} of mp3`);
  for (const file of written) {
    const mark = file.state === 'new' ? '+' : file.state === 'replaced' ? '~' : ' ';
    say(`  ${mark} ${repoPath(file.abs).padEnd(58)} ${String(file.size).padStart(7)} B   ${file.what}`);
  }
  const fresh = written.filter((file) => file.state !== 'unchanged').length;
  say(`  ${fresh} written, ${written.length - fresh} already identical`);
  if (pruned.length > 0) {
    say('');
    say(`PRUNED ${pruned.length} file(s) this bake no longer owns, ${mb(pruned.reduce((n, file) => n + file.size, 0))} recovered`);
    for (const file of pruned) say(`  - ${repoPath(file.abs)}`);
  }
  say('');
  say(`${repoPath(OUT_MANIFEST)} ${manifestChanged ? 'written' : 'already current'} — `
    + `${voice.length} lines, ${sounds.length} assets, ${bytes} bytes`);
}

main();
