# Water System Audit

**Repository:** CAPFlyingFun/traddomium-micro-battle
**Audit date:** 2026-08-30
**Tree audited:** `39337fd` (v0.0.117 — src/ and tests/ byte-identical to `54e0961`, v0.0.111)
**Method:** read-only multi-agent audit — six independent auditors (freshwater, ocean, fresh/ocean boundary, regression history, flight/vertical placement, ocean-damage forensics), 40 raw findings merged to 16, each merged finding attacked by three adversarial verification lenses (mechanism / history / symptom), then a completeness critique. 56 agents, 0 errors, no code modified.
**Verdict vocabulary used throughout:** **CONFIRMED** (survived all three adversarial lenses), **LIKELY** (survived with material corrections), **POSSIBLE** (mechanism real, reach into the symptom unproven), **DISPROVEN** (a lens refuted it, or the audit ruled it out with evidence).

---

## 1. Executive Summary

**Confirmed root cause of the inland "underneath the water" symptoms (F1, CRITICAL):**
The rendered fresh surface and every gameplay/physics answer are built on **two different grounds**. The drawn fresh skin stands on `groundHeight` sampled at **100-unit cell corners** and linearly interpolated (`IslandWater.ts:294` → `:380`), while the float seat, flight floor, camera envelope and underwater tint all use `groundHeight` at the **exact 8-unit drawn terrain triangle**. Measured over a real order-5 valley (20,736 samples): the drawn bed stands **more than FOOTING (0.4) above the true ground at 32% of points, +2.03 at p95, +6.19 worst** (and −1.22 at p05). Valleys are concave-up, so the 100-unit chord systematically overestimates the floor *exactly where rivers live*. Wherever the error exceeds ~+0.15, the drawn skin is above the Queen's back while every internal check correctly says she is floating on top. **This error exists byte-for-byte at v0.0.90** — "good at 90" means *unprovoked*, not fault-free. It was progressively exposed by v0.0.91 (near-camera alpha ×1.9), v0.0.104/109 (generated/live sea arming the ungated breaker), and fully by v0.0.113 (alpha feather 1.5 → 0.02, painting the whole misdrawn rim for the first time).

**Highest-confidence bugs (all CONFIRMED, detailed in §4–§7):** the bed-lattice disagreement (F1); the touchdown hand-off snap (~10–12 units in one frame, F2); the invisible-but-afloat band (swims at 0.4, first drawn pixel ~1.9, F3); the ungated Pacific breaker block on fresh water plus the never-rebuilt fresh wave table (F4); the flux/depth current singularity (hundreds–thousands cm/s on films, F5); and the elimination proof that **the ocean pipeline itself is numerically identical v0.0.111 → v0.0.116** (F6).

**Is the v0.0.117 / v0.0.111 baseline internally sound?** Structurally yes — the solid list (§14) verifies the solver, the query plug, wading, placement, the one-sea-clock invariant, origin rebasing and the live-feed lifecycle as correct. But it ships **four known latent faults**: F1 (bed lattice), F3 (invisible-afloat band — "stops short of visibly entering the water"), F4 (ocean breaker foam marching across inland pools), and F5 (absurd inland currents). These were all present at v0.0.90.

**Is the ocean currently known-good?** **Yes, at the code level.** `seaSwell.ts` and `surf.ts` have *zero diff* across the entire 111→116 window; the v0.0.112 `ocean` gating was proven value-identical GLSL for both ocean sheets. Whatever was seen as "the ocean got messed up" on 112–116 was one or more of: the v112 camera dive-release collapse (F9 — the only at-sea camera-feel change alive on *all* five builds), the v114/116 salt float-exit retune (F10), the v113/116 beach film (F16), or (misattribution) inland pools *losing* their ocean foam by design. One unexamined non-code vector remains: the deployed Pages build itself (§17, gap 8).

**Is inland water currently known-good?** **No.** It is v0.0.111's inland water, restored deliberately, with F1/F3/F4/F5 live.

**Still requires device verification:** (a) the actual relief dial on Joshua's device (`×{relief}` in the fix line — several findings are dormant only at relief = 1, and `?fix=` links silently rewrite the setting); (b) whether symptomatic sessions ran the bare URL or `?sea=` (the breaker blowout and stale-table mechanisms need `?sea=`); (c) live weather at test time (rain feeds every film); (d) whether the perceived ocean damage was visual, camera-feel, or how the Queen rode the swash.

---

## 2. Versions / Known Reference Points

| Version | Commit | What it represents | Why it matters |
|---|---|---|---|
| v0.0.90 | `69da284` | **KNOWN GOOD** inland-water device behaviour | Forensic anchor. Every latent freshwater fault already exists here byte-for-byte with HEAD: the 100-unit bed lattice, the 1.5/8 feather vs FOOTING 0.4, the flux/depth current, DRAWN=1.5, and the ungated swell breaker block (introduced v0.0.88, `5cf3a99`). "Good" = unprovoked. |
| v0.0.99 | `3c4d106` | Ocean look **ACCEPTED** ("absolutely stunning") | Protected baseline for ocean visuals. |
| v0.0.100 | `70f8aeb` | Sea gains a horizontal current (`surf.ts`) | The **only** `IslandWater.ts` diff between v90 and v111 is this salt-branch hunk. |
| v0.0.101 | `6e2305d` | Camera water floor becomes an **envelope**; tint moves onto a clock | The enabling condition for every "screen under the water" report — the lens is *allowed* under a surface from here on. |
| v0.0.102–110 | Stage A–F + camera work | NDBC parser, wave generator, swappable table (`?sea=`), depth-limited breaking, spectral camera, live NOAA, crest-distribution framing | v0.0.104 moves amplitudes into a uniform bound by **every** water material, fresh included; v0.0.109 lets the live buoy set the amplitudes the fresh sheet's ungated breaker reads. |
| v0.0.111 | `54e0961` | **Playable ocean baseline**; afloat = ordinary chase camera | The restored state. Its inland faults are inherited, not introduced. |
| v0.0.112 | `231d6e5` | *(reverted)* `ocean` flag in waterLook; fresh gameplay current zeroed; dive camera on raw lever | Gating idea correct and **proven harmless to the ocean shader**; the dive-release rewiring is the top candidate for perceived at-sea damage (F9). |
| v0.0.113 | `6ce28dc` | *(reverted)* fresh feather 1.5/8 → 0.02/0.4; visual flow zeroed; toFixed(3) | **Prime suspect** for "floats a few seconds then underneath": painted the pre-existing bed error at full alpha (F1 exposure). |
| v0.0.114 | `5f7b2d9` | *(reverted)* float exit 0.85×FOOTING → DRAUGHT | Correct fix for a real traced drain fault — but ungated, so it retuned **sea swash** too (F10). |
| v0.0.115 | `c50f124` | *(reverted)* feather back to 1.5/8 + audit instruments | Device got **worse** (underneath while *flying*) — the range's most diagnostic fact: nothing in 115 touches flight (`flight.ts` last changed v0.0.95), so the flying failure indicts the **drawing**, not thresholds. |
| v0.0.116 | `8c9dfcb` | *(reverted)* back to 114 behaviour + instruments | Names the water-mesh resolution problem; flying clue left open. |
| v0.0.117 | `39337fd` | **Current.** Full revert to v0.0.111 (src+tests byte-identical, version bump only) | Restores v111's known inland faults deliberately, in exchange for the accepted ocean. |

---

## 3. Current Water Architecture

