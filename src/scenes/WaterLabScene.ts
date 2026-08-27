import * as THREE from 'three';
import { terrainHeight, setSmoothing } from '../world/heightfield';
import { UNITS_PER_METRE } from '../world/kauai';
import { WaterSim, DEFAULTS } from '../world/waterSim';

/**
 * WATER LAB — one patch of the real island, with water on it.
 *
 * THE POINT, AND THE REASON THE LAST FOUR ATTEMPTS FAILED. Every one
 * of them drew water as its own surface and then tried to make it
 * agree with a terrain mesh built somewhere else. They cannot be made
 * to agree: the ground is drawn at 31.25 m a vertex out here and a
 * channel is five metres wide, so whatever the water does, the mesh
 * under it is a different shape and the seam between them is the
 * artefact. Black bands, gaps, floating ribbons, plateaus with walls —
 * every one of those was that one disagreement wearing a new coat.
 *
 * Here there is no second surface. One grid holds `bed` and `depth`,
 * the terrain is drawn at `bed`, the water at `bed + depth`, and they
 * share their x/z exactly. Water cannot float over ground it is
 * standing on, and it cannot leave a gap at its own edge, because the
 * edge is where `depth` reaches zero and not where a polygon stops.
 *
 * A LAB, so: no queen, no streaming, no weather, no gameplay. It
 * exists to answer one question — does water poured on real Kauaʻi
 * find the valleys and stay in them — and to be looked at while it
 * does. `?scene=water`.
 *
 *   ?at=x,z    patch centre in world units (default: a valley)
 *   ?rain=r    units of depth per second on the feed cells
 *   ?feed=p    feed the top p (0..1) of the patch by elevation
 *   ?cell=u    world units per cell (100 = 1 m)
 *   ?n=cells   grid side (256 unless you are measuring something)
 */

/**
 * Patch centre — CHOSEN BY THE SIMULATION, not by eye.
 *
 * The first guess was a patch with a big drop across it, on the
 * assumption that fall makes rivers. It does not: a uniform 80 m ramp
 * sheds water evenly and the whole patch just goes wet. What makes a
 * river is CONVERGENCE, so the search ran the solver itself over 67
 * candidate patches and ranked them by how much of the water ended up
 * in the wettest 5% of cells. Here that figure is 91.2%.
 */
const DEFAULT_AT = { x: -800_000, z: 0 };
/** Cells whose bed is above this quantile get the rain. */
const DEFAULT_FEED = 0.5;
/**
 * Depth per second added to a feed cell.
 *
 * A RATE, and the patch finds its own steady state against it — rain
 * in, rim out. Set it high and the answer is a bathtub whatever the
 * terrain says (BE's WaterLab: "global rain floods the whole window").
 */
const DEFAULT_RAIN = 3;
/** Depth below which water is not DRAWN (the sim still has it). */
const DRAWN_DEPTH = 1.5;
const SKY = 0x9cc8e8;

function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = Number(params.get(key));
  return Number.isFinite(raw) && raw !== 0 ? raw : fallback;
}

