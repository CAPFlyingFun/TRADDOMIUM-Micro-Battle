/**
 * THE SARAH LAB'S HUB ENTRY and every name the scene answers to. Pure: no
 * three, no DOM, so a probe and a test can read the names without a renderer.
 *
 * Joshua, 2026-10-07, on rebuilding Sarah from his base mannequin with a belly
 * slider and clothes grown from her body: "Good to test Sarah maybe in a
 * separate link in like a Dev menu I can play around with before placing live".
 * So nothing here is the game's Sarah: the lab loads `models/sarah-base.glb`,
 * which no other scene reads.
 */
import { BELLY_KNOTS, bellyKeyWeights, type BellyCurve } from './bellyInterpolation';
import { BODY_CONTROLS, type BodyShape } from '../actor/bodyShape';
import type { RandomSpec } from '../actor/bodyRandom';
import type { DevTool } from '../devtools/DevTool';
import type { FabricFamilyId } from './fabricLibrary';

export const SARAH_LAB_SCENE_ID = 'lab:sarah';
export const SARAH_LAB_TOOL_ID = 'lab.sarah';
/** The lab's first model, v1, and the only place its path is written. */
export const SARAH_BASE_MODEL = 'models/sarah-base.glb';
/** Sarah v2 (Joshua, 2026-10-13): the newer master, arms down, outie navel modelled, five fingers rigged. */
export const SARAH_V2_MODEL = 'models/sarah-v2.glb';
/**
 * Sarah v2 with her armpits repaired for raised arms (Joshua, 2026-10-15), a separate
 * file so the approved v2 stays the reference: `scripts/sarahV2ArmWeights.mjs` rebuilds
 * her armpit weights along her skin and adds the raised-arm shapes armRaiseL/R.
 */
export const SARAH_V2_ARMS_MODEL = 'models/sarah-v2-arms.glb';
/**
 * The approved v2-arms body with its BODY-SHAPE FIELDS (`scripts/sarahV2Shape.mjs`, Joshua,
 * 2026-10-15): the same geometry and every approved shape, plus one field per body control,
 * applied on the CPU by the Lab. A separate file, so the approved v2-arms stays exactly as
 * it was beside it for comparison; with every control at its approved value it draws the
 * same body.
 */
export const SARAH_V2_BODY_MODEL = 'models/sarah-v2-body-slim.glb';
/**
 * The same body with her two skin maps GPU-compressed (KTX2; `scripts/sarahV2Recovery/body-ktx2.mjs`), a pilot to compare
 * on the phone: the room loads it in place of the slim body only when the address says `?skin=ktx2`.
 */
export const SARAH_V2_BODY_KTX2_MODEL = 'models/sarah-v2-body-slim-ktx2.glb';
/** Sarah v2's hair (`scripts/sarahV2Recovery/hair-bake.mjs`, Joshua 2026-10-24): one skinned mesh on her own skeleton. */
export const SARAH_V2_HAIR_MODEL = 'models/sarah-v2-hair.glb';
/** The model file the room loads for an entry: the KTX2 pilot replaces the slim body when asked for. */
export function sarahModelPath(entry: { readonly id: string; readonly path: string }, skin: 'ktx2' | null): string {
  return skin === 'ktx2' && entry.path === SARAH_V2_BODY_MODEL ? SARAH_V2_BODY_KTX2_MODEL : entry.path;
}
/**
 * The room loads the approved body's SLIM copy (Joshua, 2026-10-21: save download and memory): `sarah-v2-body.glb`
 * stays byte for byte as approved, and `scripts/sarahV2Recovery/body-slim.mjs` writes this file from it without the
 * garments the room no longer draws from it (both rises of leggings, each replaced by its own fitted file, and the
 * grown tee, with their trims), proving every part it keeps -- her body, the whole bikini, every morph target and
 * vertex order -- identical. 37.4 MB to 18.1 MB.
 */

/**
 * The models the lab can show, in the order MODEL cycles them (Joshua, 2026-10-13:
 * "add an option to switch between both models to compare"). v2 has no clothes yet.
 */
export const SARAH_LAB_MODELS = Object.freeze([
  Object.freeze({ id: 'v1', path: SARAH_BASE_MODEL }),
  Object.freeze({ id: 'v2', path: SARAH_V2_MODEL }),
  Object.freeze({ id: 'v2-arms', path: SARAH_V2_ARMS_MODEL }),
  Object.freeze({ id: 'v2-body', path: SARAH_V2_BODY_MODEL }),
]);

/**
 * THE LAB OPENS ON THE NEWEST v2 (Joshua, 2026-10-15: "the model I see online doesn't have
 * your fix of the belly, breasts, arms, and shoulder"). The fixes live in `v2-arms`, the
 * repaired asset beside the untouched approved files; opening on v1 hid them behind two
 * taps of MODEL. It now opens on `v2-body`, the same body with its shape fields, which
 * draws exactly as v2-arms until a body control moves; v1, v2 and v2-arms stay on MODEL.
 */
export const SARAH_LAB_DEFAULT_MODEL = SARAH_LAB_MODELS.findIndex((m) => m.id === 'v2-body');

export function modelLine(index: number): string {
  return `MODEL · ${SARAH_LAB_MODELS[((index % SARAH_LAB_MODELS.length) + SARAH_LAB_MODELS.length) % SARAH_LAB_MODELS.length].id}`;
}

export const sarahLabTool: DevTool = {
  id: SARAH_LAB_TOOL_ID,
  title: 'Sarah Lab (base model)',
  description:
    "Sarah rebuilt from the base mannequin, to try before she goes live: the BUMP slider runs from twice full term (twins and more, her breasts growing with it) to "
    + 'nearly flat, its own weight sags the belly past full term, BOUNCE (or WALK) shows it and her breasts move, FINGERS curls all ten, MODEL switches between v1 and the newer v2 to compare, OUTFIT cycles the clothes grown from her body (on v1 a red tee over black leggings; on v2 a white tank over grey maternity leggings, over the belly or under it; a bikini, a swimsuit, none), and STAND, '
    + 'WALK and SIT pose her. Drag to turn round her, pinch or scroll to come closer. Not used by the story or the game.',
  sceneId: SARAH_LAB_SCENE_ID,
};

/** The HUD root's `data-role`: what a probe waits for. */
export const SARAH_LAB_HUD_ROLE = 'sarah-lab-hud';

export type SarahLabPose = 'stand' | 'walk' | 'sit' | 'tpose';

export const SARAH_LAB_ACTION = Object.freeze({
  back: 'sarahlab:back',
  /** `${quickSize}<percent>`: the bump at one of its keyed sizes */
  quickSize: 'sarahlab:size:',
  undoBody: 'sarahlab:body-undo',
  redoBody: 'sarahlab:body-redo',
  theme: 'sarahlab:theme',
  /** `${view}<front|three-quarter|side|back>`: the camera at that angle */
  view: 'sarahlab:view:',
  fit: 'sarahlab:view-fit',
  photo: 'sarahlab:photo',
  stand: 'sarahlab:stand',
  walk: 'sarahlab:walk',
  sit: 'sarahlab:sit',
  tpose: 'sarahlab:tpose',
  turn: 'sarahlab:turn',
  bounce: 'sarahlab:bounce',
  outfit: 'sarahlab:outfit',
  model: 'sarahlab:model',
  refine: 'sarahlab:refine',
  bellyCurve: 'sarahlab:belly-curve',
  armSide: 'sarahlab:armside',
  /** `${bodyReset}<control>` resets one body control; `${tiltPreset}<deg>` sets the belly tilt */
  bodyReset: 'sarahlab:body-reset:',
  bodyResetAll: 'sarahlab:body-reset-all',
  /** `${bodyLink}<control>` links or unlinks one breast dimension; `bodyLinkAll` links all three, or unlinks them */
  bodyLink: 'sarahlab:body-link:',
  bodyLinkAll: 'sarahlab:body-link-all',
  tiltPreset: 'sarahlab:tilt:',
  /** the CAMERA tab, held upright: closer, further, and back to where the room starts */
  zoomIn: 'sarahlab:zoom-in',
  zoomOut: 'sarahlab:zoom-out',
  resetView: 'sarahlab:reset-view',
  /** RANDOMIZE, its group locks (`${randomGroupLock}belly`), a control's lock (`${randomLock}<key>`) and RANGES */
  randomize: 'sarahlab:randomize',
  randomGroupLock: 'sarahlab:random-group-lock:',
  randomLock: 'sarahlab:random-lock:',
  randomRanges: 'sarahlab:random-ranges',
  /** THE CLOTH EXPERIMENT (Joshua, 2026-10-23): the light tee as true cloth, on and off */
  cloth: 'sarahlab:cloth',
  /** the cloth laid on her again, and its dials back to their defaults */
  clothReset: 'sarahlab:cloth-reset',
  clothDefaults: 'sarahlab:cloth-defaults',
  /** the cloth tee's neckline, cut deeper as a U or a V (Joshua, 2026-10-24) */
  neckShape: 'sarahlab:neck-shape',
  /** FACE: her face drawn or bare, where her eyes look, blinking, talking, and `${faceIris}<name>` her eye colour */
  face: 'sarahlab:face',
  eyes: 'sarahlab:eyes',
  blink: 'sarahlab:blink',
  talk: 'sarahlab:talk',
  hair: 'sarahlab:hair',
  faceIris: 'sarahlab:face-iris:',
  /** FACE: her skin's map stepped through the candidates, a picture from the phone, and the brush (Joshua, 2026-10-24) */
  skin: 'sarahlab:skin',
  skinUpload: 'sarahlab:skin-upload',
  skinPaint: 'sarahlab:skin-paint',
  skinBare: 'sarahlab:skin-bare',
  /** `${skinColour}<swatch name>` */
  skinColour: 'sarahlab:skin-colour:',
  skinHard: 'sarahlab:skin-hard',
  skinErase: 'sarahlab:skin-erase',
  skinUndo: 'sarahlab:skin-undo',
  skinRedo: 'sarahlab:skin-redo',
  skinClear: 'sarahlab:skin-clear',
  skinSave: 'sarahlab:skin-save',
  /** a picture to paint WITH: upload it, colour or texture, tile or stamp */
  skinTextureUpload: 'sarahlab:skin-texture-upload',
  skinTexture: 'sarahlab:skin-texture',
  skinStamp: 'sarahlab:skin-stamp',
});

