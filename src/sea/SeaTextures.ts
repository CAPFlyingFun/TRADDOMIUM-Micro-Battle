/**
 * THE SEA'S TWO TEXTURES, LOADED ONCE AND SHARED — and disposed.
 *
 * The ripple normal map and the foam lace. Both are baked to the quality
 * ladder (`scripts/bakeTextures.mjs`), so which FILE loads is the
 * player's setting, and both wrap and mip, so which FILTERING they get
 * is the player's setting too.
 *
 * WHY THIS IS A CLASS AND NOT TWO LINES IN THE MATERIAL. v0 loaded them
 * inside `makeWaterLook`, which is called once per SHEET — twice for the
 * ocean's near and far, three times once inland water existed. Three
 * `TextureLoader().load` calls for the same URL is three decodes, three
 * uploads and three resident copies on the GPU: at v0's 1536 ripple and
 * 1024 foam that is about 52 MiB of texture memory for two images. And
 * `Ocean.dispose()` disposed the geometry and the material and never the
 * textures, because it could not reach them — they were captured in a
 * closure. So a scene change leaked all of it.
 *
 * Here they are loaded once, handed to every wearer as the same uniform
 * objects, and this object owns their lifetime.
 *
 * A MISSING FILE IS A LOOK, NOT A FAILURE, and the two fallbacks are
 * chosen rather than convenient:
 *
 *   ripple  flat blue (128, 128, 255) — the neutral normal. No ripple.
 *   foam    dark grey (40, 40, 40) — BELOW every foam threshold in the
 *           shader, so a missing file means no surf. The opposite
 *           fallback would paint the whole shore solid white.
 *
 * Pure of gameplay: this knows about files and the GPU and nothing about
 * waves.
 */
import * as THREE from 'three';
import { textureUrl, type TextureName } from '../assets/textureManifest';
import { anisotropyFor, type TextureTier } from '../assets/textureQuality';

export interface SeaTextureOptions {
  readonly tier: TextureTier;
  /**
   * `renderer.capabilities.getMaxAnisotropy()`. Read by the caller,
   * because this module does not hold a renderer.
   */
  readonly deviceAnisotropy: number;
  /** `import.meta.env.BASE_URL` — the game is served from /v1/ on Pages. */
  readonly base?: string;
  /** Swappable for a test. Defaults to three's own loader. */
  readonly loader?: THREE.TextureLoader;
}

/** A texture uniform, shared BY REFERENCE with every material that reads it. */
export interface TextureSlot {
  value: THREE.Texture;
}

export class SeaTextures {
  /** The ripple normal map, four octaves of it per fragment. */
  readonly ripple: TextureSlot;
  /** The foam lace, thresholded into bubbles. */
  readonly foam: TextureSlot;
  /** What was actually asked of the GPU, so a HUD can be honest about it. */
  readonly anisotropy: number;
  readonly tier: TextureTier;

  private readonly fallbacks: THREE.Texture[] = [];
  private readonly loaded: THREE.Texture[] = [];
  private disposed = false;

  constructor(options: SeaTextureOptions) {
    this.tier = options.tier;
    this.anisotropy = anisotropyFor(options.tier, options.deviceAnisotropy);
    const loader = options.loader ?? new THREE.TextureLoader();
    const base = options.base ?? '/';
    this.ripple = this.slot('water-normal', flatNormal(), loader, base);
    this.foam = this.slot('surf-foam', darkerThanAnyThreshold(), loader, base);
  }

  private slot(
    name: TextureName,
    fallback: THREE.Texture,
    loader: THREE.TextureLoader,
    base: string,
  ): TextureSlot {
    this.fallbacks.push(fallback);
    const slot: TextureSlot = { value: fallback };
    loader.load(
      textureUrl(name, this.tier, base),
      (texture) => {
        // THE RACE IS REAL: a scene the player left while its textures
        // were in flight would otherwise upload them and leak them,
        // because nothing is left to dispose them afterwards.
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = this.anisotropy;
        // The ripple map is a normal map and the foam is read as a
        // brightness; neither is a colour anybody looks at, so neither
        // wants the sRGB transfer applied on the way in.
        texture.colorSpace = THREE.NoColorSpace;
        this.loaded.push(texture);
        slot.value = texture;
      },
      undefined,
      () => { /* flat water and a calm shore are looks, not failures */ },
    );
    return slot;
  }

  /** Everything this loaded, and the fallbacks it made. Idempotent. */
  dispose(): void {
    this.disposed = true;
    for (const texture of this.loaded) texture.dispose();
    for (const texture of this.fallbacks) texture.dispose();
    this.loaded.length = 0;
    this.fallbacks.length = 0;
  }
}

/** (128, 128, 255): straight up. A normal map that says "no ripple". */
function flatNormal(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * (40, 40, 40): below every foam threshold in the shader.
 *
 * The direction matters. Every foam ingredient is a `smoothstep` whose
 * lower edge is above this luminance, so a missing foam map means a
 * calm shore. A bright fallback would paint the entire waterline solid.
 */
function darkerThanAnyThreshold(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([40, 40, 40, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}
