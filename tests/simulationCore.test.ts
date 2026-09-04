/**
 * The import-boundary test (ARCHITECTURE §2.6, §3).
 *
 * Core modules import nothing from `three` and reference nothing of the
 * browser: no DOM, no storage, no network, no frame scheduler. That
 * matters twice over:
 *
 *  - Unit-testability NOW. A module with no DOM in it runs under plain
 *    node with no jsdom and no mocks, so its tests stay cheap enough to
 *    be written for every function rather than only the important ones.
 *  - It is the running definition of WHAT COULD RUN ON A SERVER once
 *    multiplayer authority matters. A module that passes here can be
 *    lifted to a headless authority as it stands; one that fails cannot,
 *    and this test says so the day the reference is added rather than the
 *    day the server is.
 *
 * It reads SOURCE TEXT instead of importing the modules. Importing would
 * need every core module to load in node — the very thing a DOM reference
 * breaks, with a confusing error — and a type-only import of three is
 * erased before runtime yet still means the module describes its state in
 * render terms. Source text catches both. Comments and string literals are
 * stripped first, because every core file's doc comment says what it must
 * not touch.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface CoreEntry {
  /** A directory or a single file, relative to the repo root. */
  readonly path: string;
  /** Must exist and yield files, so the test cannot pass by scanning nothing. */
  readonly required: boolean;
}

/**
 * The core set from ARCHITECTURE §3. `required` marks what exists at the
 * Phase 0 core commit; the rest arrive with their phases and are skipped
 * until then. Adding an entry here is how a module becomes core.
 */
const CORE: readonly CoreEntry[] = [
  { path: 'src/world', required: true },
  { path: 'src/session', required: true },
  { path: 'src/net', required: true },
  { path: 'src/persistence', required: true },
  { path: 'src/app/FrameClock.ts', required: true },
  { path: 'src/app/AppState.ts', required: true },
  // The pure Map that core world/WorldLoader imports: if it ever pulled in a
  // screen, every core module downstream would too.
  { path: 'src/app/registry.ts', required: true },
  { path: 'src/data', required: true },
  { path: 'src/perf/FrameStats.ts', required: true },
  { path: 'src/actor', required: true },
  // The one pure file in input/: the Intent shape actor/ and autonomy/ share.
  { path: 'src/input/Intent.ts', required: true },
  { path: 'src/autonomy', required: false },
];

/**
 * The one declared browser adapter: the only file in persistence/ allowed
 * to touch `window`. Its existence is asserted below so a rename cannot
 * leave a stale exemption that matches nothing.
 */
const EXEMPT: readonly string[] = ['src/persistence/localStorageStore.ts'];

/**
 * Identifiers that mean "the browser". The first row is the brief; the
 * second spells the same §2.6 rule out for the other doors it names — the
 * scheduler's other half, the network, and the storage that is not
 * localStorage.
 */
const FORBIDDEN_GLOBALS: readonly string[] = [
  'document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'fetch', 'requestAnimationFrame',
  'cancelAnimationFrame', 'WebSocket', 'XMLHttpRequest', 'indexedDB',
];

/**
 * A bare identifier only: `foo.window` is a property, not the global, and
 * `ownerDocument` is a different word. Case-sensitive on purpose.
 */
const GLOBAL = new RegExp(`(?<![\\w$.])(?:${FORBIDDEN_GLOBALS.join('|')})(?![\\w$])`, 'g');

/**
 * Build-time constants Vite substitutes textually (`src/env.d.ts`).
 * Neither an import nor a browser global, so the lists above miss them —
 * and core still may not name one. `worker/` imports `src/net/` whole and
 * is type-checked on its own (`npm run relay:typecheck`) against the
 * workers runtime, where no define is substituted and no ambient
 * declaration is loaded: a core file naming `__RELAY_URL__` broke that
 * build and only that build, with typecheck, 505 tests, the app build and
 * four probes all green. A build constant is READ at an edge
 * (`ui/buildInfo.ts`) and handed to core as a parameter.
 */
const FORBIDDEN_DEFINES: readonly string[] = [
  '__RELAY_URL__', '__APP_VERSION__', '__BUILD_COMMIT__', '__BUILD_DATE__',
];

const DEFINE = new RegExp(`(?<![\\w$.])(?:${FORBIDDEN_DEFINES.join('|')})(?![\\w$])`, 'g');

/** `from 'x'`, `import 'x'`, `import('x')`, `require('x')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function isThree(specifier: string): boolean {
  return specifier === 'three' || specifier.startsWith('three/');
}

// ---------------------------------------------------------------------------
// Source scanner
// ---------------------------------------------------------------------------

interface Stripped {
  /** Comments blanked; string literals kept, because import specifiers live in them. */
  readonly withStrings: string;
  /** Comments blanked AND string, template and regex bodies blanked: only code identifiers remain. */
  readonly codeOnly: string;
}

