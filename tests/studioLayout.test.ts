// @vitest-environment jsdom
/**
 * THE CHARACTER ROOM AS A STUDIO (src/sarahlab/studioLayout.ts, studioTheme.ts; Joshua, 2026-10-23: "Use the new UI
 * look, but let's keep both themes like a dark/light color"). Each control goes to its section in the order it was
 * built, keeping its data-action and its handler; one section shows at a time; the open section's rail button folds
 * the inspector and brings it back; turning the phone changes only the CSS; and the theme is one attribute, LIGHT by
 * default, remembered on the device, never throwing when storage does.
 */
import { describe, expect, it, vi } from 'vitest';
import { STUDIO_FOLD_ACTION, STUDIO_ROLE, STUDIO_SECTIONS, studioLayout, studioSectionAction } from '../src/sarahlab/studioLayout';
import { DEFAULT_THEME, STUDIO_THEME_KEY, THEME_TOKENS, readTheme, storeTheme, themeCss } from '../src/sarahlab/studioTheme';

function room() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="panel">
      <div id="bump-l" data-tab="body">BUMP</div><input id="bump" data-tab="body" type="range">
      <div id="row"><button id="model" data-tab="body">MODEL</button><button id="curve" data-tab="body">CURVE</button><button id="outfit" data-tab="outfit">OUTFIT</button><button id="bounce" data-tab="pose">BOUNCE</button></div>
      <details id="belly" data-tab="body"><summary>BELLY</summary><div id="range" data-tab="body">nested</div></details>
      <details id="editor" data-tab="fabric"><summary>EDIT OUTFIT</summary></details>
      <div id="poses" data-tab="pose"><button id="sit">SIT</button></div>
      <div id="loose">not a control</div>
    </div>`;
  document.body.appendChild(root);
  return root;
}
const section = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
const ids = (el: Element) => [...el.querySelectorAll('[id]')].map((e) => e.id);
const click = (root: HTMLElement, action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();

describe('the studio layout', () => {
  it('puts each control in its section, in the order it was built, nested ones staying where they are', () => {
    const root = room();
    studioLayout(root, { changed: () => undefined });
    expect(ids(section(root, 'body'))).toEqual(['bump-l', 'bump', 'model', 'curve', 'belly', 'range']);
    expect(ids(section(root, 'outfit'))).toEqual(['outfit']);
    expect(ids(section(root, 'pose'))).toEqual(['bounce', 'poses', 'sit']);
    expect(ids(section(root, 'fabric'))).toEqual(['editor']);
    // a run of loose buttons shares one wrapping row
    expect(root.querySelector('#model')!.parentElement).toBe(root.querySelector('#curve')!.parentElement);
    expect(root.querySelector('#model')!.parentElement!.className).toBe('sl-row');
    // untagged things are left alone
    expect(root.querySelector('#loose')!.parentElement!.id).toBe('panel');
  });

  it('keeps every handler', () => {
    const root = room();
    const hit = vi.fn();
    root.querySelector('#sit')!.addEventListener('click', hit);
    studioLayout(root, { changed: () => undefined });
    (root.querySelector('#sit') as HTMLButtonElement).click();
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('shows one section at a time, with its title, and a rail button for every section', () => {
    const root = room();
    const layout = studioLayout(root, { changed: () => undefined });
    const rail = root.querySelector(`[data-role="${STUDIO_ROLE.rail}"]`)!;
    expect([...rail.querySelectorAll('button')].map((b) => b.dataset.action)).toEqual(STUDIO_SECTIONS.map((s) => studioSectionAction(s.id)));
    expect(layout.open).toBe('body');
    expect(section(root, 'body').hasAttribute('data-open')).toBe(true);
    click(root, studioSectionAction('pose'));
    expect(layout.open).toBe('pose');
    expect(section(root, 'body').hasAttribute('data-open')).toBe(false);
    expect(section(root, 'pose').hasAttribute('data-open')).toBe(true);
    expect(root.querySelector(`[data-role="${STUDIO_ROLE.title}"]`)!.textContent).toBe('Pose & motion');
    expect(root.querySelector(`[data-action="${studioSectionAction('pose')}"]`)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('folds with the open section\'s button or FOLD, and a section opened unfolds it', () => {
    const root = room();
    const changed = vi.fn();
    const layout = studioLayout(root, { changed });
    click(root, studioSectionAction('body'));
    expect(layout.folded).toBe(true);
    expect(root.hasAttribute('data-folded')).toBe(true);
    click(root, studioSectionAction('body'));
    expect(layout.folded).toBe(false);
    click(root, STUDIO_FOLD_ACTION);
    expect(layout.folded).toBe(true);
    click(root, studioSectionAction('outfit'));
    expect(layout.folded).toBe(false);
    expect(layout.open).toBe('outfit');
    expect(changed).toHaveBeenCalled();
  });

  it('turning the phone changes only the CSS: the controls stay where they are', () => {
    const root = room();
    const layout = studioLayout(root, { changed: () => undefined });
    const before = ids(root);
    layout.setPortrait(true);
    expect(root.dataset.orient).toBe('portrait');
    expect(ids(root)).toEqual(before);
    layout.setPortrait(false);
    expect(root.dataset.orient).toBe('landscape');
    expect(ids(root)).toEqual(before);
  });

  it('a drag on the rail or the inspector never reaches the stage behind', () => {
    const root = room();
    studioLayout(root, { changed: () => undefined });
    const orbit = vi.fn();
    root.addEventListener('pointerdown', orbit);
    for (const role of [STUDIO_ROLE.rail, STUDIO_ROLE.inspector]) root.querySelector(`[data-role="${role}"]`)!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(orbit).not.toHaveBeenCalled();
    root.querySelector(`[data-role="${STUDIO_ROLE.stage}"]`)!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(orbit).toHaveBeenCalledTimes(1);
  });

  it('switches the theme with one attribute', () => {
    const root = room();
    const layout = studioLayout(root, { changed: () => undefined });
    expect(root.dataset.theme).toBe(DEFAULT_THEME);
    layout.setTheme('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(layout.theme).toBe('dark');
  });
});

describe('the themes', () => {
  it('opens LIGHT, the studio\'s look, and gives both themes every token', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(Object.keys(THEME_TOKENS.light).sort()).toEqual(Object.keys(THEME_TOKENS.dark).sort());
    const css = themeCss('.x');
    expect(css).toContain('.x[data-theme="light"]{--sl-ink:#213936');
    expect(css).toContain('.x[data-theme="dark"]{--sl-ink:#e8e2d8');
  });

  it('remembers the choice and never throws when storage does', () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
    expect(readTheme(storage)).toBe('light');
    storeTheme(storage, 'dark');
    expect(kept.get(STUDIO_THEME_KEY)).toBe('dark');
    expect(readTheme(storage)).toBe('dark');
    kept.set(STUDIO_THEME_KEY, 'purple');
    expect(readTheme(storage)).toBe('light');
    const broken = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
    expect(readTheme(broken)).toBe('light');
    expect(() => storeTheme(broken, 'dark')).not.toThrow();
    expect(readTheme(null)).toBe('light');
  });
});
