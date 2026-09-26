/**
 * THE GAME IS LANDSCAPE ONLY, AND THE GATE THAT SAYS SO CANNOT BE A SCENE.
 *
 * Joshua, 2026-09-26: "Let's force landscape only like Beyond Extinction
 * has, as it would play better since it's not a tap to move." Movement is
 * a stick under a thumb; held upright there is nowhere for the thumbs and
 * the 3D camera frames a wall, because three keeps a fixed VERTICAL field
 * of view and a narrow viewport therefore shows LESS of the room.
 *
 * There is no API for this. iOS Safari does not implement Screen
 * Orientation Lock at all, and elsewhere `lock()` requires fullscreen. So
 * it is a prompt, and the prompt lives in the STATIC DOCUMENT: no scene,
 * no component, no script. That is what these assertions are really
 * protecting — a gate that hides the entire game must not be able to get
 * stuck up, or down, by a bug in the thing it is hiding.
 *
 * Read as TEXT rather than rendered, because the point is where it lives.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = readFileSync(`${ROOT}index.html`, 'utf8');
const MANIFEST = JSON.parse(readFileSync(`${ROOT}public/manifest.webmanifest`, 'utf8')) as Record<string, unknown>;
const MAIN = readFileSync(`${ROOT}src/main.ts`, 'utf8');

describe('landscape only', () => {
  it('ships the gate in the static document, not in a scene', () => {
    expect(HTML).toContain('id="orient"');
    // After #boot, so it covers the splash as well as the game.
    expect(HTML.indexOf('id="orient"')).toBeGreaterThan(HTML.indexOf('id="boot"'));
    // And before the module that would otherwise have to put it there.
    expect(HTML.indexOf('id="orient"')).toBeLessThan(HTML.indexOf('src="/src/main.ts"'));
  });

  it('shows it on a PHONE held upright and nowhere else', () => {
    const rule = /@media \(orientation: portrait\) and \(pointer: coarse\) \{/;
    expect(HTML, 'the gate must be keyed on portrait AND a coarse pointer').toMatch(rule);
    // `pointer: coarse` is what keeps it off a narrow desktop window,
    // where a tall viewport is a resized window and not a turned phone.
    const query = HTML.slice(HTML.search(rule));
    expect(query.slice(0, 400)).toContain('#orient');
  });

  it('hides the game behind it rather than stacking on top of a live screen', () => {
    // A gate the player can reach past is not a gate. Everything the app
    // owns goes `visibility: hidden` inside the same query.
    const query = HTML.slice(HTML.search(/@media \(orientation: portrait\) and \(pointer: coarse\)/));
    const block = query.slice(0, 1400);
    for (const id of ['#app', '#ui', '#boot']) expect(block, id).toContain(id);
    expect(block).toContain('visibility: hidden');
  });

  it('asks an installed app for landscape too, which is the half that IS an API', () => {
    expect(MANIFEST.orientation).toBe('landscape');
  });

  it('re-asserts the viewport when the phone turns', () => {
    // iOS Safari can stay laid out at the previous orientation's width
    // after a rotation — and this game now asks every phone player to
    // rotate, so that turn is on the main path rather than at the edge.
    expect(MAIN).toContain("addEventListener('orientationchange'");
    expect(MAIN).toContain("meta[name=\"viewport\"]");
  });

  it('says what it is for, in words a player can act on', () => {
    const gate = HTML.slice(HTML.indexOf('id="orient"'), HTML.indexOf('src="/src/main.ts"'));
    expect(gate).toMatch(/sideways|rotate|turn/i);
    expect(gate).toMatch(/landscape/i);
    // An alertdialog, so a screen reader announces it rather than
    // reading the hidden game behind it.
    expect(gate).toContain('role="alertdialog"');
  });
});