/** Blank every character except newlines, so line numbers survive stripping. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** After one of these a `/` opens a regex literal, because none of them can end an expression. */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/**
 * A scanner, not a parser: it only needs to know where comments, strings,
 * template literals and regex literals begin and end. Template expressions
 * (`${...}`) are scanned as code, recursively, so `${window.innerWidth}`
 * cannot hide inside a template. The one heuristic is the classic one for
 * `/`: it opens a regex when the previous significant token cannot end an
 * expression. A wrong guess there fails loudly (a file is flagged or a
 * self-test below breaks); it does not silently pass anything.
 */
function strip(source: string): Stripped {
  const n = source.length;
  let withStrings = '';
  let codeOnly = '';

  const both = (text: string): void => {
    withStrings += text;
    codeOnly += text;
  };

  const regexOpens = (): boolean => {
    const tail = codeOnly.trimEnd();
    if (tail.length === 0) return true;
    if (REGEX_PRECEDERS.has(tail[tail.length - 1])) return true;
    const word = /([A-Za-z_$][\w$]*)$/.exec(tail);
    return word !== null && REGEX_KEYWORDS.has(word[1]);
  };

  /** Index just past the closing quote, or the newline if the string is unterminated. */
  const quotedEnd = (start: number, quote: string): number => {
    let i = start + 1;
    while (i < n) {
      const c = source[i];
      if (c === '\\') i += 2;
      else if (c === quote) return i + 1;
      else if (c === '\n') return i;
      else i += 1;
    }
    return n;
  };

  /** Index just past the closing `/` (flags are left to the code scanner; they are harmless identifiers). */
  const regexEnd = (start: number): number => {
    let i = start + 1;
    let inClass = false;
    while (i < n) {
      const c = source[i];
      if (c === '\\') i += 2;
      else if (c === '[') {
        inClass = true;
        i += 1;
      } else if (c === ']') {
        inClass = false;
        i += 1;
      } else if (c === '/' && !inClass) return i + 1;
      else if (c === '\n') return i;
      else i += 1;
    }
    return n;
  };

  /** Scan code from `i`; when `inTemplate`, stop AT the `}` that closes the template expression. */
  const code = (start: number, inTemplate: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < n) {
      const c = source[i];
      const next = source[i + 1];
      if (c === '/' && next === '/') {
        const nl = source.indexOf('\n', i);
        const stop = nl === -1 ? n : nl;
        both(blank(source.slice(i, stop)));
        i = stop;
      } else if (c === '/' && next === '*') {
        const close = source.indexOf('*/', i + 2);
        const stop = close === -1 ? n : close + 2;
        both(blank(source.slice(i, stop)));
        i = stop;
      } else if (c === '"' || c === "'") {
        const stop = quotedEnd(i, c);
        withStrings += source.slice(i, stop);
        codeOnly += c + blank(source.slice(i + 1, stop - 1)) + c;
        i = stop;
      } else if (c === '`') {
        i = template(i);
      } else if (c === '/' && regexOpens()) {
        const stop = regexEnd(i);
        withStrings += source.slice(i, stop);
        codeOnly += '/' + blank(source.slice(i + 1, stop - 1)) + '/';
        i = stop;
      } else if (inTemplate && c === '}' && depth === 0) {
        return i;
      } else {
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        both(c);
        i += 1;
      }
    }
    return i;
  };

  /** Scan a template literal from its opening backtick; returns the index past the closing one. */
  const template = (start: number): number => {
    both('`');
    let i = start + 1;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        withStrings += source.slice(i, i + 2);
        codeOnly += blank(source.slice(i, i + 2));
        i += 2;
      } else if (c === '`') {
        both('`');
        return i + 1;
      } else if (c === '$' && source[i + 1] === '{') {
        both('${');
        i = code(i + 2, true);
        if (source[i] === '}') {
          both('}');
          i += 1;
        }
      } else {
        withStrings += c;
        codeOnly += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    }
    return i;
  };

  code(0, false);
  return { withStrings, codeOnly };
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function violationsIn(file: string, source: string): Violation[] {
  const { withStrings, codeOnly } = strip(source);
  const found: Violation[] = [];
  for (const m of withStrings.matchAll(SPECIFIER)) {
    if (isThree(m[2])) found.push({ file, line: lineOf(withStrings, m.index ?? 0), what: `imports '${m[2]}'` });
  }
  for (const m of codeOnly.matchAll(GLOBAL)) {
    found.push({ file, line: lineOf(codeOnly, m.index ?? 0), what: `references ${m[0]}` });
  }
  for (const m of codeOnly.matchAll(DEFINE)) {
    found.push({ file, line: lineOf(codeOnly, m.index ?? 0), what: `names ${m[0]}` });
  }
  return found;
}

