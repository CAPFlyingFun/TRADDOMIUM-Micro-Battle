/**
 * The v1 web-app manifest: served under /v1/ beside v0 at the site root,
 * so every URL in it is RELATIVE, the home screen shows the game's own
 * name, and every icon it names is a baked file in public/.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Icon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly orientation: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly icons: readonly Icon[];
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8')) as Manifest;
const index = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const MIME: Readonly<Record<string, string>> = { '.png': 'image/png', '.webp': 'image/webp' };

describe('public/manifest.webmanifest', () => {
  it('uses relative start_url and scope, so it works under /v1/ as well as at a root', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('puts the game\'s full name on the home screen, in both places a phone reads it', () => {
    expect(manifest.name).toBe('TRADDOMIUM: Micro Battle!');
    // Android reads short_name for the launcher label; iOS reads its own
    // meta tag and ignores the manifest, so the two must agree or the same
    // install is called two things on two phones.
    expect(manifest.short_name).toBe('TRADDOMIUM');
    expect(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/.exec(index)?.[1]).toBe(manifest.short_name);
    // Ten characters: an iOS home-screen label truncates at about twelve,
    // and a name that ends in an ellipsis is not the name.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    // No initialism: the label is the word a player would say out loud.
    expect(manifest.short_name).not.toMatch(/TMB/);
  });

  it('says which build it is where there is room for it, rather than in the icon label', () => {
    // While v0 serves the site root and v1 serves /v1/, the description is
    // what tells an install listing the two apart.
    expect(manifest.description).toContain('v1');
    expect(manifest.description).toContain('/v1/');
  });

  it('runs standalone in landscape', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('landscape');
  });

  it('takes its colours from index.html', () => {
    const theme = /<meta name="theme-color" content="([^"]+)"/.exec(index)?.[1];
    expect(manifest.theme_color).toBe(theme);
    // The launcher shows background_color until the document paints; it must be the splash's own ground.
    expect(index).toMatch(new RegExp(`#boot\\s*\\{[^}]*background:\\s*${manifest.background_color}`));
  });

  it('names baked icons that exist, with the right type, in any and maskable purposes', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('./')).toBe(true);
      const file = path.join(ROOT, 'public', icon.src.slice(2));
      expect(existsSync(file), `${icon.src} is not in public/ — run npm run bake:art`).toBe(true);
      expect(icon.type).toBe(MIME[path.extname(icon.src)]);
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(existsSync(path.join(ROOT, 'public', 'apple-touch-icon.png'))).toBe(true);
  });
});
