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
deploy `dist/` to GitHub Pages (`.github/workflows/deploy.yml`).

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
