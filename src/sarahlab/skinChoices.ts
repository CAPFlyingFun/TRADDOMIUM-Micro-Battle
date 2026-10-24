/**
 * HER SKIN, CHOSEN (Joshua, 2026-10-24: "Can you compress all the images and add a button to switch between them, and
 * maybe a simple body texture uploaded/paint?").
 *
 * He had her skin's colour map enhanced three ways -- ChatGPT's experimental AI pass at 1254 square, a plain 4096 upscale
 * of the original, and his own Bazaart pass at 2048 -- and "the only way to know each one is to try and render and see
 * how it looks". So the Sarah Lab's FACE section carries SKIN, which steps through them on her, live: the file's own
 * map first (nothing downloaded, nothing of the approved body changes), then each candidate, fetched the first time it
 * is chosen. Each is a WebP made from his image at quality 90 (41-48 dB PSNR against it: no difference the eye finds),
 * 0.2 to 0.7 MB where the PNGs were 2.5 to 11.6 MB. Same atlas, same UVs: each one is laid on her exactly as the file's
 * own map is.
 *
 * What a choice costs on the GPU is what its pixels cost, not its download: the 4096 upscale is a 0.6 MB file and
 * 85 MB of texture with its mipmaps, four times the others, for no difference anyone could see in the comparison
 * shots, so its line says so.
 *
 * An UPLOADED image (any picture from the phone, meant to be a painted copy of her atlas) joins the cycle as UPLOAD,
 * and PAINT paints on whichever is chosen (`skinPaint.ts`); SAVE hands back the painted PNG, which UPLOAD takes again.
 *
 * Pure: names, paths and lines, so a test can read them.
 */

export type SkinId = 'original' | 'ai' | 'bazaart' | 'upscale' | 'upload';

export interface SkinChoice {
  readonly id: Exclude<SkinId, 'upload'>;
  readonly label: string;
  /** The candidate's file, or null for the body file's own map. */
  readonly path: string | null;
  /** Pixels square. */
  readonly size: number;
  readonly note: string;
}

/** The order SKIN steps through them. */
export const SKIN_CHOICES: readonly SkinChoice[] = Object.freeze([
  Object.freeze({ id: 'original', label: 'ORIGINAL', path: null, size: 2048, note: 'as approved' }),
  Object.freeze({ id: 'ai', label: 'AI 1254', path: 'models/skins/sarah-v2-skin-ai-1254.webp', size: 1254, note: 'ChatGPT, softest' }),
  Object.freeze({ id: 'bazaart', label: 'BAZAART', path: 'models/skins/sarah-v2-skin-bazaart-2048.webp', size: 2048, note: 'warmer, more contrast' }),
  Object.freeze({ id: 'upscale', label: '4K UPSCALE', path: 'models/skins/sarah-v2-skin-upscale-4096.webp', size: 4096, note: 'heavy on the GPU' }),
] as const);

/**
 * The original map as a plain image too, for the brush: where the room draws her body from the KTX2 pilot
 * (`?skin=ktx2`) her map is GPU-compressed and has no pixels a canvas can read.
 */
export const SKIN_ORIGINAL_IMAGE = 'models/skins/sarah-v2-skin-original-2048.webp';

/** The choice after `id`; UPLOAD is in the cycle only once there is an upload. */
export function nextSkin(id: SkinId, hasUpload: boolean): SkinId {
  const order: SkinId[] = [...SKIN_CHOICES.map((c) => c.id), ...(hasUpload ? (['upload'] as const) : [])];
  const at = order.indexOf(id);
  return order[(at < 0 ? 0 : at + 1) % order.length];
}

/** Megabytes of GPU memory a square map of `size` takes as 8-bit RGBA with its mipmaps. */
export function skinGpuMb(size: number, height = size): number {
  return Math.round((size * height * 4 * (4 / 3)) / (1024 * 1024));
}

/** The SKIN button. */
export function skinLine(id: SkinId, upload: { readonly name: string; readonly width: number; readonly height: number } | null): string {
  if (id === 'upload' && upload) return `SKIN · UPLOAD · ${upload.width}×${upload.height}`;
  const c = SKIN_CHOICES.find((s) => s.id === id) ?? SKIN_CHOICES[0];
  return `SKIN · ${c.label} · ${c.size}`;
}

/** The line under it: what the choice is, its size on the GPU, and whether it is still on its way. */
export function skinNote(id: SkinId, upload: { readonly name: string; readonly width: number; readonly height: number } | null, state: 'loading' | 'ready' | 'failed', painted: boolean): string {
  if (state === 'loading') return 'Loading the skin…';
  if (state === 'failed') return 'That skin could not be loaded: she keeps the one she had.';
  const c = id === 'upload' ? null : SKIN_CHOICES.find((s) => s.id === id) ?? SKIN_CHOICES[0];
  const size = c ? c.size : upload?.width ?? 0, height = c ? c.size : upload?.height ?? 0;
  const what = c ? c.note : `your image, ${upload?.name ?? ''}`.trim();
  const square = id !== 'upload' || (upload && upload.width === upload.height);
  return `${what} · ${skinGpuMb(size, height)} MB on the GPU${square ? '' : ' · not square: is it her atlas?'}${painted ? ' · painted (SAVE PNG keeps it)' : ''}`;
}

/** The brush's colours: what a touch-up of her face and skin needs, a tap each. */
export const SKIN_SWATCHES: readonly { readonly name: string; readonly hex: string }[] = Object.freeze([
  { name: 'skin', hex: '#e2b49f' },
  { name: 'blush', hex: '#d48a80' },
  { name: 'lips', hex: '#b2625c' },
  { name: 'brow', hex: '#6b3b23' },
  { name: 'iris', hex: '#5f6b3c' },
  { name: 'lash', hex: '#2b1c15' },
  { name: 'freckle', hex: '#b7774f' },
  { name: 'white', hex: '#f1ebe5' },
]);

/** '#rrggbb' as 0..255 channels (anything else is her skin swatch). */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = parseInt(m ? m[1] : SKIN_SWATCHES[0].hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The brush's size, centimetres on her: from a millimetre (an eyelash line) to six centimetres (a cheek). */
export const SKIN_BRUSH_CM = Object.freeze({ min: 0.1, max: 6, step: 0.1, initial: 0.8 });

export function skinBrushLine(cm: number, hard: boolean, erase: boolean): string {
  return `BRUSH · ${cm < 1 ? `${Math.round(cm * 10)} mm` : `${cm.toFixed(1)} cm`} · ${hard ? 'hard' : 'soft'} edge${erase ? ' · ERASING back to the skin' : ''}`;
}

export function skinStrengthLine(strength: number): string {
  return `STRENGTH · ${Math.round(Math.max(0, Math.min(1, strength)) * 100)}% a dab`;
}