export const SARAH_LAB_FIELD = Object.freeze({
  /** the room's name and build at the top (`labTitle`) */
  title: 'sarahlab-title',
  status: 'sarahlab-status',
  bump: 'sarahlab-bump',
  fingers: 'sarahlab-fingers',
  arms: 'sarahlab-arms',
  /** `${body}<control>`: a body control's line; its slider follows it */
  body: 'sarahlab-body-',
  bodyNote: 'sarahlab-body-note',
  /** a painted shirt's length (Joshua, 2026-10-22: "from knee-length up to just above the crotch") */
  shirtLength: 'sarahlab-shirt-length',
  /** `${randomRange}<key>-min` / `-max`: a control's random range */
  randomRange: 'sarahlab-random-range-',
  /** the cloth tee's length (Joshua, 2026-10-23: "0% and make 100% at mid-thigh"), and what the cloth costs each frame */
  teeLength: 'sarahlab-tee-length',
  /** the cloth tee's neckline (Joshua, 2026-10-24: "U/V shape and select how deep up to turtleneck") */
  neckline: 'sarahlab-neckline',
  cloth: 'sarahlab-cloth',
  /** `${clothDial}<dial>`: one of the cloth's dials */
  clothDial: 'sarahlab-cloth-dial-',
  /** FACE: the mouth held open, the brows' and lips' amounts */
  faceMouth: 'sarahlab-face-mouth',
  faceBrows: 'sarahlab-face-brows',
  faceLips: 'sarahlab-face-lips',
  /** FACE: what the skin she wears is, and the brush's size and strength */
  skinNote: 'sarahlab-skin-note',
  skinBrush: 'sarahlab-skin-brush',
  skinStrength: 'sarahlab-skin-strength',
  skinTextureSize: 'sarahlab-skin-texture-size',
});

/** Where the cloth tee is: the light tee as one sheet, with rows below its hem to mid-thigh (`scripts/sarahV2Recovery/shirt-cloth.mjs`). */
export const CLOTH_SHIRT_PATH = 'models/sarah-v2-spandex-cloth.glb';
/** The cloth tee's LENGTH line: 0 the tee as made, 1 mid-thigh. */
export function teeLengthLine(length: number, cloth: boolean): string {
  const pct = Math.round(Math.max(0, Math.min(1, length)) * 100);
  return `TEE LENGTH · ${pct}% · ${pct === 0 ? 'as made' : pct >= 97 ? 'mid-thigh' : pct < 50 ? 'over her hips' : 'upper thigh'}${cloth ? '' : ' · with CLOTH SIM'}`;
}
/**
 * THE CLOTH TEE'S NECKLINE (Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can do U/V
 * shape and select how deep up to turtleneck? I would set the deepest/lowest point between the breasts and top belly"):
 * one slider from -100 to 100. Below 0 the collar rises up her neck, a share of the rows the cloth file carries there
 * (-100 all of them, a turtleneck); 0 is the scoop as made; above 0 the front is cut deeper, in the shape NECK SHAPE
 * says, to `deepestCm` below the scoop at 100 (her breasts' lower crease).
 */
export const CLOTH_NECKLINE_DEFAULT = 0;
export function necklineLine(value: number, shape: 'U' | 'V', deepestCm: number, cloth: boolean): string {
  const v = Math.round(Math.max(-100, Math.min(100, Number.isFinite(value) ? value : 0)));
  const off = cloth ? '' : ' · with CLOTH SIM';
  if (v === 0) return `NECKLINE · as made (scoop)${off}`;
  if (v < 0) {
    const s = -v / 100;
    return `NECKLINE · ${s >= 0.85 ? 'turtleneck' : s >= 0.5 ? 'mock neck' : s >= 0.25 ? 'crew neck' : 'higher scoop'} · ${-v}% of the collar${off}`;
  }
  return `NECKLINE · ${shape} · ${((v / 100) * deepestCm).toFixed(1)} cm deeper${v >= 97 ? ' · to under her bust' : ''}${off}`;
}
/** The NECK SHAPE button: which shape a neckline cut deeper than made takes. */
export function neckShapeLine(shape: 'U' | 'V', value: number): string {
  return `NECK SHAPE · ${shape === 'V' ? 'V' : 'U'}${value > 0 ? '' : ' · for a deeper cut'}`;
}
/**
 * THE CLOTH'S DIALS (Joshua, 2026-10-24: "test making the fabric more weighty (more gravity focused and less moving
 * around), tight/form fitting (less space between body and shirt for a tighter fit)... Could potentially even add sliders
 * to play with values in real time"). Each is a 0-100 slider; these say what it sets in the cloth (`clothSim.ts`'s
 * settings, and the stand-off `clothSkin.ts` keeps) and how its line reads.
 */
export type ClothDial = 'weight' | 'calm' | 'fit' | 'close' | 'stretch' | 'grip' | 'steps';
export type ClothTune = Readonly<Record<ClothDial, number>>;
export interface ClothDialSpec { readonly key: ClothDial; readonly line: (v: number) => string }
const dialAt = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)) / 100;
/** Gravity, times the real one: 0.25 to 4 (the slider is logarithmic). */
export const clothGravityScale = (v: number) => 0.25 * 16 ** dialAt(v);
/** Damping per second: 0 to 12. */
export const clothDamping = (v: number) => 12 * dialAt(v);
/** The pattern's size against the fitted tee: 1.05 (roomy) to 0.85 (snug). */
export const clothRestScale = (v: number) => 1.05 - 0.2 * dialAt(v);
/** How far off her skin it keeps, millimetres: 6 to 0.5. */
export const clothStandOffMm = (v: number) => 6 - 5.5 * dialAt(v);
/** How easily it stretches (XPBD compliance, 1e-8 firm to 1e-4 very stretchy) and how far it may (1.15 to 1.65 times). */
export const clothCompliance = (v: number) => 10 ** (-8 + 4 * dialAt(v));
export const clothMaxStretch = (v: number) => 1.15 + 0.5 * dialAt(v);
/**
 * How it holds on her skin: friction 0 to 1 UP AND DOWN her, and a fifth of that ACROSS her (Joshua, 2026-10-24: "I
 * would make grip instead how fast the animation moves vertically, with small changes to horizontally… with only a max
 * of 20% loss horizontally"). So GRIP sets how readily the tee rides up or slides down her and barely changes how it
 * eases round her.
 */
export const clothFriction = (v: number) => dialAt(v);
export const CLOTH_GRIP_ACROSS = 0.2;
export const clothFrictionAcross = (v: number) => CLOTH_GRIP_ACROSS * dialAt(v);
/** Solver substeps a frame, 2 to 16: smoothness against cost. */
export const clothSubsteps = (v: number) => Math.round(2 + 14 * dialAt(v));
export const CLOTH_DIALS: readonly ClothDialSpec[] = Object.freeze([
  { key: 'weight', line: (v) => `WEIGHT · ${clothGravityScale(v).toFixed(2)}× gravity` },
  { key: 'calm', line: (v) => `CALM · damping ${clothDamping(v).toFixed(1)}/s${dialAt(v) > 0.6 ? ' · settles fast' : dialAt(v) < 0.15 ? ' · lively' : ''}` },
  { key: 'fit', line: (v) => `FIT · pattern ${Math.round(clothRestScale(v) * 100)}% of the tee${clothRestScale(v) < 0.95 ? ' · snug' : clothRestScale(v) > 1 ? ' · roomy' : ''}` },
  { key: 'close', line: (v) => `CLOSENESS · ${clothStandOffMm(v).toFixed(1)} mm off her skin` },
  { key: 'stretch', line: (v) => `STRETCH · up to ${clothMaxStretch(v).toFixed(2)}× · give 1e${(-8 + 4 * dialAt(v)).toFixed(1)}` },
  { key: 'grip', line: (v) => `GRIP · up and down ${clothFriction(v).toFixed(2)} · across ${clothFrictionAcross(v).toFixed(2)}` },
  { key: 'steps', line: (v) => `QUALITY · ${clothSubsteps(v)} steps a frame` },
]);
/**
 * Joshua's own setting, found on his phone (2026-10-24: "I found I believe the perfect setting that I would like to be
 * used as the default for the cloth simulation"): half real gravity, settling fast, the snuggest pattern, half a
 * millimetre off her, a middling grip, 8 steps. STRETCH is the one change, to the middle (Joshua, the same morning:
 * "Stretch 50… I can always adjust per outfit's settings"): at his 0 the snug pattern could not give, so the tee rode
 * up her when she sat and above a 150% belly standing. (The first defaults, "weighty and form-fitting", were
 * 65 35 65 75 50 80 43.)
 */
