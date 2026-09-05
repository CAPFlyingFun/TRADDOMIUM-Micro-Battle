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
 * SESSION is the fifth column and it appears only when the owner offers a
 * `session()` hook. It is the HUD's one honest line about multiplayer, and
 * every word in it is measured rather than promised: `Connected` is a
 * welcomed client on an open socket and NOTHING more — not that online play
 * is finished, not that the other player can see you. It counts the other
 * players this world is actually drawing, and it names refused claims when
 * there are any, because a movement the authority would not allow is
 * otherwise invisible. In a solo session the line reads `Solo`.
 *
 * Talks to its owner through a typed hook object and reads plain summary
 * structs; it does not import FrameStats, the camera or anything of `net/`
 * (§2.7) — the link's state reaches it as six plain words it can print.
 * Imports the DOM only — testable under jsdom without three.
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

/**
 * What kind of session this world is running in, and — when it is a
 * networked one — how its link stands. Six plain words, not `net/`'s own
 * states: the HUD prints what it is told and never learns the protocol.
 *
 *   solo         no network at all; nothing was opened.
 *   idle         networked, but nothing has been opened yet.
 *   connecting   a handshake is in flight.
 *   connected    welcomed by the authority on an open socket.
 *   lost         it was up and the link went away.
 *   unreachable  the handshake did not complete.
 *   left         this end hung up deliberately.
 */
export type SessionLink = 'solo' | 'idle' | 'connecting' | 'connected' | 'lost' | 'unreachable' | 'left';

export interface SessionReadout {
  readonly link: SessionLink;
  /** OTHER players currently drawn. Zero in solo. */
  readonly others: number;
  /** Claims the authority answered with a different truth. Zero in solo. */
  readonly refusedClaims: number;
  /** Claim-to-acknowledgement, milliseconds; absent until one has been measured. */
  readonly roundTripMs?: number;
}

export interface PerfHudHooks {
  /** The rows to show. Re-read at every refresh so the checkboxes follow the model, not the clicks. */
  layers(): readonly LayerToggle[];
  /** The player toggled a checkbox. The owner decides what it means; the HUD re-reads `layers()`. */
  onLayerToggle(id: WorldLayerId, enabled: boolean): void;
  /**
   * How this world's session stands. Absent means the owner has nothing to
   * say about a session, and the column is not built at all — an empty
   * heading would be a claim of its own.
   */
  session?(): SessionReadout;
}

type Field = 'meanFps' | 'lowFps' | 'simDt' | 'cameraPosition' | 'cameraSpeed' | 'cameraFacing';

const GOLD = '#c9a94a';
const PARCHMENT = '#e8e2c8';

/**
 * How wide the SESSION column may get before its line wraps, in pixels.
 * Chosen so the whole HUD clears the PAUSE button at the 932 px design
 * canvas with the longest line the wire produces — see the comment where
 * it is used.
 */
const SESSION_MAX_WIDTH = 210;

/** One word per link state, and not a word more than is true. */
const LINK_WORDS: Readonly<Record<SessionLink, string>> = {
  solo: 'Solo',
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  lost: 'Connection lost',
  unreachable: 'Relay unreachable',
  left: 'Left the session',
};

/**
 * The one word for a link state, shared with the bot's panel
 * (`BotHud.ts`) so the two overlays in the same world can never describe
 * the same link with different words.
 */
export function linkWords(link: SessionLink): string {
  return LINK_WORDS[link];
}

