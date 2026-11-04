/**
 * `?open=<name>` (src/app/openLink.ts): a bookmark straight into an Editors tool. A name opens a tool by its id or the
 * id's last part, in any case; a world tool (it would start a solo game), a panel tool and a link tool never open this
 * way; anything else falls back to the main menu.
 *
 * The character room's old links are index.html's business now (src/app/characterBuilder.ts, Joshua 2026-11-04): its
 * first script sends `?open=CharacterRoom`, `?open=sarah` and `?open=lab.sarah` to the Character Builder's own site
 * before the game loads. That script is run here against a stand-in `location`, so what it does is pinned, not only
 * what it says.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DevTool } from '../src/devtools/DevTool';
import { readFileSync } from 'node:fs';
import { openLinkScene } from '../src/app/openLink';
import { CHARACTER_BUILDER_LINKS, CHARACTER_BUILDER_URL, characterBuilderTool } from '../src/app/characterBuilder';

const tool = (id: string, sceneId?: string): DevTool => ({ id, title: id, description: id, ...(sceneId ? { sceneId } : { open: () => {} }) });
const tools: DevTool[] = [tool('perf-world', 'world:perf'), tool('lab.creatures', 'lab:creatures'), tool('panel.thing'), tool('lab.tombs', 'lab:tombs'), characterBuilderTool];

const HTML = readFileSync('index.html', 'utf8');
/** index.html's first inline script: the one that runs before anything of the game. */
const FIRST_SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];

/** Runs that script against an address; returns where it sent the page, or null when it left it alone. */
function sentTo(search: string, hash = ''): string | null {
  const replace = vi.fn();
  new Function('location', 'URLSearchParams', FIRST_SCRIPT)({ search, hash, replace }, URLSearchParams);
  expect(replace.mock.calls.length).toBeLessThanOrEqual(1);
  return replace.mock.calls.length ? (replace.mock.calls[0][0] as string) : null;
}

describe('?open= links', () => {
  it('opens scene tools by id or its last part, in any case', () => {
    expect(openLinkScene('?open=creatures', tools)).toBe('lab:creatures');
    for (const search of ['?open=tombs', '?open=TOMBS', '?open=lab.tombs', '?open=%20Tombs%20', '?tier=low&open=tombs']) {
      expect(openLinkScene(search, tools), search).toBe('lab:tombs');
    }
  });

  it('never starts a world, opens a panel or a link tool, and falls back to the menu for anything unknown', () => {
    for (const search of ['', '?open=', '?open=perf-world', '?open=thing', '?open=panel.thing', '?open=nowhere', '?tier=low', '?open=character-builder']) {
      expect(openLinkScene(search, tools), search).toBeNull();
    }
  });

  it("the character room's old names open nothing here: the room is not in this build", () => {
    for (const name of CHARACTER_BUILDER_LINKS) expect(openLinkScene(`?open=${name}`, tools), name).toBeNull();
  });
});

describe("the character room's old bookmarks go to the Character Builder", () => {
  it('the first script in the page carries the same names and the same address as characterBuilder.ts', () => {
    expect(HTML.indexOf('<script>')).toBeLessThan(HTML.indexOf('<meta charset'));
    const list = /\[([^\]]*)\]\.indexOf\(open\)/.exec(FIRST_SCRIPT);
    expect(list, 'index.html has its early redirect').not.toBeNull();
    expect(JSON.parse(`[${list![1].replace(/'/g, '"')}]`)).toEqual([...CHARACTER_BUILDER_LINKS]);
    expect(FIRST_SCRIPT).toContain(`'${CHARACTER_BUILDER_URL}'`);
    expect(characterBuilderTool.href).toBe(CHARACTER_BUILDER_URL);
    expect(CHARACTER_BUILDER_URL).toBe('https://capflyingfun.github.io/Custom-Character-Builder-System/');
  });

  it('sends ?open=CharacterRoom, ?open=sarah and ?open=lab.sarah there in any case, carrying the rest of the address', () => {
    for (const search of ['?open=CharacterRoom', '?open=characterroom', '?open=CHARACTERROOM', '?open=sarah', '?open=Sarah', '?open=%20SARAH%20', '?open=lab.sarah']) {
      expect(sentTo(search), search).toBe(CHARACTER_BUILDER_URL);
    }
    expect(sentTo('?open=CharacterRoom&skin=ktx2')).toBe(`${CHARACTER_BUILDER_URL}?skin=ktx2`);
    expect(sentTo('?tier=low&open=sarah&skin=ktx2', '#look')).toBe(`${CHARACTER_BUILDER_URL}?tier=low&skin=ktx2#look`);
  });

  it('leaves every other address alone', () => {
    for (const search of ['', '?open=', '?open=tombs', '?open=character-builder', '?tier=low', '?open=sarahlab', '?sarah=1']) {
      expect(sentTo(search), search).toBeNull();
    }
  });
});