export const CLOTH_TUNE_DEFAULT: ClothTune = Object.freeze({ weight: 25, calm: 100, fit: 100, close: 100, stretch: 50, grip: 50, steps: 43 });
/** The cloth tee's length when CLOTH SIM first comes on (his setting too): a fifth of the way to mid-thigh, over her hips. */
export const CLOTH_TEE_LENGTH_DEFAULT = 0.2;
/** The cloth settings a set of dials gives (`ClothSettings` in clothSim.ts), and its stand-off in world units (100 a metre). */
export function clothTuning(t: ClothTune): { readonly settings: { substeps: number; stretchCompliance: number; bendCompliance: number; restScale: number; maxStretch: number; damping: number; gravity: [number, number, number]; friction: number; frictionAcross: number }; readonly standOff: number } {
  return {
    settings: {
      substeps: clothSubsteps(t.steps), stretchCompliance: clothCompliance(t.stretch), bendCompliance: 1e-4, restScale: clothRestScale(t.fit),
      maxStretch: clothMaxStretch(t.stretch), damping: clothDamping(t.calm), gravity: [0, -981 * clothGravityScale(t.weight), 0], friction: clothFriction(t.grip),
      frictionAcross: clothFrictionAcross(t.grip),
    },
    standOff: clothStandOffMm(t.close) / 10,
  };
}

/** What the cloth costs, for the stage: particles, her skin, the cloth, the drawing, and the frame rate. */
export function clothLine(s: { readonly particles: number; readonly skinMs: number; readonly simMs: number; readonly drawMs: number; readonly substeps: number; readonly posed: number }, frameMs: number): string {
  const ms = (x: number) => x.toFixed(x < 10 ? 1 : 0);
  // the frame's cost and rate first: held upright the stage line is cut short, and those are the reading
  return `CLOTH · ${ms(s.skinMs + s.simMs + s.drawMs)} ms · ${Math.round(1000 / Math.max(1, frameMs))} fps · ${s.particles.toLocaleString('en-US')} points · skin ${ms(s.skinMs)} + cloth ${ms(s.simMs)} + draw ${ms(s.drawMs)} · ${s.substeps} steps`;
}

/**
 * The room's name and the build it is, over her name at the top (Joshua, 2026-10-25: "let's add the version number at
 * the top header like 'Character Lab v0.127'"): the package's own version, `1.0.0-alpha.N` read as v0.N, so a phone
 * says which build it is showing without opening anything.
 */
export function labTitle(version: string): string {
  const alpha = /alpha\.(\d+)/.exec(version);
  const v = alpha ? `v0.${alpha[1]}` : version && version !== 'unversioned' ? `v${version}` : '';
  return v ? `CHARACTER LAB ${v}` : 'CHARACTER LAB';
}

/** The cloth's line while she is seated: the fitted tee is worn then, and the cloth waits for her to stand. */
export const CLOTH_SEATED_LINE = 'CLOTH · seated: the fitted tee is worn until she stands';

/** The SHIRT LENGTH line: 0 just above her crotch, 1 just above her knee. */
export function shirtLengthLine(length: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, length)) * 100);
  const where = pct <= 3 ? 'just above the crotch' : pct >= 97 ? 'just above the knee' : pct < 40 ? 'upper thigh' : pct < 70 ? 'mid-thigh' : 'above the knee';
  return `SHIRT LENGTH · ${pct}% · ${where}`;
}

/** The flat morph target the bake writes (`scripts/bellyMorph.mjs`). */
export const BELLY_TARGET = 'belly';
/**
 * The bake's key sizes, largest first: how much bump each target leaves (the
 * full belly is the model itself, no target). Each smaller key is the same belly
 * shrunk, so the slider crossfades the two keys either side of it and every size
 * on the way is round (Joshua, 2026-10-07, with month-by-month photographs: "the
 * belly is not rounded like it should"). Past the model, 150% and 200% grow the same
 * belly deeper and lower, for twins and more ("can we make the belly stretch bigger
 * than the current max... and let it naturally sag more at the bottom").
 */
export const BELLY_KEYS: readonly (readonly [number, string | null])[] = [
  [2, 'belly200'], [1.5, 'belly150'], [1, null], [0.75, 'belly75'], [0.6, 'belly60'], [0.5, 'belly50'], [0.3, 'belly30'], [0.25, 'belly25'], [0, BELLY_TARGET],
];
/**
 * The clothes' material names (`scripts/growClothes.mjs`), and `shirtAthletic`, the
 * same tee fitted close to her (`scripts/fitAthleticTee.mjs`). `shirt` is the RELAXED
 * fit (Joshua, 2026-10-14: "preserve it as an optional Relaxed Fit and make the
 * improved version Athletic Fit").
 */
export const GARMENTS = ['shirt', 'leggings', 'bikini', 'swimsuit', 'shirtAthletic', 'leggingsLow'] as const;
export const RECOVERED_SHIRTS = ['shirtRelaxedHigh', 'shirtRelaxedLow', 'shirtSpandexHigh', 'shirtSpandexLow', 'shirtSpandexLite'] as const;
export type Garment = (typeof GARMENTS)[number] | (typeof RECOVERED_SHIRTS)[number];

/**
 * THE RECOVERED v2 CLOTHES, ONE FILE EACH, LOADED AS THEY ARE WORN (Joshua, 2026-10-20: "load the room and selected
 * character first, followed by the currently selected clothing and its textures. Other outfits should load only when
 * needed"). Opening the room used to fetch the bikini bottom and both rises of leggings whatever she wore -- 23 MB of
 * the 128 MB she waited for. The shirt files are one in memory at a time; the rest stay once fetched.
 */
export type RecoveredPart = 'leggings' | 'leggings-low' | 'bottom' | 'relaxed-high' | 'relaxed-low' | 'spandex-high' | 'spandex-low' | 'spandex-lite';
const PART_OF: Partial<Record<Garment, RecoveredPart>> = {
  leggings: 'leggings', leggingsLow: 'leggings-low', bikini: 'bottom',
  shirtRelaxedHigh: 'relaxed-high', shirtRelaxedLow: 'relaxed-low', shirtSpandexHigh: 'spandex-high', shirtSpandexLow: 'spandex-low',
  shirtSpandexLite: 'spandex-lite',
};
/**
 * THE LIGHT SPANDEX TEE (Joshua, 2026-10-23: "use that shirt ChatGPT used, but then basically compress it/make it a lot
 * less vertices and try and optimize it for speed, size, and quality"). The high-waisted spandex tee simplified for
 * every belly size at once (`scripts/sarahV2Recovery/shirt-lite.mjs`): one small file where the original is 81 MB, so
 * it is offered beside the painted outfits, which the big modelled shirts are not.
 */
const LIGHT_PARTS: readonly RecoveredPart[] = ['bottom', 'spandex-lite'];
/** The garments the approved v2 body can wear from their own files, whatever its own file still carries. */
export const RECOVERED_GARMENTS = Object.freeze(Object.keys(PART_OF) as Garment[]);
/** The recovered files a set of worn garments needs, in the order they are worth fetching: smallest first. */
export function recoveredPartsFor(worn: readonly Garment[]): RecoveredPart[] {
  const parts = worn.map((g) => PART_OF[g]).filter((p): p is RecoveredPart => !!p);
  return [...new Set(parts)].sort((a, b) => Number(isShirtPart(a)) - Number(isShirtPart(b)));
}
export const isShirtPart = (part: RecoveredPart): boolean => part.startsWith('relaxed') || part.startsWith('spandex');
export const recoveredPartPath = (part: RecoveredPart): string => `models/sarah-v2-${part}.${isShirtPart(part) && part !== 'spandex-lite' ? 'gltf' : 'glb'}`;
/** The garment a shirt file is worn as. */
export const shirtOfPart = (part: RecoveredPart): Garment => (Object.entries(PART_OF).find(([, p]) => p === part)?.[0] ?? 'shirt') as Garment;

/**
 * THE SKIN UNDER WORN CLOTHES IS NOT DRAWN (Joshua, 2026-10-14: "consider masking covered
 * skin if necessary to eliminate clipping, while preserving visible skin outside"). The
 * bake marks, on every body vertex, which garments cover it (`_CLOTH_COVER`, one bit per
 * garment in `GARMENTS` order). Skin a shown garment covers entirely cannot poke through
 * it, however the pose folds her. The modelled bikini is left out: its cut is not the
 * grown one the bits describe.
 */
export const MASKING_GARMENTS: readonly Garment[] = ['shirt', 'leggings', 'swimsuit', 'shirtAthletic', 'leggingsLow'];
/** v2's body is never hidden under clothes (Joshua, 2026-10-19); v1 keeps its cover masking. */
export function bodyNeverHidden(modelId: string): boolean {
  return modelId.startsWith('v2');
}
export function coverMask(shown: readonly Garment[]): number {
  let m = 0;
  for (const g of shown) if (MASKING_GARMENTS.includes(g)) m |= 1 << GARMENTS.indexOf(g as (typeof GARMENTS)[number]);
  return m;
}
/** The leggings under the athletic tee, away from its hem, are not drawn while it is worn (`_UNDER_TOP`, `scripts/fitAthleticTee.mjs`). */
export const UNDER_TOP_GARMENT: Garment = 'shirtAthletic';
/** Keep skin at garment boundaries; remove only faces fully covered by one shown garment. */
export function uncoveredSkinIndices(indices: ArrayLike<number>, coverage: ArrayLike<number>, shown: number): Uint32Array {
  const kept: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (!(coverage[a] & coverage[b] & coverage[c] & shown)) kept.push(a, b, c);
  }
  return new Uint32Array(kept);
}

/**
 * THE OUTFITS the OUTFIT button cycles through, each the garments it shows (Joshua,
 * 2026-10-08: the red tee over black leggings, then "something simple like a bikini...
 * swimsuit... all one piece outfit"). Clothes that hang off the body (shirts that
 * flare, jackets, shorts) wait for a real second mesh.
 */
