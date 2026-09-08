// @vitest-environment jsdom
/**
 * THE ANTENNAE'S NAMES, without a GPU: three's scene graph and the
 * sightings a sweep would hand over.
 *
 *   a name stands above the thing and clear of it, floor and all
 *   one texture per WORD, reused by every label that says it, and the
 *     cache is bounded rather than growing with the words it has seen
 *   a label fades with the sighting's own strength and nothing else
 *   the cap keeps the NEAREST, because those are the ones a player
 *     can walk to before the ten seconds are up
 *   near words hold their size, far ones shrink, none go below the floor
 *   the pool is made once and reused; a frame moves sprites, never adds
 *   dispose lets go of every texture and every material
 *
 * WHY THE DOM IS BARELY IN THIS FILE. jsdom has no canvas backend, so
 * `getContext('2d')` returns null and nothing can be asserted about
 * pixels. What matters here is not the paint anyway — it is the CACHE,
 * the placement and the pooling, all of which are ordinary objects. A
 * stand-in 2D context is installed so the painting path runs and the
 * measured width reaches the sprite's aspect, and the degrade with no
 * context at all is checked on its own.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  LABELS_SEE_THROUGH_WORLD,
  LABEL_CAP,
  LABEL_HOLD,
  LABEL_MIN_PIXELS,
  LABEL_PIXELS,
  LABEL_RENDER_ORDER,
  SenseLabels,
  WORD_CACHE_CAP,
  type LabelLens,
} from '../src/sense/SenseLabels';
import { LABEL_LIFT, LABEL_LIFT_FLOOR, type SenseKind, type Sighting } from '../src/sense/senseTypes';
import { world } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';

const GROUND = 1000;
const FOV = (60 * Math.PI) / 180;
/** The world size of one pixel at unit distance, on a 430-pixel phone screen. */
const PER_PIXEL = (2 * Math.tan(FOV / 2)) / 430;

/** A lens 60° tall on a 430-pixel phone screen, standing at the height the labels are placed at. */
function lens(at = new THREE.Vector3(0, GROUND, 0), heightPx = 430): LabelLens {
  return { fovRadians: FOV, heightPx, at };
}

interface Facts {
  readonly kind?: SenseKind;
  readonly wx?: number;
  readonly wz?: number;
  readonly height?: number;
  readonly size?: number;
  readonly distance?: number;
  readonly strength?: number;
}

function sighting(name: string, facts: Facts = {}): Sighting {
  const wx = facts.wx ?? 0;
  const wz = facts.wz ?? 0;
  return {
    id: `${name}:${wx},${wz}`,
    kind: facts.kind ?? 'material',
    name,
    at: world(wx, wz),
    height: facts.height ?? GROUND,
    size: facts.size ?? 20,
    distance: facts.distance ?? Math.hypot(wx, wz),
    strength: facts.strength ?? 1,
  };
}

const lift = (size: number): number => Math.max(size * LABEL_LIFT, LABEL_LIFT_FLOOR);

/**
 * A thing whose LABEL lands exactly at the camera's own height, so the
 * distance from the lens to the label is `wx` and the size rule can be
 * read straight off the sprite.
 */
function atRange(name: string, wx: number, size = 20): Sighting {
  return sighting(name, { wx, size, height: GROUND - size - lift(size), distance: wx });
}

const spriteAt = (view: SenseLabels, i: number): THREE.Sprite => view.group.children[i] as THREE.Sprite;
const mapAt = (view: SenseLabels, i: number): THREE.Texture | null => spriteAt(view, i).material.map;
const visible = (view: SenseLabels): number => view.group.children.filter((c) => c.visible).length;

/**
 * A stand-in 2D context: enough of one for the plate to be painted and
 * measured. Not a canvas implementation — it exists so the paint path
 * runs somewhere no real canvas does.
 */
interface Stroke {
  readonly word: string;
  readonly canvasWidth: number;
  readonly plates: number;
}

const strokes: Stroke[] = [];

