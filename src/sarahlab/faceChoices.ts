/**
 * HER FACE'S CONTROLS, AS NAMES AND LINES (Joshua, 2026-10-24: "would like to somehow add bones 🦴 in or something
 * around the mouth to open and close like talking, and maybe the illusion of the eyes being able to look around in
 * sync"). The face itself is a shader layer on her body (`faceRig.ts`) moved by a small animator (`faceMotion.ts`);
 * this is what the FACE section says about it, so a test can read it without a renderer.
 *
 * Pure.
 */
import type { EyeMode } from './faceMotion';

/** The order EYES steps through: alive by default, then on the viewer, then still. */
export const EYE_MODES: readonly EyeMode[] = Object.freeze(['around', 'camera', 'ahead'] as EyeMode[]);
export function nextEyeMode(mode: EyeMode): EyeMode {
  return EYE_MODES[(EYE_MODES.indexOf(mode) + 1) % EYE_MODES.length];
}
export function eyesLine(mode: EyeMode): string {
  return `EYES · ${mode === 'around' ? 'LOOK AROUND' : mode === 'camera' ? 'AT THE CAMERA' : 'AHEAD'}`;
}

/**
 * Iris colours, LINEAR rgb as the shader takes them (the face's default is the hazel green of her reference sheet, TMB-
 * Story `assets/source/sarah-sheet.png`). The amber round the pupil and the dark rim follow whichever is chosen.
 */
export const IRIS_CHOICES: readonly { readonly name: string; readonly linear: readonly [number, number, number]; readonly swatch: string }[] = Object.freeze([
  { name: 'hazel', linear: [0.40, 0.43, 0.24], swatch: '#a9ad84' },
  { name: 'green', linear: [0.25, 0.42, 0.18], swatch: '#89ad75' },
  { name: 'brown', linear: [0.20, 0.11, 0.05], swatch: '#7c5c3e' },
  { name: 'blue', linear: [0.18, 0.28, 0.42], swatch: '#7590ad' },
  { name: 'grey', linear: [0.30, 0.33, 0.34], swatch: '#949b9e' },
]);

/** The MOUTH slider: held open, 0 to 100. */
export function mouthLine(percent: number, talking: boolean): string {
  const p = Math.round(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)));
  return `MOUTH · ${p === 0 ? 'closed' : `${p}% open`}${talking ? ' · and talking' : ''}`;
}
export function browsLine(percent: number): string {
  const p = Math.round(Math.max(0, Math.min(100, percent)));
  return `BROWS · ${p === 0 ? 'none (the sculpt\'s own)' : `${p}%`}`;
}
export function lipsLine(percent: number): string {
  const p = Math.round(Math.max(0, Math.min(100, percent)));
  return `LIP COLOUR · ${p === 0 ? 'her skin' : `${p}%`}`;
}