/** One layer of a painted outfit: a coverage template (`paintTemplates.ts`) in a fabric swatch (`fabricLibrary.ts`). */
/** Sarah's red and her leggings' charcoal, from Joshua's reference picture of her (2026-10-23). */
export const SARAH_RED = '#be0f2a', SARAH_LEGGINGS = '#3a3b52';
/** One layer of a built-in outfit: a template and its fabric, a pack colour or a custom one (`tint`, fabricTint.ts). */
export interface PaintedLayer { readonly template: string; readonly fabric: { readonly family: FabricFamilyId; readonly colour: number; readonly tint?: string } }
/** A modelled garment's fabric in a built-in outfit, as the editor's FABRIC would set it. */
export type OutfitFabric = PaintedLayer['fabric'];
export const OUTFITS: readonly { readonly name: string; readonly garments: readonly Garment[]; readonly paint?: readonly PaintedLayer[]; readonly fabrics?: Partial<Record<Garment, OutfitFabric>> }[] = [
  { name: 'tee + leggings', garments: ['shirtAthletic', 'leggings'] },
  { name: 'top + low leggings', garments: ['shirtAthletic', 'leggingsLow'] },
  { name: 'bikini', garments: ['bikini'] },
  { name: 'swimsuit', garments: ['swimsuit'] },
  { name: 'none', garments: [] },
  { name: 'spandex + high leggings', garments: ['shirtSpandexHigh', 'leggings'] },
  { name: 'spandex + low leggings', garments: ['shirtSpandexLow', 'leggingsLow'] },
  // PAINTED OUTFITS (Joshua, 2026-10-21: "try body paint for all the clothing"): the same white tee over grey
  // leggings, in both rises, as paint on her skin -- no garment file to download, no morphs of its own (it follows
  // every belly and breast shape for free). Layers paint bottom first. Only on the approved v2 body.
  // SARAH'S OUTFIT (Joshua, 2026-10-23, from his reference picture: "match and make the default outfit for Sarah, this
  // one"): a red tee over charcoal leggings, both custom colours measured off the picture. The picture's neckline is a
  // round scoop; a scoop painted on her today draws a wavy edge across the large triangles of her upper chest, so she
  // wears the crew, whose edge is clean, until a scoop can be drawn as cleanly
  // ...and the same outfit in the modelled spandex tee, light enough to offer: its round scoop neck and curved hem are
  // the picture's, its red is the same dye on jersey; the leggings stay painted under it
  { name: 'Sarah · red spandex tee + charcoal leggings', garments: ['shirtSpandexLite'], paint: [{ template: 'leggingsFull', fabric: { family: 'athletic', colour: 0, tint: SARAH_LEGGINGS } }], fabrics: { shirtSpandexLite: { family: 'jersey', colour: 0, tint: SARAH_RED } } },
  { name: 'Sarah · red tee + charcoal leggings', garments: [], paint: [{ template: 'leggingsFull', fabric: { family: 'athletic', colour: 0, tint: SARAH_LEGGINGS } }, { template: 'teeShort', fabric: { family: 'jersey', colour: 0, tint: SARAH_RED } }] },
  { name: 'painted tee + leggings', garments: [], paint: [{ template: 'leggingsFull', fabric: { family: 'athletic', colour: 1 } }, { template: 'teeShort', fabric: { family: 'jersey', colour: 0 } }] },
  { name: 'painted tee + low leggings', garments: [], paint: [{ template: 'leggingsUnder', fabric: { family: 'athletic', colour: 1 } }, { template: 'teeShort', fabric: { family: 'jersey', colour: 0 } }] },
  { name: 'painted U-neck tee + leggings', garments: [], paint: [{ template: 'leggingsFull', fabric: { family: 'athletic', colour: 1 } }, { template: 'teeU', fabric: { family: 'jersey', colour: 0 } }] },
  { name: 'painted V-neck tee + leggings', garments: [], paint: [{ template: 'leggingsFull', fabric: { family: 'athletic', colour: 1 } }, { template: 'teeV', fabric: { family: 'jersey', colour: 0 } }] },
  { name: 'painted swimsuit', garments: [], paint: [{ template: 'swimsuit', fabric: { family: 'athletic', colour: 14 } }] },
  { name: 'painted leotard', garments: [], paint: [{ template: 'bodysuit', fabric: { family: 'athletic', colour: 15 } }] },
];
/** Sarah's own red tee and charcoal leggings, all painted: nothing to download. */
export const PAINTED_DEFAULT_OUTFIT = OUTFITS.findIndex((o) => o.name === 'Sarah · red tee + charcoal leggings');
/**
 * The outfit the room opens in on the approved v2 body (Joshua, 2026-10-23: "use that shirt ChatGPT used, but ...
 * compress it"): the modelled spandex tee, light, in her red, over the painted charcoal leggings. Its round scoop neck
 * and curved hem are his picture's, which the painted tee's crew neck and straight hem were not.
 */
export const SARAH_DEFAULT_OUTFIT = OUTFITS.findIndex((o) => o.name === 'Sarah · red spandex tee + charcoal leggings');
/** Painted outfits are masks on the approved v2 body's own vertices: offered only where that body is (its recovered shirts are listed). */
export const paintedOutfitsAvailable = (available: readonly Garment[]): boolean => available.includes('shirtRelaxedHigh');
/**
 * THE ATHLETIC FIT IS THE TEE (Joshua, 2026-10-14: "keep Athletic Fit as the default
 * shirt; remove the old Relaxed Fit option once Athletic Fit is validated"). The grown
 * tee (`shirt`) stays in the file only for a model with no athletic tee yet (v2), which
 * wears it in its place.
 */
export function wornGarments(index: number, available: readonly Garment[]): Garment[] {
  return wantedGarments(index, available).filter((g) => available.includes(g));
}
/** What outfit `index` asks for on a model offering `available` (on the approved v2 body, its first two wear the recovered relaxed shirts). */
function wantedGarments(index: number, available: readonly Garment[]): Garment[] {
  const outfit = OUTFITS[((index % OUTFITS.length) + OUTFITS.length) % OUTFITS.length];
  if (available.includes('shirtRelaxedHigh') && (index === 0 || index === 1)) return index === 0 ? ['shirtRelaxedHigh', 'leggings'] : ['shirtRelaxedLow', 'leggingsLow'];
  return outfit.garments.map((g) => (g === 'shirtAthletic' && !available.includes(g) ? 'shirt' : g));
}
/**
 * An outfit a model cannot dress (v1 has no under-the-belly leggings) is skipped, not shown
 * half-worn. With no list of what the model carries, every outfit is offered.
 */
export function nextOutfit(index: number, available: readonly Garment[] = []): number {
  for (let step = 1; step <= OUTFITS.length; step += 1) {
    const next = (index + step) % OUTFITS.length;
    if (offered(next, available)) return next;
  }
  return (index + 1) % OUTFITS.length;
}
/** Whether a model offering `available` offers outfit `index` (what OUTFIT steps through, and the WEAR cards show). */
function offered(index: number, available: readonly Garment[]): boolean {
  const wanted = wantedGarments(index, available);
  if (OUTFITS[index].paint && available.length && !paintedOutfitsAvailable(available)) return false;
  // where painted outfits are, the modelled clothes that need their own files are kept but never offered, so never
  // downloaded (Joshua, 2026-10-22: "keep the modeled clothing, but not load them"); the bikini stays (its design is
  // protected, and its top is in her own file)
  if (paintedOutfitsAvailable(available) && recoveredPartsFor(wanted).some((part) => !LIGHT_PARTS.includes(part))) return false;
  return !available.length || wanted.every((g) => available.includes(g));
}
/** Every outfit a model offering `available` offers, in OUTFITS order, without 'none' (a blank outfit is NEW OUTFIT's). */
export function offeredOutfits(available: readonly Garment[]): number[] {
  return OUTFITS.map((_, i) => i).filter((i) => OUTFITS[i].name !== 'none' && offered(i, available));
}
/** Where a built-in outfit's baked card picture is served (`scripts/bakeOutfitThumbs.mjs` writes it). */
export const outfitThumbPath = (name: string): string => `sarahlab/outfits/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`;
/**
 * THE v2 OUTFIT (Joshua, 2026-10-16/17): a white tank over grey maternity leggings, in two
 * rises, over the belly and under it. Each edge is a bound trim, its own primitive named
 * `<garment>Trim` (`.scratch/outfit/trim.mjs`), shown with its garment; the high leggings'
 * waistband is under the tank, so its trim is not drawn while the tank is worn.
 */
export function trimShown(material: string, shown: readonly Garment[]): boolean | null {
  if (!material.endsWith('Trim')) return null;
  const of = material.slice(0, -4) as Garment;
  if (!(GARMENTS as readonly string[]).includes(of)) return null;
  if (of === 'leggings' && (shown.includes('shirt') || shown.includes('shirtRelaxedHigh') || shown.includes('shirtSpandexHigh') || shown.includes('shirtSpandexLite'))) return false;
  return shown.includes(of);
}
export function outfitLine(index: number): string {
  return `OUTFIT · ${OUTFITS[((index % OUTFITS.length) + OUTFITS.length) % OUTFITS.length].name}`;
}

/**
 * The bump slider reads as how much bump there is. Each target's weight: the two
 * keys either side of the slider share it, every other target is 0.
 */
/** The bump slider's top: twice the model's own belly. */
export const BUMP_MAX_PERCENT = 200;

/**
 * RANDOMIZE's controls (Joshua, 2026-10-22): the bump (in the BELLY group, so the group lock holds it too) and every
 * body-shape control, each with the range RANDOMIZE picks from until it is changed -- the bump its whole slider, a shape
 * control twice its natural spread either side of the approved value (`BodyControlSpec.spread`). A control added to
 * BODY_CONTROLS later (height, hips, waist, arms, face) joins here with no other change.
 */
export const BODY_RANDOM_SPECS: readonly RandomSpec[] = Object.freeze([
  Object.freeze({ key: 'bump', group: 'belly', min: 0, max: BUMP_MAX_PERCENT, step: 1, defaultMin: 0, defaultMax: BUMP_MAX_PERCENT }),
  ...BODY_CONTROLS.map((c) => Object.freeze({ key: c.key, group: c.group, min: c.min, max: c.max, step: c.step, defaultMin: Math.max(c.min, c.fallback - 2 * c.spread), defaultMax: Math.min(c.max, c.fallback + 2 * c.spread) })),
]);


