import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * The commit this build came from.
 *
 * Joshua tests from the deployed Pages build, where the only question
 * that matters is "am I looking at the change we just made, or the one
 * before it?" A semver cannot answer that — a hash can.
 *
 * Not every build has a git checkout to ask (a tarball, a bare CI
 * image), so a missing hash is a normal outcome, not a failure.
 */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

// Relative base so the build works from a GitHub Pages project path.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
