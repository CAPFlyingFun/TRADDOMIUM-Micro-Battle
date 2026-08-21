/**
 * CHOOSE WHERE THE COLONY BEGINS.
 *
 * The whole island on one screen, thirty regions on it, and a panel
 * that tells you what you are about to walk into. The player picks a
 * REGION; the game picks one of its hidden candidates, so restarts
 * vary and nobody memorises a coordinate.
 *
 * Marker pixels are presentation and the candidate's WorldPoint is the
 * truth — the two never swap. See coords.ts.
 */
import {
  chooseCandidate, readyRegions, type Environment, type ReadyRegion,
  type SpawnCandidate,
} from '../world/spawn';
import { bakeIsland, MAP_SIZE, worldToMap } from './islandMap';
import { geoToWorld } from '../world/geo';
import { UNITS_PER_METRE } from '../world/kauai';

const GOLD = 'rgba(255, 216, 130, .85)';
const LIVE = 'rgb(110, 255, 150)';
const INK = 'rgba(9, 13, 20, .93)';

const FACE: Record<Environment, string> = {
  coast: '🏖️', grass: '🌾', jungle: '🌿', foothill: '⛰️', mountain: '🏔️',
};

const CALLED: Record<Environment, string> = {
  coast: 'Coast', grass: 'Open lowland', jungle: 'Jungle',
  foothill: 'Foothills', mountain: 'Mountain',
};

export interface Chosen {
  readonly region: ReadyRegion;
  readonly candidate: SpawnCandidate;
}