/**
 * SARAH v2'S CURVE, SWITCHABLE (Joshua, 2026-10-13: "If a curvature correction is
 * necessary at 100%, implement it as a separate, reversible shape refinement that can
 * be toggled for comparison"). Her master is 100% and is never reshaped; the bake
 * writes the corrected upper-belly curve at 100% as its own target, and the Lab's
 * CURVE button turns it on. Full at 100%, gone by 85% (the smaller sizes are built
 * from the master) and by 150% (the grown sizes carry the curve themselves).
 * v1 has no such target and the button is not shown for it.
 */
export const BELLY_REFINE_TARGET = 'bellyRefine';

/**
 * THE SEATED CORRECTIVE (Joshua, 2026-10-14: "if the lower belly still has a slight
 * point while sitting, try a subtle pose-specific corrective morph. Do not modify the
 * approved standing geometry"). `scripts/addSeatCorrective.mjs` bakes `bellySeat`,
 * which carries the bump's lower flanks forward over the thighs; it is on only while
 * she sits, scaled by how far into the sit she is (`seated`, 0..1, so a transition can
 * ease it). It is full from 90% to 110% and gone by 50% and by 150%: under 50% the
 * bump is too small to be covered, and past 150% the pelvis weighting
 * (`scripts/protectGrownBump.mjs`) already keeps the underside round, where this shape,
 * written on the 100% body, would flatten a facet into the bigger flank.
 * It is a shape, not soft tissue: nothing here answers to contact.
 */
export const SEAT_TARGET = 'bellySeat';

export function seatCorrectiveWeight(seated: number, bumpPercent: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0));
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const ease = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
  return s * ease((b - 0.5) / 0.4) * (1 - ease((b - 1.1) / 0.4));
}

/**
 * SARAH v2's SEATED CORRECTIVE (Joshua, 2026-10-14: "As the legs bend upward, gradually
 * reduce the belly's downward tilt only as much as needed to avoid intersection... minimal
 * or no correction when standing"). `bellySeatV2` (scripts/sarahV2Correctives.mjs) eases
 * the lower half of her bump up and a little forward; seated it is nothing by 50%, all of
 * it at 100%, and grows on to twice that at 200%, where the bump hangs lowest. Standing it
 * is nothing at every size. v1 has no such target and ignores it.
 */
export const SEAT_V2_TARGET = 'bellySeatV2';
export function seatCorrectiveV2Weight(seated: number, bumpPercent: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0));
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const u = Math.min(1, Math.max(0, (b - 0.5) / 0.5));
  return s * (b <= 1 ? u * u * (3 - 2 * u) : b);
}

export function refineWeight(on: boolean, bumpPercent: number): number {
  if (!on) return 0;
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  if (b <= 1) { const u = Math.min(1, Math.max(0, (b - 0.85) / 0.15)); return u * u * (3 - 2 * u); }
  return Math.max(0, 1 - (b - 1) / 0.5);
}

export function refineLine(on: boolean): string {
  return on ? 'CURVE · refined' : 'CURVE · as modelled';
}

/**
 * A value tabulated at the belly keys (largest first), at a belly size, along a belly curve: the approved straight
 * crossfade, or the experiment's (`bellyInterpolation.ts`), which weighs every key.
 */
function keyed(table: readonly (readonly [number, number])[], bumpPercent: number, curve: BellyCurve): number {
  const w = bellyKeyWeights(bumpPercent, curve);
  let v = 0;
  for (const [s, r] of table) { const k = BELLY_KNOTS.indexOf(s); if (k >= 0) v += w[k] * r; }
  return v;
}

/** Each belly key target's weight at a size. `curve` is the experiment (default: exactly the approved slider). */
export function bellyWeights(bumpPercent: number, curve: BellyCurve = 'approved'): Record<string, number> {
  if (curve !== 'approved') {
    const w = bellyKeyWeights(bumpPercent, curve), out: Record<string, number> = {};
    for (const [s, name] of BELLY_KEYS) if (name) out[name] = w[BELLY_KNOTS.indexOf(s)];
    return out;
  }
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const out: Record<string, number> = {};
  for (const [, name] of BELLY_KEYS) if (name) out[name] = 0;
  for (let i = 0; i < BELLY_KEYS.length - 1; i += 1) {
    const [s0, n0] = BELLY_KEYS[i], [s1, n1] = BELLY_KEYS[i + 1];
    if (b > s0 || b < s1) continue;
    const f = (s0 - b) / (s0 - s1);
    if (n0) out[n0] = 1 - f;
    if (n1) out[n1] = f;
    break;
  }
  return out;
}

/**
 * Original bust at zero. Research-informed nominal volume targets are 1.30 at
 * belly 100 and an optional larger 1.55 at 200. Width is capped at +10%.
 * These are artistic shape targets, not measured anatomy or predictions.
 */
export const BREAST_TARGETS = Object.freeze({ small: 'breast0', big: 'breast100', bob: 'breastBob' });
/** Nominal volume target, not measured mesh volume or a medical prediction. */
export function breastVolumeRatio(bumpPercent: number): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  return p <= 100 ? 1 + 0.30 * p / 100 : 1.30 + 0.25 * (p - 100) / 100;
}
export function breastPercent(bumpPercent: number): number {
  return (breastVolumeRatio(bumpPercent) - 1) / 0.55 * 100;
}
/**
 * The breasts' own spring: lighter than the bump, so a little quicker and a little
 * looser. GAME TUNING.
 */
export const BREAST_SPRING = Object.freeze({ hz: 2.8, damping: 0.28, maxM: 0.012, maxAccel: 40 });
/** One step of the breasts' spring, in place (the same body motion as the bump's). */
export function stepBreastSpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number): BellySpring {
  return stepSpring(s, dt, upAccel, leftAccel, BREAST_SPRING);
}
/** How much of their spring's travel the breasts show (Joshua, 2026-10-08: "reduce the breast bounce by 55%"). GAME TUNING. */
export const BREAST_SWING = 0.45;
/** breastBob's weight: the spring's drop, bigger breasts swinging more. */
export function breastBobWeight(bumpPercent: number, s: BellySpring): number {
  return BREAST_SWING * breastVolumeRatio(bumpPercent) * (s.y / BELLY_MOTION.bobM);
}

export function breastWeights(bumpPercent: number): Record<string, number> {
  const b = breastPercent(bumpPercent);
  return {
    [BREAST_TARGETS.small]: 0,
    [BREAST_TARGETS.big]: b / 100,
  };
}

/**
 * THE BUST GROWS THE WAY THE BELLY DOES (Joshua, 2026-10-15: "make the breasts look more
 * rounded from the front... do the breasts similar to the belly and how it gets bigger and
 * smaller"). `breastGrow` (scripts/sarahV2Refine.mjs) is her own 0% breast scaled evenly in
 * every direction to BREAST_GROW_MAX_VOLUME; a blend of one even scaling is an even scaling,
 * so each size is her round 0% shape, at the same nominal volume targets as before
 * (`breastVolumeRatio`). A model that carries it uses it in place of `breast100`; one that
 * does not (v1) keeps `breast100` exactly.
 */
export const BREAST_GROW_TARGET = 'breastGrow';

/**
 * Sarah v2 sits the settled way (`SeatedPose.settled`, Joshua, 2026-10-15: "refine the seated
 * pose so it still looks natural and comfortable with the belly"); v1 keeps the sit it was
 * tuned with.
 */
export function settledSitFor(modelId: string): boolean {
  return modelId.startsWith('v2');
}
export const BREAST_GROW_MAX_VOLUME = 1.55;
export function breastGrowWeight(bumpPercent: number): number {
  return (Math.cbrt(breastVolumeRatio(bumpPercent)) - 1) / (Math.cbrt(BREAST_GROW_MAX_VOLUME) - 1);
}
export function breastWeightsFor(bumpPercent: number, grows: boolean): Record<string, number> {
  if (!grows) return breastWeights(bumpPercent);
  return { [BREAST_TARGETS.small]: 0, [BREAST_TARGETS.big]: 0, [BREAST_GROW_TARGET]: breastGrowWeight(bumpPercent) };
}

/**
 * THE UPPER BELLY, A LITTLE TALLER AND FULLER (Joshua, 2026-10-15: "from around the belly
 * button upward, by about 5% more height/fullness... keep this subtle"). `bellyUpper`
 * (scripts/sarahV2Refine.mjs) is written on the 100% bump; each size takes it by how big its
 * own upper bump is against 100%'s, crossfaded between the keys the way `bellyWeights` is.
 * Measured on v2 by the script and stamped in the file (`bellyUpperScale`); the test holds
 * this table to the file.
 */
export const BELLY_UPPER_TARGET = 'bellyUpper';
export const BELLY_UPPER_SCALE: readonly (readonly [number, number])[] = [
  [2, 1.649], [1.5, 1.32], [1, 1], [0.75, 0.513], [0.6, 0.306], [0.5, 0.169], [0.3, 0.042], [0.25, 0.01], [0, 0],
];
export function bellyUpperWeight(bumpPercent: number, curve: BellyCurve = 'approved'): number {
  if (curve !== 'approved') return keyed(BELLY_UPPER_SCALE, bumpPercent, curve);
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  for (let i = 0; i < BELLY_UPPER_SCALE.length - 1; i += 1) {
    const [s0, r0] = BELLY_UPPER_SCALE[i], [s1, r1] = BELLY_UPPER_SCALE[i + 1];
    if (b > s0 || b < s1) continue;
    const f = (s0 - b) / (s0 - s1);
    return r0 * (1 - f) + r1 * f;
  }
  return 0;
}

