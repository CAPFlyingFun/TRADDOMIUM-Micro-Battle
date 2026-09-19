/**
 * THE GAME'S AUDIO — Chapter 1's dialogue and sound, on four separate
 * buses under one master.
 *
 *   manifest.ts     what the bake produced and what a bus CARRIES: 88
 *                   voice lines and 20 sound assets, each with its own
 *                   authored gain, and the accounting that lets a UI be
 *                   honest about the empty MUSIC bus. Pure data
 *   mix.ts          the arithmetic: the perceptual fader curve, the
 *                   stored-levels sanitiser, and the duck that keeps a
 *                   ventilation bed off the dialogue. Pure: no
 *                   WebAudio, no DOM, so every number a player hears is
 *                   decided by something a test can run in plain node
 *   AudioEngine.ts  the platform: the gain graph, the iOS unlock, lazy
 *                   cached decoding, and the counters that say why
 *                   nothing is playing. The ONLY file here allowed to
 *                   touch an AudioContext
 *
 * The split is the same one `world/tombs` has with `tombs/`: the thing
 * that decides is testable without a browser, and the thing that talks
 * to the machine is one file with no decisions of its own in it.
 *
 * Audio is NOT core (ARCHITECTURE §3) — it fetches, it decodes and it
 * holds a device handle, none of which a server tick may do — so nothing
 * in `world/`, `actor/`, `data/`, `net/` or `persistence/` may import
 * this directory. A scene plays a line; the simulation says one should
 * be played.
 */
export {
  BUSES, BUS_LABEL, busCarries,
  type AudioManifest, type Bus, type SoundAsset, type VoiceLine,
} from './manifest';
export {
  DUCKED_BUSES, DUCK_ATTACK_S, DUCK_DEPTH_DB, DUCK_GAIN, DUCK_HOLD_S, DUCK_RELEASE_S,
  MIX_DEFAULTS, MIX_RANGE_DB, MIX_SHAPE,
  busGainFor, curveGain, duckGainAt, duckGainOf, duckRampTo, duckedGainFor, ducks, gainFor,
  masterGainFor, mixSnapshot, newDuckRamp, newDuckState, resetDuck, sanitizeMixLevels, stepDuck,
  type DuckRamp, type DuckState, type MixLevels,
} from './mix';
export {
  AudioEngine, newAudioStatus,
  type AudioEngineOptions, type AudioPhase, type AudioStatus,
} from './AudioEngine';
