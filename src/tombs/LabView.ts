/**
 * THE TOMBS LABORATORY, DRAWN — a `LabLayout` of several hundred boxes
 * turned into about a dozen draw calls, and the one place in the game
 * where local metres become world units.
 *
 * What `terrain/` is to `world/heightfield` and `flora/` to
 * `world/objects`, this is to `world/tombs` (ARCHITECTURE §3): the only
 * place a floor plan meets a mesh. The plan does not know what a mesh
 * is; this file does not decide where a wall goes. It reads a layout, it
 * builds, and the only thing it does per frame is turn five rings.
 *
 * ─── metres in, world units out ──────────────────────────────────────
 *
 * The island is 5,600,000 units across at a centimetre a unit, and the
 * plan is written in metres at human scale with its origin on the floor
 * at the building's centre (`world/tombs/types.ts`). THE CONVERSION
 * HAPPENS HERE AND NOWHERE ELSE, and it happens PER PLACEMENT — every
 * position and every extent is multiplied by `UNITS_PER_METRE` as its
 * matrix is composed.
 *
 * What it deliberately does NOT do is scale the group by 100. A scaled
 * parent is the tempting one-liner and it is wrong in four ways at once:
 * every child's local frame is in a different unit from every other
 * object in the scene, normals need the inverse transpose, a line or a
 * point size does not scale with it at all, and anything that later
 * reads a child's world position gets a number whose units depend on
 * which parent it was asked through. The group's transform is a
 * TRANSLATION and stays one.
 *
 * ─── the building sits on the ground, and the ground moves ───────────
 *
 * The site is one surveyed coordinate (`world/tombs/site.ts`), but the
 * height under it is not one number: `Heightfield.heightAt` answers from
 * the coarse lattice until an HD tile lands and from the tile after, and
 * the two agree only at the lattice's own samples. So the building's Y is
 * an INPUT, re-suppliable — `groundUnits` at construction, `setGround`
 * whenever the field's revision moves — and every height inside the
 * building is stored as a DEPTH against the floor, which is exactly the
 * rule the worm's trail was rewritten to obey (CLAUDE.md: "anything
 * remembered against [the ground] is remembered as a DEPTH"). A tile
 * landing under the site moves the whole building with the world; it
 * never leaves a doorstep hanging.
 *
 * The plan's y = 0 is the floor's TOP face, so the group's Y is simply
 * the ground. X and Z belong to whoever holds the floating origin: this
 * view never writes them, so a scene may set `group.position.x/z` each
 * time the origin shifts without ever fighting this file for the Y.
 *
 * ─── one mesh per surface, not one per slab ──────────────────────────
 *
 * A laboratory is several hundred boxes and a handful of materials, which
 * is the exact shape `THREE.InstancedMesh` is for. Slabs are grouped BY
 * SURFACE and drawn as one instanced unit box each; pillars the same over
 * one unit cylinder; the array's rings are a torus apiece because five
 * different radii cannot share a geometry and five draw calls is not a
 * problem. So the building costs:
 *
 *     (surfaces with slabs) + (surfaces with pillars) + rings + 2
 *
 * — at most 10 + 10 + rings + 2, and for a plan that uses six or seven
 * surfaces in its walls and two in its pillars, about a dozen. The two on
 * the end are the lamp fittings, one instanced mesh per lighting set.
 * Nothing is created for a surface the plan does not use.
 *
 * The unit box and the unit cylinder are each built ONCE and shared by
 * every instanced mesh that wants them. That is safe only because
 * `InstancedMesh` computes its OWN bounding sphere over its instances
 * rather than borrowing the geometry's — the shared unit box's sphere is
 * a half-metre ball at the origin, and a mesh culled against that would
 * vanish the moment the camera left the middle of the room. `build`
 * calls `computeBoundingSphere` on every instanced mesh for that reason.
 *
 * ─── the lights, and why there are so few of them ────────────────────
 *
 * The plan carries dozens of lamps in two sets that both exist at once.
 * A real `THREE.PointLight` is not paid for by this building: three
 * gathers the scene's lights once per render and filters them by the
 * CAMERA's layers, never per object, so every point light here lengthens
 * the fragment loop of the terrain, the sea and twenty thousand blades of
 * grass as well. That is the measurement behind `maxLights` being a
 * single digit, and behind its default coming from the DETAIL rung
 * (`assets/detailQuality.ts`) rather than from the building:
 *
 *     ultra-low 2   low 3   medium 4   high 6   ultra-high 8
 *
 * GAME TUNING, not measured on Joshua's phone yet — the render probe the
 * integration pass writes is where it gets measured, and this table is
 * the one place to change when it is.
 *
 * Which lamps get one is decided by ROOM FIRST: each room's strongest
 * lamp is taken before any room's second, so a cap smaller than the room
 * count leaves rooms unlit rather than leaving one room lit five times.
 * `stats.roomsLit` says how many rooms got one, so a probe reads the
 * binding limit instead of guessing at it.
 *
 * Every other lamp is a FITTING: a small unlit box in the lamp's own
 * colour, instanced, two draw calls for the whole building. A ceiling
 * with fittings in it reads as a lit ceiling even where no light falls,
 * which is what makes a cap on the real lights affordable.
 *
 * A lamp's `intensity` is read as the irradiance it delivers AT ONE
 * METRE. three wants candela and this scene is in centimetres, so at 1 m
 * (100 units) with the physical decay of 2 the number is multiplied by
 * 100² exactly once, here (`LAMP_CANDELA`). Every previous light in this
 * repo was a hemisphere or the sun — both distance-free — so this is the
 * first place the centimetre world and three's photometric units have
 * had to be reconciled, and getting it wrong is the difference between a
 * lamp and a dead bulb.
 *
 * ─── the lever ───────────────────────────────────────────────────────
 *
 * Chapter 2: "He pulled the physical shutdown lever, and the room went
 * dark… The emergency lights switched on." `setLighting` makes that
 * literal: the leaving set's real lights go `visible = false` (three
 * skips an invisible light entirely, so it costs nothing in the shader)
 * and its fittings go dark; the arriving set's come up. Nothing is
 * disposed and nothing is rebuilt, so the lever can be pulled back.
 *
 * If the two sets hold different numbers of real lights, three's light
 * count changes and every lit material in the scene recompiles — once,
 * on the frame the lever is pulled. That is a visible hitch and it is the
 * honest price: the alternative is carrying both sets' lights in every
 * frame's shader for the whole game so that one moment is smooth.
 *
 * ─── what this file does not draw ────────────────────────────────────
 *
 * Doorways (the plan cuts the wall around them; the opening is the
 * absence of a slab), interactions (a label is the HUD's), rooms (air),
 * and the sliding door's motion. No textures: `assets/textureQuality.ts`
 * has nothing to give a building with no bake, and the surfaces are flat
 * colours until one exists — at which point `tierFor` is the door and
 * `labLook.ts` is where the map names would go.
 *
 * `update(dt)` touches ring quaternions and nothing else. There is no
 * allocation in it, no matrix rebuilt and no buffer re-uploaded; the
 * scratch objects are module-scope and reused.
 */