export class WaterLabScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sim: WaterSim;
  private readonly waterPos: Float32Array;
  private readonly waterDepth: Float32Array;
  private readonly water: THREE.Mesh;
  private readonly hud: HTMLDivElement;

  /** Where the feed falls — computed once from the bed. */
  private readonly feeds: boolean[] = [];
  private raining = true;
  private readonly rainRate: number;

  /** Sim seconds advanced, and wall seconds spent, since the last read. */
  private simSeconds = 0;
  private wallSeconds = 0;
  private lastFrame = 0;
  private sinceHud = 0;

  // Camera orbit, in the patch's own frame.
  private yaw = 0.6;
  private pitch = 0.55;
  private range: number;
  private disposed = false;

  constructor(host: HTMLElement) {
    const params = new URLSearchParams(location.search);
    const at = (() => {
      const raw = (params.get('at') ?? '').split(',').map(Number);
      return raw.length === 2 && raw.every(Number.isFinite)
        ? { x: raw[0], z: raw[1] } : DEFAULT_AT;
    })();
    const n = Math.max(16, Math.round(num(params, 'n', DEFAULTS.n)));
    const cell = num(params, 'cell', DEFAULTS.cell);
    this.rainRate = num(params, 'rain', DEFAULT_RAIN);
    const feed = num(params, 'feed', DEFAULT_FEED);

    // SMOOTHING OFF. v0.0.60 established this and it is not a look
    // setting where water is concerned: at 1 the same valleys are a
    // median 13.63 m shallower than the survey says, which is a
    // different island to pour water on.
    setSmoothing(0);

    this.sim = new WaterSim({ n, cell });
    const span = n * cell;
    // Bed straight from the shared field — the same function the
    // walker, the camera and the tests read. Sampled at the patch's
    // own corner so the grid is world-aligned and reproducible.
    const originX = at.x - span / 2;
    const originZ = at.z - span / 2;
    this.sim.fillBed((cx, cy) => terrainHeight(originX + cx * cell, originZ + cy * cell));

    // The feed: the upper catchment only. Rain on every cell alike
    // floods the patch into a bathtub — Beyond Extinction's WaterLab
    // learned that and wrote it down, and it is cheaper to believe it.
    const sorted = Float32Array.from(this.sim.bed).sort();
    const mark = sorted[Math.floor(sorted.length * feed)];
    for (let i = 0; i < this.sim.bed.length; i++) this.feeds.push(this.sim.bed[i] >= mark);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(SKY);

    this.camera = new THREE.PerspectiveCamera(55, 1, cell / 4, span * 12);
    this.range = span * 0.9;

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(span, span * 1.4, span * 0.7);
    this.scene.add(sun, new THREE.HemisphereLight(SKY, 0x5a4a38, 0.9));

    // ONE GRID, TWO SURFACES. Both meshes are built over the same
    // x/z lattice; only the y differs, and the water's y is the
    // terrain's plus its own depth.
    const ground = this.lattice((i) => this.sim.bed[i]);
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({
      color: 0x6f6a4e, roughness: 0.95, metalness: 0,
    })));

    const surface = this.lattice((i) => this.sim.bed[i] + this.sim.depth[i]);
    this.waterPos = surface.getAttribute('position').array as Float32Array;
    this.waterDepth = new Float32Array(n * n);
    surface.setAttribute('depth', new THREE.BufferAttribute(this.waterDepth, 1));
    this.water = new THREE.Mesh(surface, this.waterMaterial());
    this.water.renderOrder = 1;
    this.scene.add(this.water);

    this.hud = document.createElement('div');
    this.hud.setAttribute('style', 'position:fixed;top:8px;left:8px;z-index:50;'
      + 'font:12px ui-monospace,monospace;color:#dff1ff;background:rgba(6,14,22,0.72);'
      + 'padding:8px 10px;border-radius:8px;white-space:pre;pointer-events:none');
    host.appendChild(this.hud);

    this.bindControls(host);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  /** An n x n vertex lattice over the patch, y from `height`. */
  private lattice(height: (i: number) => number): THREE.BufferGeometry {
    const { n, cell } = this.sim;
    const span = n * cell;
    const pos = new Float32Array(n * n * 3);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = cy * n + cx;
        pos[i * 3] = cx * cell - span / 2;
        pos[i * 3 + 1] = height(i);
        pos[i * 3 + 2] = cy * cell - span / 2;
      }
    }
    const faces = new Uint32Array((n - 1) * (n - 1) * 6);
    let f = 0;
    for (let cy = 0; cy < n - 1; cy++) {
      for (let cx = 0; cx < n - 1; cx++) {
        const a = cy * n + cx;
        faces[f++] = a; faces[f++] = a + n; faces[f++] = a + 1;
        faces[f++] = a + 1; faces[f++] = a + n; faces[f++] = a + n + 1;
      }
    }
    // FLAT +Y NORMALS, written rather than left out. The first version
    // set none at all on the water and a lit material with no normal
    // shades black — 88% of the patch went dark and read as mud. The
    // ground recomputes its own from the bed; the surface is close
    // enough to level that one up-vector is both cheaper and steadier
    // than recomputing 65,536 of them every frame.
    const normals = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) normals[i * 3 + 1] = 1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(new THREE.BufferAttribute(faces, 1));
    return g;
  }

  /**
   * Water, coloured by its own depth.
   *
   * DRY IS DISCARDED, not drawn thin. The wet edge is wherever depth
   * crosses the threshold, which is a contour of the simulation rather
   * than the rim of a polygon somebody chose — that is the whole
   * difference from every previous attempt, and it is one line.
   */
  private waterMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.15, metalness: 0.1,
      transparent: true, side: THREE.DoubleSide,
    });
    // DRAWN IS NOT THE SAME AS WET, and the difference is the whole
    // reason "88% wet" was a useless number. The solver's dryDepth is
    // half a millimetre — which to a 5.5 mm queen is real water and
    // must stay in the simulation — but a film that thin over every
    // cell paints the patch uniformly and hides the channels inside
    // it. This is a RENDER floor only; the sim keeps its film.
    const dry = DRAWN_DEPTH;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float depth;
          varying float vDepth;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vDepth = depth;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vDepth;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            if (vDepth < ${dry.toFixed(4)}) discard;
            // Debug ramp: a film is pale, a pool is deep blue. Reading
            // depth off the picture is most of what this lab is for.
            // RAMPED OVER CENTIMETRES, not metres. A stream on this
            // island is tens of units deep, so a ramp that saturates at
            // 300 paints every one of them the same pale nothing —
            // exactly the mistake the old river shader made against an
            // ocean ramp. 60 units is 60 cm: knee-deep to a person,
            // unswimmable to her, and the top of the useful range.
            float t = clamp(vDepth / 60.0, 0.0, 1.0);
            diffuseColor.rgb = mix(vec3(0.62, 0.86, 0.88), vec3(0.04, 0.22, 0.55), t * t);
            diffuseColor.a = mix(0.55, 0.97, t);
          }`);
    };
    return material;
  }

  private bindControls(host: HTMLElement): void {
    let dragging = false; let lx = 0; let ly = 0;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointerleave', () => { dragging = false; });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.yaw -= (e.clientX - lx) * 0.006;
      this.pitch = Math.max(0.08, Math.min(1.5, this.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      this.range = Math.max(this.sim.cell * 8, this.range * (e.deltaY > 0 ? 1.1 : 0.9));
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      // R stops and starts the rain; C clears the patch to dry.
      if (e.key === 'r' || e.key === 'R') this.raining = !this.raining;
      if (e.key === 'c' || e.key === 'C') this.sim.depth.fill(0);
    });
    void host;
  }

  private readonly resize = (): void => {
    const w = window.innerWidth; const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const wall = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.wallSeconds += wall;

    // REAL TIME, or as near as the frame allows. Steps are whole, so
    // the remainder carries rather than being dropped — otherwise the
    // sim runs slow by however much each frame rounded away.
    const { dt } = this.sim.opts;
    let owed = wall / dt + this.carry;
    const steps = Math.min(Math.floor(owed), 240);
    this.carry = owed - Math.floor(owed);
    for (let s = 0; s < steps; s++) {
      if (this.raining) this.sim.rain(this.rainRate, dt, (cx, cy) => this.feeds[cy * this.sim.n + cx]);
      this.sim.step(true);
      this.simSeconds += dt;
    }

    // Lift the surface onto the bed it is standing on.
    for (let i = 0; i < this.waterDepth.length; i++) {
      this.waterDepth[i] = this.sim.depth[i];
      this.waterPos[i * 3 + 1] = this.sim.bed[i] + this.sim.depth[i];
    }
    const geom = this.water.geometry;
    geom.getAttribute('position').needsUpdate = true;
    geom.getAttribute('depth').needsUpdate = true;

    const span = this.sim.n * this.sim.cell;
    const mid = this.midHeight();
    this.camera.position.set(
      Math.sin(this.yaw) * Math.cos(this.pitch) * this.range,
      mid + Math.sin(this.pitch) * this.range,
      Math.cos(this.yaw) * Math.cos(this.pitch) * this.range,
    );
    this.camera.lookAt(0, mid, 0);
    this.renderer.render(this.scene, this.camera);

    this.sinceHud += wall;
    if (this.sinceHud > 0.25) { this.sinceHud = 0; this.report(span); }
  };

  private carry = 0;

  private midHeight(): number {
    let sum = 0;
    for (let i = 0; i < this.sim.bed.length; i++) sum += this.sim.bed[i];
    return sum / this.sim.bed.length;
  }

  private report(span: number): void {
    let wet = 0; let deepest = 0; let total = 0;
    for (let i = 0; i < this.sim.depth.length; i++) {
      const d = this.sim.depth[i];
      if (d > DRAWN_DEPTH) wet++;
      if (d > deepest) deepest = d;
      total += d;
    }
    // HOW CHANNELLED IS IT — the share of all the water standing in
    // the wettest twentieth of the patch. Sheet flow sits near 5%;
    // this patch was picked because the solver put 91% there.
    const sorted = Array.from(this.sim.depth).sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)))
      .reduce((a, b) => a + b, 0);
    const channelled = total > 0 ? top / total : 0;
    const m = (u: number) => (u / UNITS_PER_METRE);
    // THE NUMBER THE PAPER'S TABLE HIDES: cycles per second is not
    // speed. Simulated seconds per wall second is, and it is the one
    // that says whether an ant could stand in this.
    const rate = this.wallSeconds > 0 ? this.simSeconds / this.wallSeconds : 0;
    this.hud.textContent = [
      `patch    ${m(span).toFixed(0)} m  ${this.sim.n}²  @ ${m(this.sim.cell).toFixed(2)} m/cell`,
      `dt       ${this.sim.opts.dt}s`,
      `speed    ${rate.toFixed(2)}× real time`,
      `drawn    ${((100 * wet) / this.sim.depth.length).toFixed(1)}% of cells`,
      `in top5% ${(100 * channelled).toFixed(1)}% of the water`,
      `deepest  ${m(deepest).toFixed(2)} m`,
      `rain     ${this.raining ? 'on' : 'off'}   [R] rain  [C] clear  drag/wheel`,
    ].join('\n');
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.hud.remove();
  }
}
