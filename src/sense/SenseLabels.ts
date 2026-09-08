/**
 * THE ANTENNAE'S NAMES: the word over each thing the sweep has reached,
 * light on a dark plate, smaller and fainter the further off it is.
 *
 * This is the half of the effect that carries the INFORMATION. The fills
 * say WHERE things are and which of the three groups each belongs to; a
 * colour cannot say `RESIN` and a silhouette cannot tell a sprout from a
 * seedling. The two files read the same `Sighting[]`, neither arranges
 * it, and they never speak to each other.
 *
 * ─── one texture per WORD, never one per label ──────────────────────
 *
 * Text in a three scene is a canvas painted into a sprite. That keeps
 * the whole effect inside the scene graph: no DOM element projected
 * through the camera by hand every frame, and no HUD layer that floats
 * over the wrong thing for a frame whenever the camera turns.
 *
 * What a canvas costs is the PAINT and the upload, so nothing here
 * paints per frame or per label. The world names things from a small
 * closed set — twelve object families and three animals — so a plate is
 * minted ONCE for a word and then used by every label that says it, this
 * ping and every ping after. The cache is keyed on the word itself,
 * because the word is the whole of what a plate contains: the ink is the
 * same for every kind (the fill's hue has already said which group this
 * is, and re-saying it in the type would buy a texture per word-and-kind
 * pair for no new information), so two `TWIG`s are one texture whatever
 * they are.
 *
 * It is bounded at `WORD_CACHE_CAP` and evicts least-recently-used, not
 * because fifteen words need evicting but because a future family list,
 * or a name that carries a number in it, is exactly how a cache with no
 * bound is written by accident. The bound is a multiple of the label cap
 * so the entry evicted is never one this frame is drawing.
 *
 * ─── the dark plate is what makes it read in daylight ───────────────
 *
 * It is painted into the SAME texture as the glyphs rather than hung
 * behind them as a second object: one sprite, one draw, and a backing
 * that cannot arrive a frame late or a pixel off from the word it is
 * behind. Light letters on a dark plate hold up over bright fog and over
 * black soil alike, and neither is lit — like the finder's pins and like
 * the fills, a sense may not fail at night, which is half of Kaua'i's
 * day.
 *
 * ─── near words are big, far words are small ────────────────────────
 *
 * `FinderView`'s pins hold a CONSTANT size on screen and are right to: a
 * pin is the claim that something is over here, and a claim too small to
 * see is worth nothing. A name is not the same object. Two dozen of them
 * stand inside a six-metre bubble, and at one size the far ones — of
 * which there are always more, because the count grows with the area —
 * would pile on top of the near ones and the sweep would read as a page
 * of text rather than as things standing in a place. His screenshots
 * shrink, and shrinking is the only depth cue a flat unlit label has.
 *
 * So a label holds `LABEL_PIXELS` while it is within `LABEL_HOLD` of the
 * eye and then stops growing in the world, which makes it fall away on
 * screen exactly as a real object does; and it never falls below
 * `LABEL_MIN_PIXELS`, which is the smallest a word survives at arm's
 * length on a 430-pixel screen.
 *
 * ─── it may not name what the sweep cannot reach ────────────────────
 *
 * A name is a stronger claim than a shape: a word floating over a ridge
 * says "there is a WORM there" about something the antennae never
 * touched. So the labels are depth-tested like the fills are, for the
 * same reason (`SenseFills.SEE_THROUGH_WORLD`, ARCHITECTURE §2.9), and
 * the answer is named here too so the two can be tried together on the
 * device rather than drifting apart in a boolean each.
 */
