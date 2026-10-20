/**
 * THE LOADING METER (Joshua, 2026-10-20, opening the character room: "a real-time asset loading indicator... the
 * amount downloaded, the total size, the percentage and the download speed, for example 15.0 MB / 30.0 MB (50.0% @
 * 1.2 MB/s)... an estimated time remaining once there's enough data... distinguish between downloading and preparing
 * the 3D model, so it doesn't show 100% before the room is actually usable").
 *
 * It counts what the loader actually receives, as the loader receives it (`assets.loadModel` with a `meter`): the
 * bytes are never fetched a second time to be measured. A load is a BATCH -- opening the room, putting on an outfit
 * -- of ITEMS, one an asset with the bytes it is expected to cost (`__PUBLIC_SIZE__`, or null when no one knows, which
 * makes the whole batch indeterminate rather than wrong).
 *
 * The phases are a function of the items, not a latch: DOWNLOADING while any item still has bytes to come,
 * PREPARING once every byte is in and the scene is still building her, READY only when the scene says the room is
 * usable, FAILED with the reason when it says so. So the downloaded share can reach 100% only at the moment the
 * phase stops being "downloading".
 *
 * Bytes the browser served from its own cache are counted as received (the bar has to finish) but not as speed: a
 * 66 MB shirt read from disk in a tenth of a second is not a 660 MB/s connection, and an ETA built on it would lie.
 *
 * Pure: no DOM, no fetch, a clock passed in. `src/sarahlab/loadingCard.ts` draws it.
 */

export type LoadPhase = 'idle' | 'downloading' | 'preparing' | 'ready' | 'failed';

export interface LoadSnapshot {
  readonly label: string;
  readonly phase: LoadPhase;
  /** Bytes in so far, this batch. */
  readonly received: number;
  /** Bytes the batch costs, or null while any item's size is unknown. */
  readonly total: number | null;
  /** received / total in 0..1, or null when indeterminate. Below 1 while the phase is downloading. */
  readonly fraction: number | null;
  /** Network speed over the last few seconds, or null until there is enough of it to say. */
  readonly bytesPerSecond: number | null;
  /** Seconds left at that speed, or null until there is enough data (time AND bytes) to estimate. */
  readonly etaSeconds: number | null;
  /** Of `received`, how many came from the browser's cache. */
  readonly cachedBytes: number;
  readonly error: string | null;
}

/** The window the speed is averaged over: long enough to ride out a stall, short enough to follow a change. */
export const SPEED_WINDOW_MS = 3000;
/** No ETA before this long into the batch, nor before this many network bytes: the first second is all handshake. */
export const ETA_AFTER_MS = 1500, ETA_AFTER_BYTES = 512 * 1024;

interface Item { expected: number | null; received: number; cached: number; done: boolean; active: boolean; readonly bySource: Map<string, number> }
interface Delta { t: number; source: string; bytes: number }

export class LoadMeter {
  private label = '';
  private items = new Map<string, Item>();
  private deltas: Delta[] = [];
  private cachedSources = new Set<string>();
  private startedAt = 0;
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private error: string | null = null;
  private eta: number | null = null;
  private etaAt = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * A new batch. Items still downloading from an earlier batch keep what they have received, and rejoin the count
   * if this batch expects them too (an outfit chosen again while its leggings are on their way).
   */
  start(label: string): void {
    this.label = label;
    for (const [key, item] of this.items) { if (item.done) this.items.delete(key); else item.active = false; }
    this.cachedSources.clear();
    this.startedAt = this.now();
    this.state = 'loading';
    this.error = null;
    this.eta = null;
  }

  /** This batch needs `key`, expected to cost `bytes` (null: unknown). Idempotent: a second call keeps the first's count. */
  expect(key: string, bytes: number | null): void {
    const item = this.items.get(key);
    if (item) { item.active = true; if (item.expected === null) item.expected = bytes; return; }
    this.items.set(key, { expected: bytes, received: 0, cached: 0, done: false, active: true, bySource: new Map() });
  }

  /** `bytes` more of `key` arrived, from `source` (the URL, so a cache hit can be told apart later). */
  progress(key: string, bytes: number, source = key): void {
    const item = this.items.get(key);
    if (!item || bytes <= 0) return;
    item.received += bytes;
    item.bySource.set(source, (item.bySource.get(source) ?? 0) + bytes);
    if (this.cachedSources.has(source)) item.cached += bytes;
    const t = this.now(), last = this.deltas[this.deltas.length - 1];
    if (last && last.source === source && t - last.t < 100) last.bytes += bytes;
    else this.deltas.push({ t, source, bytes });
    this.prune(t);
  }

  /** Everything `source` delivered for `key` came from the browser's cache: count it, but not as speed. */
  cached(key: string, source: string): void {
    if (this.cachedSources.has(source)) return;
    this.cachedSources.add(source);
    const item = this.items.get(key);
    if (item) item.cached = Math.min(item.received, item.cached + (item.bySource.get(source) ?? 0));
  }