import * as THREE from 'three';
import type { DetailTier } from '../assets/detailQuality';
import { UNITS_PER_METRE } from '../world/dem';
import { TOMBS_GROUND_UNITS } from '../world/tombs/site';
import type { LabLayout, Lamp, LightMode, Pillar, RoomId, Slab, Surface } from '../world/tombs/types';
import {
  FITTING_DARK, FITTING_LIT, LIGHTING, RING_LOOK, SCREEN_ATLAS, SCREEN_LIT, SURFACE_TEXTURE, lookFor,
  screenPanelFor, screenPanelUv,
  type LightingLook, type ScreenPanel, type SurfaceLook,
} from './labLook';

/** 100 world units to the metre, as everywhere. The plan is in metres; the scene is in units. */
const M = UNITS_PER_METRE;

/**
 * Candela per unit of a lamp's `intensity`, given that intensity means
 * "the irradiance a metre away" and the scene is in centimetres. With
 * three's physical decay of 2 the irradiance at distance d units is
 * I / d², so I = intensity × (100 units)².
 */
const LAMP_CANDELA = M * M;

/** Three's physically correct inverse-square falloff. Named so nobody reads the 2 as a magic number. */
const LAMP_DECAY = 2;

const TAU = Math.PI * 2;

/**
 * How many lamps may be real lights, by detail rung. GAME TUNING — the
 * cost is scene-wide (see the header), so the rung that sets how much
 * world is drawn is the right thing to read it from.
 */
const LIGHTS_AT: Readonly<Record<DetailTier, number>> = Object.freeze({
  'ultra-low': 3, low: 4, medium: 6, high: 8, 'ultra-high': 12,
});

/** Sides on the unit cylinder every pillar is drawn from. A round thing at arm's length; twelve is already a circle. */
const PILLAR_SIDES_AT: Readonly<Record<DetailTier, number>> = Object.freeze({
  'ultra-low': 8, low: 8, medium: 10, high: 12, 'ultra-high': 16,
});

/** Segments around a ring's tube, then around the ring itself. The array is the thing the room is built around; it gets the triangles. */
const RING_SEGMENTS_AT: Readonly<Record<DetailTier, { readonly tube: number; readonly round: number }>> = Object.freeze({
  'ultra-low': Object.freeze({ tube: 6, round: 24 }),
  low: Object.freeze({ tube: 6, round: 32 }),
  medium: Object.freeze({ tube: 8, round: 40 }),
  high: Object.freeze({ tube: 10, round: 56 }),
  'ultra-high': Object.freeze({ tube: 12, round: 72 }),
});

/**
 * Which surfaces cast the sun's shadow: the building's shell and the
 * bodies standing in it. A floor casts nothing it is not already under,
 * and a screen face is a decal on a panel that is already casting.
 */
const CASTS_SHADOW: ReadonlySet<Surface> = new Set<Surface>(['wall', 'ceiling', 'metal', 'panel', 'desk', 'seat', 'accent']);

