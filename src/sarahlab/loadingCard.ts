/**
 * THE CHARACTER ROOM'S LOADING CARD (Joshua, 2026-10-20): what the meter (`assets/loadMeter.ts`) says, drawn for a
 * phone first -- "15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)", a bar, the time left once there is enough data to say, a
 * separate PREPARING step so the bar never claims 100% before she can be used, and when a download fails, why and a
 * RETRY that is a real 44-point button.
 *
 * Two places. Opening the room it is a card in the middle, because there is nothing else to look at yet. Putting on
 * an outfit that has not been fetched it is ASIDE, out of her way -- in landscape the left column under BACK, held
 * upright just above the controls -- since she stays in the outfit she has on until the new one is ready and the
 * room keeps working underneath.
 */
import { downloadLine, etaLine, formatMegabytes, type LoadSnapshot } from '../assets/loadMeter';

export const LOADING_CARD_ROLE = 'sarahlab-loading';
export const LOADING_RETRY_ACTION = 'sarahlab:loading:retry';
export type LoadingPlace = 'centre' | 'aside';
/** The CSS variable the scene sets to how much of the bottom its controls cover, held upright (`uprightTabs.covered`). */
export const LOADING_COVERED_VAR = '--sarahlab-covered';

export interface LoadingCard {
  readonly element: HTMLElement;
  /** Draw the snapshot; a ready or idle meter hides the card. Writes the DOM only where something changed. */
  show(snapshot: LoadSnapshot, place: LoadingPlace): void;
  hide(): void;
}