function stubInk(canvas: HTMLCanvasElement): unknown {
  let px = 10;
  let plates = 0;
  return {
    set font(value: string) {
      px = Number.parseInt(/(\d+)px/.exec(value)?.[1] ?? '10', 10);
    },
    get font(): string {
      return `${px}px`;
    },
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    measureText: (text: string): { width: number } => ({ width: text.length * px * 0.6 }),
    fillRect: (): void => {
      plates += 1;
    },
    fillText: (text: string): void => {
      strokes.push({ word: text, canvasWidth: canvas.width, plates });
    },
  };
}

type WithContext = { getContext: (id: string) => unknown };
const prototype = HTMLCanvasElement.prototype as unknown as WithContext;
let realGetContext: (id: string) => unknown;

beforeAll(() => {
  realGetContext = prototype.getContext;
  prototype.getContext = function (this: HTMLCanvasElement, id: string): unknown {
    return id === '2d' ? stubInk(this) : null;
  };
});

afterAll(() => {
  prototype.getContext = realGetContext;
});

afterEach(() => {
  setOrigin(world(0, 0));
  strokes.length = 0;
});

describe('SenseLabels', () => {
  it('draws nothing until the sweep finds something', () => {
    const view = new SenseLabels();
    expect(view.drawn).toBe(0);
    expect(visible(view)).toBe(0);
    view.update([], lens());
    expect(view.drawn).toBe(0);
    expect(visible(view)).toBe(0);
    view.dispose();
  });

  it('stands the name above the thing, clear of its body', () => {
    const view = new SenseLabels();
    view.update([sighting('TWIG', { wx: 300, wz: -120, size: 20 })], lens());
    const sprite = spriteAt(view, 0);
    expect(sprite.visible).toBe(true);
    expect(sprite.position.x).toBeCloseTo(300, 4);
    expect(sprite.position.z).toBeCloseTo(-120, 4);
    // The top of the thing plus its lift — and the anchor is the plate's
    // bottom edge, so nothing of the label hangs back down into it.
    expect(sprite.position.y).toBeCloseTo(GROUND + 20 + 20 * LABEL_LIFT, 4);
    expect(sprite.position.y).toBeGreaterThan(GROUND + 20);
    expect(sprite.center.y).toBe(0);
    view.dispose();
  });

  it('lifts a 2.5 mm aphid by the floor, not by its own tiny fraction', () => {
    const view = new SenseLabels();
    // 65% of a 2.5 mm body is under two millimetres: the name would print
    // inside the animal.
    view.update([sighting('APHID', { kind: 'creature', wx: 100, size: 0.25 })], lens());
    expect(spriteAt(view, 0).position.y).toBeCloseTo(GROUND + 0.25 + LABEL_LIFT_FLOOR, 4);
    view.dispose();
  });

  it('paints one texture per WORD and reuses it for every label that says it', () => {
    const view = new SenseLabels();
    view.update(
      [
        sighting('TWIG', { wx: 100 }),
        sighting('TWIG', { wx: 200 }),
        sighting('TWIG', { wx: 300 }),
        sighting('RESIN', { wx: 400 }),
      ],
      lens(),
    );
    expect(view.drawn).toBe(4);
    expect(view.cachedWords).toBe(2);
    expect(mapAt(view, 0)).not.toBeNull();
    expect(mapAt(view, 1)).toBe(mapAt(view, 0));
    expect(mapAt(view, 2)).toBe(mapAt(view, 0));
    expect(mapAt(view, 3)).not.toBe(mapAt(view, 0));
    // Painted once each, and the plate went down before the word.
    expect(strokes.map((s) => s.word)).toEqual(['TWIG', 'RESIN']);
    expect(strokes.every((s) => s.plates === 1)).toBe(true);
    view.dispose();
  });

  it('never repaints a word it has already seen, this frame or any later one', () => {
    const view = new SenseLabels();
    const twig = mapOf(view, 'TWIG');
    for (let f = 0; f < 30; f += 1) view.update([sighting('TWIG', { wx: 100 + f })], lens());
    expect(strokes).toHaveLength(1);
    expect(mapAt(view, 0)).toBe(twig);
    expect(view.cachedWords).toBe(1);
    view.dispose();
  });

  it('sizes the plate to the word: a longer name gets a wider texture, not smaller type', () => {
    const view = new SenseLabels();
    view.update([sighting('FERN', { wx: 100 }), sighting('DRIFTWOOD', { wx: 200 })], lens());
    const [short, long] = strokes;
    expect(long.canvasWidth).toBeGreaterThan(short.canvasWidth);
    // And the sprite is stretched by that same aspect, so the letters are
    // the same shape on both.
    const shortSprite = spriteAt(view, 0);
    const longSprite = spriteAt(view, 1);
    expect(longSprite.scale.x / longSprite.scale.y).toBeGreaterThan(shortSprite.scale.x / shortSprite.scale.y);
    view.dispose();
  });

  it('BOUNDS the cache: seeing three hundred words does not keep three hundred textures', () => {
    const view = new SenseLabels();
    const minted = new Set<THREE.Texture>();
    let freed = 0;
    for (let i = 0; i < WORD_CACHE_CAP * 3; i += 1) {
      view.update([sighting(`WORD${i}`, { wx: 100 })], lens());
      const texture = mapAt(view, 0);
      if (texture !== null && !minted.has(texture)) {
        minted.add(texture);
        texture.addEventListener('dispose', () => {
          freed += 1;
        });
      }
      expect(view.cachedWords).toBeLessThanOrEqual(WORD_CACHE_CAP);
    }
    expect(minted.size).toBe(WORD_CACHE_CAP * 3);
    expect(view.cachedWords).toBe(WORD_CACHE_CAP);
    // Everything evicted was let go of rather than merely forgotten.
    expect(freed).toBe(WORD_CACHE_CAP * 2);
    view.dispose();
  });

  it('never evicts a plate the frame it is drawing is using', () => {
    // The bound is a multiple of the label cap precisely so this cannot
    // happen: a frame draws at most LABEL_CAP words and the cache holds
    // more than that, so the eviction scan always has a victim that is
    // not on screen.
    expect(WORD_CACHE_CAP).toBeGreaterThan(LABEL_CAP);
    const view = new SenseLabels();
    const crowd: Sighting[] = [];
    for (let i = 0; i < LABEL_CAP; i += 1) crowd.push(sighting(`NEAR${i}`, { wx: 100 + i }));
    // Fill the cache with words that are no longer in sight...
    for (let i = 0; i < WORD_CACHE_CAP; i += 1) view.update([sighting(`OLD${i}`, { wx: 100 })], lens());
    expect(view.cachedWords).toBe(WORD_CACHE_CAP);
    // ...then ask for a full screen of new ones in a single frame.
    view.update(crowd, lens());
    expect(view.drawn).toBe(LABEL_CAP);
    const drawn = new Set<THREE.Texture | null>();
    for (let i = 0; i < LABEL_CAP; i += 1) drawn.add(mapAt(view, i));
    expect(drawn.size).toBe(LABEL_CAP);
    expect(view.cachedWords).toBe(WORD_CACHE_CAP);
    view.dispose();
  });

  it('fades with the sighting\'s own strength and nothing else', () => {
    const view = new SenseLabels();
    view.update(
      [
        sighting('TWIG', { wx: 100, strength: 1 }),
        sighting('RESIN', { wx: 200, strength: 0.4 }),
        sighting('STONE', { wx: 300, strength: 0.05 }),
      ],
      lens(),
    );
    expect(spriteAt(view, 0).material.opacity).toBeCloseTo(1, 6);
    expect(spriteAt(view, 1).material.opacity).toBeCloseTo(0.4, 6);
    expect(spriteAt(view, 2).material.opacity).toBeCloseTo(0.05, 6);
    view.dispose();
  });

  it('cannot be made brighter than the pulse it belongs to', () => {
    const view = new SenseLabels();
    view.update([sighting('TWIG', { wx: 100, strength: 4 })], lens());
    expect(spriteAt(view, 0).material.opacity).toBe(1);
    view.dispose();
  });

  it('does not spend a draw on a word at zero strength', () => {
    const view = new SenseLabels();
    view.update(
      [sighting('GONE', { wx: 100, strength: 0 }), sighting('TWIG', { wx: 200, strength: 0.8 })],
      lens(),
    );
    expect(view.drawn).toBe(1);
    expect(visible(view)).toBe(1);
    // And the one that is drawn is the one with strength left in it.
    expect(spriteAt(view, 0).position.x).toBeCloseTo(200, 4);
    expect(view.cachedWords).toBe(1);
    view.dispose();
  });

  it('keeps the NEAREST when there are more things than words on screen', () => {
    const view = new SenseLabels();
    const many: Sighting[] = [];
    // Furthest first, so an unsorted slice would name exactly the wrong ones.
    for (let i = LABEL_CAP + 20; i > 0; i -= 1) many.push(sighting(`W${i}`, { wx: i * 10 }));
    view.update(many, lens());
    expect(view.drawn).toBe(LABEL_CAP);
    expect(visible(view)).toBe(LABEL_CAP);
    expect(spriteAt(view, 0).position.x).toBeCloseTo(10, 4);
    expect(spriteAt(view, LABEL_CAP - 1).position.x).toBeCloseTo(LABEL_CAP * 10, 4);
    // Nothing was painted for the words that were dropped.
    expect(view.cachedWords).toBe(LABEL_CAP);
    view.dispose();
  });

  it('names them nearest first, whether or not the cap is biting', () => {
    // The order is not cosmetic: it is what the cap cuts from the end
    // of, so it has to be right before the list is full rather than
    // only once it overflows.
    const view = new SenseLabels();
    view.update(
      [
        sighting('FAR', { wx: 400 }),
        sighting('NEAR', { wx: 40 }),
        sighting('MID', { wx: 180 }),
      ],
      lens(),
    );
    expect(view.drawn).toBe(3);
    expect(spriteAt(view, 0).position.x).toBeCloseTo(40, 4);
    expect(spriteAt(view, 1).position.x).toBeCloseTo(180, 4);
    expect(spriteAt(view, 2).position.x).toBeCloseTo(400, 4);
    view.dispose();
  });

  it('holds a readable size close up: twice as far is twice as big in the world', () => {
    const view = new SenseLabels();
    view.update([atRange('NEAR', LABEL_HOLD / 3), atRange('MID', (LABEL_HOLD * 2) / 3)], lens());
    const near = spriteAt(view, 0).scale.y;
    const mid = spriteAt(view, 1).scale.y;
    expect(mid / near).toBeCloseTo(2, 5);
    // And the size asked for is the size drawn.
    expect(near).toBeCloseTo((LABEL_HOLD / 3) * PER_PIXEL * LABEL_PIXELS, 6);
    view.dispose();
  });

  it('SHRINKS past the hold: the same world size, so it falls away like a real thing', () => {
    const view = new SenseLabels();
    view.update(
      [atRange('A', LABEL_HOLD), atRange('B', LABEL_HOLD * 1.5), atRange('C', LABEL_HOLD * 2)],
      lens(),
    );
    const held = spriteAt(view, 0).scale.y;
    expect(spriteAt(view, 1).scale.y).toBeCloseTo(held, 6);
    expect(spriteAt(view, 2).scale.y).toBeCloseTo(held, 6);
    // Which on screen is full size, two thirds of it, and half of it.
    const pixels = (i: number, at: number): number => spriteAt(view, i).scale.y / (at * PER_PIXEL);
    expect(pixels(0, LABEL_HOLD)).toBeCloseTo(LABEL_PIXELS, 4);
    expect(pixels(1, LABEL_HOLD * 1.5)).toBeCloseTo((LABEL_PIXELS * 2) / 3, 4);
    expect(pixels(2, LABEL_HOLD * 2)).toBeCloseTo(LABEL_MIN_PIXELS, 4);
    view.dispose();
  });

  it('never shrinks below the floor, however far off the thing is', () => {
    const view = new SenseLabels();
    const far = LABEL_HOLD * 8;
    view.update([atRange('FAR', far)], lens());
    expect(spriteAt(view, 0).scale.y / (far * PER_PIXEL)).toBeCloseTo(LABEL_MIN_PIXELS, 4);
    view.dispose();
  });

  it('a taller viewport draws a label smaller in the world, because a pixel is smaller', () => {
    const view = new SenseLabels();
    view.update([atRange('TWIG', 100)], lens(new THREE.Vector3(0, GROUND, 0), 430));
    const phone = spriteAt(view, 0).scale.y;
    view.update([atRange('TWIG', 100)], lens(new THREE.Vector3(0, GROUND, 0), 860));
    expect(spriteAt(view, 0).scale.y).toBeCloseTo(phone / 2, 6);
    view.dispose();
  });

  it('POOLS its sprites: a frame moves them and never adds one', () => {
    const view = new SenseLabels();
    expect(view.group.children).toHaveLength(LABEL_CAP);
    const first = spriteAt(view, 0);
    const last = spriteAt(view, LABEL_CAP - 1);
    for (let f = 0; f < 20; f += 1) {
      const list: Sighting[] = [];
      for (let i = 0; i < (f % 5) + 1; i += 1) list.push(sighting(`W${i}`, { wx: 100 + i * 10 }));
      view.update(list, lens());
      expect(view.group.children).toHaveLength(LABEL_CAP);
      expect(visible(view)).toBe((f % 5) + 1);
    }
    expect(spriteAt(view, 0)).toBe(first);
    expect(spriteAt(view, LABEL_CAP - 1)).toBe(last);
    view.dispose();
  });

  it('puts down the labels it stopped drawing rather than leaving them standing', () => {
    const view = new SenseLabels();
    const many: Sighting[] = [];
    for (let i = 0; i < 10; i += 1) many.push(sighting(`W${i}`, { wx: 100 + i * 10 }));
    view.update(many, lens());
    expect(visible(view)).toBe(10);
    view.update([], lens());
    expect(view.drawn).toBe(0);
    expect(visible(view)).toBe(0);
    view.dispose();
  });

  it('is unlit, unfogged, and never punches a hole in the label behind it', () => {
    const view = new SenseLabels();
    const sprite = spriteAt(view, 0);
    const material = sprite.material;
    expect(material.type).toBe('SpriteMaterial');
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.sizeAttenuation).toBe(true);
    expect(sprite.renderOrder).toBe(LABEL_RENDER_ORDER);
    view.dispose();
  });

  it('names only what the sweep can reach: depth-tested, like the fills', () => {
    // A word floating over a ridge would say there is a WORM there about
    // something the antennae never touched (ARCHITECTURE §2.9).
    expect(LABELS_SEE_THROUGH_WORLD).toBe(false);
    const view = new SenseLabels();
    expect(spriteAt(view, 0).material.depthTest).toBe(true);
    // Over the fills (3000), under the finder's pins (4000).
    expect(LABEL_RENDER_ORDER).toBeGreaterThan(3000);
    expect(LABEL_RENDER_ORDER).toBeLessThan(4000);
    view.dispose();
  });

  it('moves its names with the world when the origin shifts', () => {
    const view = new SenseLabels();
    const twig = sighting('TWIG', { wx: 5_000, distance: 300 });
    view.update([twig], lens());
    expect(spriteAt(view, 0).position.x).toBeCloseTo(5_000, 3);
    // The origin snaps to a lattice, so the label is asked to agree with
    // `toLocal` rather than with arithmetic done here.
    setOrigin(world(4_000, 0));
    view.update([twig], lens());
    expect(spriteAt(view, 0).position.x).toBeCloseTo(toLocal(twig.at).lx, 3);
    expect(spriteAt(view, 0).position.x).toBeLessThan(5_000);
    view.dispose();
  });

  it('dispose lets go of every texture and every material, and stops answering', () => {
    const view = new SenseLabels();
    view.update([sighting('TWIG', { wx: 100 }), sighting('RESIN', { wx: 200 })], lens());
    let freed = 0;
    const textures = new Set<THREE.Texture>();
    for (let i = 0; i < LABEL_CAP; i += 1) {
      spriteAt(view, i).material.addEventListener('dispose', () => {
        freed += 1;
      });
      const texture = mapAt(view, i);
      if (texture !== null) textures.add(texture);
    }
    expect(textures.size).toBe(2);
    for (const texture of textures) {
      texture.addEventListener('dispose', () => {
        freed += 1;
      });
    }
    view.dispose();
    expect(freed).toBe(LABEL_CAP + 2);
    expect(view.cachedWords).toBe(0);
    expect(view.group.children).toHaveLength(0);
    view.update([sighting('TWIG', { wx: 100 })], lens());
    expect(view.drawn).toBe(0);
  });

  it('is cheap: a full screen of names, sixty frames, and nothing painted after the first', () => {
    const view = new SenseLabels();
    const many: Sighting[] = [];
    for (let i = 0; i < 200; i += 1) many.push(sighting(`W${i % 15}`, { wx: (i % 40) * 10, wz: Math.floor(i / 40) * 10 }));
    view.update(many, lens());
    const painted = strokes.length;
    const started = performance.now();
    for (let f = 0; f < 60; f += 1) view.update(many, lens());
    const perFrame = (performance.now() - started) / 60;
    expect(view.drawn).toBe(LABEL_CAP);
    // Fifteen words in the world, and every one of them already painted.
    expect(painted).toBe(15);
    expect(strokes).toHaveLength(15);
    // Generous for a slow box; it is a sort, then a position and a scale
    // per name.
    expect(perFrame).toBeLessThan(2);
    view.dispose();
  });
});