/** Which surfaces take one: the large flat things a shadow would be read on. */
const TAKES_SHADOW: ReadonlySet<Surface> = new Set<Surface>(['floor', 'wall', 'ceiling', 'desk', 'panel', 'seat']);

// Scratch, allocated once at module scope and reused. Nothing here
// survives the call it is used in.
const M4 = new THREE.Matrix4();
const V3 = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SPIN = new THREE.Quaternion();
const COLOUR = new THREE.Color();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export interface LabViewOptions {
  /**
   * The ground under the site, in WORLD UNITS — what
   * `Heightfield.heightAt(TOMBS_SITE)` answers, which is NOT necessarily
   * `TOMBS_GROUND_UNITS`: the survey coarsens and refines under the same
   * point. The surveyed figure is the default so a probe with no
   * heightfield still stands the building on the recorded ground.
   */
  readonly groundUnits?: number;
  /** The detail rung, for the light cap and the segment counts. Defaults to `medium`, the conservative rung. */
  readonly detail?: DetailTier;
  /** Overrides the rung's light cap. A probe measuring the cost of lights passes this; the game does not. */
  readonly maxLights?: number;
  /**
   * Whether this view owns an ambient light.
   *
   * TRUE by default, so a bare probe of the building is lit. A scene that
   * already has a sky must pass FALSE and apply `view.lighting` itself:
   * three filters lights by the CAMERA's layers and never per object, so
   * an ambient light added here would also wash the island outside.
   */
  readonly ambient?: boolean;
  /** Whether the building casts and takes the sun's shadow. True by default. */
  readonly shadows?: boolean;
  /**
   * THE SCREEN ATLAS — `tombs-screen` off the texture ladder, or nothing.
   *
   * A view is handed the texture rather than loading it, because this
   * file has no business knowing what a URL is (`assets/` is the one
   * loader, ARCHITECTURE §3). WITHOUT IT the screens are dark glass,
   * exactly as they were: the picture is an addition and never a
   * requirement, so a probe that does not bother still draws a building.
   */
  readonly screenTexture?: THREE.Texture | null;
  /**
   * THE SURFACES' TEXTURES, by the name `labLook.SURFACE_TEXTURE` gives
   * them — `lab-floor`, `lab-wall` and the rest, off the texture ladder.
   *
   * Handed in rather than loaded, for the same reason the screen atlas
   * is: `assets/` is the one loader. A surface with nothing here is drawn
   * in its palette colour alone, exactly as the whole building was until
   * now, so a probe or a test that passes none still gets a building.
   */
  readonly surfaceTextures?: Readonly<Record<string, THREE.Texture>> | null;
}

/** What a probe or a HUD line reads off the built building. */
export interface LabViewStats {
  readonly slabs: number;
  readonly pillars: number;
  readonly rings: number;
  /** Every lamp in the plan, both sets. */
  readonly lamps: number;
  /** Real `PointLight`s built for the LIVE set. */
  readonly realLights: number;
  /** Rooms of the live set that got one — the reading that says whether the cap is binding. */
  readonly roomsLit: number;
  /** Rooms of the live set that have a lamp at all. */
  readonly roomsWithLamps: number;
  readonly drawCalls: number;
  readonly mode: LightMode;
  readonly running: boolean;
}

/** One ring of the array: its resting orientation, its rate, and where it has turned to. */
interface RingDraw {
  readonly mesh: THREE.Mesh;
  /** Tilt then yaw, composed once at build. The spin multiplies this, never replaces it. */
  readonly base: THREE.Quaternion;
  /** Radians a second about the ring's own axis — local +Z, which is a torus's hole. */
  readonly spin: number;
  angle: number;
}

/** One lighting set: the few real lights, and a fitting for every lamp in it. */
interface LampSet {
  readonly mode: LightMode;
  readonly lights: THREE.PointLight[];
  readonly fittings: THREE.InstancedMesh | null;
  readonly material: THREE.MeshBasicMaterial | null;
  readonly lamps: number;
  readonly roomsLit: number;
  readonly roomsWithLamps: number;
}

export class LabView {
  readonly group = new THREE.Group();

  /**
   * Everything the layout says is SOLID, in world units, in the group's
   * own frame — y = 0 is the floor's top face, x and z measure from the
   * building's centre. `group.position` (or `group.matrixWorld`) puts it
   * in the scene's frame; it is left out of this box on purpose, because
   * this view owns only the Y of that position and reporting a half-known
   * frame would be worse than reporting a known one.
   *
   * Solid is `Slab.solid` and `Pillar.solid` and nothing else: the plan
   * is the one answer to whether a body stops, and the renderer does not
   * get a second opinion (`world/tombs/types.ts`).
   */
  readonly bounds = new THREE.Box3();

  private readonly detail: DetailTier;
  private readonly maxLights: number;
  private readonly shadows: boolean;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly surfaceMaterials = new Map<Surface, THREE.MeshStandardMaterial>();
  private readonly ringDraws: RingDraw[] = [];
  private readonly sets: LampSet[] = [];