export function loadingCard(doc: Document, onRetry: () => void): LoadingCard {
  const root = doc.createElement('div');
  root.dataset.role = LOADING_CARD_ROLE;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const style = doc.createElement('style');
  style.textContent = `
    [data-role="${LOADING_CARD_ROLE}"] { position:absolute; left:50%; transform:translateX(-50%); box-sizing:border-box;
      width:min(340px, calc(100vw - 32px)); padding:14px 16px; border-radius:14px; background:rgba(10,13,18,0.92);
      border:1px solid rgba(255,255,255,0.12); color:#e8e2d8; font:600 13px system-ui,sans-serif; display:none;
      pointer-events:auto; touch-action:none; box-shadow:0 8px 30px rgba(0,0,0,0.35); z-index:5 }
    [data-role="${LOADING_CARD_ROLE}"][data-place="centre"] { top:50%; transform:translate(-50%,-50%) }
    [data-role="${LOADING_CARD_ROLE}"][data-place="aside"] { top:calc(64px + env(safe-area-inset-top)); left:max(12px, env(safe-area-inset-left)); transform:none;
      width:min(280px, calc(50vw - 80px)); padding:10px 12px }
    @media (orientation: portrait) { [data-role="${LOADING_CARD_ROLE}"][data-place="aside"] { top:auto; left:50%; transform:translateX(-50%);
      width:min(340px, calc(100vw - 32px)); bottom:calc(var(${LOADING_COVERED_VAR}, 0px) + 8px) } }
    [data-role="${LOADING_CARD_ROLE}"] .ld-title { font-size:14px; margin-bottom:9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    [data-role="${LOADING_CARD_ROLE}"][data-place="aside"] .ld-title { font-size:12px; margin-bottom:6px }
    [data-role="${LOADING_CARD_ROLE}"] .ld-track { position:relative; height:8px; border-radius:4px; background:rgba(255,255,255,0.12); overflow:hidden }
    [data-role="${LOADING_CARD_ROLE}"] .ld-fill { position:absolute; left:0; top:0; bottom:0; width:0; border-radius:4px; background:#d4a853; transition:width .2s linear }
    [data-role="${LOADING_CARD_ROLE}"][data-indeterminate] .ld-fill { width:35% !important; transition:none; animation:ld-slide 1.2s ease-in-out infinite }
    [data-role="${LOADING_CARD_ROLE}"][data-phase="preparing"] .ld-fill { width:100% !important; transition:none;
      background:repeating-linear-gradient(-45deg,#d4a853 0 10px,#b38a3e 10px 20px); background-size:28px 28px; animation:ld-stripes .8s linear infinite }
    [data-role="${LOADING_CARD_ROLE}"] .ld-line { margin-top:8px; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    [data-role="${LOADING_CARD_ROLE}"] .ld-sub { margin-top:3px; font-size:11px; color:#9aa0a8; min-height:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    [data-role="${LOADING_CARD_ROLE}"] .ld-error { margin-top:8px; font-size:12px; color:#f0b8a8; display:none; white-space:normal }
    [data-role="${LOADING_CARD_ROLE}"] button { margin-top:10px; min-height:44px; width:100%; border-radius:10px; border:1px solid rgba(212,168,83,.6);
      background:rgba(212,168,83,.16); color:#f2dfb4; font:700 13px system-ui,sans-serif; letter-spacing:.08em; display:none }
    [data-role="${LOADING_CARD_ROLE}"][data-phase="failed"] .ld-error, [data-role="${LOADING_CARD_ROLE}"][data-phase="failed"] button { display:block }
    [data-role="${LOADING_CARD_ROLE}"][data-phase="failed"] .ld-track { opacity:.4 }
    @keyframes ld-slide { 0% { left:-35% } 100% { left:100% } }
    @keyframes ld-stripes { 0% { background-position:0 0 } 100% { background-position:28px 0 } }
    @media (prefers-reduced-motion: reduce) { [data-role="${LOADING_CARD_ROLE}"] .ld-fill { animation:none !important } }`;
  const title = doc.createElement('div'); title.className = 'ld-title';
  const track = doc.createElement('div'); track.className = 'ld-track';
  const fill = doc.createElement('div'); fill.className = 'ld-fill';
  track.appendChild(fill);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const line = doc.createElement('div'); line.className = 'ld-line';
  const sub = doc.createElement('div'); sub.className = 'ld-sub';
  const error = doc.createElement('div'); error.className = 'ld-error';
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.dataset.action = LOADING_RETRY_ACTION;
  retry.textContent = 'RETRY';
  retry.addEventListener('click', (e) => { e.stopPropagation(); onRetry(); });
  root.append(style, title, track, line, sub, error, retry);
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation());

  const set = (el: HTMLElement, text: string) => { if (el.textContent !== text) el.textContent = text; };
  const attr = (name: string, value: string | null) => {
    if (value === null) { if (root.hasAttribute(name)) root.removeAttribute(name); }
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  };

  return {
    element: root,
    show(s, place) {
      if (s.phase === 'idle' || s.phase === 'ready') { this.hide(); return; }
      root.style.display = 'block';
      attr('data-place', place);
      attr('data-phase', s.phase);
      attr('data-indeterminate', s.phase === 'downloading' && s.fraction === null ? '' : null);
      set(title, s.label);
      const pct = s.fraction === null ? null : Math.round(s.fraction * 1000) / 10;
      const width = `${pct ?? 0}%`;
      if (fill.style.width !== width) fill.style.width = width;
      if (pct === null || s.phase !== 'downloading') track.removeAttribute('aria-valuenow'); else track.setAttribute('aria-valuenow', String(pct));
      if (s.phase === 'preparing') {
        set(line, 'Preparing the 3D model…');
        set(sub, `${formatMegabytes(s.received)} downloaded${s.cachedBytes > 0 ? ` · ${formatMegabytes(s.cachedBytes)} from this device's cache` : ''}`);
      } else {
        // a stopped download has no speed to quote
        set(line, downloadLine(s.phase === 'failed' ? { ...s, bytesPerSecond: null } : s));
        const eta = s.phase === 'downloading' ? etaLine(s) : null;
        const cached = s.cachedBytes > 0 ? `${formatMegabytes(s.cachedBytes)} from this device's cache` : null;
        set(sub, s.phase === 'failed' ? '' : [eta ?? (s.received === 0 ? 'connecting…' : s.total === null ? 'size unknown' : 'estimating time…'), cached].filter(Boolean).join(' · '));
      }
      set(error, s.error ?? '');
    },
    hide() { if (root.style.display !== 'none') root.style.display = 'none'; },
  };
}