```
                 LAND                    FRESH WATER                        OCEAN
        ┌──────────────────┐   ┌─────────────────────────────┐   ┌─────────────────────────────┐
        │ heightfield.ts   │   │ IslandWater.ts              │   │ seaSwell.ts  (wave table,   │
        │  terrainHeight   │──►│  WaterSim (waterSim.ts)     │   │  ONE clock, shoaling,       │
        │  groundHeight    │   │  256×100-unit window        │   │  SWELL_AMP_UNIFORM)         │
        │  (8-unit drawn   │   │  follow/recentre @6,400     │   │ surf.ts (orbital + surge)   │
        │   triangle,      │   │  shiftWater / resample      │   │ liveSea.ts / SeaService /   │
        │   reliefScale)   │   │  base = groundHeight @100u  │   │  ndbcFeed (NOAA 51208,      │
        └────────┬─────────┘   │  drawn y = base + d·relief  │   │  behind ?sea= only)         │
                 │             │  spotAt: bilinear·relief    │   │ Ocean.ts (near+far sheets,  │
                 │             │  depthAt: probe-only ⚠      │   │  render ONLY, no physics)   │
                 │             └──────────────┬──────────────┘   └──────────────┬──────────────┘
                 │                            │ fresh branch                    │ g < 0 branch
                 │             ┌──────────────▼─────────────────────────────────▼──────────────┐
                 └────────────►│              waterQuery.ts — THE ONE MUTABLE PLUG             │
                               │   installed by IslandWater's constructor (:209) — BOTH        │
                               │   branches; dispose() nulls it (ocean gameplay dies too) ⚠    │
                               │   WaterSpot { depth, flowX, flowZ, salt? }                    │
                               └──────────────────────────┬────────────────────────────────────┘
              ┌───────────────┬───────────────┬───────────┼──────────────┬─────────────────────┐
              ▼               ▼               ▼           ▼              ▼                     ▼
        wading.ts        flight floor    FollowCamera   Underwater.ts   HUD (AWL/DEPTH,    goTo/fix,
        wadeAt:125       IslandScene     keepAbove-     surfaceAt:68    column hook :724)  LND sample
        FOOTING 0.4      trueFloor:1313  Ground:471     submersion      wading():712       :2215/:2318
        DRAUGHT 0.15     holdFloor ease  (camera x/z)   (camera x/z,    (gameplay chain)
        sticky 0.85      SURFACE_        sea-beat       sea-beat
        (ONE rule for    MARGIN=12       envelope ⚠     clocks ⚠
        both waters)     clamp :1337     since v101     since v101/106

        SHARED MATERIAL: waterLook.ts — one factory for fresh AND ocean.
        At v0.0.111 the fragment shader of EVERY water sheet (fresh included) compiles
        swellUniformChunk (:285) + the swell-driven breaker block (:446, swellChunk at :464)
        from the LIVE ocean wave table ⚠ — vertex swell displacement is correctly gated
        (opts.swell, ocean near sheet only). stepSea/rebuildOcean rebuild ONLY the ocean
        on a table change; the fresh material's baked table goes stale ⚠ (dev-flag only).
        Globals: SWELL_AMP_UNIFORM (seaSwell), FOAM_LOD_UNIFORM, LOD_* uniforms (lodShader).

        FRAME ORDER (IslandScene.tick): flight-floor read :1313 / wadeAt :1423  →  rebase +
        reground :1643-48  →  water.follow/update :1709-10  →  ocean.update (tickSwell) :1712
        →  stepSea :1716  →  follow.update :1755  →  underwater.update :1774  →  render :1800.
        Placement reads LAST frame's sea clock; camera/tint/render read THIS frame's (F14).
```

**NOAA/live sea:** `ndbcFeed` → `SeaService` (cache/TTL/fallback — proven unable to flatten or step the sea) → `liveSea` (4-minute equal-power crossfade, `setSwellPeak` seam) → `setWaveTable` → `stepSea` rebuilds the Ocean. **Entirely behind `?sea=`** — the bare URL installs the fixed two-wave table explicitly and never contacts NOAA.

---

## 4. Freshwater Audit

### F1 — Drawn fresh surface stands on 100-unit-lattice ground; every query stands on exact 8-unit ground — **CONFIRMED · CRITICAL · existed at v0.0.90 · explains the inland symptoms**
- **Where:** `IslandWater.ts` `resample()` :294 (`base[cy*N+cx] = groundHeight` at 100-unit corners), `update()` :380 (`pos[i*3+1] = base[i] + d*relief`) — versus `spotAt()` :406–425 consumed by `wadeAt` (`wading.ts:128-139`), `PlayerAnt.settle` (:422–436), flight `trueFloor` (`IslandScene.ts:1313-1338`), `FollowCamera.keepAboveGround`, `Underwater.surfaceAt` (:68).
- **Mechanism:** drawn skin = bilerp-over-100-unit-quads of corner `groundHeight` + depth; every gameplay question = exact-triangle `groundHeight` + depth. The difference is pure lattice-vs-exact ground error: **+0.4 or more at 32% of valley points, +2.03 p95, +6.19 worst, −1.22 p05** (20,736 samples). Wherever it exceeds ~+0.15 the drawn skin covers a Queen who is *correctly* floating on top. No code path at HEAD reads the drawn triangle back (`drawnSurfaceAt` existed only in reverted c50f124, as an instrument).
- **Exposure chain:** hidden at v90/111 by the 1.5 feather for the shallow rim (pools deeper than ~1.5 show it regardless); f85b7d0 (v91) ×1.9 near alpha; 6ce28dc (v113) 0.02 feather painted the whole rim → immediately followed by the v114/115 reports.
- **Verifier corrections (important):** (1) The flight sub-claim is bounded: the un-damped clamp `holdFloor = max(holdFloor, trueFloor + 12 − flight.height)` (:1337) keeps her rendered Y ≥ queried surface + ~12 in margin-respecting flight, and 12 > 6.19 — so at *measured* magnitudes her **body** cannot render under the drawn film mid-flight; the v115 flying symptom reaches through (a) the **camera** (CLEARANCE = 1.6 lets the lens fly under a sheet misdrawn +2..+6 with the tint keyed to the queried surface and never firing), (b) sub-100-unit drainage slots the corner samples can miss entirely (error > 12 — hypothesised, unmeasured), or (c) the landing hand-off (F2). (2) The feather cannot explain the 114→115 *worsening* (115 restored 1.5/8); over pools deeper than ~1.5 the core error shows under either feather. (3) A second-order term exists: mesh tri-lerps depth, `spotAt` bilerps it — sign-varying, also at v90.