/** The texture a word gets, minted by drawing it once. */
function mapOf(view: SenseLabels, word: string): THREE.Texture | null {
  view.update([sighting(word, { wx: 100 })], lens());
  return mapAt(view, 0);
}

describe('SenseLabels without a canvas', () => {
  beforeAll(() => {
    prototype.getContext = realGetContext;
  });

  afterAll(() => {
    prototype.getContext = function (this: HTMLCanvasElement, id: string): unknown {
      return id === '2d' ? stubInk(this) : null;
    };
  });

  it('survives a host with no 2D context, the way the map does', () => {
    // The condition the module promises to survive: jsdom here has no
    // canvas backend at all.
    expect(document.createElement('canvas').getContext('2d')).toBeNull();
    const view = new SenseLabels();
    expect(() => view.update([sighting('TWIG', { wx: 100 })], lens())).not.toThrow();
    const sprite = spriteAt(view, 0);
    expect(sprite.visible).toBe(true);
    expect(mapAt(view, 0)).not.toBeNull();
    // An unpainted plate still has a believable shape, so the scene graph
    // in a test is the scene graph on a phone.
    expect(sprite.scale.x).toBeGreaterThan(0);
    expect(sprite.scale.x / sprite.scale.y).toBeGreaterThan(1);
    view.dispose();
  });
});

describe('the local-point rule', () => {
  it('reads no world coordinate at all: position is `toLocal`, distance is the sighting\'s own', () => {
    // The renderer directories' standing rule (`tests/viewBoundary.test.ts`):
    // a renderer converts at the boundary and never takes a WorldPoint
    // apart. The sweep already measured how far it reached, so there is
    // nothing here for a hand-rolled subtraction to hide behind either.
    // `fileURLToPath(import.meta.url)` and not `new URL('..', …)`: under
    // jsdom the global `URL` is jsdom's, and node's own parser is the one
    // that can read it (`tests/mapIsland.test.ts` says the same).
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const text = readFileSync(path.join(root, 'src/sense/SenseLabels.ts'), 'utf8');
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).not.toMatch(/\.w[xz]\b/);
    expect(body).toContain('this.toLocal(s.at)');
  });
});