export class SpawnMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly panel: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  private picked: ReadyRegion | null = null;
  private drawn = 0;

  constructor(host: HTMLElement, private readonly onSpawn: (at: Chosen) => void) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'spawn-map';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: 'calc(10px + env(safe-area-inset-top)) 14px calc(10px + env(safe-area-inset-bottom))',
      background: 'radial-gradient(circle at 50% 30%, #16243a, #060a12 72%)',
      zIndex: '40',
      touchAction: 'none',
      // Or the padding is added OUTSIDE the fixed inset and the map's
      // 100% height overflows the window by exactly the padding.
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>);

    this.canvas = document.createElement('canvas');
    this.canvas.dataset.ui = 'island-canvas';
    Object.assign(this.canvas.style, {
      // Square, and never taller than the window — landscape phones
      // have far less height than width, and a square that overflows
      // is a map you cannot reach the bottom of.
      //
      // width:auto and flex:0 0 auto are both load-bearing. A canvas
      // carries width and height ATTRIBUTES, which make its width
      // definite in a flex row — and `aspect-ratio` is ignored when
      // both axes are already determined. It came out 645 by 414.
      flex: '0 0 auto',
      width: 'auto',
      height: '100%',
      maxHeight: '100%',
      aspectRatio: '1 / 1',
      borderRadius: '12px',
      border: `2px solid ${GOLD}`,
      touchAction: 'none',
      cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);

    this.panel = document.createElement('div');
    this.panel.dataset.ui = 'region-panel';
    Object.assign(this.panel.style, {
      flex: '0 1 300px',
      minWidth: '0',
      maxHeight: '100%',
      overflowY: 'auto',
      padding: '14px',
      borderRadius: '12px',
      border: `2px solid ${GOLD}`,
      background: INK,
      color: 'rgba(255, 236, 200, .92)',
      font: '13px/1.5 system-ui, sans-serif',
    } as Partial<CSSStyleDeclaration>);

    this.root.append(this.canvas, this.panel);
    host.appendChild(this.root);

    const tap = (event: PointerEvent) => this.tapped(event);
    this.canvas.addEventListener('pointerdown', tap as EventListener);
    this.detach.push(() => this.canvas.removeEventListener('pointerdown', tap as EventListener));

    this.show(null);
    this.paint();
    // What the probe drives the map by: region ids with both their map
    // pixel (presentation) and their world position (the truth), so a
    // test can click the right dot and then check she arrived near the
    // right PLACE rather than near the right pixel.
    (window as unknown as Record<string, unknown>).__regions = readyRegions().map((r) => {
      const at = geoToWorld(r.around);
      const dot = worldToMap(at.wx, at.wz);
      return {
        id: r.id, name: r.name, wx: at.wx, wz: at.wz,
        mapX: dot.x / MAP_SIZE, mapY: dot.y / MAP_SIZE,
      };
    });
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.root.remove();
  }

  /** Nearest region to a tap, within reach. */
  private tapped(event: PointerEvent): void {
    const box = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * MAP_SIZE;
    const y = ((event.clientY - box.top) / box.height) * MAP_SIZE;

    let best: ReadyRegion | null = null;
    let nearest = Infinity;
    for (const region of readyRegions()) {
      const at = geoToWorld(region.around);
      const dot = worldToMap(at.wx, at.wz);
      const apart = Math.hypot(dot.x - x, dot.y - y);
      if (apart < nearest) {
        nearest = apart;
        best = region;
      }
    }
    // A generous radius: a marker is 9 px and a thumb is not.
    if (best && nearest < 34) {
      this.picked = best;
      this.show(best);
      this.paint();
    }
  }

  private paint(): void {
    const ink = this.canvas.getContext('2d')!;
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    ink.drawImage(bakeIsland(), 0, 0);

    for (const region of readyRegions()) {
      const at = geoToWorld(region.around);
      const dot = worldToMap(at.wx, at.wz);
      const here = this.picked?.id === region.id;

      ink.beginPath();
      ink.arc(dot.x, dot.y, here ? 13 : 8, 0, Math.PI * 2);
      ink.fillStyle = here ? 'rgba(110, 255, 150, .92)' : 'rgba(20, 26, 34, .82)';
      ink.fill();
      ink.lineWidth = here ? 4 : 2.5;
      ink.strokeStyle = here ? '#0b1018' : GOLD;
      ink.stroke();

      if (here) {
        ink.beginPath();
        ink.arc(dot.x, dot.y, 22, 0, Math.PI * 2);
        ink.strokeStyle = 'rgba(110, 255, 150, .55)';
        ink.lineWidth = 2;
        ink.stroke();
      }
    }

    // North, because a map without one is a picture.
    ink.fillStyle = GOLD;
    ink.font = 'bold 22px system-ui, sans-serif';
    ink.textAlign = 'center';
    ink.fillText('N', MAP_SIZE - 34, 40);
    ink.beginPath();
    ink.moveTo(MAP_SIZE - 34, 48);
    ink.lineTo(MAP_SIZE - 34, 74);
    ink.moveTo(MAP_SIZE - 40, 56);
    ink.lineTo(MAP_SIZE - 34, 48);
    ink.lineTo(MAP_SIZE - 28, 56);
    ink.strokeStyle = GOLD;
    ink.lineWidth = 2.5;
    ink.stroke();
    this.drawn += 1;
  }

  private show(region: ReadyRegion | null): void {
    if (!region) {
      this.panel.innerHTML = `
        <div style="font:700 15px/1.3 system-ui,sans-serif;letter-spacing:.06em">
          CHOOSE A START
        </div>
        <p style="opacity:.75;margin:10px 0 0">
          Thirty places around Kauaʻi. Tap one to see what is there.
        </p>
        <p style="opacity:.55;margin:14px 0 0;font-size:12px">
          The exact spot within a region is chosen for you, so no two
          colonies begin on the same grain of sand.
        </p>`;
      return;
    }

    const at = region.candidates[0];
    const metres = at ? Math.round(at.ground / UNITS_PER_METRE) : 0;
    const stars = '★'.repeat(region.difficulty) + '☆'.repeat(3 - region.difficulty);

    this.panel.innerHTML = `
      <div style="font:700 16px/1.25 system-ui,sans-serif">
        ${FACE[region.environment]} ${region.name}
      </div>
      <div style="margin-top:10px;opacity:.8">
        <div>Environment: <b>${CALLED[region.environment]}</b></div>
        <div>Elevation: <b>~${metres} m</b></div>
        <div>Difficulty: <b style="letter-spacing:.1em">${stars}</b></div>
      </div>
      <p style="margin:12px 0 0;opacity:.85">${region.description}</p>
      <p style="margin:10px 0 0;opacity:.5;font-size:12px">
        ${region.candidates.length} possible starts in this region.
      </p>`;

    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.ui = 'spawn-here';
    go.textContent = 'SPAWN HERE';
    Object.assign(go.style, {
      appearance: 'none',
      display: 'block',
      width: '100%',
      marginTop: '14px',
      padding: '13px',
      borderRadius: '10px',
      border: `2px solid ${LIVE}`,
      background: 'rgba(110, 255, 150, .16)',
      color: LIVE,
      font: '700 14px/1 system-ui, sans-serif',
      letterSpacing: '.08em',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    go.addEventListener('click', () => {
      const candidate = chooseCandidate(region);
      if (candidate) this.onSpawn({ region, candidate });
    });
    this.panel.appendChild(go);
  }
}