  private unitBox: THREE.BoxGeometry | null = null;
  private unitBoxColoured: THREE.BoxGeometry | null = null;
  /** One box per (thin axis, atlas panel) a screen actually asks for. */
  private readonly screenBoxes = new Map<string, THREE.BoxGeometry>();
  private readonly screenTexture: THREE.Texture | null;
  private readonly surfaceTextures: Readonly<Record<string, THREE.Texture>>;
  private unitCylinder: THREE.CylinderGeometry | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  private mode: LightMode = 'normal';
  private running = false;
  private slabCount = 0;
  private pillarCount = 0;

  constructor(options: LabViewOptions = {}) {
    this.detail = options.detail ?? 'medium';
    this.maxLights = Math.max(0, Math.floor(options.maxLights ?? LIGHTS_AT[this.detail]));
    this.shadows = options.shadows ?? true;
    this.screenTexture = options.screenTexture ?? null;
    this.surfaceTextures = options.surfaceTextures ?? {};
    this.group.name = 'tombs-lab';
    this.group.position.y = options.groundUnits ?? TOMBS_GROUND_UNITS;
    if (options.ambient ?? true) {
      const look = LIGHTING[this.mode];
      this.ambientLight = new THREE.AmbientLight(look.ambient, look.ambientIntensity);
      this.ambientLight.name = 'tombs-ambient';
      this.group.add(this.ambientLight);
    }
  }

  /**
   * Build (or rebuild) the meshes for this layout. Idempotent: whatever
   * was here is disposed first, so calling it twice leaks nothing and
   * leaves the same building standing.
   */
  build(layout: LabLayout): void {
    this.clear();
    this.buildSlabs(layout);
    this.buildPillars(layout);
    this.buildRings(layout);
    this.buildLamps(layout);
    this.measure(layout);
    this.applyLighting();
  }

  /** `emergency` after the shutdown lever, `normal` otherwise. */
  setLighting(mode: LightMode): void {
    if (mode !== 'normal' && mode !== 'emergency') return;
    this.mode = mode;
    this.applyLighting();
  }

  /** Radians/second per ring while the array runs; 0 stops it. */
  setArrayRunning(running: boolean): void {
    this.running = running;
  }

  /**
   * Re-seat the building on a ground that has moved — an HD tile landing
   * under the site, a heightfield revision. Cheap: one number on the
   * group's transform, because every height inside the building is a
   * depth against the floor and not an absolute.
   */
  setGround(groundUnits: number): void {
    if (!Number.isFinite(groundUnits)) return;
    this.group.position.y = groundUnits;
  }

  /** Advance the rings. dt in SECONDS. */
  update(dt: number): void {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    for (const ring of this.ringDraws) {
      if (ring.spin === 0) continue;
      let angle = ring.angle + ring.spin * dt;
      // Wrapped, because an array left running for an hour would otherwise
      // grow an angle whose float steps are coarser than a frame's turn.
      if (angle >= TAU || angle <= -TAU) angle %= TAU;
      ring.angle = angle;
      ring.mesh.quaternion.copy(ring.base).multiply(SPIN.setFromAxisAngle(AXIS_Z, angle));
    }
  }

  /** The air this state wants. The fog is the owner's to apply; a Group cannot hold `Scene.fog`. */
  get lighting(): LightingLook {
    return LIGHTING[this.mode];
  }

  get stats(): LabViewStats {
    const live = this.sets.find((s) => s.mode === this.mode);
    let lamps = 0;
    for (const set of this.sets) lamps += set.lamps;
    return Object.freeze({
      slabs: this.slabCount,
      pillars: this.pillarCount,
      rings: this.ringDraws.length,
      lamps,
      realLights: live ? live.lights.length : 0,
      roomsLit: live ? live.roomsLit : 0,
      roomsWithLamps: live ? live.roomsWithLamps : 0,
      drawCalls: this.meshes.length,
      mode: this.mode,
      running: this.running,
    });
  }

  /** Every geometry, material and mesh this view made, gone; the group emptied. */
  dispose(): void {
    this.clear();
    if (this.ambientLight) {
      this.group.remove(this.ambientLight);
      this.ambientLight.dispose();
      this.ambientLight = null;
    }
    this.group.clear();
  }

  // -------------------------------------------------------------------
  // building
  // -------------------------------------------------------------------

