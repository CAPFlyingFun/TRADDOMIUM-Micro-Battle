# Creature Lab research — consolidated for approval

Five reports, one per lab animal, gathered before any of the Lab is
built (Joshua, 2026-09-08: "have them research first, you take all the
research, share the results, if I approve, then use agents to build
it"). This file is the consolidation: what each report found, where the
current table (`src/creatures/species.ts`) or v0's parts bin disagrees
with the literature, what I recommend building to, and the decisions
that are Joshua's rather than mine.

Every number carries its label. MEASURED means a paper or an extension
sheet says so and is named. BIOLOGICAL SHAPE means the form is measured
and the figure is transferred or derived. GAME TUNING means we chose it
and say why. The reports mark with an asterisk the rows a blocked
journal host kept them from reading in full; those rows are "as cited"
and are listed at the end for re-checking from a machine that can open
them.

Confidence per report: queen medium, worker medium, aphid medium,
earthworm medium, housefly medium — in every case because the primary
publishers were blocked from the sandbox and figures came from
abstracts, extension sheets and reviews.

---

## 1. Queen — alate *Solenopsis invicta* female (`queen.md`)

**What the literature measures**

| Quantity | Value | Label | Source |
|---|---|---|---|
| Body length | 7–9.5 mm, typical 8 | MEASURED | UF/IFAS EENY-195; TAMU |
| Mass, newly mated | ≥14 mg, mean ~15 | MEASURED | Keller & Ross 1993 |
| Flight speed, female mean (flight mill) | 0.7 m/s, rising with temperature | MEASURED | Vogt, Appel & West 2000 |
| Flight speed, male mean | 1.0 m/s | MEASURED | Vogt et al. 2000 |
| Wingbeat | 96 Hz (S. richteri, n=1 — a congener) | MEASURED | Gui et al. 2010 |
| Time aloft | ≤30 min; 99 % land within 2 km | MEASURED | Markin et al. 1971 |
| Takeoff | from a standstill on the ground or a grass tip; no run-up | MEASURED | Zeng et al. (nuptial-flight observations) |
| Flight weather | 24–32 °C, RH ≥80 %, light wind, 09:00–15:00, 1–2 days after rain | MEASURED / SHAPE (wind) | Milio et al. 1988; Morrill 1974 |
| Dealation after mating | within 0.5–1 h of landing; histolysis within 2 h | MEASURED | Burns et al. 2007; Jones et al. 1978 |
| Walking speed | NOT PUBLISHED for any gyne; workers 10–30 mm/s | GAME TUNING | Wen 2020; Gravish 2013 |

**Where v0's parts bin is wrong** (`legacy/v0-main` `flight.ts`, `pace.ts`, `castes.ts`)

- v0 cruise 0.40 / max 0.70 m/s: Vogt's 0.70 is a sustained MEAN, i.e. a
  cruise. Recommend cruise 0.7 MEASURED, burst 0.9–1.0 GAME TUNING.
- v0 walk 9 cm/s, run 13.5, sprint 18 = 11–22 body lengths/s: a 15 mg
  gravid alate at that pace would out-run a desert *Cataglyphis*.
  Recommend walk ~20 mm/s, flee ~50 mm/s, GAME TUNING derived from
  workers by Hurlbert 2008's mass^0.25 and a feel pass.
- v0 takeoff needs a 6.5 cm/s ground run: measured launch is from rest.
- v0 LIFT_MAX 3.0 m/s is four times her airspeed; cap climb near half
  airspeed (~0.35 m/s) or keep it only as a labelled control authority.
- v0 body length 10 mm: sources say 7–9.5. Recommend 8 with a 7–9.5 draw.
- Founding mass loss −32 % in v0; measured −54 lean / −73 fat (Tschinkel
  1993). Only matters when founding is built.
- Wingbeat provenance: 96 Hz is *S. richteri*. Relabel "MEASURED,
  congener".

**Recommend building to:** length 8 (7–9.5), mass 15 mg, walk 20 / flee
50 mm/s (GAME TUNING), cruise 0.7 / burst 1.0 m/s, wingbeat 96 Hz,
climb ≤0.35 m/s, takeoff from rest with the wing-activation beat as the
delay, a weather gate on takeoff read from the live sky (temperature,
wind, daylight), ≤30 min aloft.

**Joshua's decisions**

1. Walking feel: accept a ~2 cm/s walk the camera can follow, or keep
   v0's 9 cm/s labelled GAME TUNING?
2. The one-way door: a MATED queen can fly for a few hours at most.
   Does the lab hold her flight open until she chooses to dealate
   (game), or start the histolysis clock at mating (biology)?
3. Does she eat? An alate does not forage; a founding queen is
   claustral. If the lab says roam/feed/drink: sugars and water only?
4. Takeoff weather: a hard gate, or a soft stamina/lift penalty outside
   the band?
5. Defence: a cornered queen stings but never hunts — add a `defend`
   word, or let `flee` cover it?
6. One morph (monogyne, claustral) or also the lighter polygyne alate
   (≤12 mg, flies ~4× longer, cannot found alone)?

## 2. Worker — *Solenopsis invicta* worker caste (`worker.md`)

**What the literature measures**

| Quantity | Value | Label | Source |
|---|---|---|---|
| Body length | 1.6–6.0 mm | MEASURED | TAMU; CDFA |
| Head width | 0.45–1.50 mm; small ≤0.80, medium ≤1.00, large ≤1.50 | MEASURED | Wood & Tschinkel 1981 |
| Mature colony mix | 45 / 42 / 16 % small / medium / large | MEASURED | Wood & Tschinkel 1981 |
| Size-frequency shape | two overlapping normals; incipient colonies all small | MEASURED | Tschinkel 1988 |
| Live mass | 0.65 mg small, 3.99 mg large (extremes 0.16–4.62) | MEASURED | Chen, Rashid & Feng 2014 |
| Trail walking pace | 9.6 mm/s (~2.7 BL/s) | MEASURED | Wen et al. 2020 |
| Tunnel burst | >9 BL/s (~27 mm/s at 3 mm, 54 at 6) | MEASURED | Gravish et al. 2013 |
| Speed vs size | speed ∝ mass^0.25 ≈ length^0.75 | BIOLOGICAL SHAPE | Hurlbert et al. 2008 |
| Surface band | forages 15–43 °C soil, peak 22–36; nocturnal above ~36 | MEASURED | Porter & Tschinkel 1987 |
| Surface exposure | within 26 cm of a tunnel exit; ~0.5 m of surface walk per trip | MEASURED | Tschinkel 2011 |
| Sleep | 253 naps/day × 1.1 min; ~80 % awake at any moment | MEASURED | Cassill et al. 2009 |
| Venom | ~18 µg reserve, ~0.56 µg a sting (~30 stings); synthesis stops by day 15 | MEASURED | Haight & Tschinkel 2003 |
| Who answers a threat | heavy vertebrate-like disturbance draws majors 5× more | MEASURED | Haight 2010 |
| Aphids | tended for honeydew; their attackers are killed | MEASURED | Kaplan & Eubanks 2002; Rice & Eubanks 2013 |
| Earthworm in diet | as dead matter only; no record of a worker killing a healthy adult | MEASURED | UF/IFAS; Wilson & Oliver 1969 |
| Fly | eggs/larvae/pupae/tenerals taken at 63–94 % mortality; adults uncatchable | MEASURED | Hu & Frank 1996 |

**Where the current design is wrong**

- `sizeRatio` scales pace linearly with length (the worm's law). For
  ants it is ~length^0.75: a 6 mm major runs ~1.9× a 2 mm minim, not
  3×. Recommend a per-species exponent on `sizeRatio` (worm 1, ant
  0.75). This is the one change that touches code already shipped.
- `data/registries.ts` treats "major" as a caste with its own curves.
  The measurement is ONE worker caste, one continuous size draw (two
  overlapping normals). Recommend one worker species whose curves are
  indexed by the draw; "Major" survives only as the UI word for the top
  of the distribution. This matches Joshua's §12 (polymorphism).
- The temperament union is `passive | skittish`; a fire ant worker is
  neither. Needs a word that attacks, gated on nest proximity and
  threat size.
- Rest: every current species rests in one long block; the worker naps
  a minute at a time, mostly inside. Recommend short `restS`, low
  `restAt`, rest only in a tunnel.
- The aphid must not flee its tender (see §3).
- A worker should never be 10 m from a tunnel exit in the open.

**Recommend building to:** length draw 1.6–6.0 mm over two normals
(45/42/16), mass by HW³, walk 9.6 mm/s at 3.5 mm scaling by
length^0.75, sprint ceiling the tunnel burst (GAME TUNING that it holds
on the flat), turn ~6 rad/s (GAME TUNING), sight ~50 mm (GAME TUNING
from 48–92 facets), reaction 0.2–0.5 s, a `defensive` temperament,
naps not blocks.

**Joshua's decisions**

1. Size draw from day one (45/42/16) or all-small until the colony
   grows (biology), which makes the player's first workers minims?
2. Venom: a finite reserve that does not refill in an old worker
   (measured), a slowly refilling meter, or no meter — the survival
   invariant says a bar may only move if it can move back.
3. Can a lone worker start a fight with a 150 mm worm (3,000 worker
   masses)? The literature says recruitment or nothing.
4. Is a grounded or feeding fly catchable, or only its immatures?
5. Threat sizing: does the camera/player register as vertebrate-heavy
   and draw majors 5× as often?

## 3. Aphid — *Aphis gossypii*, melon aphid (`aphid.md`)

**What the literature measures**

| Quantity | Value | Label | Source |
|---|---|---|---|
| Body length, apterae | 0.9–1.8 mm, typical 1.4 | MEASURED | Influential Points; UF/IFAS EENY-173 |
| Walking pace | ~1 mm/s (*Myzus*, 25 °C); 0.8 recommended for *A. gossypii* | BIOLOGICAL SHAPE | Alford, Blackburn & Bale 2012 |
| Displaced: walk to a new plant | nearest within 1 h; up to 180 cm | MEASURED | Alyokhin & Sewell 2003 |
| Survival on bare soil | 1.2 days | MEASURED | Alyokhin & Sewell 2003 |
| Drop righting | 90 % land on their feet within 0.17 s | MEASURED | Ribak et al. 2013 |
| Return after a drop | ~40 s from 13 cm, by SIGHT of the plant | MEASURED | Gish & Inbar 2006 |
| Sight of a host | ≥130 mm | MEASURED | Gish & Inbar 2006 |
| Alarm cue | stem vibration, contact, pheromone within 1–3 cm — never a sight cue | MEASURED | J. Pest Sci. 2020; Basu et al. 2021 |
| Ant-tended *Aphis* on alarm | walk or waggle, drop is the minority; ants depress it further | MEASURED | Nault et al. 1976 |
| Time to phloem | 3.5–6.3 h; ingestion bouts of hours | MEASURED | Walker 2024; Garzo et al. 2002 |
| Hosts | >700 dicots; on Kauaʻi cucurbits, hibiscus, citrus, taro, noni — NOT grasses or ferns | MEASURED | CTAHR; Messing et al. 2007 |
| Mass | ~0.1–0.3 mg, derived; the measurement is behind the block | GAME TUNING | Moreno-Delafuente 2021 (not read) |

**Where the current table is wrong**

- `lengthMm 2.5 (1.5–4)` → 1.4 (0.9–1.8). The rig halves; nothing else.
- `feedS 30–120 s` with a 50 % stem walk after each → hours; feedS
  [900, 3600] s and WALK_CHANCE ~0.15 (GAME TUNING seconds).
- Every alarm is a drop → two-stage: walk 1–3 cm first, drop only on
  contact or a persisting disturbance; a drop fraction of ~20–30 % is
  a guess and labelled so.
- `alarmS 8 s` → 20–40 s (one paper, one species: medium).
- `sightMm 30` → 130 for host-finding; `alarmMm 20` stays but is the
  contact/vibration radius, and the camera is a NON-alarming sight cue.
- Hosts include fern and grass → [shrub, broadleaf, flower, tree] for
  this species. Kauaʻi's grass aphids are other genera.
- `scientificName 'Aphidoidea'` is a superfamily → `Aphis gossypii`.
- The walking-pace comment ("about a body length a second") is wrong at
  2.5 mm; 0.8 mm/s at 1.4 mm is ~0.6 BL/s.

**And one thing for the worker:** the aphid is not prey (Joshua §10)
and the literature agrees harder than the brief did — a tended aphid
does not flee an ant, it is stood on and defended.

**Joshua's decisions**

1. One species or three? If the green rig must also sit on grass and
   ferns it is honestly a melon aphid, a grass aphid and the black fern
   aphid sharing a rig. A second species entry costs a name.
2. Is the player's ant a disturbance? Until tending is built, does an
   approaching ant make it kick, walk, or nothing?
3. Honeydew as a resource now (one droplet per 20–60 min, a `honeydew`
   ResourceKind so plant → aphid → honeydew → ant exists) or with
   tending later?
4. Rain: shed a fraction of a colony in heavy rain (they return within
   a minute) or leave them on the sheltered underside?

## 4. Earthworm (`earthworm.md`)

**The species question comes first.** *Lumbricus terrestris* — the
animal the table names — has no Hawaiʻi record in anything reached and
cannot survive lowland Kauaʻi (25 °C is lethal over months, Berry &
Jordan 2001; the soil is 21–25 °C all year). The worms under Kauaʻi's
litter are *Amynthas gracilis* (epi-endogeic, introduced before 1852,
60–160 mm, 3–6 mm bore, surfaces at night after heavy rain) and
*Pontoscolex corethrurus* (endogeic, never surfaces). Recommend renaming
to *A. gracilis*, keeping the rig, carrying the *L. terrestris*
locomotion numbers with the label saying so.

**What the literature measures**

| Quantity | Value | Label | Source |
|---|---|---|---|
| *L. terrestris* length | 110–200 mm (some 120–250) | MEASURED | CABI |
| *A. gracilis* length / bore | 60–160 mm / 3–6 mm | MEASURED | Bishop Museum; Virginia Tech |
| Surface crawl | ~0.1 BL/s (15 mm/s at 150 mm) | MEASURED | Quillin 1999 * |
| Crawl scaling | U ∝ M^0.33 — length^1, the law the table uses | MEASURED | Quillin 1999 |
| Peristaltic wave | 0.08–0.33 Hz; stride ~0.2–0.3 BL (derived) | MEASURED / SHAPE | Seymour 1969; Quillin 1999 * |
| New-burrow penetration | ~0.2–0.5 mm/s, 30–75× slower than the crawl; stops past ~200 kPa | MEASURED | Ruiz et al. 2015, 2017; Ruiz & Or 2018 |
| Push vs weight | hatchling 500×, adult 10× | MEASURED | Quillin 2000 |
| Withdrawal reflex | 6 ms to first spike; giant fibres 7.5–45 m/s | MEASURED | Drewes 1980 |
| Predator-vibration escape | emerges at ~8 mm/s, crawls away, no sprint | MEASURED | Catania 2008 |
| Vibration reach | <500 Hz, peak 97 Hz; surfacing to zero by 8–9 m | MEASURED | Mitra et al. 2009 |
| Light | foraging drops at ≥10 lx | MEASURED | Cai et al. 2025 |
| Surface foraging (*L. terrestris*) | 30–45 cm circle with the tail in ONE burrow, for much of a night | MEASURED | Nuutinen & Butt 2005 |
| Rain surfacing | *A. gracilis* out at night after heavy rain; *P. corethrurus* never | MEASURED | Chuang & Chen 2008 |
| Hawaiʻi density | 92–469 worms/m² on Hawaiʻi Island | MEASURED | Zou et al. 2010 |

**Where the current table is wrong**

- Burrow pace = crawl pace (the docblock says no discount was measured):
  there IS one, and it is 30–75×. Travel in an EXISTING burrow is at
  crawl pace. This is the number that bit the project twice.
- Flee 25 mm/s as a faster crawl (invented, and labelled so): the fast
  escape is a giant-fibre withdrawal of a few cm into the burrow in tens
  of ms; the surface escape crawl is no faster than a crawl.
- Surface bout 20–90 s then re-burrow anywhere: the animal keeps a home
  burrow and forages a circle around it for minutes.
- The renderer has no peristalsis (deleted for the snake rule). The
  measured wave is 0.08–0.33 Hz; it should return as a wave in RADIUS
  with the bones held on the path — a wave in position was the bug, the
  wave in girth is the biology. This answers §15A.
- Density 400/ha is two orders under Hawaiʻi's measurement (a cap, and
  a phone reason — label it).
- Alarm at 40 mm for an ant: an ant's footfalls are not a vibration a
  worm answers; contact is. The camera's reach stays tuning.

**Joshua's decisions**

1. Rename to *Amynthas gracilis*, or keep the night crawler as a
   knowingly imported scenario species the way *S. invicta* is?
2. DIGGING SPEED — a decision, not a value. At the honest 0.3 mm/s a
   worm making new burrow takes 8 min per body length and is invisible
   again. (a) worms travel existing burrows at crawl pace and dig new
   ground rarely and slowly; (b) a labelled 3–5× discount instead of
   50×; (c) the surface is where worms are seen and the burrow is a
   hiding state.
3. Which flee: retract into the burrow (fast, real), crawl away across
   the surface (slow, real), or *Amynthas*'s thrash-and-tail-autotomy
   when grabbed? One word, three motions.
4. Does the ant get to eat the worm? A surfaced worm as a large carrion
   or prey resource is a whole food mechanic (group carry).
5. A second soil species, *P. corethrurus*, the worm that never
   surfaces, as the contrast that makes the rain-surfacing one legible?
6. Home-burrow fidelity (a remembered point per worm) vs burrow-anywhere.

## 5. Housefly — *Musca domestica* (`housefly.md`)

**What the literature measures**

| Quantity | Value | Label | Source |
|---|---|---|---|
| Body length | 4–8 mm, mean 6.35 | MEASURED | ADW; LSU |
| Mass | 12 mg | MEASURED | ADW |
| Cruise | ~2 m/s (≈300 BL/s); max unpublished, above 2 | MEASURED | West 1951; Wagner 1986 via Zahn 2019 |
| Wingbeat | 130 / 160–162 / 180 Hz by method | MEASURED | Sotavalta 1947; Unwin & Corbet 1984, in Pinto et al. 2022 |
| Flight turn | saccades of 20–30 ms, up to 90°, ~10/s, peak 35 rad/s | MEASURED | Schilstra & van Hateren 1999 (*Calliphora*) |
| Escape trigger | an approaching DARK object (looming), not range | MEASURED | Holmqvist & Srinivasan 1991 |
| Escape planning | ~200 ms postural preparation; leap 0.48 m/s in 2 ms | MEASURED | Card & Dickinson 2008 |
| Landing | deceleration at a retinal-expansion threshold, ~76 ms to contact | MEASURED | Wagner 1982 |
| Inverted landing | real and distinctive (Liu et al. 2019) | MEASURED | — Creature Lab D deferred |
| Flying height | spread evenly 0.1–2 m; lands at 1.8 m | MEASURED | Zahn 2019 |
| Hover | none in *Musca*; only a pre-landing brake (the lamp-circler is *Fannia*) | GAME TUNING | extension pages |
| Endurance | minutes to hours of continuous flight | MEASURED | Rockstein & Bhatnagar 1966 |
| Temperature | ceases below ~10 °C, rises to 30, falls above 35 | MEASURED | Schou et al. 2013 |
| Daily activity | dawn to dusk, a mid-morning peak, inactive in the dark, roosts on foliage | MEASURED | Zahn & Gerry 2020 |
| Eye | 2.9° per facet: a 4 mm ant is resolvable only within ~80 mm; a hand at metres | MEASURED / SHAPE | Juusola lab 2026 |
| Walking speed | NOT PUBLISHED; the table's 15 mm/s is a guess labelled BIOLOGICAL SHAPE | GAME TUNING | — |

**Where the current table is wrong**

- `cruiseMmS 1500` → 2000 MEASURED; escape burst 3000 GAME TUNING.
- `WINGBEAT_HZ 200` "commonly 150–250" → 170; drop the claim.
- `turnRadS 6` in the air → ~30 rad/s saccades in flight, 6–10 on foot.
- `sightMm 300` / `alarmMm 150` as flat ranges → an angular sight rule
  and a LOOMING alarm rule: the fly ignores a slow ant and fears the
  camera, which is the biology and probably the feel.
- `hoverS 0.3–1.5` → 0.2–0.8 and only before `land`.
- `hopS × cruise ≠ hopMm`: derive one from the other.
- `fatiguePerS 1/40` exhausts a fly in 40 s: keep for the short-hop
  brief but label GAME TUNING.
- No day/night: gate feed/fly by daylight and temperature, roost at
  night — the time slider exists to show this.
- Walking pace relabel GAME TUNING; add mass 12 mg.

**Fly vs Queen (Joshua §18), on the sheet:** cruise 2 vs 0.7 m/s (300
vs ~84 BL/s); wingbeat 160–180 vs 96 Hz; a 90° saccade in 30 ms vs
wind-steered flight with no measured saccade; a 3.5 ms escape leap vs a
deliberate climb; lands on anything including undersides vs
ground/vegetation; seconds-long hops vs one long flight; mass about
EQUAL (12 vs ~15 mg) — do not make the fly lighter to make it quicker.

**Joshua's decisions**

1. Keep the fly low (0.12–0.6 m) for the ant's sake, or use the
   measured 0.1–2 m spread and accept flights leaving the ant's view?
2. Looming alarm: the fly ignores the ant and fears the camera — is that
   the feel wanted?
3. Any station-keeping hover at all (reads as "fly" but is *Fannia*)?
4. Roost visibly on foliage at night, or thin out?
5. Should flight speed scale with `sizeRatio` at all? Wingbeat and
   speed scale only weakly with size in flies; recommend NOT linearly.

---

## Cross-cutting: what the five reports say together

1. **`sizeRatio` needs an exponent per species.** Worm 1 (Quillin:
   U ∝ M^0.33), ant 0.75 (Hurlbert: mass^0.25), fly ~0 for flight.
   One number on the species entry; one line in `sizeRatio`. This is
   the only recommendation that changes shipped behaviour.
2. **Senses are angular and looming, not radii.** The fly (2.9°/facet,
   looming trigger), the aphid (never a sight cue; vibration/contact/
   pheromone at 1–3 cm; sees a PLANT at 13 cm), the worm (vibration,
   contact, light), the worker (48–92 facets, motion only). The
   `sightMm`/`alarmMm` pair should become "what can it resolve at what
   angle" and "what looms". Recommend building the sense model once in
   the Lab and reading it back to the wild.
3. **The time slider now has consequences.** Fly inactive in the dark;
   worker nocturnal above 36 °C soil and diurnal in cool seasons; worm
   surfacing at night after rain; queen flying only 09:00–15:00.
4. **Rest is naps, not blocks**, at least for the ant (Cassill).
5. **The tending relation is the lab's first social rule:** worker
   stands on and defends the aphid; aphid does not flee the ant; ant
   never eats a healthy aphid. Flood, rain and the camera are what
   disturb them.
6. **Prey table, from the literature:** worker takes fly immatures and
   carrion, never a flying adult; earthworm is carrion or a recruitment
   target, never a lone kill; aphid is never prey.
7. **Flood responses (alpha.34 feedback #7) have their biology now:**
   aphid walks to the nearest plant and survives 1.2 days on soil (no
   flotation figure was found — "float/swim" is not supported); fly
   flies (2 m/s); *A. gracilis* has POOR immersion tolerance and crawls
   OUT, which is the opposite of "burrow deeper" — it surfaces at
   night after heavy rain. So v1's "flee the closing edge" is right for
   the fly and the aphid, and the worm's true response is to surface.
8. **Peristalsis returns as girth, not position** (§15A answered).

## What was NOT reachable, to re-check from an unblocked machine

Queen: Milio 1988 wind threshold; Markin 1971 altitude/duration.
Worker: none flagged beyond "as cited" extension summaries.
Aphid: Moreno-Delafuente 2021 fresh/dry mass.
Earthworm: Quillin 1999 absolute crawl and stride per wave (starred).
Housefly: Wagner 1986 full text; Rockstein & Bhatnagar 1966 numbers.

## What I recommend we build (pending approval)

Build the Lab to the five "recommend building to" blocks above, with
these choices made unless Joshua overrides them: *A. gracilis* named,
*L. terrestris* numbers labelled; worker as one caste with the two-
normal draw and a `defensive` temperament; aphid at 1.4 mm on dicots
with the two-stage flee and NO reaction to the ant; fly at 2 m/s with
looming alarm, no hover, day-active; queen at 8 mm, 0.7 m/s cruise,
walk 20 mm/s, takeoff from rest, weather-gated. The six numbered
questions per animal are the ones I cannot answer for him.
