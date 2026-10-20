// @vitest-environment jsdom
/**
 * The character room's loading card (src/sarahlab/loadingCard.ts): the download line in Joshua's format, an
 * indeterminate bar when the size is unknown, a PREPARING step that never claims a download percentage, and a failure
 * that says why and offers a working RETRY. Ready, it is gone.
 */
import { describe, expect, it } from 'vitest';
import type { LoadSnapshot } from '../src/assets/loadMeter';
import { loadingCard, LOADING_RETRY_ACTION } from '../src/sarahlab/loadingCard';

const base: LoadSnapshot = { label: 'Opening the character room', phase: 'downloading', received: 15e6, total: 30e6, fraction: 0.5, bytesPerSecond: 1.2e6, etaSeconds: 12.4, cachedBytes: 0, error: null };

describe('the loading card', () => {
  it('draws each phase and hides when ready', () => {
    let retried = 0;
    const card = loadingCard(document, () => { retried++; });
    document.body.appendChild(card.element);
    const text = () => card.element.textContent ?? '';
    card.show(base, 'centre');
    expect(card.element.style.display).toBe('block');
    expect(text()).toContain('15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)');
    expect(text()).toContain('about 12 s left');
    expect(card.element.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('50');

    card.show({ ...base, total: null, fraction: null, etaSeconds: null }, 'aside');
    expect(card.element.hasAttribute('data-indeterminate')).toBe(true);
    expect(card.element.dataset.place).toBe('aside');
    expect(text()).toContain('size unknown');

    card.show({ ...base, phase: 'preparing', received: 30e6, fraction: 1, cachedBytes: 10e6 }, 'centre');
    expect(text()).toContain('Preparing the 3D model');
    expect(text()).not.toContain('100.0%');
    expect(text()).toContain("10.0 MB from this device's cache");

    card.show({ ...base, phase: 'failed', error: 'Her outfit could not be downloaded.' }, 'centre');
    expect(card.element.dataset.phase).toBe('failed');
    expect(text()).toContain('Her outfit could not be downloaded.');
    card.element.querySelector<HTMLButtonElement>(`[data-action="${LOADING_RETRY_ACTION}"]`)!.click();
    expect(retried).toBe(1);

    card.show({ ...base, phase: 'ready' }, 'centre');
    expect(card.element.style.display).toBe('none');
  });
});