  /** One instanced unit box per surface that has slabs. */
  private buildSlabs(layout: LabLayout): void {
    const bySurface = new Map<Surface, Slab[]>();
    for (const slab of layout.slabs) {
      const list = bySurface.get(slab.surface);
      if (list) list.push(slab);
      else bySurface.set(slab.surface, [slab]);
    }
    this.slabCount = layout.slabs.length;
    for (const [surface, slabs] of bySurface) {
      // A SCREEN IS NOT ONE MESH BUT A FEW, and every other surface still
      // is. The atlas panel a screen shows depends on its own shape and
      // the face that shows it depends on which axis is thin, so the
      // screens split into one instanced mesh per (thin axis, panel) —
      // three of them for this plan, against one for everything else.
      // Same material, same texture, one draw call per group.
      for (const [key, group] of this.groupSlabs(surface, slabs)) {
        const geometry = key === '' ? this.box() : this.screenBox(key);
        const mesh = new THREE.InstancedMesh(geometry, this.materialFor(surface), group.length);
        for (let i = 0; i < group.length; i += 1) {
          const { at, size } = group[i].box;
          M4.makeScale(size.x * M, size.y * M, size.z * M);
          M4.setPosition(at.x * M, at.y * M, at.z * M);
          mesh.setMatrixAt(i, M4);
        }
        this.finish(mesh, `slab:${surface}${key === '' ? '' : `:${key}`}`,
          CASTS_SHADOW.has(surface), TAKES_SHADOW.has(surface));
      }
    }
  }

  /**
   * The slabs of one surface, split into the groups that need different
   * geometry. Everything but a lit screen is one group under the key `''`.
   */
  private groupSlabs(surface: Surface, slabs: readonly Slab[]): Map<string, Slab[]> {
    const groups = new Map<string, Slab[]>();
    for (const slab of slabs) {
      const key = surface === 'screen' && this.screenTexture !== null ? screenKey(slab) : '';
      const list = groups.get(key);
      if (list) list.push(slab);
      else groups.set(key, [slab]);
    }
    return groups;
  }

  /**
   * One instanced unit cylinder per surface that has pillars. A pillar's
   * `at` is the centre of its BASE, so the instance stands half its
   * height above it — the cylinder three builds is centred on its own
   * middle.
   */
  private buildPillars(layout: LabLayout): void {
    const bySurface = new Map<Surface, Pillar[]>();
    for (const pillar of layout.pillars) {
      const list = bySurface.get(pillar.surface);
      if (list) list.push(pillar);
      else bySurface.set(pillar.surface, [pillar]);
    }
    this.pillarCount = layout.pillars.length;
    for (const [surface, pillars] of bySurface) {
      const mesh = new THREE.InstancedMesh(this.cylinder(), this.materialFor(surface), pillars.length);
      for (let i = 0; i < pillars.length; i += 1) {
        const p = pillars[i];
        const across = p.radius * 2 * M;
        M4.makeScale(across, p.height * M, across);
        M4.setPosition(p.at.x * M, (p.at.y + p.height / 2) * M, p.at.z * M);
        mesh.setMatrixAt(i, M4);
      }
      this.finish(mesh, `pillar:${surface}`, CASTS_SHADOW.has(surface), TAKES_SHADOW.has(surface));
    }
  }

  /**
   * A torus each — five radii cannot share a geometry, and five draw
   * calls for the thing the building exists to hold is not a cost worth
   * arguing with.
   *
   * The rest pose is TILT ABOUT +X FIRST, THEN YAW ABOUT +Y, exactly as
   * the contract words it, which is `Ry · Rx` applied to a vector and is
   * written as a quaternion product rather than as an Euler triple so
   * that nobody has to remember which way round three reads its orders.
   * The spin is about the ring's OWN axis, which for a torus is local +Z.
   */
  private buildRings(layout: LabLayout): void {
    if (layout.rings.length === 0) return;
    const segments = RING_SEGMENTS_AT[this.detail];
    const material = this.track(new THREE.MeshStandardMaterial(standard(RING_LOOK)));
    for (const ring of layout.rings) {
      const geometry = new THREE.TorusGeometry(ring.radius * M, ring.tube * M, segments.tube, segments.round);
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `ring:${ring.id}`;
      mesh.position.set(ring.at.x * M, ring.at.y * M, ring.at.z * M);
      const base = new THREE.Quaternion()
        .setFromAxisAngle(AXIS_Y, ring.yaw)
        .multiply(QUAT.setFromAxisAngle(AXIS_X, ring.tilt));
      mesh.quaternion.copy(base);
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = this.shadows;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.ringDraws.push({ mesh, base, spin: ring.spin, angle: 0 });
    }
  }

