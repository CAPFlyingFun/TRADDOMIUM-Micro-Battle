/**
 * WHAT THE TOMBS LABORATORY IS MADE OF — ten surfaces, two lighting
 * states, and not a mesh in the file.
 *
 * `LabView` assembles; this decides. The split is the same one
 * `sea/waterLook.ts` and `sky/skyLook.ts` make against their renderers,
 * and it buys the same thing: a palette is a table of numbers, and a
 * table of numbers is answerable in plain node. There is no GPU in
 * vitest and there never will be, so anything about the building that
 * can be said as a number is said HERE, where a test can read it
 * (`tests/labLook.test.ts`), and `LabView` is left with only the part
 * that genuinely needs three.
 *
 * ─── the palette, and why it is this one ─────────────────────────────
 *
 * A research building at night, seen by someone who works in it. The
 * reference is a real laboratory's material list rather than a science
 * fiction one: rubber floor, painted block wall, laminate worktop,
 * brushed stainless, powder-coated casings, glass, and two kinds of lit
 * thing — the readouts, which glow, and the monitors, which are dark
 * glass when nobody has woken them.
 *
 *   floor     dark rubber; the darkest thing in the building, so a lit
 *             room reads as light falling ON something
 *   wall      pale grey-green, the colour institutional paint has been
 *             since long before 2110; the one hue the eye rests on
 *   ceiling   the wall, a step darker — a ceiling is lit edge-on by its
 *             own fittings and almost never reads as bright as a wall
 *   glass     the reinforced port, barely tinted, and the ONLY surface
 *             with an opacity below 1 (a test pins that)
 *   metal     brushed stainless: rough enough not to mirror, metallic
 *             enough to catch a lamp along an edge
 *   desk      laminate worktop, a neutral pale grey
 *   panel     a machine casing, darker than the wall it stands against
 *   screen    dark glass. A screen DOES NOT EMIT — a building whose
 *             every monitor glows is a set, not a workplace, and the
 *             manuscript's rooms are worked in
 *   readout   the one thing that lights itself: cyan-white, the
 *             instrument colour, on a dark bezel so it reads as a lit
 *             panel rather than as white plastic
 *   accent    warning amber: stripes, a lever housing, a door frame.
 *             Warm, but not metal (see below)
 *
 * NOTHING HERE IS NEON. The brightest surface in the building is a
 * readout at emissive intensity 1.6, and the colour it is emitting is
 * three quarters of the way to white. This project's identity is a black
 * and gold ant on a real island; a laboratory that glowed would be the
 * loudest thing in the game.
 *
 * ─── the rings are the one warm metal ────────────────────────────────
 *
 * `Ring` carries no `surface` — a ring is not a slab and the plan does
 * not pretend it is — so its look lives here as `RING_LOOK` rather than
 * in the record. It is brass-warm where every other metallic surface in
 * the building is cool, which is the whole of how the array reads as the
 * thing the building was built around. `tests/labLook.test.ts` states
 * that as a rule and not as a hope: of everything with a metalness at or
 * above `METALLIC`, only the rings are warm.
 *
 * ─── the two lighting states ─────────────────────────────────────────
 *
 * Chapter 2: "He pulled the physical shutdown lever, and the room went
 * dark… The emergency lights switched on." That is two states, and the
 * second is DARKER — not merely redder. The ambient light the emergency
 * state asks for carries a twelfth of the normal state's luminance, so a
 * room lit by it is a room you can find the door in and not one you can
 * work in. The test compares the two by Rec. 709 luminance and requires
 * the inequality strictly, so a later palette pass cannot brighten the
 * emergency state past the thing it is the absence of.
 *
 * `fog` is a colour and not a density, because an interior's fog is
 * about what the far end of a corridor fades TO. A `THREE.Group` cannot
 * own `Scene.fog`, so `LabView` publishes this and the scene that holds
 * the building applies it — the same seam `sky/skyLook.ts` has with the
 * scene that owns the sky.
 *
 * Pure: no three, no DOM, no storage, no network. A colour is not a
 * material.
 */
import type { LightMode, Surface } from '../world/tombs/types';

/**
 * How one surface is drawn. Every field is what a
 * `THREE.MeshStandardMaterial` would be given, in the units three wants
 * them, so `LabView` copies rather than converts.
 */
