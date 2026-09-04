// @vitest-environment jsdom
/**
 * The boot splash is painted by the DOCUMENT: index.html carries the
 * `<picture>` with its orientation query, the preloads and the PWA
 * links, so the artwork is on screen before any script. The module then
 * fills the hole from behind and, once the menu is up, takes the splash
 * down. Tested against the real index.html, not a copy of its markup.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOT_ID, dismissBootSplash, reportBoot } from '../src/ui/splash/BootSplash';
import { SPLASH_LANDSCAPE, SPLASH_PORTRAIT } from '../src/ui/splash/splashFrame';

// Not `new URL('../index.html', import.meta.url)`: Vite rewrites that form to the
// server origin, and under jsdom it comes back as http://localhost/index.html.
const INDEX = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

/** index.html parsed as a document of its own, so the markup can be inspected and adopted. */
function parsed(): Document {
  return new DOMParser().parseFromString(INDEX, 'text/html');
}

/** Put the real #boot into the test page, as the browser would have it before main.ts runs. */
function mountBoot(): HTMLElement {
  const boot = parsed().getElementById(BOOT_ID);
  if (!boot) throw new Error('index.html has no #boot');
  const adopted = document.importNode(boot, true);
  document.body.appendChild(adopted);
  return adopted;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('index.html paints the splash with the document', () => {
  const doc = parsed();

  it('carries #boot > .stage > picture with the portrait source and the landscape img', () => {
    const boot = doc.getElementById(BOOT_ID);
    const stage = boot?.querySelector('.stage');
    const source = stage?.querySelector('picture > source');
    const img = stage?.querySelector('picture > img');
    expect(stage).not.toBeNull();
    expect(source?.getAttribute('media')).toBe('(orientation: portrait)');
    expect(source?.getAttribute('srcset')).toBe(`./${SPLASH_PORTRAIT.file}`);
    expect(img?.getAttribute('src')).toBe(`./${SPLASH_LANDSCAPE.file}`);
    expect(img?.getAttribute('alt')?.trim().length).toBeGreaterThan(0);
  });

  it('keeps the Phase 0 shell: #app and #ui, in that order, before the splash', () => {
    const ids = [...doc.body.children].map((el) => el.id);
    expect(ids.slice(0, 3)).toEqual(['app', 'ui', BOOT_ID]);
  });

  it('preloads exactly the picture the orientation will show, and links the manifest and the iOS icon', () => {
    const preloads = [...doc.querySelectorAll('link[rel="preload"][as="image"]')].map((l) => ({
      href: l.getAttribute('href'),
      media: l.getAttribute('media'),
    }));
    expect(preloads).toEqual([
      { href: `./${SPLASH_LANDSCAPE.file}`, media: '(orientation: landscape)' },
      { href: `./${SPLASH_PORTRAIT.file}`, media: '(orientation: portrait)' },
    ]);
    expect(doc.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('./manifest.webmanifest');
    expect(doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('./apple-touch-icon.png');
    expect(doc.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes');
  });

  it('styles #boot fixed above the ui layer, with a .gone fade', () => {
    const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/#boot\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/#boot\.gone\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/#boot\s*\{[^}]*transition:\s*opacity/);
    const z = (id: string): number => Number(new RegExp(`#${id}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1] ?? NaN);
    expect(z(BOOT_ID)).toBeGreaterThan(z('ui'));
  });
});

describe('BootSplash', () => {
  it('inserts the fill layers BEHIND the picture and reports a measured fraction with its caption', () => {
    const boot = mountBoot();
    const stage = boot.querySelector<HTMLElement>('.stage');
    if (!stage) throw new Error('no stage');
    reportBoot(0.5, 'Starting');
    const kinds = [...stage.children].map((el) =>
      el.tagName === 'PICTURE' ? 'picture' : el.querySelector('[data-ui="meter-fill"]') ? 'fill' : el.className || 'back',
    );
    // Landscape in jsdom (1024 × 768): cut-out art, so back and fill go before the <picture>.
    expect(kinds.slice(0, 3)).toEqual(['back', 'fill', 'picture']);
    expect(stage.querySelector<HTMLElement>('[data-ui="meter-fill"]')?.style.width).toBe('50%');
    expect(stage.textContent).toContain('Starting');
    // The image kept its place inside the <picture>, so the orientation query still drives it.
    expect(stage.querySelector('picture > img')).not.toBeNull();
    // Pinned to the landscape file for the day it leaves the <picture>.
    expect(stage.querySelector('img')?.getAttribute('src')?.endsWith(SPLASH_LANDSCAPE.file)).toBe(true);
  });

  it('marks the caption lit at 1 and never draws past full', () => {
    const boot = mountBoot();
    reportBoot(1.7, 'Ready');
    const fill = boot.querySelector<HTMLElement>('[data-ui="meter-fill"]');
    expect(fill?.style.width).toBe('100%');
    expect(boot.querySelector('.splash-caption--below')?.classList.contains('splash-caption--lit')).toBe(true);
    reportBoot(0.2, 'Again');
    expect(boot.querySelector('.splash-caption--below')?.classList.contains('splash-caption--lit')).toBe(false);
  });

  it('dismisses by fading (.gone) and removing the element, then ignores further reports', () => {
    vi.useFakeTimers();
    const boot = mountBoot();
    reportBoot(1, 'Ready');
    dismissBootSplash();
    expect(boot.classList.contains('gone')).toBe(true);
    expect(document.getElementById(BOOT_ID)).toBe(boot);
    // A child's transition (the fill's width) must not take the splash down early.
    boot.querySelector('[data-ui="meter-fill"]')?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(document.getElementById(BOOT_ID)).toBe(boot);
    boot.dispatchEvent(new Event('transitionend'));
    expect(document.getElementById(BOOT_ID)).toBeNull();
    // The fallback timer finds nothing left to do, and reporting is a no-op.
    vi.runAllTimers();
    expect(() => reportBoot(0.5, 'late')).not.toThrow();
  });

  it('removes the splash on the fallback timer when no transition event ever comes', () => {
    vi.useFakeTimers();
    const boot = mountBoot();
    dismissBootSplash();
    expect(document.getElementById(BOOT_ID)).toBe(boot);
    vi.advanceTimersByTime(1000);
    expect(document.getElementById(BOOT_ID)).toBeNull();
  });

  it('is a no-op on a page without a splash', () => {
    expect(() => reportBoot(0.5, 'nothing')).not.toThrow();
    expect(() => dismissBootSplash()).not.toThrow();
  });
});