  /**
   * Both lighting sets, built at once and switched by visibility.
   *
   * Every lamp gets a fitting; a few get a real light. The fittings are
   * one instanced box per set, coloured per instance — which needs
   * `vertexColors` on the material AND a colour attribute on the
   * geometry, because three's `color_fragment` chunk is guarded by
   * `USE_COLOR` alone and an instance colour never reaches the fragment
   * stage without it.
   */
  private buildLamps(layout: LabLayout): void {
    for (const mode of ['normal', 'emergency'] as const) {
      const lamps = layout.lamps.filter((lamp) => lamp.mode === mode);
      if (lamps.length === 0) {
        this.sets.push({ mode, lights: [], fittings: null, material: null, lamps: 0, roomsLit: 0, roomsWithLamps: 0 });
        continue;
      }
      const material = this.track(new THREE.MeshBasicMaterial({ color: FITTING_LIT, vertexColors: true, fog: true }));
      const mesh = new THREE.InstancedMesh(this.box(true), material, lamps.length);
      const tints = new THREE.InstancedBufferAttribute(new Float32Array(lamps.length * 3), 3);
      mesh.instanceColor = tints;
      for (let i = 0; i < lamps.length; i += 1) {
        const lamp = lamps[i];
        // THE PLAN SIZES THE FITTING, this file draws it. One owner: when
        // the plan drew its own emissive panel as well, pulling the lever
        // darkened this fitting and left that panel burning.
        M4.makeScale(lamp.fitting.x * M, lamp.fitting.y * M, lamp.fitting.z * M);
        M4.setPosition(lamp.at.x * M, lamp.at.y * M, lamp.at.z * M);
        mesh.setMatrixAt(i, M4);
        COLOUR.setHex(lamp.colour);
        tints.setXYZ(i, COLOUR.r, COLOUR.g, COLOUR.b);
      }
      tints.needsUpdate = true;
      this.finish(mesh, `fittings:${mode}`, false, false);

      const chosen = chooseLamps(lamps, this.maxLights);
      const lights: THREE.PointLight[] = [];
      const rooms = new Set<RoomId>();
      for (const lamp of chosen) {
        const light = new THREE.PointLight(lamp.colour, lamp.intensity * LAMP_CANDELA, lamp.reach * M, LAMP_DECAY);
        light.name = `lamp:${lamp.id}`;
        light.position.set(lamp.at.x * M, lamp.at.y * M, lamp.at.z * M);
        // No shadow map: a point light's is six faces of depth, and this
        // building would spend more on shadowing its own lamps than on
        // drawing itself.
        light.castShadow = false;
        this.group.add(light);
        lights.push(light);
        rooms.add(lamp.room);
      }
      const withLamps = new Set<RoomId>();
      for (const lamp of lamps) withLamps.add(lamp.room);
      this.sets.push({
        mode, lights, fittings: mesh, material, lamps: lamps.length, roomsLit: rooms.size, roomsWithLamps: withLamps.size,
      });
    }
  }

  /** What the layout says is solid, in world units, in the group's frame. */
  private measure(layout: LabLayout): void {
    this.bounds.makeEmpty();
    for (const slab of layout.slabs) {
      if (!slab.solid) continue;
      const { at, size } = slab.box;
      this.bounds.expandByPoint(V3.set((at.x - size.x / 2) * M, (at.y - size.y / 2) * M, (at.z - size.z / 2) * M));
      this.bounds.expandByPoint(V3.set((at.x + size.x / 2) * M, (at.y + size.y / 2) * M, (at.z + size.z / 2) * M));
    }
    for (const p of layout.pillars) {
      if (!p.solid) continue;
      this.bounds.expandByPoint(V3.set((p.at.x - p.radius) * M, p.at.y * M, (p.at.z - p.radius) * M));
      this.bounds.expandByPoint(V3.set((p.at.x + p.radius) * M, (p.at.y + p.height) * M, (p.at.z + p.radius) * M));
    }
  }

  /** The live set up, the other down, and the ambient light to match. */
  private applyLighting(): void {
    for (const set of this.sets) {
      const live = set.mode === this.mode;
      for (const light of set.lights) light.visible = live;
      if (set.material) set.material.color.setHex(live ? FITTING_LIT : FITTING_DARK);
    }
    if (this.ambientLight) {
      const look = LIGHTING[this.mode];
      this.ambientLight.color.setHex(look.ambient);
      this.ambientLight.intensity = look.ambientIntensity;
    }
  }

  // -------------------------------------------------------------------
  // small shared machinery
  // -------------------------------------------------------------------

