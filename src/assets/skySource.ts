/**
 * THE SKY, FETCHED — the dome's half of the one loader (ARCHITECTURE
 * §2.5), shaped like `SeaTextures` for the same reasons: which FILE
 * loads is the player's texture rung (`skyManifest.skyUrl` walks down
 * to the best rung that exists), the base path is handed in because the
 * game is served from `/v1/` on Pages and a hard-coded `/sky/…` is a
 * 404 on the only build Joshua plays, and the loader is swappable so a
 * test can hand a texture in without a network.
 *
 * WHAT A SKY TEXTURE IS, ONCE LOADED, is decided here and not in the
 * view, because these are facts about the FILE:
 *
 *   sRGB          the bake wrote tone-mapped sRGB; three uploads it as
 *                 such and the shader reads linear light back.
 *   no mip chain  the dome is only ever MAGNIFIED — 2048 pixels round
 *                 360° is 5.7 a degree, a phone at 70° across 932
 *                 logical pixels is 13 — so mipmaps would cost a third
 *                 more memory to sample a level nothing reaches, and
 *                 the seam where the map wraps would show as a line
 *                 wherever the derivative flips. Linear both ways.
 *   wraps in u    the map is a full turn; the shader's `fract` needs
 *                 the sampler to agree at the seam.
 *   clamps in v   the poles are edges, not a wrap.
 *
 * A MISSING FILE IS A LOOK, NOT A FAILURE: the promise rejects, and the
 * dome shows the horizon colour for that sky, which is what fog does to
 * a sky anyway. Nothing retries — a sky is asked for again the next time
 * the look needs it and the texture is not resident.
 */
import * as THREE from 'three';
import { skyUrl, type SkyImageId } from './skyManifest';
import type { TextureTier } from './textureQuality';

export interface SkyLoadOptions {
  /** `import.meta.env.BASE_URL` — the game is served from /v1/ on Pages. Defaults to `/`. */
  readonly base?: string;
  /** Swappable for a test. Defaults to three's own loader. */
  readonly loader?: THREE.TextureLoader;
}

/** The shape `sky/SkyView` takes: one sky at one rung, when it is needed. */
export type SkyLoader = (id: SkyImageId, tier: TextureTier) => Promise<THREE.Texture>;

/** Load one baked sky at a rung, ready for the dome. Rejects when the file does not arrive. */
export function loadSky(id: SkyImageId, tier: TextureTier, options: SkyLoadOptions = {}): Promise<THREE.Texture> {
  const loader = options.loader ?? new THREE.TextureLoader();
  return loader.loadAsync(skyUrl(id, tier, options.base ?? '/')).then(prepareSkyTexture);
}

/** A loader bound to a base path, for the view to call lazily. */
export function skyLoaderFor(options: SkyLoadOptions = {}): SkyLoader {
  return (id, tier) => loadSky(id, tier, options);
}

/** The sampler state a sky texture must have — see the header. Idempotent; returns its argument. */
export function prepareSkyTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