import * as THREE from 'three';
import type { LocalPoint, WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';
import { LABEL_LIFT, LABEL_LIFT_FLOOR, type Sighting } from './senseTypes';

/**
 * The most words on screen at once, nearest to the sweep first.
 *
 * A label is about 30 pixels tall and, at three or four letters, 90 to
 * 130 wide — call it 3,000 px² of the 400,000 a 932x430 phone has. Two
 * dozen is therefore about a fifth of the view given over to text, which
 * is already the busiest an instrument should ever make the screen, and
 * it is comfortably more things than a player will walk to before the
 * ten seconds are up. The fills carry the rest: everything the sweep
 * reached still lights up, and only the nearest are NAMED. GAME TUNING.
 */
export const LABEL_CAP = 24;

/**
 * A label's height on screen in CSS pixels, plate and all, while it is
 * close. The word inside it is a little under half that — around 14
 * pixels of capital letter, which is ordinary phone body text and
 * readable at arm's length without being a banner. GAME TUNING.
 */
export const LABEL_PIXELS = 30;

/**
 * The smallest a label is ever drawn, in the same pixels. Half of full
 * size: past this a four-letter word is a grey smudge and would be
 * claiming to say something it cannot. The far ones are dropped by
 * `LABEL_CAP` long before this is the thing that saves them. GAME
 * TUNING.
 */
export const LABEL_MIN_PIXELS = 15;

/**
 * How far a label holds its full size before it starts falling away
 * with distance, in world units — a metre and a half, a quarter of the
 * sweep's own six-metre reach (`pulse.SENSE_RADIUS`).
 *
 * Set by where the shrink has to be VISIBLE: past here the label keeps
 * a constant world size, so it halves on screen by three metres and then
 * holds at the floor. That puts the whole of the near-to-far contrast
 * inside the nearest half of the bubble, where the things a player is
 * about to touch are. GAME TUNING.
 */
export const LABEL_HOLD = 150;

/**
 * How many word plates are kept. Two per label on screen: enough that
 * the fifteen words the world actually uses never evict each other, and
 * a bound that cannot evict a plate the current frame is drawing —
 * at most `LABEL_CAP` are in use, so a scan for a victim always finds
 * one that is not.
 */
export const WORD_CACHE_CAP = LABEL_CAP * 2;

/**
 * Whether a name draws through the ground. FALSE — see the header. It
 * must agree with the fills' answer: a shape the sweep declines to show
 * through a hill and a word that shows anyway is the two halves of one
 * effect disagreeing about what was sensed.
 */
export const LABELS_SEE_THROUGH_WORLD = false;

/**
 * After the fills (3000), before the finder's pins (4000). The names go
 * over the shapes they name; the finder is a dev instrument and stays
 * the last thing on the screen when it is on at all.
 */
export const LABEL_RENDER_ORDER = 3500;

/**
 * The plate, in canvas texels. 96 tall for a 30-pixel label, so a 3x
 * phone screen gets its texels one for one and nothing is resampled up.
 * The width is the word's, so every plate is tight around its own text
 * and the sprite's aspect comes from the paint rather than from a fixed
 * canvas with transparent margins.
 */
const TEXTURE_HEIGHT = 96;
const FONT_PX = 64;
const PADDING_PX = 22;
/** A word longer than this is shrunk to fit rather than clipped: half a word names the wrong thing. */
const MAX_TEXTURE_WIDTH = 512;
const MIN_FONT_PX = 30;

/** Near-black at three quarters, so the ground shows through it a little and it is still a plate. */
const PLATE = 'rgba(6, 9, 12, 0.74)';
/** The HUD's parchment, so an instrument reads as one thing wherever it appears. */
const INK = '#f4f1de';
/** A soft dark halo under the glyphs, for the moment a bright sky is behind the plate's edge. */
const GLOW = 'rgba(0, 0, 0, 0.85)';
const GLOW_BLUR = 8;

const font = (px: number): string => `bold ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;

/**
 * How wide a capital letter is as a fraction of its font size, used ONLY
 * where there is no 2D context to measure with — jsdom, and nothing on a
 * phone. It keeps a test's sprite at a believable aspect instead of a
 * zero-width one; the real width always comes from `measureText`.
 */
const ESTIMATED_GLYPH_WIDTH = 0.62;

/** One word, painted once. */
interface WordPlate {
  readonly texture: THREE.CanvasTexture;
  /** Width over height of the plate, so a sprite can be scaled by its height alone. */
  readonly aspect: number;
  /** The frame it was last drawn on, for the eviction scan. */
  usedFrame: number;
}

/** Where a world position is drawn. `world/origin.toLocal` is the default; a test hands in its own. */
export interface LabelOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

/**
 * The camera facts the size rule needs: the vertical field in RADIANS,
 * the viewport's height in CSS pixels, and where the camera stands in
 * the same local frame the labels are drawn in. Structurally the fills'
 * lens, so one object serves both; passed rather than read off a camera
 * so a test can hold all three still.
 */
export interface LabelLens {
  readonly fovRadians: number;
  readonly heightPx: number;
  readonly at: THREE.Vector3;
}

export interface SenseLabelsOptions {
  readonly origin?: LabelOrigin;
}

export class SenseLabels {
  /** One group, added to the scene once. */
  readonly group = new THREE.Group();

  /** The pool. Every sprite that will ever exist is made here; a frame only moves them. */
  private readonly sprites: THREE.Sprite[] = [];
  /**
   * A material per POOL SLOT rather than per word, which is what lets a
   * label's opacity be its own sighting's strength while the texture
   * under it is shared by every label saying the same word.
   */
  private readonly materials: THREE.SpriteMaterial[] = [];
  private readonly plates = new Map<string, WordPlate>();
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private disposed = false;

  // Scratch, allocated once. Nothing here grows with the sighting list:
  // the sweep's front expands every frame of its first second, so a
  // buffer sized to the list would be an allocation per frame.
  private readonly pos = new THREE.Vector3();
  /** The nearest `LABEL_CAP` sightings of the current frame, indices, nearest first. */
  private readonly picked = new Int32Array(LABEL_CAP);

  private shown = 0;
  private frame = 0;

  constructor(options: SenseLabelsOptions = {}) {
    this.toLocal = options.origin ? (at) => options.origin!.toLocal(at) : originToLocal;
    this.group.name = 'sense:labels';
    for (let i = 0; i < LABEL_CAP; i += 1) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: !LABELS_SEE_THROUGH_WORLD,
        // No label writes depth, so two of them never punch holes in each
        // other; three sorts the transparent pass back to front within
        // one render order, which puts the near word on top of the far
        // one — the reading order you want anyway.
        depthWrite: false,
        toneMapped: false,
        // The island's haze may not decide how bright a sense is; only
        // `strength` may.
        fog: false,
        // The scale below is in WORLD units and this file works out what
        // it should be; three must not also attenuate it.
        sizeAttenuation: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `sense:label:${i}`;
      // The anchor is the plate's BOTTOM edge, so the position is where
      // the label starts and its height cannot push it down into the
      // thing it names.
      sprite.center.set(0.5, 0);
      sprite.renderOrder = LABEL_RENDER_ORDER;
      // `center` moves the quad in the shader and the bounding sphere
      // does not know it, so three would cull a label at the top of the
      // screen while it is still on screen.
      sprite.frustumCulled = false;
      sprite.visible = false;
      this.materials.push(material);
      this.sprites.push(sprite);
      this.group.add(sprite);
    }
  }

  /** How many words the last frame drew. For the HUD; never fed back into anything drawn. */
  get drawn(): number {
    return this.shown;
  }

  /** How many plates the cache is holding. For the HUD and for the bound's test. */
  get cachedWords(): number {
    return this.plates.size;
  }

  /**
   * Name everything the sweep has reached, nearest first, up to the cap.
   *
   * THERE IS NO OFF SWITCH, for the reason the fills have none: an empty
   * list draws nothing, and an empty list is what a pulse that has run
   * out hands over, so a second way to be off is only a chance for the
   * two to disagree about which one the player is looking at.
   */
  update(sightings: readonly Sighting[], lens: LabelLens): void {
    if (this.disposed) return;
    this.frame += 1;
    const kept = this.pickNearest(sightings);

    // The world size of one pixel at distance d is 2·d·tan(fov/2) / heightPx.
    const perPixel = lens.heightPx > 0 ? (2 * Math.tan(lens.fovRadians / 2)) / lens.heightPx : 0;
    let shown = 0;
    for (let k = 0; k < kept; k += 1) {
      const s = sightings[this.picked[k]];
      const plate = this.plateFor(s.name);
      const here = this.toLocal(s.at);
      // A thing's top is at most its longest axis above the height it
      // stands at — nothing here knows the posture table `SenseFills`
      // uses, and a name a little high is right where a name inside the
      // body is wrong.
      const lift = Math.max(s.size * LABEL_LIFT, LABEL_LIFT_FLOOR);
      this.pos.set(here.lx, s.height + s.size + lift, here.lz);

      const away = this.pos.distanceTo(lens.at);
      const pixels = Math.min(
        LABEL_PIXELS,
        Math.max(LABEL_MIN_PIXELS, (LABEL_PIXELS * LABEL_HOLD) / Math.max(away, LABEL_HOLD)),
      );
      const height = away * perPixel * pixels;

      const sprite = this.sprites[shown];
      const material = this.materials[shown];
      if (material.map !== plate.texture) {
        // A null map and a texture are different shader PROGRAMS; one
        // texture for another is not, so the recompile is asked for
        // exactly once per slot and never again. The swap itself reaches
        // the GPU because each slot owns its material: three re-uploads a
        // material's uniforms whenever the one it drew last was a
        // different material, which for a pool of twenty-four is every
        // one of them, every frame.
        const first = material.map === null;
        material.map = plate.texture;
        if (first) material.needsUpdate = true;
      }
      // The plate's own darkness lives in the texture, so the material's
      // opacity is purely the pulse's. Clamped, because a label may not
      // come out brighter than the sweep it belongs to however the
      // caller arrived at the number.
      material.opacity = s.strength > 1 ? 1 : s.strength;
      sprite.position.copy(this.pos);
      sprite.scale.set(height * plate.aspect, height, 1);
      sprite.visible = true;
      shown += 1;
    }
    for (let i = shown; i < LABEL_CAP; i += 1) this.sprites[i].visible = false;
    this.shown = shown;
  }

  /**
   * The nearest `LABEL_CAP` sightings with any strength left in them,
   * nearest first, written into `picked`. Returns how many there are.
   *
   * A running top-of-the-list rather than a sort of the whole thing: the
   * cap is two dozen of what is often a couple of hundred sightings, so
   * nearly every candidate is settled by one comparison against the
   * furthest name currently on the list, and nothing has to be allocated
   * to hold an ordering of a list whose length changes every frame.
   *
   * The distance ranked on is the SWEEP's, not the camera's — it is the
   * antennae that are running out of reach, and the camera can be
   * looking anywhere. A word at zero strength is left out entirely: the
   * pulse's envelope is zero beyond its front and after its fade, so
   * that is the ordinary end of a label's life rather than an edge case.
   */
  private pickNearest(sightings: readonly Sighting[]): number {
    let kept = 0;
    for (let i = 0; i < sightings.length; i += 1) {
      const s = sightings[i];
      if (!(s.strength > 0)) continue;
      const d = s.distance;
      if (kept === LABEL_CAP && !(d < sightings[this.picked[kept - 1]].distance)) continue;
      let at = kept < LABEL_CAP ? kept : LABEL_CAP - 1;
      while (at > 0 && sightings[this.picked[at - 1]].distance > d) {
        this.picked[at] = this.picked[at - 1];
        at -= 1;
      }
      this.picked[at] = i;
      if (kept < LABEL_CAP) kept += 1;
    }
    return kept;
  }

  dispose(): void {
    this.disposed = true;
    this.shown = 0;
    for (const sprite of this.sprites) {
      sprite.visible = false;
      this.group.remove(sprite);
    }
    for (const material of this.materials) {
      material.map = null;
      material.dispose();
    }
    for (const plate of this.plates.values()) plate.texture.dispose();
    this.plates.clear();
  }

  /** The plate for a word, minted on first sight and kept. */
  private plateFor(word: string): WordPlate {
    const held = this.plates.get(word);
    if (held !== undefined) {
      held.usedFrame = this.frame;
      return held;
    }
    if (this.plates.size >= WORD_CACHE_CAP) this.evict();
    const plate = paintPlate(word);
    plate.usedFrame = this.frame;
    this.plates.set(word, plate);
    return plate;
  }

  /** Drop the plate used longest ago, never one this frame is drawing. */
  private evict(): void {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [word, plate] of this.plates) {
      if (plate.usedFrame === this.frame) continue;
      if (plate.usedFrame < oldest) {
        oldest = plate.usedFrame;
        victim = word;
      }
    }
    // `WORD_CACHE_CAP > LABEL_CAP` is what makes the scan certain to find
    // one; the fallback exists so a cap edited to the wrong side of that
    // costs a re-upload rather than an unbounded cache.
    if (victim === null) victim = this.plates.keys().next().value ?? null;
    if (victim === null) return;
    this.plates.get(victim)?.texture.dispose();
    this.plates.delete(victim);
  }
}

/**
 * Paint one word: a dark plate the size of the canvas with the word
 * centred on it, glowing faintly so its edge survives a bright sky
 * behind the plate.
 *
 * The plate IS the canvas rather than a bar inside a fixed one — a word
 * is short and known, so there is no reason to carry transparent margin
 * into the texture and then hide it with an aspect. Under jsdom
 * `getContext('2d')` is null; the texture still exists, unpainted, at a
 * believable aspect, so the scene graph is the same in a test as on a
 * phone.
 */
function paintPlate(word: string): WordPlate {
  const canvas = document.createElement('canvas');
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');

  let px = FONT_PX;
  let width = ESTIMATED_GLYPH_WIDTH * px * word.length;
  if (ctx !== null) {
    ctx.font = font(px);
    width = ctx.measureText(word).width;
    // Shrink the type until a long name fits rather than clipping it:
    // half a word names something else.
    const room = MAX_TEXTURE_WIDTH - PADDING_PX * 2;
    while (width > room && px > MIN_FONT_PX) {
      px = Math.max(MIN_FONT_PX, Math.floor((px * room) / width));
      ctx.font = font(px);
      width = ctx.measureText(word).width;
    }
  }
  canvas.width = Math.max(
    TEXTURE_HEIGHT,
    Math.min(MAX_TEXTURE_WIDTH, Math.ceil(width) + PADDING_PX * 2),
  );

  if (ctx !== null) {
    // Setting the width above resets the context, so the font is stated
    // again here rather than trusted from the measuring pass.
    ctx.font = font(px);
    ctx.fillStyle = PLATE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = GLOW_BLUR;
    ctx.fillStyle = INK;
    ctx.fillText(word, canvas.width / 2, canvas.height / 2, canvas.width - PADDING_PX * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height, usedFrame: -1 };
}