  /**
   * The unit box every slab and every fitting is drawn from, built once.
   * `coloured` adds the white colour attribute the fittings' per-instance
   * colour needs; the slabs' materials do not read it, so they get the
   * plain one and upload one buffer less.
   */
  private box(coloured = false): THREE.BoxGeometry {
    if (!coloured) {
      if (!this.unitBox) {
        this.unitBox = new THREE.BoxGeometry(1, 1, 1);
        this.geometries.push(this.unitBox);
      }
      return this.unitBox;
    }
    if (!this.unitBoxColoured) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const vertices = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
      this.geometries.push(geometry);
      this.unitBoxColoured = geometry;
    }
    return this.unitBoxColoured;
  }

  /**
   * A unit box whose TWO BROAD FACES carry one panel of the screen atlas
   * and whose four thin edges carry the bezel patch.
   *
   * three's `BoxGeometry` gives every face the whole 0..1 square, laid out
   * so the image reads the right way round FROM OUTSIDE that face — which
   * is why a screen on the east wall and a monitor on a desk both come out
   * unmirrored with no per-instance work. All this does is squeeze each
   * face's existing square into a rectangle of the atlas, which preserves
   * that property because it is a linear remap.
   *
   * Face order is three's own: +x, -x, +y, -y, +z, -z, four vertices each.
   */
  private screenBox(key: string): THREE.BoxGeometry {
    const held = this.screenBoxes.get(key);
    if (held) return held;
    const [thin, panel] = key.split(':') as ['x' | 'y' | 'z', ScreenPanel];
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const broad = screenPanelUv(SCREEN_ATLAS[panel]);
    const edge = screenPanelUv(SCREEN_ATLAS.bezel);
    const faceOfAxis: Record<'x' | 'y' | 'z', [number, number]> = { x: [0, 1], y: [2, 3], z: [4, 5] };
    const lit = new Set(faceOfAxis[thin]);
    for (let face = 0; face < 6; face += 1) {
      const to = lit.has(face) ? broad : edge;
      for (let k = 0; k < 4; k += 1) {
        const i = face * 4 + k;
        uv.setXY(i, to.u0 + uv.getX(i) * (to.u1 - to.u0), to.v0 + uv.getY(i) * (to.v1 - to.v0));
      }
    }
    uv.needsUpdate = true;
    this.geometries.push(geometry);
    this.screenBoxes.set(key, geometry);
    return geometry;
  }

  /** The unit cylinder every pillar is drawn from: diameter 1, height 1, centred on its middle. */
  private cylinder(): THREE.CylinderGeometry {
    if (!this.unitCylinder) {
      this.unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, PILLAR_SIDES_AT[this.detail]);
      this.geometries.push(this.unitCylinder);
    }
    return this.unitCylinder;
  }

  /** One material per surface, shared by that surface's slabs and pillars. */
  private materialFor(surface: Surface): THREE.MeshStandardMaterial {
    const held = this.surfaceMaterials.get(surface);
    if (held) return held;
    const material = this.track(new THREE.MeshStandardMaterial(standard(lookFor(surface))));
    material.name = `tombs:${surface}`;
    // THE PICTURE, AND ONLY THEN THE GLOW. `LOOK.screen` is dark glass and
    // stays dark glass; `SCREEN_LIT` is what a screen with something ON it
    // looks like, so a texture that did not load leaves the old, safe look
    // rather than a white glowing box (`labLook.ts`).
    if (surface === 'screen' && this.screenTexture !== null) {
      material.map = this.screenTexture;
      material.emissiveMap = this.screenTexture;
      material.emissive = new THREE.Color(SCREEN_LIT.emissive);
      material.emissiveIntensity = SCREEN_LIT.emissiveIntensity;
      material.needsUpdate = true;
    }
    const wears = SURFACE_TEXTURE[surface];
    const texture = wears ? this.surfaceTextures[wears.texture] : undefined;
    if (wears && texture) {
      // THE PALETTE'S LUMINANCE, KEPT. The shader multiplies this colour
      // by the map, so the colour is divided by the map's own mean first
      // and the map is left contributing only its variation (`labLook`'s
      // `level`).
      //
      // NO CAP. The first attempt clamped the boost at eightfold as "a
      // guard", and the guard was the bug: the rubber floor's map has a
      // mean of 0.0404 and needs 24.7, so the clamp left the floor three
      // times too dark and the shot showed the same black slab this
      // change existed to fix. There is nothing to guard against here —
      // the product is the palette's luminance BY CONSTRUCTION, whatever
      // the factor — so the check belongs where a bad map can be
      // recognised as a bad map, which is `tests/labLook.test.ts` holding
      // every `level` inside a sane band.
      material.color.multiplyScalar(1 / wears.level);
      tileBySize(material, texture, wears.tile * M);
    }
    this.surfaceMaterials.set(surface, material);
    return material;
  }

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /**
   * The last three lines every instanced mesh needs: upload the matrices,
   * compute ITS OWN bounding sphere (the shared unit geometry's would be
   * a half-metre ball at the origin), and hang it on the group.
   */
  private finish(mesh: THREE.InstancedMesh, name: string, casts: boolean, takes: boolean): void {
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.shadows && casts;
    mesh.receiveShadow = this.shadows && takes;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  /** Everything `build` made, undone. The ambient light survives it: it belongs to the view, not to the layout. */
  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      // An InstancedMesh holds its own matrix and colour buffers; only
      // its own dispose frees them, and the shared geometry below is a
      // different allocation entirely.
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    }
    for (const set of this.sets) {
      for (const light of set.lights) {
        this.group.remove(light);
        light.dispose();
      }
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.meshes.length = 0;
    this.sets.length = 0;
    this.ringDraws.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
    this.surfaceMaterials.clear();
    this.unitBox = null;
    this.unitBoxColoured = null;
    this.unitCylinder = null;
    this.slabCount = 0;
    this.pillarCount = 0;
    this.bounds.makeEmpty();
  }
}