function describeViolations(list: readonly Violation[]): string {
  return list.map((v) => `  ${v.file}:${v.line} ${v.what}`).join('\n');
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function tsFilesUnder(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out.sort();
}

const relative = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/');

interface Scan {
  /** Repo-relative paths of every core file that was read, exemptions removed. */
  readonly files: readonly string[];
  /** Files found per CORE entry, so the vacuity check can name the entry that came up empty. */
  readonly byEntry: ReadonlyMap<string, readonly string[]>;
  /** Entries that do not exist yet (later phases). */
  readonly skipped: readonly string[];
}

function scanCore(): Scan {
  const files: string[] = [];
  const byEntry = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const entry of CORE) {
    const abs = path.join(ROOT, entry.path);
    if (!existsSync(abs)) {
      skipped.push(entry.path);
      byEntry.set(entry.path, []);
      continue;
    }
    const found = (statSync(abs).isDirectory() ? tsFilesUnder(abs) : [abs]).map(relative);
    const kept = found.filter((f) => !EXEMPT.includes(f));
    byEntry.set(entry.path, kept);
    files.push(...kept);
  }
  return { files, byEntry, skipped };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('simulation core stays free of three and the browser', () => {
  const scan = scanCore();

  it('actually scans src/world, src/session and the other core entries that exist', () => {
    for (const entry of CORE) {
      const count = scan.byEntry.get(entry.path)?.length ?? 0;
      if (entry.required) {
        expect(count, `${entry.path} yielded no .ts files — the boundary test would pass vacuously`).toBeGreaterThan(0);
      }
    }
    // Later-phase directories may be absent, but only the ones marked so.
    for (const missing of scan.skipped) {
      const entry = CORE.find((e) => e.path === missing);
      expect(entry?.required, `${missing} is required core and is missing`).toBe(false);
    }
    expect(scan.files.length).toBeGreaterThan(0);
  });

  it('keeps the exemption list honest: every exempt file exists', () => {
    for (const file of EXEMPT) {
      expect(existsSync(path.join(ROOT, file)), `${file} is exempt but does not exist; the exemption is stale`).toBe(true);
    }
  });

  it('no core module imports three — not even a type-only import', () => {
    const bad: Violation[] = [];
    for (const file of scan.files) {
      bad.push(...violationsIn(file, readFileSync(path.join(ROOT, file), 'utf8')).filter((v) => v.what.startsWith('imports')));
    }
    expect(bad.length, `core modules importing three:\n${describeViolations(bad)}`).toBe(0);
  });

  it('no core module references the DOM, storage, the network or the frame scheduler', () => {
    const bad: Violation[] = [];
    for (const file of scan.files) {
      bad.push(...violationsIn(file, readFileSync(path.join(ROOT, file), 'utf8')).filter((v) => v.what.startsWith('references')));
    }
    expect(bad.length, `core modules reaching for the browser:\n${describeViolations(bad)}`).toBe(0);
  });

  it('no core module names a build-time constant — the relay compiles core too', () => {
    const bad: Violation[] = [];
    for (const file of scan.files) {
      bad.push(...violationsIn(file, readFileSync(path.join(ROOT, file), 'utf8')).filter((v) => v.what.startsWith('names')));
    }
    expect(bad.length, `core modules naming a vite define:\n${describeViolations(bad)}`).toBe(0);
  });
});

/**
 * The scanner is what stands between a stray `window` and a green test,
 * so its own edge cases are pinned here. A guard with a broken lexer is
 * worse than no guard: it would say "clean" and mean nothing.
 */
describe('the source scanner itself', () => {
  const what = (source: string): string[] => violationsIn('fixture.ts', source).map((v) => v.what);

  it('ignores comments and string literals that merely name the browser', () => {
    const source = [
      '// no window here, and no localStorage either',
      '/* document */ const caption = "fetch it from the window";',
      "const other = 'navigator';",
      'const url = `see the document`;',
    ].join('\n');
    expect(what(source)).toEqual([]);
  });

  it('sees through a template expression', () => {
    expect(what('const w = `width ${window.innerWidth}px`;')).toEqual(['references window']);
    expect(what('const w = `outer ${`inner ${document.title}`}`;')).toEqual(['references document']);
  });

  it('catches type-only imports of three and three subpaths', () => {
    expect(what("import type * as THREE from 'three';")).toEqual(["imports 'three'"]);
    expect(what('import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";')).toEqual([
      "imports 'three/examples/jsm/loaders/GLTFLoader.js'",
    ]);
    expect(what("const mod = await import('three');")).toEqual(["imports 'three'"]);
    expect(what("import { defineStore } from './store';")).toEqual([]);
  });

  it('does not let a regex literal containing a quote swallow the rest of the file', () => {
    const source = ["const q = /['\"]/g;", 'const w = window;'].join('\n');
    expect(what(source)).toEqual(['references window']);
    // And division is still division, not the start of a regex.
    expect(what("const half = total / 2; const s = 'x'; const d = document;")).toEqual(['references document']);
  });

  it('treats property access and longer identifiers as not the global', () => {
    expect(what('const el = host.ownerDocument; const w = frame.window; const f = prefetch;')).toEqual([]);
  });

  it('reports the line the reference is on', () => {
    const source = ['const a = 1;', '// comment', 'const b = fetch;'].join('\n');
    expect(violationsIn('fixture.ts', source)).toEqual([{ file: 'fixture.ts', line: 3, what: 'references fetch' }]);
  });
});