/** 0.075 mm per percent, capped at the baked 10.5 mm projection (140%). */
export function navelWeights(bumpPercent: number, navelPercent = 0): Record<string, number> {
  const p=Math.min(BUMP_MAX_PERCENT,Math.max(0,Number.isFinite(bumpPercent)?bumpPercent:100));
  // v1's own navel shapes, with the NAVEL control added on (Sarah v2's navel is `navelFlat`, below)
  const n = Number.isFinite(navelPercent) ? navelPercent / 100 : 0, out = Math.min(1, p / 140) + n;
  return {navelIn:Math.min(1,Math.max(0,-out)),navelOut:Math.min(1,Math.max(0,out))};
}

/**
 * Sarah v2's outie arrives at 75% (Joshua, 2026-10-14: "starts protruding at
 * approximately 75% belly instead of 50%"). Her outie is modelled into the 100% master;
 * `navelFlat` (scripts/sarahV2Correctives.mjs) settles it into an ordinary navel. Fully
 * on to 75%, eased off by 100%, off past it, so the outie rises smoothly over the last
 * quarter and stays as modelled through 200%. A model without the target ignores it.
 */
export const NAVEL_FLAT_TARGET = 'navelFlat';
export const NAVEL_OUT_FROM_PERCENT = 75;
export function navelFlatWeight(bumpPercent: number): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  const t = Math.min(1, Math.max(0, (p - NAVEL_OUT_FROM_PERCENT) / (100 - NAVEL_OUT_FROM_PERCENT)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * THE NAVEL CONTROL (Joshua, 2026-10-24: "a manual bellybutton in/out slider under the body section which is separate
 * from the clothing so I can adjust how much of an innie or outie bellybutton is there independent of the automatic
 * bellybutton size per belly % like the breast size"). Like the bust's SIZE it sits ON TOP of what the belly slider
 * gives. The automatic navel is `navelFlatWeight` (1 an ordinary innie, 0 her modelled outie), so how far OUT she is
 * at a size is `1 - navelFlatWeight(bump)`, and 0 on the control is exactly that.
 *
 * The control slides her from that point toward either end of what her navel can be:
 *   - -100 is the deepest innie: the same `navelFlat` shape carried on inward, `NAVEL_INNIE_EXTRA` of it again;
 *   - +100 is the fullest outie: her modelled outie and `NAVEL_OUTIE_EXTRA` more.
 * Both ends are the same at every belly size, and so is 0. In between it is a straight line each side, so there is
 * no stretch of the slider that moves nothing, at a small belly or a big one. Both limits were chosen from renders.
 *
 * It is her body, not her clothes. NAVEL DETAIL under fabric still settles it as before, and a tee over it never
 * follows it in deeper than an ordinary navel, because fabric bridges an innie.
 */
export const NAVEL_INNIE_EXTRA = 0.6;
export const NAVEL_OUTIE_EXTRA = 0.3;
export function navelFlatFor(bumpPercent: number, navelPercent: number): number {
  const n = Number.isFinite(navelPercent) ? Math.min(100, Math.max(-100, navelPercent)) / 100 : 0;
  const auto = 1 - navelFlatWeight(bumpPercent);
  const outie = n < 0 ? auto + n * (auto + NAVEL_INNIE_EXTRA) : auto + n * (1 + NAVEL_OUTIE_EXTRA - auto);
  return 1 - outie;
}
/** What the NAVEL control's line adds: where her navel stands now, at this belly size. */
export function navelState(bumpPercent: number, navelPercent: number): string {
  const outie = 1 - navelFlatFor(bumpPercent, navelPercent);
  if (outie < -0.02) return `deeper innie (${Math.round(-outie / NAVEL_INNIE_EXTRA * 100)}% of the way)`;
  if (outie < 0.05) return 'innie';
  if (outie <= 1.001) return `outie ${Math.round(outie * 100)}%`;
  return `fuller outie (+${Math.round((outie - 1) / NAVEL_OUTIE_EXTRA * 100)}%)`;
}

export function bumpLine(bumpPercent: number): string {
  const p = Math.round(Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)));
  const breasts = ` · bust volume target ${breastVolumeRatio(p).toFixed(2)}×`;
  if (p === 100) return `BUMP 100% · as modelled${breasts}`;
  if (p === 0) return `BUMP 0% · nearly flat${breasts}`;
  return (p > 100 ? `BUMP ${p}% · past full term` : `BUMP ${p}%`) + breasts;
}

/**
 * HOW FAR EACH FINGER JOINT BENDS AT A FULL CURL, degrees, knuckle first (Joshua,
 * 2026-10-08: "add finger limits and try and make sure the fingers bend
 * realistically"). It used to be 80° at every joint, so a fist bent each finger 240°
 * into its own palm, and the thumb half that at all three joints, its base included.
 * BIOLOGICAL SHAPE, eased for a mesh: a hand's knuckle flexes to about 90°, the middle
 * joint 100°, the tip 70°; these stop short of that so a fist closes without the
 * fingertips driving through the palm. The thumb's base barely bends (it swings), so
 * most of its fold is in the two joints past it. Nothing bends backward: the slider
 * runs 0 to 100% and a bend is never below zero.
 */
export const FINGER_LIMITS_DEG = Object.freeze({ finger: [70, 90, 55], thumb: [25, 45, 60] });
/** How much the thumb's fold leans into the palm as well as across it toward the little finger. */
export const THUMB_TO_PALM = 0.6;

/** One finger joint's bend, radians, for a curl percent: never backward, never past its limit. */
export function fingerBend(curlPercent: number, jointInChain: number, thumb: boolean): number {
  const limits = thumb ? FINGER_LIMITS_DEG.thumb : FINGER_LIMITS_DEG.finger;
  const limit = limits[Math.min(limits.length - 1, Math.max(0, jointInChain))];
  const curl = Math.min(100, Math.max(0, Number.isFinite(curlPercent) ? curlPercent : 0)) / 100;
  return curl * limit * (Math.PI / 180);
}

export function fingersLine(curlPercent: number): string {
  const p = Math.round(Math.min(100, Math.max(0, curlPercent)));
  return p === 0 ? 'FINGERS · open' : p === 100 ? 'FINGERS · fist' : `FINGERS · ${p}% curled`;
}

export function statusLine(loaded: boolean, failed: boolean, garments: readonly string[], hasBelly: boolean, model = 0): string {
  const m = SARAH_LAB_MODELS[((model % SARAH_LAB_MODELS.length) + SARAH_LAB_MODELS.length) % SARAH_LAB_MODELS.length];
  if (failed) return `${m.path} did not load`;
  if (!loaded) return `loading Sarah ${m.id}…`;
  const g = garments.length ? `${garments.length} garment${garments.length === 1 ? '' : 's'}` : 'no clothes in this file yet';
  return `${m.id === 'v1' ? 'base model' : `model ${m.id}`} · ${hasBelly ? 'belly slider' : 'no belly slider'} · ${g}`;
}

// ------------------------------------------------------------ the bump's weight

/**
 * THE BUMP HAS WEIGHT (Joshua, 2026-10-07: "add a weight with the belly so it can
 * move and kind of jiggle, but not like jello... it could still tilt the belly
 * downward like 1-3° to look heavy"). The bake writes three motion targets
 * (`scripts/bellyMorph.mjs`), each the full bump moved with its edges held:
 * `bellyTilt` pitches it front-down by `BELLY_MOTION.tiltRad`, `bellyBob` drops it
 * and `bellySway` moves it to her left by `BELLY_MOTION.bobM`. A renderer drives
 * them with `stepBellySpring` and `bellyMotionWeights`; all of it scales with the
 * bump, so a flat belly does not move at all.
 */
export const BELLY_MOTION = Object.freeze({
  tilt: 'bellyTilt',
  bob: 'bellyBob',
  sway: 'bellySway',
  /** bellyTilt at weight 1, radians (the bake's MOTION_TILT_RAD): a true 20° turn */
  tiltRad: (20 * Math.PI) / 180,
  /** bellyBob and bellySway at weight 1, metres (the bake's MOTION_BOB_M) */
  bobM: 0.01,
});

/**
 * The spring: a mass that lags the body and settles. GAME TUNING, chosen to read
 * as heavy rather than as jelly: a low, slow bounce (2.2 Hz) damped so the second
 * swing is about a third of the first (ζ 0.32), and never more than 1.5 cm.
 */
export const BELLY_SPRING = Object.freeze({ hz: 2.2, damping: 0.32, maxM: 0.015, maxAccel: 40 });
/**
 * The weight slider's tilt, degrees front-down, from 0 to this. It was 3°; Joshua
 * asked for more on the big sizes (2026-10-07: "maybe just add a tilt in the belly
 * direction downwards like 10° or so"). A belly smaller than the model's tilts in
 * proportion; the model's and bigger tilt by the slider's degrees.
 */
export const BELLY_TILT_MAX_DEG = 10;
/**
 * Past the model's own belly the weight tilts it by itself (Joshua, 2026-10-07: "no
 * tilt until 100% then 200% = 20°"): rising evenly from none at 100% to 20° at 200%,
 * a fifth of a degree for every percent over 100. The WEIGHT slider adds to it, from 0.
 */
export const SIZE_TILT_DEG_PER_PERCENT = 0.2;
/**
 * THE TILT IS A DIAL (Joshua, 2026-10-15: "add a Belly Tilt control with three comparison
 * presets: 0°... 10°: half of our current 20°... 20°: current shape, preserved exactly").
 * The "degrees" are what the size tilt reaches at 200%; it still begins at 100% and rises
 * evenly, so 20 is the approved behaviour exactly and 10 is half of it at every size.
 * NOT a rotation: the degrees name a weight on `bellyTilt`, a sag shape that drops the
 * bump's lower front (6 cm at weight 1, along a line 30° forward of straight down, a third
 * of that under the bust). See `scripts/bellyMorph.mjs`, `sag`.
 */
export const SIZE_TILT_DEFAULT_DEG = 20;
export const SIZE_TILT_MAX_DEG = 20;
export const SIZE_TILT_PRESETS_DEG = [0, 10, 20] as const;
export function sizeTiltDeg(bumpPercent: number, atFullDeg: number = SIZE_TILT_DEFAULT_DEG): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(100, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  const full = Math.min(SIZE_TILT_MAX_DEG, Math.max(0, Number.isFinite(atFullDeg) ? atFullDeg : SIZE_TILT_DEFAULT_DEG));
  return (p - 100) * SIZE_TILT_DEG_PER_PERCENT * (full / SIZE_TILT_DEFAULT_DEG);
}
/**
 * SEATED, HER THIGHS CARRY THE BUMP (Joshua, 2026-10-15: "Sitting should use an effective
 * belly tilt of approximately 0–5°, regardless of the character's standing tilt... implement
 * this as a pose-dependent adjustment rather than permanently changing the character's
 * selected tilt").
 *
 * The selected tilt is never written: what changes is the tilt USED. Fully seated it is the
 * selected tilt scaled onto 0–5° (20° sits at 5°, 10° at 2.5°, 0° at 0°), so two characters
 * who differ standing still differ seated, by a quarter as much. `seated` is 0 standing and 1
 * fully down; anything between is a sit or a rise in progress, eased (smoothstep) so the tilt
 * leaves and returns with no kink. A future sit animation drives `seated` from its own
 * progress; the Lab, whose legs switch at once, ramps it: quickly going down
 * (`SEATED_TILT_DOWN_SECONDS`), because until it arrives the standing tilt hangs the bump
 * into thighs that are already there, and more slowly coming up (`SEATED_TILT_UP_SECONDS`),
 * where the legs have already left and the bump simply settles back to her own tilt.
 *
 * Measured (sections through each thigh, settled sit): with the standing 20° the bump's
 * underside passes 7-12 mm into the far half of her thighs at 150-200%; at the seated 5°,
 * nothing does. What remains is the fold where her lower belly meets the top of the thigh
 * near the hip, the same at every size and already there on the approved 100% body.
 */
export const SEATED_TILT_MAX_DEG = 5;
export const SEATED_TILT_DOWN_SECONDS = 0.35;
export const SEATED_TILT_UP_SECONDS = 0.8;
export function effectiveTiltDeg(selectedDeg: number, seated: number): number {
  const sel = Math.min(SIZE_TILT_MAX_DEG, Math.max(0, Number.isFinite(selectedDeg) ? selectedDeg : SIZE_TILT_DEFAULT_DEG));
  const u = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0)), e = u * u * (3 - 2 * u);
  return sel + (sel * (SEATED_TILT_MAX_DEG / SIZE_TILT_MAX_DEG) - sel) * e;
}
/** One frame of a sit or a rise: `seated` walks linearly toward its target (0 or 1), the whole way in the down or up time. */
export function stepSeated(seated: number, target: number, dt: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0)), t = target >= 0.5 ? 1 : 0;
  if (!(dt > 0)) return s;
  return t > s ? Math.min(t, s + dt / SEATED_TILT_DOWN_SECONDS) : Math.max(t, s - dt / SEATED_TILT_UP_SECONDS);
}