### F3 — Invisible-but-afloat band: swims at 0.4, fresh skin invisible below ~1.9, fully drawn at 8 — **CONFIRMED · HIGH · existed at v0.0.90**
- **Where:** `waterLook.ts:295` (`edge = smoothstep(edgeLo, edgeHi, depth)`), :586 (`a *= edge`), :593 (discard < 0.01); opts `IslandWater.ts:234` (1.5/8); vs `FOOTING = 0.4` (`wading.ts:41`), afloat test :128.
- **Mechanism:** the depth attribute is RAW sim depth (:379). She is declared afloat — paddle gait, pace 0.22, 0.85 of the current — at 0.4, while the first pixel to survive the discard needs **~1.9–2.0** (verifiers sharpened the finding's 1.6–1.7; perceptible alpha ~0.05 needs ~2.3). On a 5% bank that is ~30 units of invisible swimming before any water renders, ~150 before it reads solid; on a 1% pool margin, hundreds. This *is* "stopping short of visibly entering/riding the inland water" — she is slowed then carried on visually dry ground while the HUD honestly reports millimetre depths. v113's 0.02/0.4 change targeted exactly this gap (its comment ties HI to FOOTING) and was reverted with everything else.
- **Latent extra:** at relief ≠ 1 the shader feathers raw depth while the query returns `raw × reliefScale()` — a second drawn/queried divergence, dormant at the default dial.

### F5 — Fresh current is raw flux/depth with a 0.5 mm floor and no cap — **CONFIRMED · HIGH · existed at v0.0.90**
- **Where:** `waterSim.ts` `velocity()` :265–273 (`face = cell·max(depth, dryDepth=0.05)`, flux/(2·face)); scaling step :204–212 lets a cell empty in one dt; consumers `spotAt` (:424–425, **nearest-cell** velocity whenever bilinear depth > 0), `wadeAt` carry (0.85 afloat / 0.4·sunk), shader flow attribute (advects all ripple octaves at ×11.1).
- **Mechanism:** one solver step on a median 11.5° Kauaʻi slope over a 1.5 mm film yields **~1,327 units/s**; an independent numeric port measured a film settling at 0.4 mm reporting a steady **4,000 units/s**. Against her drive of 7–12, even 0.4 of that pins or flings her at the shoreline; the skin visibly streams at the same number. This is the 368 cm/s and >1000 cm/s device readings. The `dryDepth` floor only prevents the depth→0 singularity, not supercritical speeds. Live again at HEAD (v112's zeroing reverted).

### F7 — `shiftWater()` carries depth but not the pipe fluxes — **CONFIRMED · MEDIUM · existed at v0.0.90 · intermittent**
- **Where:** `IslandWater.ts:272-284` (copies only `sim.depth`; `fl/fr/ft/fb` private, no reset API); `resample()` swaps the bed under them.
- **Mechanism:** every 6,400-unit recentre leaves damped momentum attributed to cells 6,400 units away (~4 s decay at damping 0.995). Verifiers narrowed the scope: stale flux at **dry** new cells is zeroed within one 0.02 s step by the scaling clamp — the phantom survives only where old-wet maps onto new-wet (e.g. flying up a river's own valley); at ~70 u/s recentres are ≥ ~91 s apart vs a 1–5 s window, so roughly **1 arrival in 20** lands inside it. A conditional arrival-moment contributor to current spikes (measured 167 cm/s + slosh on a pool, ~1,700 cm/s on a film) — not the repeatable stopping-short cause and not any vertical symptom.

### F13 — Water ground caches frozen between recentres; the "dial reaches the water" comment is orphaned — **CONFIRMED · HIGH · existed at v0.0.90 (comment false since v0.0.42)**
- **Where:** `reshapeIsland()` `IslandScene.ts:1046-1057` ends on "THE DIAL REACHES THE WATER, explicitly" with **no water call** (the `lakes?.place()`/`streams?.place()` that once followed died at `f2c821d`, v0.0.42, and IslandWater was born at v0.0.67 already beneath the orphaned comment); `onHdTile` → `terrain.rebuild()` only (:635); goTo auto-relief `setSetting('terrainRelief', fix.relief)` :2207-2209.
- **Mechanism:** three triggers move the real ground instantly with no water refresh until the next 6,400-unit recentre / ocean re-anchor: (1) an **HD tile landing mid-window** — precisely what flying into new territory does — leaves the fresh sheet drawn and simmed on the old bed, popping on the next recentre; (2) the **relief dial** (probes trigger it via fix-restore without touching a slider) — the queried depth tracks the dial instantly, the drawn base doesn't; (3) **re-smoothing**. For pure relief changes the ocean's shoreline *position* is scale-invariant (bands mis-size); HD tiles genuinely move the stored shoreline. The critique adds: HD tile **eviction** (>9 held) is a fourth trigger, and `groundHeight` *is* HD-residency-dependent — so the ocean near-sheet's anchored `-groundHeight` snapshot also goes stale on arrival/eviction near shore.

### F16 — v113/114/116's 0.02/0.4 feather painted mm films at shallow-water alpha on the **beach** — **CONFIRMED · MEDIUM · appeared 6ce28dc · reverted**
- The alpha feather is the fresh sheet's *only* visibility gate (`DRAWN=1.5` feeds a stats counter; the stand-down only covers `base < 0`). Beach cells (`base ≥ 0`) carry mm rain film in weather and real water at river mouths; on 113/114/116 a 4 mm film drew at the full shallow-water opacity (0.63) in the green fresh palette with a hard 4 mm waterline, **deterministically occluding** the ocean's feathered edge (fresh polygonOffset −6, depth-write, earlier renderOrder). The coastline is where a player judges "the ocean" — a plausible reading of the damage report, needing rain or an estuary in frame (hence MEDIUM). Only on builds 113/114/116 (112/115 shipped 1.5/8). Re-application guidance: lowering the feather requires the fresh sheet to **also stand down on the beach strip**, and requires `toFixed(3)` (at `toFixed(1)`, 0.02 silently emits 0.0).

**Freshwater items verified correct:** see §14 — solver `step()` correct vs the PG'07 model; `spotAt` lattice alignment; sub-stepping; world-fixed watercourses; no frame-order gap in fresh placement; `shiftWater` index math.

---

## 5. Ocean Audit

### F6 — Forensic elimination: the ocean pipeline is numerically identical v0.0.111 → v0.0.116 — **CONFIRMED · HIGH**
- `seaSwell.ts` and `surf.ts`: **zero diff** at every commit in the window (not just the endpoints — no broken-then-reverted intermediate state exists). `waterQuery.ts`, `liveSea.ts`, `waterSim.ts`, `Underwater.ts`: zero diff. `Ocean.ts`: only `ocean: true` plus comments; **both** sheets get the flag via the shared skin spread. `waterLook.ts`: the gating reproduces the pre-112 content exactly for `ocean:true`, and `toFixed(3)` emits `35.000/95.000` = `35.0/95.0` (the ocean's constants are integers). `package-lock`: version strings only — no dependency changed. **Every device build 112–116 ran a v111-identical ocean shader and physics.**
- Therefore the perceived ocean damage can only be: (a) **F9** — v112 camera dive-release collapse (the only at-sea camera change alive on *all five* builds); (b) **F10** — v114/116 salt float-exit retune (builds 114/116 only); (c) **F16** — beach film (builds 113/114/116 only); (d) misattribution — inland pools *losing* Pacific foam by design. Weighted by build coverage, (a) and (d) are the only mechanisms live on every damaged build. Re-application **must not "fix" Ocean/seaSwell/surf** — there is nothing there to fix.

### Core invariant — ONE AUTHORITATIVE PHYSICAL SEA: **HOLDS** (verified, §14)
- **One clock:** `tickSwell` called from exactly one place (`Ocean.update`, `Ocean.ts:246`); both sheets' `uTime` set from its return in the same statement; every CPU query (height, orbital, surf, camera, underwater) reads the same module clock; `refreshAmplitudes` once per tick. `restartSwellClock` only at scene init, *before* the sea is chosen; Ocean's constructor clears only the lattice, so the Stage F mid-blend rebuild cannot phase-jump; `resetSwell` has no callers in src.
- **CPU = GPU:** `swellChunk`/`shoalChunk` vs `rawSwell`/`shoalAt` are the same maths from the same table; amplitudes flow through the one shared `SWELL_AMP_UNIFORM`; Green's law, swash smoothstep, `SHOAL_CAP`, softMin(n=4) and the KEEL clamp are formula-identical.
- **Lattice contract:** only the near sheet registers; per-vertex depth is `-groundHeight` at the same points the CPU corner-sampler evaluates; re-anchoring keeps her ~2.1k units from centre, far inside the 6,000-unit rim fade — GPU rim flattening never touches a point gameplay can ask about. *(Caveat from the critique: `groundHeight` is HD-tile-residency-dependent, so the anchored snapshot can go stale on tile arrival/eviction near shore until re-anchor — the one correction to this solid.)*
- **Live feed:** refused/timed-out/malformed/partial/MM/met-station replies keep the last valid observation; version bumps only on genuinely new observations; cache age-gated; **a failed poll can neither flatten nor step the sea**. Bare URL: `stepSea` returns immediately, NOAA never contacted, fixed table explicitly installed.
- **Crossfades:** blend joins at zero incoming amplitude, retires at zero outgoing — both rebuild moments amplitude-continuous; ocean rebuilt on every shape change; `setSwellPeak` crossfades the breaking-envelope denominator.
- **Units/coordinates:** `energyAmplitude = Hs/(2√2)` (not Hs/2); APD ≤ DPD clamp; MWD FROM→toward via named +180 wrap; ω scale-invariant across the SI→cm conversion; compass `dirX=sin/dirZ=−cos` matches `seaSwell.wave`; `vWorld = vLocal + uCentre` reproduces world coordinates across rebases.

### F14 — Frame order: placement reads last frame's sea clock; the `stepSea` "before anything reads the water" comment is false — **CONFIRMED · HIGH · one-dt lag exists at v0.0.90 · NOT the regression**
- `wadeAt` :1423 and the flight-floor read :1313 run *before* `ocean.update`/`tickSwell` :1712; camera :1755, tint :1774 and render use the post-tick clock — she floats **one dt behind the drawn wave**, bounded by ΣA·ω·dt ≈ 98.7·dt (≤1.65 units at 60 fps; ~5–10 at 10–20 fps; capped ~9.9 by the 0.1 s dt clamp). Salt water only (fresh has no clock term); zero-mean; identical at v90 — a fidelity defect, worst on a struggling phone, not a regression. The comment (:1713–1715, arrived d7b0441) is false as written, but the table-swap frames are height-continuous by construction and `?sea=`-only. Adjacent, also CONFIRMED: the CPU chord sampler bilerps the four lattice corners while the GPU rasterises two planar triangles — they agree at vertices/edges, differ by the twist term mid-quad (worst ~4.9 units mid-cell, typically 1–2 phase-averaged) — "agree to the millimetre" holds only at vertices.

---

## 6. Fresh/Ocean Boundary Audit

### F4 — The Pacific's breaker/wash foam block runs UNGATED on the fresh sheet; the fresh material's baked wave table is never rebuilt — **CONFIRMED · HIGH · block ungated since v0.0.88 · armed by v104/v109**
- **Where:** `waterLook.ts` fragment breaker block :445–528 — `swellChunk()` at :464 (global sum of the ocean's travelling sines at the pond's world position — no shoal, no distance-to-sea), crest normalised by the **compile-time** `swellReach()/2` literal (:467), shallow gate fully open under 60 units of column (:471), foam alpha to 0.95 (:565). `swellUniformChunk` emitted for **every** wearer (:285), `bindSwellUniforms` unconditional (:240). `IslandWater.ts:234` passes no ocean flag — `WaterLookOpts` has none at HEAD. Vertex swell displacement **is** gated (`opts.swell`) — this is a paint/opacity fault only; pool geometry never heaves.
- **Effect at HEAD (bare URL):** with the shipped table the fresh look's band is `smoothstep(48, 4.5, depth)` — strongest at pool depths — and `face = smoothstep(0.15, 0.8, crest)` saturates regularly on the ~1.5 s beat: **marching breaker fronts across inland pools, heading 245°, phase speed ~237 cm/s.** With `?sea=` the generated/live sea raised reach 48 → ~210 ("inland water started reading like open ocean" — v112's own diagnosis).
- **Stale-table half (dev-flag only):** `stepSea` rebuilds only the Ocean; the fresh program keeps its baked wavenumbers/frequencies/headings and declared `uWaveAmp[oldN]` while `setWaveTable` replaces `SWELL_AMP_UNIFORM.value` wholesale — after the first buoy blend the pond's foam runs generation-B amplitudes against generation-A's baked components (a "phantom table") for the rest of the session. `customProgramCacheKey` (:218) carries no wave-table term. *(Verifier correction: a clean `?sea=` boot bakes the generated table consistently — the mismatch begins at the first mid-session swap.)*
- **v0.0.112's `ocean` flag, judged as an idea: architecturally correct** — told-not-inferred classification, matching gate pairs, cache-key token — and **proven not to have damaged the ocean** (F6). Re-derive it cleanly; don't restore the commit wholesale.

### F12 — Fresh water runs on open-Pacific tint and camera clocks — **CONFIRMED · HIGH · appeared v0.0.101/106 · magnitudes exploded under `?sea=`**
- `Underwater` splash/settle = 0.37/1.15 × `swellPeriod()` (:233–244); camera envelope beats/reach from `swellPeriod()`/`swellReach()` (`FollowCamera.ts:473-474`), hard drowned line at `surface − 1.45×swellReach()` (:512). `WaterSpot.salt` **is delivered but never read** by either consumer. Shipped table: splash 0.54 s, settle 1.70 s, fresh drowned line 70.2 units. Generated sea (`?sea=`): splash **~2.2 s**, full **~6.8 s**, drowned line **~304 units** below a pond's surface — deeper than any pool, so only the slow velocity lift ever raises a sunken lens. Every non-deliberate submersion shorter than the clock renders as **clear air** — the presentation layer that makes F2/F8/F11's transients invisible *and* (with F1) lets a lens sit under the drawn sheet with zero tint indefinitely (that geometry path involves no clock at all). A pond has no swell; sizing its patience in sea beats is a category error. At v0.0.90 the tint engaged immediately on depth and the camera had no water envelope — part of why v90 "behaved correctly".

### Ownership / lifecycle (from the boundary lane, all verified)
- **One plug, sound:** `waterQuery.ts` byte-identical since v90; one registration point (IslandWater ctor :209); all consumers handle null; no competing installer. **But** the freshwater class owns both branches and `dispose()` (:446) removes the *ocean's* gameplay too — an inversion, not a live bug at HEAD (water is built once per scene).
- **Salt classification agrees everywhere:** set in exactly one place (`ground < 0`); wadeAt drinkable/salt, canDrink, brine, swimEffort's multiplier, holdFloor ease pick and the HUD all read that one flag; the boundary cannot move with the relief dial (sign-preserving).
- **Camera floor and tint cannot disagree with each other** (same surface, same x/z, ordered correctly); rebase reseats terrain+water+ocean in-frame from world centres, y never rebased; ocean rebuild ordering correct (stepSea after ocean.update; dispose-first recompile; lattice re-registered in the same call); no program-cache collision at HEAD or in the 112–116 window.
- **`reliefScale` arithmetic is internally consistent** across query/wading/HUD/drawn-depth — the stale-**base** problem (F13) is about *when* base is sampled, not the arithmetic.

---

## 7. Flight / Water Interaction Audit

**Device symptom:** while FLYING toward inland water from a distance, the water can initially appear correct and then the Queen suddenly ends up underneath it before landing (reported on the v0.0.115 build).

**Decisive negative result first:** `flight.ts` last changed at v0.0.95; the holdFloor design predates v0.0.90; **nothing in 112–116 touched any flight code.** The flying failure therefore indicts the drawing/camera, not the flight model. Also DISPROVEN: the flight floor does *not* use raw `depthAt` — `trueFloor` is built from `waterSpotAt` (bilinear, relief-scaled, ocean-aware) at :1313; `depthAt` feeds probes only (F15).

**Mechanisms that survived verification, ranked by fit to the symptom:**

1. **F1 via the CAMERA (the strongest surviving story).** The clamp keeps her *body* ≥ queried + ~12 while flying (12 > 6.19 worst measured error), but `FollowCamera` CLEARANCE = 1.6 lets the **lens** fly under a fresh sheet misdrawn +2..+6 — and the tint keys off the *queried* surface (`Underwater.surfaceAt`), so it never fires. The screen fills with water above the camera; the player reports "she went underneath it while flying." Enabled by v0.0.101 (lens allowed under surfaces) — an enabling condition, not a 112–116 change.
2. **F2 — Touchdown hand-off snap. CONFIRMED, existed at v0.0.90.** She never flies the last ~12 units: in msl mode every clamp-driven floor rise converts to clearance loss (`flight.ts:797-800`), so descent bottoms ~8.3 above the queried surface and `land()` fires at ~+10; the next frame `wadeAt` seats her at queried − 0.15 — a **single-frame ~10–12 unit drop with no visible landing**, ending under the drawn film wherever the bed error is positive, with `overHer` = 0.15 < 1.0 so no tint. Numeric replay reproduced frame-for-frame by two independent verifiers (min Y = T+8.33; drop 10.15; takeoff mirror pop 12.15). The involuntary-msl-auto-land at a pool's queried margin can fire it *before* she reaches the visible water. Explains the *shape* of the report; cannot alone explain 115-worse-than-111 (byte-identical since v90).
3. **Critique gap 5 — the transition-tier chord (UNMEASURED, prime candidate for "looked correct at a distance").** The water window spans ±12,800 but the 8-unit near terrain mesh covers only ±2,048; beyond that the *drawn ground* is the 312.5-unit-step transition tier while `groundHeight` reproduces the near lattice only. Nearly all of the *visible-at-distance* fresh sheet is judged against terrain drawn on a ~3× coarser chord, and the relationship **changes as near cells stream in on approach** — never traced; measure before further fixes.
4. **F8 — Hard-dive margin defeat. CONFIRMED (narrowed).** The clamp reads *last* frame's clearance; the integration then subtracts up to ~10 units/frame after ~4 s of full lever — the final 1–2 frames of a committed dive render at queried+2 down to queried+0 (worse at low fps), under the drawn film in p95-tail spots, while `aloft` is still true. A ≤~100 ms flash at the water, not "some distance away"; byte-identical since v90.
5. **F11 — `reground()` drops the water column on every floating-origin rebase. CONFIRMED (conditional).** `PlayerAnt.reground` :166–169 re-seats her preserving `above` but passing `base = 0` (the fly path's water column, `settle` 4th param, is lost — the sibling `above` bug was fixed for "THE FLASH EVERY SEVEN SECONDS"; `base` never was; pinned to v0.0.83 `1392900`). Tick order rebase→render means the dropped position IS the rendered frame, camera copying her translation same-frame. She renders below the surface only when the column exceeds her clearance (low approach over a deep pool); one frame per 4096 units of travel *when over water*; no tint (clock). Restored next frame.
6. **F7 (stale recentre flux) and F13 (HD tile landing mid-flight)** contribute at exactly the arrival moment: currents spike as she lands (1-in-20 arrivals), and the fresh sheet sits on a pre-HD bed precisely when flying into new territory — with the recentre `resample()` (3×65,536 lookups + a 65k sort, synchronous) and per-tile `terrain.rebuild()` landing on the same frames, lengthening dt exactly when F8 needs it (critique gap 6, unmeasured).
7. **F14 (one-dt sea lag)** — salt only; adds up to ~10 units of seat-vs-wave skew on a struggling device; pre-existing.

**Window-following itself is sound for flight** (§14): RECENTRE=6,400 is half the half-span; she cannot out-fly the query into a null region at any reachable speed; `shiftWater` cannot invent depth; the sea-before-fresh branch order prevents the rain-film-replaces-ocean floor bug; inland pool *geometry* never heaves (vertex swell gated). Cells **entering** the window arrive empty and refill from baseflow over seconds — flagged by the critique as an untraced candidate clock for "floats a few seconds, then…".

---

## 8. Regression History (v0.0.90 → v0.0.117, water-relevant)

| Ver | Commit | Subsystem | Could explain? | What changed / blast radius |
|---|---|---|---|---|
| 90 | `69da284` | camera | no | KNOWN GOOD baseline. Every latent freshwater fault already here byte-for-byte (100-unit lattice, 1.5/8 vs FOOTING, flux/depth current, DRAWN=1.5, ungated breaker from v0.0.88 `5cf3a99`). |
| 91 | `f85b7d0` | shared | no | Viewing-distance opacity ×1.9 by 250 units, before the feather. Exposure step: makes near shallow water (and anything under it) read. |
| 92 | `5c9bf67` | terrain | no | Relief normalised to 2 cm — `groundRelief.ts` shading only; `heightfield.ts` untouched. |
| 93 | `7e872f9` | terrain | no | Relief behind `#ifdef` + cache key; zero geometry change. |
| 94 | `03773bd` | terrain | no | LITE/base/full diagnostics; identical triangles verified. *Diagnosed* the drawn-attr-interpolation fault class (ocean hatch) without fixing it. |
| 95 | `1eb535a` | flight | no | Air-speed ladder + takeoff ramp. **Last change to `flight.ts` in the whole range.** |
| 96 | `2d7bfe8` | ocean | no | Foam LOD knees; foam tiling off degraded vWorld. Uncovered (not created) depth-attr terracing. |
| 97 | `c49f7fe` | other | no | Master LOD core; zero visual change; terrain tiers untouched. |
| 98 | `accc110` | other | no | LOD probes/overlay; TerrainStream diff exports a constant only. |
| 99 | `3c4d106` | ocean | no | Foam gated in the micro sphere. **Ocean look ACCEPTED.** |
| 100 | `70f8aeb` | ocean | maybe | Salt branch gains `surfFlowAt` current; camera floor asks at its own x/z. **The only IslandWater 90→111 diff.** Sea-side only. |
| 101 | `6e2305d` | camera | maybe | Water surface becomes an **envelope** — the lens is allowed under water; tint moves onto a clock. Enabling condition for every "screen under the water" report. |
| 102–103 | `02084d7`,`7222a5f` | ocean | no | Stage A/B: parser + generator, zero consumers in the bundle. |
| 104 | `71479eb` | shared | **yes** | Stage C: swappable table behind `?sea=`; **amplitudes move to a uniform bound by every water material including fresh** — arms the v0.0.88 breaker block (reach 48 → ~210 when active). |
| 105 | `7db07cf` | ocean | no | Stage D: depth-limited breaking (can only lower the surface); accepted into the 111 baseline. |
| 106–108, 110 | — | camera | no | Stage E + framing experiments; superseded and removed by 111 (`waterQuery` ends byte-identical to 90). |
| 109 | `d7b0441` | ocean | maybe | Stage F: live NDBC behind `?sea=`; the buoy's Hs now sets the amplitudes the fresh breaker reads; the false "before anything reads the water" comment arrives. Bare URL makes no requests. |
| 111 | `54e0961` | camera | maybe | Afloat = ordinary chase camera. **The restored state.** Inland faults all inherited; the 111-era symptom reports fit the latent set. |
| 112 | `231d6e5` | shared | maybe | *(reverted)* ocean flag (proven harmless to the ocean shader — both sheets flagged); fresh gameplay current zeroed (skin still advected); **dive camera on raw lever, release band 0.55→0.30, sunkFor zeroed** — the only at-sea camera change alive on all of 112–116. |
| 113 | `6ce28dc` | freshwater | **yes** | *(reverted)* Feather 1.5/8 → 0.02/0.4; flowAttr zeroed; toFixed(3). **Prime suspect for "floats then underneath"** — painted the F1 bed error at full alpha; also drew still opaque films near the coast. |
| 114 | `5f7b2d9` | shared | **yes** | *(reverted)* Float exit → DRAUGHT, from a real traced drain fault — but one rule for all water: **changed how she rides sea swash** (its own commit message says so). Top candidate if the "ocean damage" was behavioural. |
| 115 | `c50f124` | freshwater | maybe | *(reverted)* Reverts feather + wading to 90 code; adds instruments; quantifies the bed error. **Device got WORSE — the flying clue** — nothing in 115 touches flight, so the drawing/camera is indicted. |
| 116 | `8c9dfcb` | freshwater | maybe | *(reverted)* Back to 114 behaviour + instruments; names the water-mesh resolution problem. |
| 117 | `39337fd` | shared | no | Full revert to 111 (empty src/tests diff), version bump only. Deliberately restores 111's known inland faults. |

**Ranked suspects (history lane):**
1. `6ce28dc` (v113) — for the inland "underneath" on 114/116 (feather exposure of F1 + still coastal films).
2. `5f7b2d9` (v114) — for behavioural ocean damage on 114/116 (salt swash retune, F10).
3. `71479eb` (v104) + `d7b0441` (v109) — for "Pacific breakers on inland pools" at 111 (armed the pre-90 ungated block).
4. `231d6e5` (v112) — for ocean *feel* on all of 112–116 (dive-release collapse, F9); its shader gating is **exonerated**.
5. **NO COMMIT** — for "stopping short", the 1.5 mm HUD depth and the 368 cm/s current: latent pre-90 faults surfacing under more inland play (the 90→111 range changed nothing on the fresh path).
6. `6e2305d` (v101) — enabling condition for every "screen under the water" report.

---

## 9. Verification Results

Every merged finding was attacked by three independent adversarial lenses, each instructed to refute it: **mechanism** (does the code do what is claimed, line by line), **history** (does the v0.0.90/appearance claim hold in git), **symptom** (do magnitudes and timings actually reach the observed device behaviour). **48 verdicts: 0 refutations.** All 16 findings are CONFIRMED at the mechanism level; the lenses' corrections narrowed *reach* claims. Disagreements are preserved below rather than collapsed.

**F1 (bed lattice) — the flight-leg sub-claim:**
- *Finding as merged:* the queen "renders UNDER a sheet drawn up to +6.19 too high" in flight.
- *Mechanism & history lenses:* refuted **that sentence** (not the finding): the un-damped SURFACE_MARGIN=12 clamp keeps her body ≥ queried+~12, and 12 > 6.19 — margin-respecting flight cannot put *her* under the film at measured magnitudes.
- *Symptom lens:* same arithmetic; identified the surviving routes — the camera (CLEARANCE 1.6 + query-keyed tint), sub-cell drainage slots (error > 12, unmeasured), and the landing hand-off.
- *Adjudication:* **CONFIRMED for the v114 float-then-underneath symptom; PLAUSIBLE (via camera / narrow slots / hand-off) for the v115 flying symptom.** Confidence: high.
- *Also noted:* the 20,736-sample measurement corroborates via reverted c50f124's commit message rather than being independently re-derived; the exposure narrative cannot explain 114→115 worsening (115 restored the old feather).

**F2 (touchdown snap) — explainsSymptom:**
- *History lens:* "yes" → **"partly"** — byte-identical since v0.0.90 (device-good), so it explains the *shape* of the entry (invisible one-frame teleport, no tint) but not why 115 was worse than 111. Also: only applies in the default `msl` hold mode; the replayed minimum is ~8.3 above, not 12. *Adjudication:* CONFIRMED defect; partial symptom reach.

**F4 (ungated breaker) — scope:**
- *All three lenses:* the crest-vs-baked-denominator quadruple-saturation ("~95–105 against 24.2") happens only on a **mid-session** table swap, not a clean `?sea=` boot (onBeforeCompile runs after `useProceduralSea`); the reach-210 blowout and stale-table mechanism are `?sea=`-only; the bare-URL ungated breaker (marching foam on ponds) fires regardless, as it already did at v90. f85b7d0's role is brightening the non-foam skin (foam was already at cap). *Adjudication:* CONFIRMED; symptom = yes for "breakers on pools" at 111, no for the 114/115 underneath symptoms (the gate was in force on those builds).

**F6 (ocean elimination) — precision:**
- "Byte-equivalent GLSL" → **numerically identical** (35.000 vs 35.0 differ textually from v113 on; one cache-key recompile of identical source). Candidates re-weighted by build coverage: only the v112 camera change and the by-design pond-foam loss are live on **all** damaged builds. *Adjudication:* CONFIRMED.

**F7 (stale recentre flux) / F8 (dive margin) / F11 (rebase drop) — reach narrowed by the symptom lens:** intermittent/transient contributors (1-in-20 arrivals; ≤100 ms flash needing a 4 s full-lever dive; one conditional frame per 4,096 units) — real defects, none can carry a *persistent* underneath state. All existed at v90.

**F12 (sea clocks on fresh) — conditionality:** the lurid magnitudes (2.2 s / 6.8 s / 304 units) hold under `?sea=`; the bare URL still runs sea clocks on swell-less ponds at 0.54 s / 1.70 s / 70 units. Era commits indicate the generated sea WAS active in symptomatic sessions. "Presentation layer of every report" overstates: the F1 geometry path needs no clock at all. Salt is *delivered but unread*, not undelivered.

**F14 (frame order) — explainsSymptom:** symptom lens downgraded maybe → **no** for the device timeline (byte-identical across 90–116; zero-mean; salt-only). Kept as a real background fidelity defect.

**F15 (probe hook) — attribution:** the "~1.5 mm HUD depth" reading came through the *gameplay* chain (`this.wet` via wadeAt), not `depthAt`; what stands is that probe scripts (`probe-swim.mjs:32,63`, `probe-islandwater.mjs:30`) measured the `depthAt` surface while the device HUD measured the `spotAt` surface — device-vs-probe comparisons in the 111–113 era mixed two different depths. `depthAt`'s docstring ("for wading and drinking") is stale and part of the trap.

**F3, F5, F9, F10, F13, F16:** confirmed with only sharpening corrections (first visible pixel ~1.9 not 1.6; theoretical transport ceiling 2,500–5,000 u/s; v112 collapse needs a ≥30% throw held ~0.25–0.5 s, not a literal single-frame tap; the F16 "z-fight" is actually a deterministic occlusion; the F13 archaeology dates to v0.0.42, not a migration).

---

## 10. Confirmed Findings (ranked)

**CRITICAL**
- **F1** Drawn-vs-queried ground disagreement (100-unit bed lattice) — the root of the inland underneath symptoms. Pre-v90.

**HIGH**
- **F2** Touchdown hand-off snap (~10–12 units, one frame, no tint). Pre-v90.
- **F3** Invisible-but-afloat band (afloat at 0.4; first pixel ~1.9; solid at 8) — "stopping short". Pre-v90.
- **F4** Ungated Pacific breaker block on fresh water + fresh material never rebuilt on table change. Block pre-v90 (v0.0.88); armed by v104/v109.
- **F5** Flux/depth current singularity (hundreds–thousands cm/s on films; believed by wading, drawn by the shader). Pre-v90.
- **F6** Ocean pipeline numerically identical 111→116 (elimination; re-application must not touch Ocean/seaSwell/surf).
- **F9** v112 dive-release collapse of the sea camera (raw lever, 0.30 cliff, sunkFor discard, 6/s drain). 112–116 only; reverted.
- **F10** v114/116 FLOAT_EXIT=DRAUGHT applied to salt water (swash float behaviour changed). 114/116 only; reverted.
- **F12** Sea-beat tint/camera clocks applied to fresh water (salt delivered but unread). v101/106; magnitudes explode under `?sea=`.
- **F13** Water ground caches frozen vs instant terrain changes (HD tiles, relief dial, smoothing; orphaned "dial reaches the water" comment since v0.0.42).
- **F14** One-dt sea-clock lag in placement + false stepSea invariant comment (+ bilinear-vs-triangle mid-quad skew ≤~4.9). Pre-v90 / v109.
- **F15** `__island.waterDepth` probe hook measures a different surface (nearest-cell, unscaled, no ocean branch) — the probe-passes/device-fails class in one line. Pre-v90.

**MEDIUM**
- **F7** shiftWater carries depth but not pipe fluxes (conditional arrival-moment phantom currents). Pre-v90.
- **F8** Hard-dive margin defeat (1–2 frame airborne flash at/below queried+2). Pre-v90.
- **F11** reground() drops the water column on rebase (one conditional rendered frame per 4,096 units). v0.0.83.
- **F16** Beach film at full alpha over the ocean waterline on 113/114/116 (needs rain/estuary in frame).

**LOW / background:** the F14 spatial twist term; F3's relief-dependent shader-band divergence (dormant at dial 1); F15's stale docstring.

---

## 11. Disproven / Rejected Hypotheses

Recorded so future agents do not repeat these loops. Each was actively investigated and ruled out with evidence.

1. **"v0.0.112's ocean-flag gating damaged the ocean shader" — DISPROVEN.** The ocean:true emitted GLSL was normalised and diffed: comments and the cache-key token only; both ocean sheets received the flag via the shared skin spread; constants value-identical under toFixed(3). The gating idea is exonerated and architecturally correct (F6, boundary solid).
2. **"The flight floor uses raw nearest-cell depth (`depthAt`)" — DISPROVEN.** `trueFloor` is built from `waterSpotAt` (bilinear, relief-scaled, ocean-aware) at `IslandScene.ts:1313`; `depthAt` feeds the probe hook only (F15). This fear shaped part of the investigation and is false at HEAD *and* at v90.
3. **"The underwater tint can engage while she is aloft over fresh water" — DISPROVEN** (except the one-frame F11 rebase drop, far too short for the splash clock): the SURFACE_MARGIN clamp holds her ≥ queried+12 and camera elevation is clamped 10–80° above her, putting the lens ≥ queried+12.6; Underwater converts through `originAt` correctly.
4. **"The float/wading thresholds explain the v115 flying symptom" — DISPROVEN.** Nothing in 112–116 touched any flight code (`flight.ts` last changed v0.0.95; holdFloor pre-range); v115 itself restored the v90 wading code and the device got worse. The thresholds are also byte-identical v90↔HEAD.
5. **"The hydrology is broken / not updating" — DISPROVEN.** `waterSim.step()` is byte-identical to v90 and correct against the pipe model (acceleration, K-scaling, mass move, soak, rim drain all verified); under steady baseflow the field reaches a fixed point. The v114 drain-drop trace was real but its rule ran identically in good v90 — a latent interaction, not a solver fault.
6. **"A frame-order gap or floating-origin gap in fresh placement" — DISPROVEN.** Wade-sample → settle → rebase+reground+camera+water.place all in-frame; `place()` re-seats every frame even on the early-return path; the only staleness is one frame of sim feed (~0.04–0.07 units). Rebase cannot move any water surface (y never rebased); the one exception is F11's `base` drop.
7. **"A shader program-cache collision between fresh and ocean" — DISPROVEN** at HEAD and across 112–116: the wearers' keys always differ on existing numeric fields; makeWaterLook has no cache of its own.
8. **"The live NOAA feed can flatten or step the sea" — DISPROVEN.** Every failure mode keeps the last valid observation; blends are amplitude-continuous; the bare URL never contacts NOAA and explicitly installs the fixed table.
9. **"The Stage F mid-blend Ocean rebuild can jump the swell phase" — DISPROVEN.** Ocean's constructor clears only the lattice; the clock restarts only at scene init, before the sea is chosen; `resetSwell` has no callers in src.
10. **"She can out-fly the water window into a null region" — DISPROVEN.** RECENTRE=6,400 is half the half-span; `spotAt` answers everywhere she can reach at any speed.
11. **"Inland pool geometry heaves with the swell" — DISPROVEN.** The vertex swell displacement is gated on `opts.swell`, which the fresh material never passes — F4 is paint/opacity only.
12. **"v0.0.113's feather change was simply wrong" — REJECTED as stated.** It targeted a real, confirmed gap (F3) and its diagnosis was correct; it failed because it exposed F1 (painting water on a bed known only to ±2–6 units). The order of operations was wrong, not the analysis. Symmetrically, **"v0.0.115's revert-to-known-good was safe" — REJECTED**: restoring the old feather made the device worse, proving the feather was never the root.
13. **"The camera alone explains everything" — REJECTED.** The camera (v101 envelope, F9, F12) is an amplifier and presentation layer; the geometric disagreement (F1) and the gameplay singularities (F3, F5) are independent, body-level faults.

---

## 12. Architecture Coupling / Blast Radius

Direction summary: **ocean→fresh coupling is live data flow** (wave table + uniform read by the fresh fragment shader); **fresh→ocean coupling is shared source** (one material factory, one query closure, one wading rule). Both directions fired during 112–116.

| Setting / function | Fresh affected? | Ocean affected? | Should affect both? | Risk if changed |
|---|---|---|---|---|
| `FOOTING` (0.4), `DRAUGHT` (0.15) — `wading.ts` | yes | yes | **yes** (her biology) | Medium: float line on every shore incl. swash |
| `FOOTING_STICKY` / float exit | yes | yes | debatable — **label it**; v114 proved the salt side is easy to forget | **High** (unlabeled both-water surface; bit us) |
| `WADE_PACE`/`PADDLE_PACE`, carry fractions, `SWIM_DRAIN`/`DIVE_DRAIN` | yes | yes | yes (sea surcharge correctly layered in `brine.ts`) | Low |
| Fresh feather `edgeLo/edgeHi` (per-call opts) | yes | no | fresh-only ✅ | Low for the constants — the risk is edits to the **shared emission code** around them (v113's toFixed proved the path) |
| `swellChunk`/`shoalChunk`/`swellUniformChunk`/`SWELL_AMP_UNIFORM` | **yes (F4 bug)** | yes | **ocean-only** | **High** — the live leak |
| `swellPeriod()`/`swellReach()` as clock/scale | **yes (F12 bug)** — tint + camera envelope | yes | ocean-only for pacing | **High** |
| `surfFlowAt` / `seaOrbitalAt` | no | yes | ocean-only ✅ (but invoked from the fresh-owned closure) | Medium |
| `WaterSim` soak / `BASEFLOW` / `STORM_PER_MM` | yes | no | fresh-only ✅ | Low |
| `waterSim.velocity()` (flux/depth) | yes (F5) | no | fresh-only | High until replaced by a real stream model |
| Camera envelope constants (`FollowCamera`) | yes | yes | yes — the camera treats water as water | Medium (F9 showed a retune reads as "ocean damage") |
| `Underwater` splash/settle clocks | yes (F12) | yes | should be **per-kind** | Medium |
| `SURFACE_MARGIN`, holdFloor easing | yes | yes | yes (one flight) | Medium (F2/F8 live here) |
| `reliefScale()` | yes | yes (+ terrain) | shared by necessity | **High** multiplier — F13/F15 dormant-at-1 faults wake with the dial |
| `depthAt` probe hook | probes only | probes wrong offshore | n/a | Medium: silently validates the wrong surface (F15) |
| `IslandWater.dispose()` | yes | **yes — removes ocean gameplay** | should be fresh-only | Latent (water built once per scene today) |
| `Ocean.ts` / `seaSwell.ts` / `surf.ts` internals | no | yes | ocean-only ✅ (proven: zero fresh reach) | Protected (§14) |

---

## 13. Recommended Fix Order

Smallest safe sequence. Each step is independently verifiable and none reopens the accepted ocean.

**Step 0 — Device facts first (no code).** Confirm on the phone: the fix line's `×{relief}` (is the dial 1?), whether symptomatic sessions used `?sea=`, and what the "ocean damage" actually was (visual / camera-feel / how she rode the swash). These choose between otherwise-identical fixes.

### A. Actual bug fixes (in order)

1. **A1 — Re-land the `ocean` material gate as a single-purpose commit** (kills F4: pond breakers + phantom-table; the v112 idea, exonerated by F6). Prove it with an emitted-GLSL byte-diff for `ocean:true` before/after, and a fresh-shader byte-stability test across table swaps. Include `toFixed(3)` only with its reason documented. **Touch nothing else in the commit.**
2. **A2 — Still fresh water, both halves at once** (kills F5): zero the fresh *gameplay* flow (v112's `spotAt` change) and the fresh *visual* flow attribute (v113's `update()` change) in one commit, gated to the fresh branch only. The solver keeps running (it decides where water is).
3. **A3 — Re-land the float-exit drain fix gated on `!salt`** (keeps v114's genuinely correct inland fix, removes F10's sea side-effect). The v114 trace stands: soak drains 3 mm/s and the old exit seats her under standing water.
4. **A4 — Fix the two one-frame vertical snaps:** `reground()` passes the stored `base` (F11 — one argument), and the touchdown hand-off eases the ~10-unit seat change over a few frames or lands her at the drawn-consistent height (F2); re-check F8's post-update clamp while there (clamp against post-integration height, or clamp `above` itself).
5. **A5 — The root: make the drawn fresh surface and the queried surface agree** (F1). This is the water-mesh resolution problem — a bed that agrees with `groundHeight` at her scale near her (finer local tessellation, or drawing the near skin on query-consistent ground) — **it is its own piece of work, not a constant.** Only *after* it lands may the feather come down (A6). Measure first: the critique's gap-5 transition-tier chord and gap-4 boot-time coarse-bed additions to the error budget.
6. **A6 — Lower the fresh feather to meet FOOTING** (F3 — v113's correct goal), now safe, **with** the beach stand-down F16 requires and `toFixed(3)`.
7. **A7 — Salt-aware presentation clocks** (F12): `Underwater` and the camera envelope read `spot.salt` (already delivered) and use still-water pacing inland.
8. **A8 — Dive-camera intent, second attempt** (F9's guidance): keep the intent plumbing; no one-frame cliff at 30% throw (keep easing or a higher HI); don't zero `sunkFor` on sub-full intent.

### B. Architecture cleanup (after A1–A4, before or alongside A5)

1. Extract the **water router** out of `IslandWater`'s constructor; `oceanAt()` owned by the ocean side; `dispose()` stops un-registering the sea.
2. `WaterSpot.salt?: boolean` → required **`kind: 'fresh' | 'sea'`**.
3. **Blast-radius guard tests:** pinned ocean emitted-GLSL + ocean query fixtures (any fresh-side edit that moves the ocean fails loudly) and the fresh mirror; `BOTH WATERS` labels on every wading constant.
4. Restore the orphaned invariant: `reshapeIsland`/`resmoothIsland`/HD-tile arrival trigger a water `resample()` + ocean re-anchor (F13); clear or carry pipe fluxes in `shiftWater()` (F7).
5. Fix or delete `depthAt`'s probe hook (F15): route `__island.waterDepth` through `waterSpotAt` (the correct `column()` hook already exists), and fix the stale docstring.

### C. Future polish (measure first, no urgency)

- One-dt placement/render sea-clock skew (F14) — reorder or accept; document the false comment either way.
- Transition-tier vs near-mesh drawn-ground agreement at distance (critique gap 5).
- Recentre `resample()` cost / dt spikes (gap 6); baseflow refill time for cells entering the window (gap 4).
- Probe route (`?scene=island` vs bare-URL GameFlow) and probe weather environment (gaps 3, 7).
- Deployment forensics for 112–116 if the ocean report resists all code explanations (gap 8).

---

## 14. Things NOT To Change

The audit verified the following as **correct**. Do not reopen them without new evidence — in particular, do not "fix" the ocean while re-applying inland work.

**Protected outright (zero diff 111→116, invariant proven):**
- `src/world/seaSwell.ts`, `src/world/surf.ts`, `src/world/Ocean.ts` internals — one clock (single `tickSwell` call site), CPU/GPU formula identity, lattice contract, amplitude-continuous crossfades, `clearSwellLattice`-not-clock in the constructor, zero-callers `resetSwell`.
- `src/weather/SeaService.ts` / `ndbcFeed.ts` / `ndbc.ts` / `seaState.ts` / `waveField.ts` — failure-proof feed lifecycle, defensive unit-correct parsing, honest statistics (Hs/(2√2), APD≤DPD, FROM→toward, deterministic seeding, normalised energy budget).
- `stepSea`/`rebuildOcean` discipline (poll → rebuild on shape change → re-anchor in the same call; dispose-first recompile).
- Floating-origin handling across the water boundary (world-coordinate uniforms, per-frame `place()`, y never rebased).

**Correct at HEAD (byte-identical to v0.0.90; the faults are elsewhere):**
- `src/world/waterSim.ts` `step()` — correct against the pipe model. *(The fault is `velocity()`'s consumers, F5.)*
- `src/world/waterQuery.ts` — the plug is sound; one installer; null-safe consumers.
- `src/ant/wading.ts` — FOOTING/DRAUGHT/sticky/`above=0` while wading/swimEffort ladder. *(Internally consistent; the disagreement is with the drawing.)*
- `src/ant/PlayerAnt.ts` `settle()` and `src/world/origin.ts` — honour the contract exactly *(except F11's `reground` base argument)*.
- `src/world/heightfield.ts`, `coords.ts`, `islandChannels.ts` — untouched all range.
- `spotAt` lattice alignment; sub-stepping carry; world-fixed watercourse lookup; sea-before-fresh branch order; `shiftWater` index math *(depth carry correct; the fluxes are the finding)*; window following at any flight speed.
- Flight: one floor measured once (flight.update and settle share holdFloor/holdBase); `takeOff` nulls the stale floor; the msl shift and `above ≥ 0` clamp correct in isolation.
- Salt classification: one writer, all consumers read the one flag; boundary relief-invariant.
- Camera-floor/tint agreement (same surface, same x/z, correct order); no program-cache collisions.
- The v0.0.112 gating **concept** and its wiring pattern (flag in cache key, matched gate pairs, both ocean sheets flagged).

---

## 15. Proposed Post-Bug Architecture

**Principle: SEPARATE OWNERSHIP + SHARED INTERFACES** — not duplicated engines.

- **Neutral water router** (~10 lines, living where the plug already is): classify by `groundHeight < 0`, delegate to `freshWaterAt()` (= `IslandWater.spotAt`, unchanged) or `oceanAt()` (= the current `g<0` branch body — `seaSwellAt` + `surfFlowAt` — moved to the ocean side, e.g. `surf.ts`). IslandWater registers only its fresh half; disposing the window no longer un-registers the sea. *(Fits the codebase: both halves already exist as pure functions.)*
- **`WaterSpot.kind: 'fresh' | 'sea'`** replacing `salt?: boolean` — a required discriminant makes accidental cross-use a type error; `wading.ts` already treats salt and drinkable as two questions. Endorsed by the audit (F12's "delivered but unread" flag is exactly the failure mode this prevents).
- **Shared wading stays shared** — flotation is her biology. Every constant gets an explicit `BOTH WATERS` label; per-kind divergence (the float exit, A3) is expressed as a labelled branch, never an accident.
- **Explicitly gated ocean shader features** — one `waterLook` factory (the look genuinely is shared), with swell uniforms, breaker block and sea-beat pacing behind `ocean`/`kind` gates; cache key includes the identity; the fresh program never bakes table-dependent chunks (killing the phantom-table class outright).
- **Per-kind presentation pacing** — Underwater clocks and the camera envelope scaled by the *kind's* wave character (a pond's is ~zero).
- **Blast-radius regression tests as standing infrastructure** — pinned ocean GLSL/query fixtures and the fresh mirror, so a 112-style cross-contamination cannot ship silently again.

Explicitly **not** proposed: two water engines, river physics, new ocean or camera tuning, multiplayer scaffolding.

---

## 16. Device Acceptance Checklist

Run on the phone after fixes (fix overlay on for the `×{relief}` line; note the URL used).

**FRESH**
- [ ] Walk into shallow water: film becomes visible before her gait changes; no invisible slowdown band
- [ ] Wade → float transition: continuous, at/near the visible shoreline, no jump or stop
- [ ] Remain floating 60+ s on a pool (through a rain shower ending, if possible): never seated under standing water
- [ ] Fly toward inland water from >100 m: water at distance looks right and *stays* right on approach; no sudden underneath before landing
- [ ] Land on a pool: visible touchdown (no teleport past the last ~10 cm of descent)
- [ ] Cross a recenter boundary (fly ~64 m+ and land in water): no current shove, no surface pop
- [ ] No sudden surface-height jumps when HD terrain streams in or the relief dial moves
- [ ] No absurd current readings (HUD CUR); pond skin does not visibly stream
- [ ] No Pacific-style breaker fronts marching across pools (bare URL **and** `?sea=procedural`)
- [ ] Dive in a pond: underwater look engages promptly (not seconds late)

**OCEAN**
- [ ] Float: rides the swell, camera comfortable, no washing-machine
- [ ] Swim: carried by orbital/surf current as before
- [ ] Dive: camera follows intent promptly, no collapse on a partial lever touch; surface: clean recovery, no lingering sunken look
- [ ] Waves/foam/breakers: identical to accepted v0.0.111 look (protect per CLAUDE.md)
- [ ] Swash line: she grounds and refloats as on v0.0.111 (or per the gated A3 change, inland only)
- [ ] Camera at 100° FOV: still supported
- [ ] `?sea=procedural` and live NOAA: transitions smooth over minutes; network airplane-mode test does not flatten or step the sea
- [ ] Near/far ocean seam: no z-fighting, no visible handover ring

**BOUNDARY**
- [ ] Land → fresh: classification and HUD (drinkable) correct
- [ ] Land → sea: salt behaviour (no drinking, stamina surcharge) correct
- [ ] Coastline in rain: no second green skin over the beach strip; ocean waterline unobscured
- [ ] Freshwater pool near the coast: stays a pond (no ocean foam), the sea stays the sea

---

## 17. Appendix

### Key file paths
`src/world/waterQuery.ts` (the plug) · `src/world/IslandWater.ts` (fresh window + BOTH query branches) · `src/world/waterSim.ts` (pipe solver) · `src/ant/wading.ts` (one wading rule) · `src/world/waterLook.ts` (one material factory) · `src/world/Ocean.ts` (render-only sheets) · `src/world/seaSwell.ts` (table/clock/shoaling) · `src/world/surf.ts` (orbital+surge) · `src/world/liveSea.ts`, `src/weather/SeaService.ts`, `src/weather/ndbcFeed.ts` (live sea) · `src/world/Underwater.ts` (tint) · `src/camera/FollowCamera.ts` (envelope) · `src/scenes/IslandScene.ts` (integration/tick) · `src/ant/flight.ts`, `src/ant/PlayerAnt.ts` (vertical placement) · `src/world/heightfield.ts` (groundHeight/reliefScale)

### Key constants (at HEAD = v0.0.111 content)
`FOOTING=0.4` · `DRAUGHT=0.15` · `FOOTING_STICKY=0.85` (exit 0.34) · fresh feather `edgeLo=1.5/edgeHi=8` · `DRAWN=1.5` (stats only) · `CELL=100`, `N=256`, `RECENTRE=6_400` · `BASEFLOW=2`, `SOAK=0.3`, `dt=0.02`, `damping=0.995`, `dryDepth=0.05` · `SURFACE_MARGIN=12` · `LIFT_MAX=300`, `LIFT_RAMP=4` · ocean feather `35/95`, `midAt 700/deepAt 2600` · shipped table amps `16+6`, `SHOAL_CAP=2.2` → `swellReach≈48.4`, period ≈1.47 s · `SPLASH/SETTLE_BEATS 0.37/1.15` · `BRIEF/PATIENCE_BEATS 0.24/1.09` · `DIVE_RELEASE 0.15/0.55` · `DROWNED_REACH=1.45` · `CLEARANCE=1.6` · `REBASE_AT=4096` · near terrain step 8 units (`CELL_SPAN 512 / 64`)

### Commit SHAs
Good/bad anchors: v90 `69da284` · v111 `54e0961` · v117 `39337fd` (HEAD). Reverted era: 112 `231d6e5` · 113 `6ce28dc` · 114 `5f7b2d9` · 115 `c50f124` · 116 `8c9dfcb`. Named in findings: v88 breaker block `5cf3a99` · v83 fly/settle base `1392900` · v42 water removal (orphaned comment) `f2c821d` · v100 surf `70f8aeb` · v101 envelope `6e2305d` · v104 uniforms `71479eb` · v109 live NOAA `d7b0441`.

### The measurement behind F1
20,736 samples over a real order-5 valley: water-mesh bed (groundHeight @100-unit corners, bilerped) minus groundHeight @exact position — p05 −1.22 · median +0.02 · p95 **+2.03** · worst **+6.19** · **>FOOTING(0.4) at 32.3%** of points. (First derived in-session; recorded verbatim in c50f124's commit message; re-verified by three lenses. Caveat: measured with groundHeight on both sides — boot-time coarse-vs-HD delta is an *additional* term, unmeasured.)

### Audit gaps — open follow-ups from the completeness critique
1. `groundHeight` is HD-tile-residency-dependent (arrival **and** eviction) — the ocean's anchored depth snapshot and F13's trigger list both need the correction; measure coarse-vs-HD deltas at shoreline vertices.
2. **The device's actual dial settings were never established** — settings persist to localStorage, the default was once relief 1.5, and `?fix=` links rewrite the dial. One screenshot of the fix line settles it.
3. Probes drive `?scene=island`, but the player runs bare-URL GameFlow (spawn selection, save/restore, fresh-profile settings) — unaudited delta.
4. Boot-time coarse water bed: IslandWater is built before HD tiles land and nothing refreshes base until a 6,400-unit recentre — the **spawn window** carries lattice error PLUS coarse-vs-HD delta. Also untraced: the depth of cells *entering* the window at a recentre (empty, refilling at baseflow — a candidate clock for "floats a few seconds, then…").
5. Beyond ±2,048 units the drawn ground is the 312.5-unit transition tier while groundHeight reproduces the near lattice — the visible-at-distance fresh sheet is judged against a ~3× coarser chord that *changes on approach*. Prime unmeasured candidate for the v115 "looked correct at a distance" clue.
6. Recentre `resample()` (3×65,536 lookups + 65k sort, synchronous) and per-HD-tile `terrain.rebuild()` land at the arrival moment — the dt spike F8 needs; one `performance.now()` probe answers it.
7. Weather is the unexamined environmental variable: live rain feeds every film; probes may run permanently dry while the device ran rain.
8. Deployment forensics (Pages build, HTTP cache across the 111→112 deploy, the `alreadyTried` update gate) — the only remaining vector consistent with "the code is identical yet the ocean looked wrong".
9. Files never opened: `hydro.ts`, `drainage.ts`, `lodShader.ts` (changed 90→111), `GameFlow.ts`/`SpawnMap.ts`, `WeatherService.ts`/`simulated.ts`/`openMeteo.ts`, probe assertion bodies.

### Useful commands / tests / probes
- `npx vitest run` · `npm run typecheck` · `npm run build` — full gate (1,043 tests at v0.0.117).
- `git show 69da284:src/world/IslandWater.ts` — read v90 without touching the tree.
- `git diff 54e0961 8c9dfcb -- src/` — the whole reverted era (exactly 7 src files).
- `npm run probe:foamsphere` — the ocean-look regression check (run after touching anything the water reads).
- `__island.column()` — the *correct* probe surface (waterSpotAt-based); prefer over `__island.waterDepth` until F15 is fixed.
- Fix overlay (`showFix`) — prints `×{relief}`; the FRESH debug line exists only on reverted `c50f124`/`8c9dfcb` if needed again.
- Audit provenance: workflow `wf_18a8a1f3-ee3`, 56 agents, 40 raw → 16 merged findings, 48 adversarial verdicts (0 refuted), 65 solid entries, 29-entry timeline.

---

*This report preserves the audit's evidence deliberately. Where a verifier corrected a finding, both the claim and the correction are recorded; where agents disagreed, the disagreement is shown in §9 rather than averaged away. CONFIRMED here means survived three adversarial lenses at specific file:line anchors on `39337fd` — not merely asserted.*