export interface SurfaceLook {
  /** 0xRRGGBB, sRGB, as every colour in this repo is written. */
  readonly colour: number;
  /** 0 mirror, 1 chalk. */
  readonly roughness: number;
  /** 0 dielectric, 1 metal. Nothing in between is physical; a few things here are, for looks. */
  readonly metalness: number;
  /** 1 unless the surface is glass. A material is only made transparent when this is below 1. */
  readonly opacity: number;
  /** 0x000000 unless the surface lights itself. */
  readonly emissive: number;
  /** Multiplies `emissive`. Zero whenever `emissive` is black, so the two can never disagree. */
  readonly emissiveIntensity: number;
}

/** At or above this, a surface reads as metal rather than as a painted thing. */
export const METALLIC = 0.5;

/**
 * THE BUILDING'S MATERIALS. Typed as a full `Record<Surface, …>`, so a
 * `Surface` added to the contract fails the typecheck here rather than
 * drawing as `undefined` on a phone.
 */
export const LOOK: Readonly<Record<Surface, SurfaceLook>> = Object.freeze({
  // Dark rubber sheet. Almost matte, barely a sheen — a lamp on this
  // floor is a wide soft patch, which is what makes a corridor read long.
  floor: Object.freeze({ colour: 0x4e5459, roughness: 0.94, metalness: 0.02, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // Painted block. The building's one restful hue.
  wall: Object.freeze({ colour: 0xa9b4ab, roughness: 0.82, metalness: 0.02, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // The wall, one step down: a ceiling is lit edge-on and reads darker.
  ceiling: Object.freeze({ colour: 0x8e968f, roughness: 0.88, metalness: 0.02, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // The reinforced port. The ONE surface below opacity 1, and the tint
  // is the thickness of the glass rather than a colour anyone chose.
  glass: Object.freeze({ colour: 0xbcd8d6, roughness: 0.06, metalness: 0.0, opacity: 0.24, emissive: 0x000000, emissiveIntensity: 0 }),
  // Brushed stainless: rough enough not to mirror a room that has no
  // environment map to mirror, metallic enough to take a lamp on an edge.
  metal: Object.freeze({ colour: 0x8b9198, roughness: 0.34, metalness: 0.88, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // Laminate worktop, neutral and pale, so what is standing on it shows.
  desk: Object.freeze({ colour: 0xa8ada9, roughness: 0.58, metalness: 0.04, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // Powder-coated casing, darker than the wall behind it.
  panel: Object.freeze({ colour: 0x59625e, roughness: 0.52, metalness: 0.22, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // Dark glass. NOT a light source: see the header.
  screen: Object.freeze({ colour: 0x0a0d10, roughness: 0.14, metalness: 0.08, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
  // The one surface that lights itself. A dark bezel carrying a
  // cyan-white glow, which is a lit instrument; a pale bezel carrying the
  // same glow is a sheet of white plastic.
  readout: Object.freeze({ colour: 0x16343a, roughness: 0.30, metalness: 0.0, opacity: 1, emissive: 0x6fe0ee, emissiveIntensity: 1.6 }),
  // Warning amber. Warm, and deliberately NOT metallic — the rings' claim
  // to being the only warm metal is checked against `METALLIC`.
  accent: Object.freeze({ colour: 0xb8912f, roughness: 0.55, metalness: 0.28, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 }),
});

/**
 * Every surface the building knows, derived from `LOOK` so the two can
 * never drift. `types.ts` deliberately exports the union and no array —
 * a list of the members belongs with whoever has to iterate them.
 */
export const SURFACES: readonly Surface[] = Object.freeze(Object.keys(LOOK) as Surface[]);

/**
 * THE ARRAY'S RINGS: brass, and the only warm metal in the building.
 *
 * Not in `LOOK` because `Ring` has no `surface` to look up. Rougher than
 * a mirror on purpose — a ring turning slowly should catch its lamp as a
 * moving band, and a polished one would only catch a room that has no
 * reflections in it.
 */
export const RING_LOOK: SurfaceLook = Object.freeze({
  colour: 0xb08348, roughness: 0.30, metalness: 0.90, opacity: 1, emissive: 0x000000, emissiveIntensity: 0,
});

/** The air of a room, for the two states it has. */
export interface LightingLook {
  /** Ambient colour, 0xRRGGBB. */
  readonly ambient: number;
  /** Ambient intensity, as three wants it. */
  readonly ambientIntensity: number;
  /** What the far end of a corridor fades to, 0xRRGGBB. A Group cannot own `Scene.fog`; its owner applies this. */
  readonly fog: number;
}

/**
 * NORMAL, then EMERGENCY. The second is the first's absence: a twelfth
 * of the luminance, and red rather than the daylight-white the building
 * runs on. `tests/labLook.test.ts` requires the inequality strictly, in
 * both the ambient term and the fog, so this table cannot be edited into
 * an emergency that is merely a colour grade.
 */
export const LIGHTING: Readonly<Record<LightMode, LightingLook>> = Object.freeze({
  normal: Object.freeze({ ambient: 0xbcd0d4, ambientIntensity: 1.70, fog: 0x1b2226 }),
  emergency: Object.freeze({ ambient: 0x8f3128, ambientIntensity: 0.34, fog: 0x140708 }),
});

/** Both states, derived from `LIGHTING` so they cannot drift. */
export const LIGHT_MODES: readonly LightMode[] = Object.freeze(Object.keys(LIGHTING) as LightMode[]);

/**
 * A LAMP'S FITTING: the box drawn where a lamp is, in LOCAL METRES.
 *
 * Why it exists at all: a real `THREE.PointLight` is paid for by every
 * lit material in the SCENE, not only by this building (three gathers
 * lights once per render and filters them by the CAMERA's layers, never
 * per object — `three.module.js`, `projectObject`). So only a handful of
 * lamps can be real, and the rest have to read as lit some other way.
 * A small unlit box in the lamp's own colour is that way: it costs one
 * instance, it is bright whatever the room's light is doing, and a
 * ceiling with fittings in it reads as a lit ceiling even where no light
 * is falling.
 *
 * The normal fitting is a strip light; the emergency one is the small
 * bulkhead unit above a door. GAME TUNING, from ordinary building
 * hardware — a 600 mm strip and a 180 mm bulkhead.
 */
export interface FittingLook {
  /** Metres, local +X. */
  readonly width: number;
  /** Metres, local +Y — how thick the fitting hangs. */
  readonly height: number;
  /** Metres, local +Z. */
  readonly depth: number;
}

export const FITTING: Readonly<Record<LightMode, FittingLook>> = Object.freeze({
  normal: Object.freeze({ width: 0.60, height: 0.04, depth: 0.18 }),
  emergency: Object.freeze({ width: 0.18, height: 0.06, depth: 0.08 }),
});

/**
 * What a fitting's own colour is multiplied by when its set is LIVE, and
 * when it is not.
 *
 * The dark value is not black: an unlit fitting is still a fitting, and a
 * ceiling that loses its fixtures entirely when the lever is pulled reads
 * as a ceiling that changed shape. `LabView` switches one material colour
 * per set rather than rewriting instances.
 */
export const FITTING_LIT = 0xffffff;
export const FITTING_DARK = 0x2a2e31;

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

/**
 * THE SCREENS CARRY A PICTURE, AND THE SURFACE STILL DOES NOT EMIT.
 *
 * Joshua, 2026-09-19, looking at a shot of the laboratory: "that black is
 * the computer screen?" — and then, "could you create a fake TOMBS image
 * to fit the screens so it's more obvious to be a computer screen". He
 * had spent a message thinking two of them were an artefact on the back
 * of Jack's neck, which is what a flat near-black rectangle with no bezel
 * and no content looks like from three metres.
 *
 * READ THIS AGAINST `LOOK.screen`, WHICH IS UNCHANGED. The rule this file
 * has carried from the start — "a screen DOES NOT EMIT; a building whose
 * every monitor glows is a set, not a workplace" — is about the SURFACE,
 * and it still holds: dark glass, emissive 0x000000, and that is what a
 * screen with nothing on it is. What emits now is the IMAGE, and only
 * when there is one. `LabView` applies `SCREEN_LIT` to the screen
 * material ONLY once the atlas has loaded, so a missing texture falls
 * back to the dark glass rather than to a white glowing box — which is
 * the right failure and the reason the two are separate constants.
 *
 * It is also more true to the manuscript than the old blank was. Chapter
 * 1 opens with Jack AT HIS CONSOLE reading diagnostic data; a laboratory
 * where the diagnostics are running on a screen nobody has woken is the
 * version that was wrong.
 *
 * The intensity is well under the readout's 1.6, and the map it
 * multiplies is mostly near-black with thin bright lines, so the average
 * emission off a screen is a fraction of a lit instrument's. Nothing here
 * is neon.
 */
export const SCREEN_LIT = Object.freeze({
  /** White, so the atlas's own colours come through the emissive map unshifted. */
  emissive: 0xffffff,
  emissiveIntensity: 0.85,
});

/** The atlas is square, like every texture on the ladder. */
export const SCREEN_ATLAS_SIZE = 1024;

/**
 * A rectangle in the atlas, IN TEXELS WITH Y DOWN FROM THE TOP — the way
 * `art/textures/tombs-screen.svg` draws it, so the two files can be read
 * against each other line for line. `screenPanelUv` is the one place the
 * flip to three's bottom-up v happens.
 */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * WHAT IS ON THE SCREEN ATLAS, and why it is an atlas at all.
 *
 * The building's eleven screens are two shapes: four workstation monitors
 * at 0.62 x 0.46 (1.35) and the control room's six camera panels at
 * 0.84 x 0.36 (2.33), with the structural monitor at 0.80 x 0.60 (1.33)
 * joining the first group. One image stretched across both would be
 * stretched by 1.7 on one of them, and a stretched logo is worse than no
 * logo. Two images would be two textures and two materials.
 *
 * So: one texture, two panels, and the UV rectangle is chosen per slab
 * from the aspect of its own broad face. `bezel` is the third rectangle —
 * a flat patch of dark plastic that the four THIN edges of every screen
 * sample, so a 5 cm edge shows a casing rather than a squashed copy of
 * the whole interface.
 */
export const SCREEN_ATLAS: Readonly<Record<'terminal' | 'feed' | 'bezel', ScreenRect>> = Object.freeze({
  /** The workstation terminal: 768 x 576 is 1.333, against the monitor's 1.348. */
  terminal: Object.freeze({ x: 0, y: 0, w: 768, h: 576 }),
  /** A camera feed: 1024 x 438 is 2.338, against the control panel's 2.333. */
  feed: Object.freeze({ x: 0, y: 586, w: 1024, h: 438 }),
  /** Dark plastic, for the four edges of the box each screen is. */
  bezel: Object.freeze({ x: 800, y: 16, w: 208, h: 208 }),
});

export type ScreenPanel = 'terminal' | 'feed';

/**
 * Which panel a screen of this shape shows, by whichever of the two the
 * broad face is closer to in LOG aspect — so "twice as wide as it should
 * be" and "half as wide" are the same distance from a fit, which is what
 * stretching actually costs.
 */
export function screenPanelFor(wide: number, tall: number): ScreenPanel {
  if (!(wide > 0) || !(tall > 0)) return 'terminal';
  const want = Math.log(wide / tall);
  const terminal = Math.log(SCREEN_ATLAS.terminal.w / SCREEN_ATLAS.terminal.h);
  const feed = Math.log(SCREEN_ATLAS.feed.w / SCREEN_ATLAS.feed.h);
  return Math.abs(want - terminal) <= Math.abs(want - feed) ? 'terminal' : 'feed';
}

/**
 * A rectangle as UVs three can use: `u0, v0` the bottom-left corner,
 * `u1, v1` the top-right. THE FLIP LIVES HERE. Every texture in this
 * project loads with three's default `flipY`, so the image's TOP row is
 * v = 1, and a rectangle measured downward from the top becomes one
 * measured upward from the bottom exactly once, in this function.
 */
export function screenPanelUv(rect: ScreenRect, size = SCREEN_ATLAS_SIZE): {
  readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number;
} {
  return Object.freeze({
    u0: rect.x / size,
    u1: (rect.x + rect.w) / size,
    v0: 1 - (rect.y + rect.h) / size,
    v1: 1 - rect.y / size,
  });
}

/**
 * Rec. 709 luminance of a packed 0xRRGGBB colour, 0..1.
 *
 * Here rather than in the test because the claim "the emergency state is
 * darker" is part of the palette's specification, and a specification
 * that can only be checked by a number the test invents privately is not
 * one this file is holding itself to.
 */
export function luminance(colour: number): number {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How much light a state actually delivers: its ambient, weighted by its intensity. */
export function ambientLevel(mode: LightMode): number {
  const look = LIGHTING[mode];
  return luminance(look.ambient) * look.ambientIntensity;
}

/**
 * The look for a surface. Total by type — but the fallback is real, not
 * decoration: the plan and this renderer are separate modules that ship
 * separately, and a plan carrying a surface this build has never heard of
 * should draw as a grey casing rather than throw on `.colour` halfway
 * through a build. `panel` is the neutral thing to be mistaken for.
 */
export function lookFor(surface: Surface): SurfaceLook {
  const look = LOOK[surface] as SurfaceLook | undefined;
  return look ?? LOOK.panel;
}