/** Each centimetre the bump drops also pitches it this many tilt-target weights: it swings, not slides. */
const BOUNCE_TILT = 0.25 * (0.1 / ((20 * Math.PI) / 180)); // the same swing as before the tilt target became 20°

/** The bump's displacement from where it hangs, metres (y down, x to her left), and how fast. */
export interface BellySpring { y: number; vy: number; x: number; vx: number }
export const restingBellySpring = (): BellySpring => ({ y: 0, vy: 0, x: 0, vx: 0 });

/**
 * One step of the spring, in place. `upAccel` and `leftAccel` are the body's own
 * acceleration there (m/s², up and to her left): the bump lags it, so the body
 * rising throws the bump down and a step to the left throws it right. Substeps of
 * at most 1/240 s keep it stable on a slow frame; a jump (a pose change, a
 * teleport) is clamped rather than flung.
 */
export function stepBellySpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number): BellySpring {
  return stepSpring(s, dt, upAccel, leftAccel, BELLY_SPRING);
}

interface SpringTuning { readonly hz: number; readonly damping: number; readonly maxM: number; readonly maxAccel: number }
function stepSpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number, tune: SpringTuning): BellySpring {
  const w = 2 * Math.PI * tune.hz, c = 2 * tune.damping * w;
  const clampA = (a: number) => (Number.isFinite(a) ? Math.max(-tune.maxAccel, Math.min(tune.maxAccel, a)) : 0);
  const ay = clampA(upAccel), ax = clampA(leftAccel);
  const total = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), 0.1);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const h = total / steps;
  for (let k = 0; k < steps && h > 0; k += 1) {
    s.vy += (-w * w * s.y - c * s.vy + ay) * h;
    s.vx += (-w * w * s.x - c * s.vx - ax) * h;
    s.y += s.vy * h;
    s.x += s.vx * h;
    const m = tune.maxM;
    if (Math.abs(s.y) > m) { s.y = Math.sign(s.y) * m; s.vy = 0; }
    if (Math.abs(s.x) > m) { s.x = Math.sign(s.x) * m; s.vx = 0; }
  }
  return s;
}

/**
 * A walk's own bounce, as the acceleration of the body: the hips rise and fall
 * twice a stride, about 2 cm either way (BIOLOGICAL SHAPE: the centre of mass
 * travels some 4 to 5 cm in a walking step), eased to WALK_BOUNCE_M. The lab's walk
 * turns joints and never lifts the body, so it adds this; a body that really moves
 * feeds its own.
 */
/**
 * How far the walk lifts the body each step, metres, for the springs to feel. 2 cm
 * is about a real walk's; it threw the bump about too much to look at (Joshua,
 * 2026-10-08: "the bounce is a little too much while walking... maybe lower 60%
 * less"), so 40% of it. GAME TUNING.
 */
export const WALK_BOUNCE_M = 0.02 * 0.4;

export function walkBounceAccel(phase: number, strideSeconds: number): number {
  if (!(strideSeconds > 0)) return 0;
  const w = (4 * Math.PI) / strideSeconds; // two steps a stride
  return -w * w * WALK_BOUNCE_M * Math.cos(4 * Math.PI * phase);
}

/** How much of the spring's travel the bump shows. GAME TUNING. */
export const BELLY_SWING = 0.45;

/** The three motion targets' weights for a bump size, a resting tilt and the spring. */
export function bellyMotionWeights(bumpPercent: number, tiltDeg: number, s: BellySpring, sizeTiltAtFullDeg: number = SIZE_TILT_DEFAULT_DEG): Record<string, number> {
  // a bigger belly is heavier: it tilts and swings by its size, the model's own being 1
  const size = Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)) / 100;
  const tilt = Math.min(BELLY_TILT_MAX_DEG, Math.max(0, tiltDeg)) * (Math.PI / 180);
  const bob = s.y / BELLY_MOTION.bobM;
  // how much it swings: grows with the bump to full term and NO further, at half the
  // spring's travel (Joshua, 2026-10-08: "the belly especially past 100% is too
  // exaggerated... lower even more"). A bigger belly is heavier, which moves less.
  const swing = BELLY_SWING * Math.min(1, size);
  return {
    [BELLY_MOTION.tilt]: (Math.min(1, size) * tilt + sizeTiltDeg(bumpPercent, sizeTiltAtFullDeg) * (Math.PI / 180)) / BELLY_MOTION.tiltRad + swing * BOUNCE_TILT * bob,
    [BELLY_MOTION.bob]: swing * bob,
    [BELLY_MOTION.sway]: swing * (s.x / BELLY_MOTION.bobM),
  };
}

/**
 * A REAL T-POSE, AND EVERY ANGLE ON THE WAY (Joshua, 2026-10-15: "test the arms at 0, 30,
 * 45, 60 and 90 degrees... both arms together and individually"). v1 is modelled in a T,
 * so its bind pose already is one; v2 is modelled arms-down. Each chosen upper arm is
 * turned at its shoulder, in the bind pose's world frame, from the direction it was
 * modelled in toward level and straight out, by `fraction` of the way: 1 is the T
 * (about 90 degrees for v2, nothing for v1).
 */
export interface TPoseJoint { readonly x: number; readonly y: number; readonly z: number }
export interface TPoseTurn { readonly joint: number; readonly ax: number; readonly ay: number; readonly az: number; readonly radians: number }
export function tPoseTurns(bind: readonly TPoseJoint[], arms: readonly { shoulder: number; elbow: number; out: 1 | -1; fraction?: number }[]): TPoseTurn[] {
  const turns: TPoseTurn[] = [];
  for (const { shoulder, elbow, out, fraction = 1 } of arms) {
    const s = bind[shoulder], e = bind[elbow];
    if (!s || !e || fraction <= 0) continue;
    const v = [e.x - s.x, e.y - s.y, e.z - s.z], l = Math.hypot(v[0], v[1], v[2]);
    if (!l) continue;
    const u = [v[0] / l, v[1] / l, v[2] / l], t = [out, 0, 0];
    const c = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]], sin = Math.hypot(c[0], c[1], c[2]), cos = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
    if (sin < 1e-6) continue;
    turns.push({ joint: shoulder, ax: c[0] / sin, ay: c[1] / sin, az: c[2] / sin, radians: Math.atan2(sin, cos) * Math.min(1, fraction) });
  }
  return turns;
}
/** Which arms the ARMS slider raises, in the order its button cycles them. */
export const ARM_SIDES = Object.freeze(['both', 'left', 'right'] as const);
export type ArmSide = (typeof ARM_SIDES)[number];
export function armsLine(degrees: number, side: ArmSide = 'both'): string {
  const d = Math.round(Math.min(90, Math.max(0, degrees)));
  return `ARMS · ${d}°${side === 'both' ? '' : ` · ${side} only`}`;
}
/**
 * The raised-arm shapes (armRaiseL for the arm modelled toward +x, armRaiseR toward -x)
 * tuck the skin shared by arm and torso into the armpit. They come in sooner than the
 * angle does, because the web forms early: 1 - (1 - t)^2 of the shape at t of the raise
 * (56% at 30 degrees, 75% at 45, 89% at 60, all of it level). GAME TUNING against renders.
 */