/** Radians to a whole degree in 0..359, the same reading the bot's panel gives. */
function degrees(radians: number): number {
  const deg = Math.round((radians * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

function plural(count: number, one: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${one}s`;
}

/**
 * The one line. In solo it is the one word. Networked, it says how the
 * link stands, how many other players this world is DRAWING — "last
 * seen" when the link is down, because what is on screen is then a
 * stale picture and saying otherwise would be the HUD promising
 * something the wire is not delivering — and what the authority has
 * refused, when it has refused anything.
 */
function sessionWords(readout: SessionReadout): string {
  const parts: string[] = [LINK_WORDS[readout.link]];
  if (readout.link === 'solo') return parts[0];
  if (readout.link === 'connected') {
    parts.push(readout.others === 0 ? 'no other players' : `${plural(readout.others, 'other player')}`);
    if (readout.roundTripMs !== undefined) parts.push(`claim→ack ${Math.round(readout.roundTripMs)} ms`);
  } else if (readout.others > 0) {
    parts.push(`${plural(readout.others, 'other player')} last seen`);
  }
  if (readout.refusedClaims > 0) parts.push(`${plural(readout.refusedClaims, 'claim')} refused`);
  return parts.join(' · ');
}

export class PerfHud {
  private readonly root: HTMLElement;
  private readonly fields: Readonly<Record<Field, HTMLElement>>;
  /** Built only when the owner offers a `session()` hook; null otherwise. */
  private readonly sessionLine: HTMLElement | null;
  private readonly boxes = new Map<WorldLayerId, HTMLInputElement>();
  /** Each layer row's wrapper and its text node, so the label can follow the model. */
  private readonly rows = new Map<string, { wrap: HTMLElement; text: Text }>();
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
    this.fields = {
      meanFps: line(frame, 'mean-fps'),
      lowFps: line(frame, 'low-fps'),
      simDt: line(sim, 'sim-dt'),
      cameraPosition: line(camera, 'camera-position'),
      cameraSpeed: line(camera, 'camera-speed'),
      cameraFacing: line(camera, 'camera-facing'),
    };
    // Before LAYERS, which is a column of rows rather than a readout and
    // reads best last.
    if (hooks.session === undefined) {
      this.sessionLine = null;
    } else {
      const col = column('SESSION');
      // THE ONE COLUMN THAT WRAPS. Every other readout is a fixed handful
      // of characters; this one grows with what the wire is doing —
      // `Connected · 1 other player · claim→ack 17 ms` is three times the
      // width of `Solo`. Left on one line it pushed the HUD 47 px under
      // the PAUSE button, which is pinned to the right edge, and the
      // LAYERS column's last word disappeared behind it. Wrapping costs
      // one line of a HUD that is already seven rows tall; clipping costs
      // a readout. `scripts/probe-bot.mjs` measures both, with another
      // player in the room, because that is when the line is longest.
      col.style.maxWidth = `${SESSION_MAX_WIDTH}px`;
      this.sessionLine = line(col, 'session');
      this.sessionLine.style.whiteSpace = 'normal';
    }
    this.buildLayerRows(column('LAYERS'));
    uiLayer.appendChild(this.root);
  }

  /** Call every frame with the WALL-CLOCK dt; the DOM is touched only HUD_HZ times a second. */
  update(readout: PerfReadout, rawDt: number): void {
    this.sinceRefresh += rawDt;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.sinceRefresh = 0;
    // A hidden HUD is not written to either: the point of hiding it is to take its cost out of the frame.
    if (this.root.hidden) return;
    this.render(readout);
  }

  /** The player's "Show frame rate" setting. Hidden, the HUD costs no DOM writes. */
  get hidden(): boolean {
    return this.root.hidden;
  }

  set hidden(value: boolean) {
    if (this.root.hidden === value) return;
    this.root.hidden = value;
    // Paint on the first frame it comes back rather than up to a refresh period later.
    if (!value) this.sinceRefresh = Infinity;
  }

  dispose(): void {
    this.root.remove();
    this.boxes.clear();
    this.rows.clear();
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
      const text = doc.createTextNode(label);
      wrap.appendChild(text);
      parent.appendChild(wrap);
      this.rows.set(id, { wrap, text });
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
    // Degrees in the ACTOR's convention, so this line and a capsule's own
    // facing describe the same compass — see `FreeFlyCamera.headingOfYaw`.
    this.fields.cameraFacing.textContent = `facing ${degrees(c.facing)}°`;
    const session = this.hooks.session?.();
    if (this.sessionLine !== null && session !== undefined) this.sessionLine.textContent = sessionWords(session);
    // THE MODEL IS THE TRUTH, and that includes the WORDS. A click the
    // owner rejected snaps back here — and so does a row whose built-ness
    // was not known when the HUD was constructed. Whether TERRAIN is built
    // is not a fact about this build: it is whether the survey actually
    // downloaded, which is settled after this panel exists. Writing the
    // label once left the row reading "not built" over ground that was
    // plainly on the screen.
    for (const layer of this.hooks.layers()) {
      const box = this.boxes.get(layer.id);
      if (!box) continue;
      box.checked = layer.enabled;
      box.disabled = !layer.built;
      const row = this.rows.get(layer.id);
      if (row) {
        const label = layer.built ? layer.id : `${layer.id} — not built`;
        if (row.text.nodeValue !== label) row.text.nodeValue = label;
        row.wrap.style.opacity = !layer.built && !layer.enabled ? '0.5' : '1';
      }
    }
  }
}
