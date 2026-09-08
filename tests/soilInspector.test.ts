// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SoilInspector } from '../src/ui/SoilInspector';

describe('soil inspection controls', () => {
  it('opens without cutting, focuses a worm, adjusts the section and returns to surface', () => {
    const host = document.createElement('div'); document.body.append(host);
    const depth = vi.fn(); const worm = vi.fn(() => true);
    const ui = new SoilInspector(host, { onDepth: depth, onWorm: worm });
    (host.querySelector('[data-action="soil"]') as HTMLButtonElement).click();
    expect(depth).not.toHaveBeenCalled();
    (host.querySelector('[data-action="soil-worm"]') as HTMLButtonElement).click();
    expect(worm).toHaveBeenCalledOnce();
    expect(depth).toHaveBeenLastCalledWith(12);
    const slider = host.querySelector('input')!;
    slider.value = '9'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(depth).toHaveBeenLastCalledWith(9);
    (host.querySelector('[data-action="soil-close"]') as HTMLButtonElement).click();
    expect(depth).toHaveBeenLastCalledWith(0);
    expect(host.querySelector<HTMLElement>('[data-soil-panel]')!.hidden).toBe(true);
    ui.dispose(); expect(host.children.length).toBe(0); host.remove();
  });

  it('does not claim a found worm when none is nearby, and keeps slider keys away from movement', () => {
    const host = document.createElement('div'); document.body.append(host);
    const depth = vi.fn();
    const ui = new SoilInspector(host, { onDepth: depth, onWorm: () => false });
    (host.querySelector('[data-action="soil"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="soil-worm"]') as HTMLButtonElement).click();
    expect(host.textContent).toContain('No worm nearby'); expect(depth).not.toHaveBeenCalled();
    const keys = vi.fn(); window.addEventListener('keydown', keys);
    host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(keys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', keys); ui.dispose(); host.remove();
  });
});