/**
 * WEAR A TEXTURE AT A FIXED SIZE, WHATEVER THE THING IS.
 *
 * Every slab in this building is ONE unit box scaled to its size, and
 * every face of it carries the same 0..1 UV. Left alone that puts one
 * floor tile across a twenty-six metre corridor and another across a
 * two-metre landing, and neither is a floor. Setting `map.repeat` cannot
 * fix it either: the repeat belongs to the TEXTURE, and one texture is
 * shared by every slab of the surface.
 *
 * So the UV is DERIVED IN THE VERTEX SHADER from the instance's own
 * matrix, which already carries both the size and the place:
 *
 *   - a FLAT face takes the two world axes it lies in, which for an
 *     axis-aligned box is exact — no blend, no third sample. It uses the
 *     WORLD position rather than the local one, so the tiling runs
 *     unbroken from one slab into the next and a floor laid in six pieces
 *     reads as one floor.
 *   - a CURVED face — the pillars, and only the pillars — has no world
 *     plane to lie in, and a normal that turns would seam four times
 *     around it. It keeps the cylinder's own wrap instead, scaled to the
 *     real circumference and height, which is continuous by construction.
 *
 * The branch is decided by whether the normal is axis-aligned, which is
 * a property of the geometry and not a flag anybody has to remember to
 * pass.
 *
 * `tileUnits` is how many WORLD UNITS one repeat covers —
 * `SURFACE_TEXTURE`'s metres times `UNITS_PER_METRE`.
 */
function tileBySize(material: THREE.MeshStandardMaterial, texture: THREE.Texture, tileUnits: number): void {
  material.map = texture;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.labTile = { value: Math.max(1e-3, tileUnits) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float labTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
        {
          #ifdef USE_INSTANCING
            vec3 labAt = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;
            vec3 labSize = vec3(
              length( instanceMatrix[ 0 ].xyz ),
              length( instanceMatrix[ 1 ].xyz ),
              length( instanceMatrix[ 2 ].xyz ) );
          #else
            vec3 labAt = position;
            vec3 labSize = vec3( 1.0 );
          #endif
          vec3 labN = abs( normal );
          vec2 labUv;
          if ( max( labN.x, max( labN.y, labN.z ) ) > 0.999 ) {
            labUv = labN.x > 0.5 ? labAt.zy : ( labN.y > 0.5 ? labAt.xz : labAt.xy );
          } else {
            labUv = vec2( uv.x * 3.14159265 * labSize.x, uv.y * labSize.y );
          }
          vMapUv = labUv / labTile;
        }
        #endif`);
  };
  // A material whose program is already compiled will not run the hook
  // again on its own.
  material.needsUpdate = true;
}

/**
 * Which screen box a slab needs: its thinnest axis, and the atlas panel
 * whose aspect its broad face is closest to.
 *
 * The thin axis is what makes a slab a PANEL rather than a block, and it
 * is read off the plan's own numbers rather than declared, so a screen
 * moved from a wall to a desk gets the right faces with nothing to
 * update.
 */
function screenKey(slab: Slab): string {
  const { x, y, z } = slab.box.size;
  if (x <= y && x <= z) return `x:${screenPanelFor(z, y)}`;
  if (y <= x && y <= z) return `y:${screenPanelFor(x, z)}`;
  return `z:${screenPanelFor(x, y)}`;
}

/** A `SurfaceLook` as `MeshStandardMaterial` wants it. Transparency only where the look asks for it. */
function standard(look: SurfaceLook): THREE.MeshStandardMaterialParameters {
  return {
    color: look.colour,
    roughness: look.roughness,
    metalness: look.metalness,
    emissive: look.emissive,
    emissiveIntensity: look.emissiveIntensity,
    transparent: look.opacity < 1,
    opacity: look.opacity,
    fog: true,
  };
}

/** A lamp's claim on one of the few real lights. Brightest first; reach breaks a tie. */
function strength(lamp: Lamp): number {
  return lamp.intensity * 1_000 + lamp.reach;
}

/**
 * Which lamps become real lights: EVERY ROOM'S STRONGEST BEFORE ANY
 * ROOM'S SECOND.
 *
 * A plain "brightest n in the building" would put all four of a cap of
 * four in the control room, because that is where the bright lamps are,
 * and leave the corridor the player walks down black. Rooms are ordered
 * by their own strongest lamp so the cap bites at the dimmest room rather
 * than at an arbitrary one, and the round-robin is what makes the reading
 * `roomsLit` worth printing.
 */
function chooseLamps(lamps: readonly Lamp[], cap: number): Lamp[] {
  if (cap <= 0 || lamps.length === 0) return [];
  const byRoom = new Map<RoomId, Lamp[]>();
  for (const lamp of lamps) {
    const list = byRoom.get(lamp.room);
    if (list) list.push(lamp);
    else byRoom.set(lamp.room, [lamp]);
  }
  const rooms = [...byRoom.values()];
  for (const room of rooms) room.sort((a, b) => strength(b) - strength(a));
  rooms.sort((a, b) => strength(b[0]) - strength(a[0]));
  const chosen: Lamp[] = [];
  for (let round = 0; chosen.length < cap; round += 1) {
    let added = 0;
    for (const room of rooms) {
      if (chosen.length >= cap) break;
      const lamp = room[round];
      if (!lamp) continue;
      chosen.push(lamp);
      added += 1;
    }
    if (added === 0) break;
  }
  return chosen;
}
