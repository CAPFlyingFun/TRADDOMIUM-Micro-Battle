> **Production entry: hybrid Chapter One.** The normal Pages/PWA URL and existing `/v1/` installs now open the cinematic laboratory. Extras opens the preserved island/advanced systems at `/island/` and archived build at `/legacy/`. All original `src/`, `public/`, worker code and island save keys remain intact.
>
> Install the root dependencies with `npm ci`, then install the hybrid with `pnpm --dir prototype install --frozen-lockfile` (pnpm 11.25.0). `npm run dev` starts the hybrid; `npm run dev:systems` starts the original systems sandbox. `npm run build` still validates/builds that sandbox; `npm run build:hybrid` builds the normal PWA. The deployment workflow builds and assembles all mounts. See [integration notes](prototype/docs/production-integration.md).

# TRADDOMIUM: Micro Battle!

A browser-based direct-control ant survival RPG built with three.js,
TypeScript and Vite, played in mobile landscape. You control one ant
inside a persistent colony on a true-scale, surveyed Kauaʻi; individual
ants can die, the colony continues. This tree is the **v1 clean
rebuild**: it is built from the foundation outward against a written
spec, and good v0 modules are re-added deliberately, phase by phase,
rather than carried across wholesale.

## Run, test, build

```
npm install
npm run dev          # Vite dev server
npm test             # vitest, once
npm run test:watch   # vitest, watching
npm run typecheck    # tsc -b
npm run build        # typecheck + production bundle in dist/
npm run preview      # serve dist/
npm run probe:boot   # Playwright boot probe (scripts/probe-boot.mjs)
```

Pushes to `main` run typecheck, tests and build in GitHub Actions and
deploy to GitHub Pages (`.github/workflows/deploy.yml`). While v1 is
rebuilt the site carries both builds: v0 (from `legacy/v0-main`) at the
root, which is what the installed PWA opens, and v1 under `/v1/`.

## Where the spec is

- `CLAUDE.md` — standing rules and engineering invariants.
- `docs/ARCHITECTURE.md` — the v1 architecture: module map, ownership,
  allowed dependency direction, rebuild phases and the Phase 0
  definition of done.
- `MASTERROADMAP.md` — the long-form product vision.
- `docs/research/` — reference material carried from v0, read-only.

## Where v0 is

The previous implementation is preserved untouched on the branch
`legacy/v0-main`. Read it for measured constants, research and
deployment plumbing (`git show legacy/v0-main:<path>`); do not copy
modules across.
