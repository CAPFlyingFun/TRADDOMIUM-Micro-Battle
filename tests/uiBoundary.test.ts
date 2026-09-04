/**
 * The typed-hooks convention as a test (ARCHITECTURE §2.7, ui/screen.ts).
 *
 * Reads the source text of every file in src/ui and fails if any of them
 * imports from world/, actor/ or autonomy/, or from session/ other than the
 * `GameSession` TYPE. A screen that reaches past its hooks is exactly how
 * v0's screens became impossible to rewire one at a time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const UI_DIR = fileURLToPath(new URL('../src/ui/', import.meta.url));

interface ImportSite {
  readonly file: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly statement: string;
}

/** `import … from 'x'`, `export … from 'x'` — the clause between the keyword and `from` holds only names and braces. */
const FROM_RE = /\b(import|export)(\s+type)?\s+[\w\s{},*$]*?\bfrom\s*['"]([^'"]+)['"]/g;
/** `import 'x'` — side-effect imports (the stylesheet). */
const BARE_RE = /\bimport\s*['"]([^'"]+)['"]/g;
/** `import('x')` — dynamic imports are imports too. */
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string, source: string): ImportSite[] {
  const sites: ImportSite[] = [];
  for (const m of source.matchAll(FROM_RE)) {
    sites.push({ file, specifier: m[3], typeOnly: m[2] !== undefined, statement: m[0] });
  }
  for (const m of source.matchAll(BARE_RE)) sites.push({ file, specifier: m[1], typeOnly: false, statement: m[0] });
  for (const m of source.matchAll(DYNAMIC_RE)) sites.push({ file, specifier: m[1], typeOnly: false, statement: m[0] });
  return sites;
}

const uiFiles = readdirSync(UI_DIR).filter((f) => f.endsWith('.ts'));
const sites = uiFiles.flatMap((f) => importsOf(f, readFileSync(join(UI_DIR, f), 'utf8')));

const FORBIDDEN_DIRS = /(^|\/)(world|actor|autonomy)(\/|$)/;
const SESSION_DIR = /(^|\/)session(\/|$)/;

describe('ui import boundary', () => {
  it('has screens to check', () => {
    expect(uiFiles).toEqual(
      expect.arrayContaining([
        'screen.ts', 'MainMenuScene.ts', 'SessionPickerScene.ts', 'SettingsScene.ts', 'AboutScene.ts',
        'LoadingScene.ts', 'PauseOverlay.ts', 'ProfileScene.ts',
      ]),
    );
    expect(sites.length).toBeGreaterThan(uiFiles.length);
  });

  it('never imports from world/, actor/ or autonomy/', () => {
    const offenders = sites.filter((s) => FORBIDDEN_DIRS.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });

  it('imports nothing from session/ except the GameSession type', () => {
    const sessionImports = sites.filter((s) => SESSION_DIR.test(s.specifier));
    const offenders = sessionImports.filter((s) => !(s.typeOnly && /\/session\/GameSession$/.test(s.specifier)));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
    // And the type IS used: the picker and the pause overlay hold a session.
    expect(sessionImports.length).toBeGreaterThan(0);
  });

  it('imports the one stylesheet exactly once, from screen.ts', () => {
    const css = sites.filter((s) => s.specifier.endsWith('.css'));
    expect(css.map((s) => `${s.file} → ${s.specifier}`)).toEqual(['screen.ts → ./styles.css']);
  });

  it('reaches the app only through its contracts, never the composition root', () => {
    const app = sites.filter((s) => /\/app\//.test(s.specifier)).map((s) => s.specifier.replace(/^.*\/app\//, ''));
    expect(new Set(app)).toEqual(new Set(['actions', 'Scene', 'registry']));
  });
});
