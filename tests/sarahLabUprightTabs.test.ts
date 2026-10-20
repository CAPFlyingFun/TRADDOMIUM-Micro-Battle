// @vitest-environment jsdom
/**
 * The character room held upright (src/sarahlab/uprightTabs.ts; Joshua, 2026-10-20: "tabs or buttons similar to the
 * storm tracker at the bottom"): each control goes to its tab in the order it stands in landscape, the open tab's
 * sheet folds away when its tab is tapped again, and turning back to landscape puts every control exactly where it
 * was -- the approved landscape layout never changes.
 */
import { describe, expect, it } from 'vitest';
import { uprightLayout, uprightTabAction, UPRIGHT_SHEET_ROLE, UPRIGHT_TABBAR_ROLE } from '../src/sarahlab/uprightTabs';

function room() {
  const root = document.createElement('div');
  root.innerHTML = `
    <button data-action="back">BACK</button>
    <div id="poses" data-tab="pose" data-upright-whole style="position:absolute;left:12px;bottom:16px"><button>STAND</button><button>SIT</button></div>
    <div id="panel">
      <div id="bump-l" data-tab="body">BUMP</div><input id="bump" data-tab="body" type="range">
      <div id="arms-l" data-tab="pose">ARMS</div><input id="arms" data-tab="pose" type="range">
      <div id="row"><button id="model" data-tab="body">MODEL</button><button id="outfit" data-tab="clothes">OUTFIT</button><button id="turn" data-tab="camera">TURN</button><button id="bounce" data-tab="pose">BOUNCE</button></div>
      <details id="belly" data-tab="body"><summary>BELLY</summary></details>
      <details id="paint" data-tab="clothes"><summary>TEXTURE</summary></details>
    </div>
    <div id="cam" style="display:none"><button id="zoom" data-tab="camera" data-upright-only>ZOOM</button></div>
    <div id="info">Sarah Lab</div>`;
  document.body.appendChild(root);
  return root;
}
const ids = (el: Element) => [...el.querySelectorAll('[id]')].map((e) => e.id);
const sectionIds = (root: HTMLElement, tab: string) => ids(root.querySelector(`[data-tab-section="${tab}"]`)!);

describe('the character room upright', () => {
  it('sorts the controls into tabs in their landscape order, and puts them all back exactly', () => {
    const root = room(), before = root.innerHTML;
    let changes = 0;
    const layout = uprightLayout(root, () => { changes++; });
    layout.setPortrait(true);
    expect(changes).toBe(1);
    expect(sectionIds(root, 'pose')).toEqual(['poses', 'arms-l', 'arms', 'bounce']);
    expect(sectionIds(root, 'body')).toEqual(['bump-l', 'bump', 'model', 'belly']);
    expect(sectionIds(root, 'clothes')).toEqual(['outfit', 'paint']);
    expect(sectionIds(root, 'camera')).toEqual(['turn', 'zoom']);
    // nothing is placed over her by its landscape position any more
    expect((root.querySelector('#poses') as HTMLElement).style.position).toBe('static');
    expect(root.querySelector(`[data-role="${UPRIGHT_TABBAR_ROLE}"]`)).not.toBeNull();
    layout.setPortrait(true); // repeating changes nothing
    expect(changes).toBe(1);
    layout.setPortrait(false);
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector(`[data-role="${UPRIGHT_SHEET_ROLE}"]`)).toBeNull();
    // and again, both ways
    layout.setPortrait(true); layout.setPortrait(false);
    expect(root.innerHTML).toBe(before);
  });

  it('opens one tab at a time, and folds the sheet away when the open tab is tapped again', () => {
    const root = room(), layout = uprightLayout(root, () => {}, 'body');
    layout.setPortrait(true);
    const sheet = root.querySelector<HTMLElement>(`[data-role="${UPRIGHT_SHEET_ROLE}"]`)!, section = (t: string) => root.querySelector<HTMLElement>(`[data-tab-section="${t}"]`)!;
    expect(layout.open).toBe('body');
    expect(section('body').style.display).toBe('flex');
    expect(section('pose').style.display).toBe('none');
    root.querySelector<HTMLButtonElement>(`[data-action="${uprightTabAction('pose')}"]`)!.click();
    expect(layout.open).toBe('pose');
    expect(section('pose').style.display).toBe('flex');
    expect(section('body').style.display).toBe('none');
    root.querySelector<HTMLButtonElement>(`[data-action="${uprightTabAction('pose')}"]`)!.click();
    expect(layout.open).toBeNull();
    expect(sheet.style.display).toBe('none');
    // a landscape room covers nothing at the bottom
    layout.setPortrait(false);
    expect(layout.covered()).toBe(0);
  });
});
