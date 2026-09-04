/**
 * The performance HUD: a DOM overlay in the scene's ui layer.
 *
 * Two readouts that must never be confused: FRAME (raw), the wall-clock
 * frame rate — mean and 95th-percentile low — and SIM dt, the step the
 * simulation actually took, which reads "paused" when it is 0. They are two
 * separate columns with their own headings because v0 showed one number and
 * it was the wrong one (§2.4). Beside them: the camera's position and speed,
 * and the LAYERS column, one checkbox per world layer so each layer's cost
 * can be measured alone on a real device (§9).
 *
 * Refreshes at HUD_HZ rather than every frame: a readout that changes sixty
 * times a second cannot be read, and the DOM write itself costs frame time
 * in the very scene that is measuring frame time. The refresh is timed by
 * RAW dt, because while the world is paused sim dt is 0 and a HUD timed by
 * it would freeze before it could say "paused".
 *
 * Talks to its owner through a typed hook object and reads plain summary
 * structs; it does not import FrameStats or the camera (§2.7). Imports the
 * DOM only — testable under jsdom without three.
 */
import type { WorldLayerId } from '../world/WorldLoader';
import type { CameraReadout } from './FreeFlyCamera';
import type { FrameSummary } from './FrameStats';
import type { LayerToggle } from './layerToggles';

/** DOM refreshes per second. */
export const HUD_HZ = 5;

export interface PerfReadout {
  readonly frame: FrameSummary;
  readonly camera: CameraReadout;
}

export interface PerfHudHooks {
  /** The rows to show. Re-read at every refresh so the checkboxes follow the model, not the clicks. */
  layers(): readonly LayerToggle[];
  /** The player toggled a checkbox. The owner decides what it means; the HUD re-reads `layers()`. */
  onLayerToggle(id: WorldLayerId, enabled: boolean): void;
}

type Field = 'meanFps' | 'lowFps' | 'simDt' | 'cameraPosition' | 'cameraSpeed';

const GOLD = '#c9a94a';
const PARCHMENT = '#e8e2c8';

export class PerfHud {
  private readonly root: HTMLElement;
  private readonly fields: Readonly<Record<Field, HTMLElement>>;
  private readonly boxes = new Map<WorldLayerId, HTMLInputElement>();
  /** Infinity so the very first update() paints without waiting a refresh period. */
  private sinceRefresh = Infinity;

  constructor(
    uiLayer: HTMLElement,
    private readonly hooks: PerfHudHooks,
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = 'perf-hud';
    this.root.style.cssText =
      'position:absolute;top:8px;left:10px;display:flex;align-items:flex-start;gap:16px;' +
      `padding:8px 10px;background:rgba(6,9,12,0.72);color:${PARCHMENT};` +
      `font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid ${GOLD};border-radius:6px;`;

    const column = (heading: string): HTMLElement => {
      const col = doc.createElement('div');
      const head = doc.createElement('div');
      head.textContent = heading;
      head.style.cssText = `color:${GOLD};letter-spacing:0.06em;margin-bottom:2px;white-space:nowrap;`;
      col.appendChild(head);
      this.root.appendChild(col);
      return col;
    };
    const line = (parent: HTMLElement, field: string): HTMLElement => {
      const el = doc.createElement('div');
      el.dataset.field = field;
      el.style.whiteSpace = 'nowrap';
      parent.appendChild(el);
      return el;
    };

    const frame = column('FRAME (raw)');
    const sim = column('SIM dt');
    const camera = column('CAMERA');
    const layers = column('LAYERS');
    this.fields = {
      meanFps: line(frame, 'mean-fps'),
      lowFps: line(frame, 'low-fps'),
      simDt: line(sim, 'sim-dt'),
      cameraPosition: line(camera, 'camera-position'),
      cameraSpeed: line(camera, 'camera-speed'),
    };
    this.buildLayerRows(layers);
    uiLayer.appendChild(this.root);
  }

  /** Call every frame with the WALL-CLOCK dt; the DOM is touched only HUD_HZ times a second. */
  update(readout: PerfReadout, rawDt: number): void {
    this.sinceRefresh += rawDt;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.sinceRefresh = 0;
    this.render(readout);
  }

  dispose(): void {
    this.root.remove();
    this.boxes.clear();
  }

  private buildLayerRows(parent: HTMLElement): void {
    const doc = parent.ownerDocument;
    const row = (id: string, label: string, checked: boolean, locked: boolean): HTMLInputElement => {
      const wrap = doc.createElement('label');
      // A locked-OFF row is a layer this build cannot show: dimmed as well as
      // disabled. A locked-ON row is the base world and reads at full strength.
      wrap.style.cssText = `display:block;white-space:nowrap;opacity:${locked && !checked ? 0.5 : 1};`;
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.dataset.action = `layer:${id}`;
      box.checked = checked;
      box.disabled = locked;
      box.style.cssText = 'margin:0 6px 0 0;vertical-align:middle;';
      wrap.appendChild(box);
      wrap.appendChild(doc.createTextNode(label));
      parent.appendChild(wrap);
      return box;
    };

    // The empty world is what everything else is measured against: always on, never a choice.
    row('empty', 'empty — always on', true, true);
    for (const layer of this.hooks.layers()) {
      const box = row(layer.id, layer.built ? layer.id : `${layer.id} — not built`, layer.enabled, !layer.built);
      box.addEventListener('change', () => this.hooks.onLayerToggle(layer.id, box.checked));
      this.boxes.set(layer.id, box);
    }
  }

  private render(readout: PerfReadout): void {
    const f = readout.frame;
    const c = readout.camera;
    if (f.frames === 0) {
      this.fields.meanFps.textContent = 'mean     no frames yet';
      this.fields.lowFps.textContent = '95th low no frames yet';
    } else {
      this.fields.meanFps.textContent = `mean     ${f.meanFps.toFixed(1)} fps`;
      this.fields.lowFps.textContent = `95th low ${f.lowFps.toFixed(1)} fps`;
    }
    this.fields.simDt.textContent = f.simDt === 0 ? 'paused' : `${(f.simDt * 1000).toFixed(1)} ms`;
    this.fields.cameraPosition.textContent = `x ${c.x.toFixed(1)}  y ${c.y.toFixed(1)}  z ${c.z.toFixed(1)}`;
    this.fields.cameraSpeed.textContent = `speed ${c.speed.toFixed(0)} units/s`;
    // The model is the truth; a click the owner rejected snaps back here.
    for (const layer of this.hooks.layers()) {
      const box = this.boxes.get(layer.id);
      if (!box) continue;
      box.checked = layer.enabled;
      box.disabled = !layer.built;
    }
  }
}