export const ARM_RAISE_TARGETS = Object.freeze({ plusX: 'armRaiseL', minusX: 'armRaiseR' });
export function armRaiseWeight(degrees: number): number {
  const t = Math.min(1, Math.max(0, (Number.isFinite(degrees) ? degrees : 0) / 90));
  return 1 - (1 - t) * (1 - t);
}

// ------------------------------------------------------------ body shape (Joshua, 2026-10-15)

/**
 * The bump's size, in the shape fields' terms: how big each size's bump is against 100%'s,
 * over the whole bump and below the navel (`scripts/sarahV2Shape.mjs` measures and stamps
 * them as `bellyShapeScale` / `bellyLowerScale`; the test holds these to the file). The
 * upper one is `BELLY_UPPER_SCALE`.
 */
export const BELLY_SHAPE_SCALE: readonly (readonly [number, number])[] = [
  [2, 1.565], [1.5, 1.279], [1, 1], [0.75, 0.59], [0.6, 0.397], [0.5, 0.27], [0.3, 0.088], [0.25, 0.044], [0, 0],
];
export const BELLY_LOWER_SCALE: readonly (readonly [number, number])[] = [
  [2, 1.506], [1.5, 1.25], [1, 1], [0.75, 0.643], [0.6, 0.46], [0.5, 0.339], [0.3, 0.12], [0.25, 0.067], [0, 0],
];
function scaleAt(table: readonly (readonly [number, number])[], bumpPercent: number, curve: BellyCurve = 'approved'): number {
  if (curve !== 'approved') return keyed(table, bumpPercent, curve);
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  for (let i = 0; i < table.length - 1; i += 1) {
    const [s0, r0] = table[i], [s1, r1] = table[i + 1];
    if (b > s0 || b < s1) continue;
    const f = (s0 - b) / (s0 - s1);
    return r0 * (1 - f) + r1 * f;
  }
  return 0;
}

/**
 * MANUAL SIZE MAY GO PAST THE SLIDER'S BUST (Joshua, 2026-10-15: "for manual control, allow
 * the breast size to go up to x2.0, but if using the simple slider, only that x1.55 we
 * have... allow manual control to override the normal default max size").
 *
 * The belly slider alone still carries the bust from 1.0x to 1.55x volume. The SIZE control
 * starts from whatever the slider gives: upward, +100% is `BREAST_MANUAL_MAX_VOLUME` at every
 * belly size (+50% is halfway there), so the whole travel of the control does something and
 * its top is the same 2.0x whether she is at 30% or 200%; downward the same way, -100% is
 * 0.5x. All of it is volume against her own unpregnant (0%) bust, the 1.0x the slider starts
 * from (100% belly carries 1.30x).
 * `breastGrow` is one even scaling about the breast's middle, so taking its weight past 1 is
 * that same even scaling, larger: nothing new is invented past 1.55x.
 */
export const BREAST_MANUAL_MAX_VOLUME = 2.0;
/** ...and down to half (Joshua, 2026-10-15: "minimum at 0.5x, max at 2.0x"): -100% is 0.5x at every belly size. */
export const BREAST_MANUAL_MIN_VOLUME = 0.5;
/** How many `breastGrow` units the bust is: 1 at the slider's 1.55x, about 1.81 at 2.0x. */
export function breastGrowUnits(bumpPercent: number, sizePercent = 0): number {
  return (bustScale(bumpPercent, sizePercent) - 1) / (Math.cbrt(BREAST_GROW_MAX_VOLUME) - 1);
}
/** The bust's volume against her own 0% breast: the slider's, with the SIZE control on top. */
export function bustVolume(bumpPercent: number, sizePercent = 0): number {
  const base = breastVolumeRatio(bumpPercent), s = Math.min(100, Math.max(-100, Number.isFinite(sizePercent) ? sizePercent : 0));
  const end = s >= 0 ? BREAST_MANUAL_MAX_VOLUME : BREAST_MANUAL_MIN_VOLUME;
  return base + (end - base) * Math.abs(s) / 100;
}
/** The bust's linear scale against her own 0% breast. */
export function bustScale(bumpPercent: number, sizePercent = 0): number {
  return Math.cbrt(bustVolume(bumpPercent, sizePercent));
}

/**
 * HEIGHT is not a scale, it is a shift, and a shift is not linear: a field written for 1 cm
 * at 100% and multiplied up to 3 cm of a 200% bump turned the bump pointed and ridged. So
 * `scripts/sarahV2Shape.mjs` writes the shift EXACTLY at the slider's ends (2 cm up, 2 cm
 * down) for each size key's own bump (100, 150, 200%), and this crossfades: from nothing to
 * the end by how far the slider is moved, and between the two keys either side of the size
 * shown (below 100% the 100% field, by how big the bump is against 100%'s).
 */
export const BELLY_HEIGHT_END_CM = 2;
export function bellyHeightWeights(heightCm: number, bumpPercent: number, curve: BellyCurve = 'approved'): Record<string, number> {
  const h = Math.min(BELLY_HEIGHT_END_CM, Math.max(-BELLY_HEIGHT_END_CM, Number.isFinite(heightCm) ? heightCm : 0));
  const dir = h >= 0 ? 'Up' : 'Down', other = h >= 0 ? 'Down' : 'Up', t = Math.abs(h) / BELLY_HEIGHT_END_CM;
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const keys: Record<string, number> = { '': 0, '150': 0, '200': 0 };
  if (curve !== 'approved') {
    // every key's weight: below 100% the 100% field by each key's size, above it the 150% and 200% fields
    const w = bellyKeyWeights(bumpPercent, curve);
    keys[''] = keyed(BELLY_SHAPE_SCALE.filter(([s]) => s <= 1), bumpPercent, curve);
    keys['150'] = w[BELLY_KNOTS.indexOf(1.5)]; keys['200'] = w[BELLY_KNOTS.indexOf(2)];
  } else if (b <= 1) keys[''] = scaleAt(BELLY_SHAPE_SCALE, bumpPercent);
  else if (b <= 1.5) { const u = (b - 1) / 0.5; keys[''] = 1 - u; keys['150'] = u; }
  else { const u = (b - 1.5) / 0.5; keys['150'] = 1 - u; keys['200'] = u; }
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(keys)) { out[`shape:bellyHeight${dir}${k}`] = t * w; out[`shape:bellyHeight${other}${k}`] = 0; }
  return out;
}

/**
 * Each shape field's strength for a body and a belly size (`scripts/sarahV2Shape.mjs` writes
 * one field per control at one unit: 10%, 1 cm or 5°). Every belly field is relative to the
 * size shown (a +10% width is 10% of THAT bump), every breast field to the bust as big as it
 * is; position is in centimetres whatever the size. All defaults give all zeros.
 */
export function bodyShapeFieldWeights(shape: BodyShape, bumpPercent: number, curve: BellyCurve = 'approved'): Record<string, number> {
  const S = scaleAt(BELLY_SHAPE_SCALE, bumpPercent, curve), Up = bellyUpperWeight(bumpPercent, curve), Lo = scaleAt(BELLY_LOWER_SCALE, bumpPercent, curve);
  const s = bustScale(bumpPercent, shape.breastSize);
  return {
    ...bellyHeightWeights(shape.bellyHeight, bumpPercent, curve),
    'shape:bellyWidth': (shape.bellyWidth / 10) * S,
    'shape:bellyDepth': (shape.bellyDepth / 10) * S,
    'shape:bellyUpper': (shape.bellyUpper / 10) * Up,
    'shape:bellyLower': (shape.bellyLower / 10) * Lo,
    'shape:breastGrowMore': Math.max(0, breastGrowUnits(bumpPercent, shape.breastSize) - 1),
    // spacing is two fields: apart, and together (held off her midline so the breasts meet, never cross)
    'shape:breastSpacingOut': Math.max(0, shape.breastSpacing),
    'shape:breastSpacingIn': Math.max(0, -shape.breastSpacing),
    'shape:breastWidth': (shape.breastWidth / 10) * s,
    'shape:breastHeight': (shape.breastHeight / 10) * s,
    'shape:breastDepth': (shape.breastDepth / 10) * s,
    'shape:breastPosition': shape.breastPosition,
    'shape:breastDroop': (shape.breastDroop / 5) * s,
    'shape:breastUpper': (shape.breastUpper / 10) * s,
    'shape:breastLower': (shape.breastLower / 10) * s,
  };
}

/** The bust's own GPU weights with the SIZE control: the same even scaling, to a little more or less volume. */
export function breastWeightsForShape(bumpPercent: number, grows: boolean, sizePercent: number): Record<string, number> {
  if (!grows || !sizePercent) return breastWeightsFor(bumpPercent, grows);
  // past 1.55x the rest of the growth is `shape:breastGrowMore` (bodyShapeFieldWeights), which keeps the cleavage
  return { [BREAST_TARGETS.small]: 0, [BREAST_TARGETS.big]: 0, [BREAST_GROW_TARGET]: Math.min(1, breastGrowUnits(bumpPercent, sizePercent)) };
}
