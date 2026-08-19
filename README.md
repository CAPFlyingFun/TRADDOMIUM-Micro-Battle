# TRADDOMIUM: Micro Battle!

A 3D Battle/Growth Survival Simulator with different game modes, quests,
and gameplay to play.

**Play the current build:**
https://capflyingfun.github.io/TRADDOMIUM-Micro-Battle/

A direct-control ant survival RPG in a huge tiny world, built with
three.js + TypeScript + Vite for the browser (mobile landscape first).

The colony is the persistent home and identity, but the player directly
controls ONE individual ant at a time. Individual ants can die; the
colony and the world continue.

Influences (influence, not copying): Path of Titans (direct creature
control), ARK (living ecosystem, hard stat tradeoffs), Smalland
(ordinary nature as enormous terrain).

## Design source of truth

The Trello board is the living design document:
https://trello.com/b/DoBMcBRT/traddomium-micro-battle

This is a CLEAN REBUILD. Requirements, research, art and lessons from
the earlier implementations are reused; code is written fresh, one
focused development scene at a time, each with an integration gate
before the next layer.

Rebuild order (see "The spine" card): 01 movement, 02 input + camera,
03 six-leg IK, 04 digging, 05 carry, 06 HUD, 07 combat, 08 AI wildlife,
09 colony/nest, 10 hatch/tutorial, 11 polished mini-world.

## Development scenes

Every approved system gets a permanent lab reachable via `?scene=`:

| Scene    | URL              | Covers                                  |
| -------- | ---------------- | --------------------------------------- |
| `island` | `/?scene=island` | 01 movement + 02 input/camera (default) |

## Commands

```
npm install
npm run dev          # local dev server
npm test             # vitest
npm run typecheck    # tsc -b
npm run build        # production build (dist/)
npm run probe:island # headless boot + screenshot (needs a preview server)
```

## Controls

- Desktop: WASD / arrow keys.
- Touch: drag on the left half of the screen for the movement stick.

## Deployment

Every push to `main` runs typecheck, tests and the production build,
then publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). The Vite `base` is relative, so the
build works from the project's Pages subpath.
