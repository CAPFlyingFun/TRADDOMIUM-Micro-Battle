/**
 * Every file under scripts/ is wired to a package.json script or listed in
 * scripts/MANUAL.md under "# Manual-only" (ARCHITECTURE §2.12; CLAUDE.md,
 * "Engineering invariants specific to v1").
 *
 * v0 accumulated 29 orphaned probes and nobody could tell which were dead
 * and which were load-bearing. With this test the answer to "is this
 * script alive?" is always in one of two files: package.json says how it
 * runs, or MANUAL.md says it is run by hand and why.
 *
 * Three cheap companions close the loopholes the rule itself leaves open:
 * a wired script that no longer exists is a broken npm command; a
 * manual-only listing for a deleted file is stale; and a file that is both
 * wired and listed as manual-only makes the heading a lie.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = 'scripts';
const MANUAL = 'scripts/MANUAL.md';
const MANUAL_HEADING = /^#{1,6}\s*Manual-only\s*$/i;

/** Repo-relative, forward slashes, so a listing written on any OS matches. */
const relative = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/');

function filesUnder(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(relative(full));
  }
  return out.sort();
}

/** MANUAL.md itself and README-like notes are documentation, not scripts. */
function isDocumentation(rel: string): boolean {
  const base = path.posix.basename(rel);
  return base === 'MANUAL.md' || /^readme.*\.md$/i.test(base);
}

function packageScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this npm script name the file? Matched as a whole path token
 * (optionally `./`-prefixed) so `scripts/probe-boot.mjs` is not satisfied
 * by `scripts/probe-boot.mjs.bak`.
 */
function scriptNames(script: string, rel: string): boolean {
  return new RegExp(`(?:^|[\\s"'=])(?:\\./)?${escapeRegex(rel)}(?=$|[\\s"'&|;])`).test(script);
}

/** Every `scripts/...` path an npm script mentions, so a deleted-but-wired file is caught too. */
function wiredPaths(scripts: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const script of Object.values(scripts)) {
    for (const m of script.matchAll(/(?:^|[\s"'=])(?:\.\/)?(scripts\/[^\s"'&|;]+)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * The allow-list: every `scripts/...` path written anywhere between the
 * "# Manual-only" heading and the next heading. Prose in that section
 * counts, so a path is written there only to allow-list it.
 */
function manualOnly(): string[] {
  const abs = path.join(ROOT, MANUAL);
  if (!existsSync(abs)) throw new Error(`${MANUAL} is missing; it carries the "# Manual-only" allow-list`);
  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = lines.findIndex((line) => MANUAL_HEADING.test(line));
  if (start === -1) throw new Error(`${MANUAL} has no "# Manual-only" heading, so nothing can be allow-listed`);
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#/.test(line)) break;
    section.push(line);
  }
  const listed = new Set(section.join('\n').match(/scripts\/[^\s`'")\]>]+/g) ?? []);
  return [...listed].sort();
}

describe('scripts/ is fully accounted for', () => {
  const scripts = packageScripts();
  const listed = manualOnly();
  const wired = wiredPaths(scripts);
  const files = existsSync(path.join(ROOT, SCRIPTS_DIR)) ? filesUnder(path.join(ROOT, SCRIPTS_DIR)) : [];

  it('has a scripts directory and an allow-list to check', () => {
    expect(files.length, `${SCRIPTS_DIR}/ has no files; the boot probe is expected to live there`).toBeGreaterThan(0);
    expect(existsSync(path.join(ROOT, MANUAL))).toBe(true);
  });

  it('every file is wired to a package.json script or listed under # Manual-only', () => {
    const orphans = files.filter(
      (rel) => !isDocumentation(rel) && !Object.values(scripts).some((s) => scriptNames(s, rel)) && !listed.includes(rel),
    );
    expect(
      orphans.length,
      `not wired to any package.json script and not listed under "# Manual-only" in ${MANUAL}:\n` +
        orphans.map((f) => `  ${f}`).join('\n'),
    ).toBe(0);
  });

  it('every scripts/ path a package.json script names exists', () => {
    const missing = wired.filter((rel) => !existsSync(path.join(ROOT, rel)));
    expect(missing.length, `npm scripts point at files that do not exist:\n${missing.map((f) => `  ${f}`).join('\n')}`).toBe(0);
  });

  it('every # Manual-only listing exists', () => {
    const stale = listed.filter((rel) => !existsSync(path.join(ROOT, rel)));
    expect(stale.length, `${MANUAL} lists files that do not exist:\n${stale.map((f) => `  ${f}`).join('\n')}`).toBe(0);
  });

  it('nothing is both wired and listed as manual-only', () => {
    const both = listed.filter((rel) => Object.values(scripts).some((s) => scriptNames(s, rel)));
    expect(
      both.length,
      `listed under "# Manual-only" but also wired to an npm script (the heading would be lying):\n${both.map((f) => `  ${f}`).join('\n')}`,
    ).toBe(0);
  });
});