  /** An attempt at `key` failed and is being retried: what it had received is not coming. */
  restart(key: string): void {
    const item = this.items.get(key);
    if (item) { item.received = 0; item.cached = 0; item.done = false; item.bySource.clear(); }
  }

  /** Every byte of `key` is in. A size nobody knew becomes the size it turned out to be. */
  downloaded(key: string): void {
    const item = this.items.get(key);
    if (!item) return;
    item.done = true;
    item.expected = Math.max(item.expected ?? 0, item.received);
  }

  /** `key` is no longer wanted (cancelled): it leaves the count. */
  drop(key: string): void { this.items.delete(key); }

  ready(): void { this.state = 'ready'; }
  fail(message: string): void { this.state = 'failed'; this.error = message; }

  snapshot(): LoadSnapshot {
    const t = this.now();
    this.prune(t);
    let received = 0, expected = 0, unknown = false, waiting = false, cachedBytes = 0;
    for (const item of this.items.values()) {
      if (!item.active) continue;
      received += item.received;
      cachedBytes += item.cached;
      if (item.expected === null) unknown = true; else expected += Math.max(item.expected, item.received);
      if (!item.done && !(item.expected !== null && item.received >= item.expected)) waiting = true;
    }
    const total = unknown ? null : expected;
    const phase: LoadPhase = this.state === 'idle' ? 'idle' : this.state === 'failed' ? 'failed' : this.state === 'ready' ? 'ready' : waiting ? 'downloading' : 'preparing';
    let fraction = total === null ? null : total === 0 ? 1 : Math.min(1, received / total);
    // the share shows 100% only once the phase has moved on: a stream can deliver its last byte a moment before
    // the loader closes the item
    if (fraction !== null && phase === 'downloading') fraction = Math.min(fraction, 0.999);
    const bytesPerSecond = this.speed(t);
    let etaSeconds: number | null = null;
    if (phase === 'downloading' && total !== null && bytesPerSecond && t - this.startedAt >= ETA_AFTER_MS && received - cachedBytes >= ETA_AFTER_BYTES) {
      const raw = Math.max(0, total - received) / bytesPerSecond;
      // eased so it settles rather than flickering second to second; a big change (a stall, a burst) shows at once
      this.eta = this.eta === null || Math.abs(raw - this.eta) > Math.max(10, this.eta * 0.5) ? raw : this.eta + (raw - this.eta) * Math.min(1, (t - this.etaAt) / 2000);
      this.etaAt = t;
      etaSeconds = this.eta;
    } else if (phase !== 'downloading') this.eta = null;
    return { label: this.label, phase, received, total, fraction, bytesPerSecond, etaSeconds, cachedBytes, error: this.error };
  }

  private speed(t: number): number | null {
    let bytes = 0;
    for (const d of this.deltas) if (!this.cachedSources.has(d.source)) bytes += d.bytes;
    if (!bytes) return null;
    // the bytes of the last few seconds over the time they took: the window, or the batch so far while it is
    // younger than that; never under half a second
    const span = Math.min(SPEED_WINDOW_MS, Math.max(500, t - this.startedAt));
    return (bytes / span) * 1000;
  }

  private prune(t: number): void {
    let drop = 0;
    while (drop < this.deltas.length && t - this.deltas[drop].t > SPEED_WINDOW_MS) drop++;
    if (drop) this.deltas.splice(0, drop);
  }
}

// ------------------------------------------------------------ words

/** Megabytes as a phone's own storage screen counts them (10^6), one decimal: "15.0 MB". */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Floored, never rounded up: "100.0%" is a promise. */
export function formatPercent(fraction: number): string {
  return `${(Math.floor(fraction * 1000) / 10).toFixed(1)}%`;
}

/** "15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)", or "15.0 MB (1.2 MB/s)" while the total is unknown. */
export function downloadLine(s: LoadSnapshot): string {
  const speed = s.bytesPerSecond ? `${formatMegabytes(s.bytesPerSecond)}/s` : null;
  if (s.total === null || s.fraction === null) return `${formatMegabytes(s.received)}${speed ? ` (${speed})` : ''}`;
  return `${formatMegabytes(s.received)} / ${formatMegabytes(s.total)} (${formatPercent(s.fraction)}${speed ? ` @ ${speed}` : ''})`;
}

/** "about 12 s left", "about 2 min 5 s left"; null with no estimate. */
export function etaLine(s: LoadSnapshot): string | null {
  if (s.etaSeconds === null) return null;
  const sec = Math.max(1, Math.round(s.etaSeconds));
  if (sec < 60) return `about ${sec} s left`;
  const min = Math.floor(sec / 60), rest = sec % 60;
  return min >= 10 ? `about ${min} min left` : `about ${min} min${rest ? ` ${rest} s` : ''} left`;
}
