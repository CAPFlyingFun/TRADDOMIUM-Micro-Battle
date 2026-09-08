# Alate Queen — biology for the Creature Lab

Research agent, 2026-09-08, for Joshua's Creature Lab brief (§13, §14). Winged
adult female (alate gyne) of *Solenopsis invicta*, unmated and newly mated.
Extends `docs/research/FIRE_ANT_BIOLOGY.md` §14–16 and `WING_MOTION.md`; it
does not repeat what they cite. Every number is labelled MEASURED, BIOLOGICAL
SHAPE or GAME TUNING (CLAUDE.md, FIRE_ANT_BIOLOGY §38).

**Provenance caveat, stated once.** The sandbox's egress proxy refused every
publisher host (PMC, ScienceDirect, OUP, Springer, PLOS, BioOne, USDA-ARS,
AntWiki, extension sites). Figures below come from the papers' abstracts and
from search-engine summaries of them, cross-checked across two or more hits
where possible, and from the project's own notes where those already hold the
primary numbers. Where a figure is only second-hand it is marked "(as cited)".
This is the same situation FIRE_ANT_BIOLOGY §0 describes; nothing here should
block the lab, and anything Joshua wants nailed to a page number should be
re-read from the full text by someone who can open it.

## The animal

*Solenopsis invicta* Buren, 1972 — red imported fire ant; the winged virgin
female raised in a mature colony, fed by workers, flown once, mated in the air,
landed, and (if inseminated) dealate within the hour and digging within the
day. She is the first controllable creature because her life is the game's
arc: the only ant that walks, climbs, flies and digs in one body, and the one
whose wings are a one-way door. *S. invicta* is NOT established on Kauaʻi or
anywhere in Hawaiʻi (HISC lists it as a watch species; the islands' fire ants
are *S. geminata*, *S. papuana* and *Wasmannia auropunctata*), so the game's
Kauaʻi is the alternate scenario FIRE_ANT_BIOLOGY §2.1 already names — a newly
arrived queen on an island whose ants have never met her. The biology of the
animal is unchanged by that; her competitors are the design call.

## Numbers

"Current table" is `src/creatures/species.ts` (no ant is in it yet) and,
where v0 held a number, `legacy/v0-main:src/ant/{castes,flight,pace}.ts`.

| quantity | value | unit | label | source | current table says | agrees? |
|---|---|---|---|---|---|---|
| Body length, alate female | 7–9.5, typical 8 | mm | MEASURED (range across ID sources; one *S. richteri* alate 8.3) | UF/IFAS EENY-195; TAMU field guide ("3/8 in"); Gui 2010 via WING_MOTION.md | not in table; v0 adult 10.0 (curve 5.5→10) | no |
| Head width, queen | 1.42 | mm | MEASURED | Keller & Ross 1993 (as cited) | not in table | not in table |
| Mass, newly mated monogyne queen | ≥14, mean ~15 | mg | MEASURED | Keller & Ross 1993; Porter et al. 1988 (as cited) | v0 adult mass 14 | yes |
| Mass, polygyne alate / newly mated | ≤12 | mg | MEASURED | same | not in table | not in table |
| Mass, live alate specimen (*S. richteri*) | 11.4 | mg | MEASURED, congener | Gui 2010 via WING_MOTION.md | — | — |
| Mass, established laying queen | 24.3 monogyne / 14.4 polygyne | mg | MEASURED | "Queen weights of polygyne…" (as cited) | v0 matureColony ×1.3 → 18.2 | no |
| Founding weight loss (claustral) | −54 lean, −73 fat, −67 energy | % | MEASURED | Tschinkel 1993 (as cited) | v0 founding mass ×0.68 (−32%) | no |
| Fat needed to found claustrally | ~40 | % of body | MEASURED | Keller & Passera 1989 (as cited) | not in table | not in table |
| Water lost in flight | 1.8 | mg/h | MEASURED | Vogt et al. 2000 | not in table | not in table |
| Flight speed, female, mean | 0.7 (up with temperature, down with body mass) | m/s | MEASURED, flight mill | Vogt et al. 2000 | v0 CRUISE 0.40, MAX_POWERED 0.70 | no — the MEAN sits at v0's ceiling |
| Flight speed, male, mean | 1.0 | m/s | MEASURED | Vogt et al. 2000 | not in table | not in table |
| Flight speed, female, burst | 0.9–1.0 | m/s | GAME TUNING (no published maximum; a mill mean is a cruise, the ceiling is set near the male mean) | — | v0 0.70 | no |
| Wingbeat frequency | 96 female / 108 male | Hz | MEASURED, *S. richteri*, n = 1 each | Gui 2010 via WING_MOTION.md | v0 WINGBEAT_HZ 96 | yes (relabel: congener) |
| Stroke amplitude fore / hind | 114 / 135 | ° | MEASURED, *S. richteri* | Gui 2010 | v0 wings.ts | yes |
| Flight altitude | females to ~245 (800 ft), males to ~300; mating layer 60–150 | m | MEASURED (aircraft nets, tower traps) | Markin et al. 1971 (as cited by Gui 2010) | v0: no ceiling | not in table |
| Time aloft, females | ≤30 | min | MEASURED (as cited) | Markin et al. 1971 via Gui 2010 | v0 CRUISE_SECONDS 1800 | yes |
| Endurance vs load | max duration −18 min per mg of abdomen; parasitic morph flies 4× longer | min/mg | MEASURED, tethered lab | Helms & Godfrey 2016 | not in table | not in table |
| Claustral morph's wing loading | +55–63 % wing loading, −32–38 % flight-muscle ratio vs parasitic | % | MEASURED | Helms & Godfrey 2016 | not in table | not in table |
| Self-powered range | <5 (energetics, no wind); 99 % land within 2 km; a few reach 10 | km | MEASURED / modelled | Vogt 2000; Markin 1971 (as cited) | v0 note: 1.26 km in 30 min | yes |
| Metabolic rise in flight | ~48–51× resting; RQ 0.999 (carbohydrate) | × | MEASURED | Vogt et al. 2000 | v0 FAST_DRAIN 2×, CLIMB 6× cruise | not comparable (v0 is tuning) |
| Takeoff | from the ground directly, or after climbing a grass leaf; no run | — | MEASURED, field | Zeng et al. (China observations, as cited) | v0 TAKEOFF_SPEED 6.5 cm/s ground run | no |
| Flight weather: air temperature | 24–32 (75–90 °F); 21–33 year-round envelope | °C | MEASURED | Milio et al. 1988 (as cited); Morrill 1974; UF/IFAS | not in table | not in table |
| Flight weather: humidity / rain | RH ≥80 % at flight; flights 1–2 days after rain; rain stimulates, humidity alone does not | % | MEASURED (as cited) | Milio 1988; Zeng et al. | not in table | not in table |
| Flight weather: wind | "light"; ≤8 km/h (2.2 m/s) in secondary sources | m/s | BIOLOGICAL SHAPE (threshold not read from the primary) | extension summaries of Milio/Morrill | v0: ground = air + wind, no gate | not in table |
| Flight time of day | 09:00–15:00, never at night; a nest's event 30 min – 3 h, peak at +90 min | local | MEASURED | Zeng et al. (as cited); UF/IFAS "midday" | not in table | not in table |
| Dealation, inseminated | within 0.5–1 h of landing | h | MEASURED | Burns et al. 2007; Markin 1971 | v0: founding state `winged:false`, no timer | not in table |
| Dealation, virgin, isolated | 2–6 days (93.3 %), peak days 3–5, mostly 09:00–14:00 | days | MEASURED | Huang et al. 2025 | not in table | not in table |
| Dealation, virgin after running/climbing only | 25–33 % by 108 h | % | MEASURED | Burns et al. 2007 | not in table | not in table |
| Flight-muscle histolysis onset | within 2 h of insemination; wings cast within 24 h | h | MEASURED | Jones 1978; Davis 1989 (as cited) | v0 founding: flight ×0 | yes (shape) |
| Founding sequence | vertical tunnel ~7 cm; entrance closed ≤24 h; eggs ≤24 h; minims ~30 d | — | MEASURED | Markin et al. 1972 (as cited) | FIRE_ANT_BIOLOGY §16 | yes |
| Walking speed, alate queen | NOT PUBLISHED | — | — | — | v0 walk 9 cm/s, run 13.5, sprint 18 | no source either way |
| Walking speed, worker | 9.6 ± 0.16 (lab trail, temperature unstated); >9 body lengths/s (~30 mm/s) in tunnels | mm/s | MEASURED | Wen et al. 2020; Gravish et al. 2013 | — | — |
| Proposed queen walk / flee | 20 (≈2.5 BL/s) / 50 (≈6 BL/s) | mm/s | GAME TUNING (worker figures × Hurlbert's mass^0.25 ≈ 1.8, then discounted for a gravid body) | Hurlbert et al. 2008 | v0 90 / 180 | no |
| Ground turn rate | 6 | rad/s | GAME TUNING | — | v0 TURN_RATE 18 (an ease constant, not rad/s) | not comparable |
| Flight turn rate | 1.4 | rad/s | GAME TUNING | — | v0 FLIGHT_TURN_RATE 1.4 | yes |
| Climb rate | ≤0.35 (half of airspeed) | m/s | GAME TUNING | — | v0 CLIMB_RATE 0.16; LIFT_MAX 3.0 | no (LIFT_MAX) |
| Terminal fall | 1.78 | m/s | GAME TUNING (v0's own note: no measurement) | — | v0 TERMINAL_FALL 178 | yes, still unmeasured |
| Vision | reproductives have more ommatidia than workers; alates carry 3 ocelli; interommatidial angle ~4–6° in flying castes of a comparable ant | — | BIOLOGICAL SHAPE | Baker & Ma 2006 (as cited); Narendra et al. 2016 (*Camponotus*) | not in table | not in table |
| Sight / alarm / fov | 300 / 120 / 300 | mm, mm, ° | GAME TUNING (same shape as the housefly row) | — | not in table | not in table |
| Reaction latency | 50–200 | ms | BIOLOGICAL SHAPE (insect startle tens of ms; a fly plans an escape in ~200) | Card & Dickinson 2008 (already cited in species.ts) | housefly row | yes |
| Surface activity band (workers) | 15–43 soil at 2 cm; peak 22–36 | °C | MEASURED | Porter & Tschinkel 1987 | not in table | not in table |
| Desiccation | unmated alates lose water slowest; mated dealates 2–3× faster | × | MEASURED (as cited) | Insects 2020, four *Solenopsis* spp. | not in table | not in table |

## Behaviour profile

In the game's words (`state.ts`: idle, wander, feed, rest, flee, takeoff, fly,
hover, land; attack/hunt are the lab's predator-only additions).

**Where she starts.** Biologically an alate lives in the nest until the
weather opens, does no work, and is fed by workers; she leaves once. The
lab's "roam, feed, drink, rest, flee" is therefore a GAME framing of the hours
between landing and digging, stretched — and it should say so on the card.

**idle / rest.** Wings folded flat over the gaster, one over the other,
extending past its tip (UF/IFAS). Rest is long: she is an investment, not a
forager. Night is rest — no flights and no surface activity after dark.

**wander.** A walk of ~2–2.5 body lengths a second (GAME TUNING, see the
table). She is a competent climber; on a stem she goes up, which is also how
she launches. She is drawn to moist ground, shade lines and reflective
surfaces (Morisawa; ADW), and many drown in pools — water is an attractor and
a hazard, not a barrier she respects.

**feed / drink.** Biology: an unmated alate does not forage; a mated one is
claustral and eats nothing until her minims forage. Keeper practice and the
*Lasius* feeding experiments show founding queens WILL take water and sugar
water and do better for it, but I found no *S. invicta* primary paper on it.
So the lab's feed/drink is GAME TUNING with a biological shape: sugars first
(nectar, honeydew, sap — carbohydrate is what her flight burns, RQ ≈ 1), water
at a wet edge, carrion only opportunistically. Hunger should climb slowly:
she carries ~40 % of her body as fat.

**takeoff.** Two doors, both measured: straight off the ground, or up a grass
blade and off the tip. No run-up. Wing activation is the visible beat: wings
unfold, a second of building beat (v0's 1 s launch ease is a good shape), then
lift. Gate it on the sky: 24–32 °C, light wind, daylight, ideally after rain.
Outside that band a real alate does not go — a hard gate is honest, a
stamina/lift penalty is the softer alternative (open question 4).

**fly.** Cruise at the measured 0.7 m/s; a 0.9–1.0 burst is tuning. Beat at
96 Hz (draw at an aliased rate — WING_MOTION.md). Real flights climb to
60–250 m and last up to 30 min; the lab's queen should be able to reach that
band but pay for it (48–51× resting metabolism). Wind: she is slower than an
ordinary breeze, so `ground = air + wind` (already v0's rule) means a 3 m/s
wind owns her heading. Turn by banking, 1.4 rad/s, as v0 does.

**hover.** Not documented for ants; treat v0's hover as a hold (a control
convenience, not a claim). Mated alates "glide towards the ground" after
mating — descent is mostly a glide, not a hover-down.

**land.** Anywhere; sunlit open ground and moist soil preferred. After a MATED
landing the clock starts: dealation in ≤1 h, histolysis within 2 h, chamber
dug and closed within 24 h. An UNMATED alate that lands keeps her wings for
days and can fly again — that is the player's roaming window.

**flee.** Triggers: a looming shape (dragonfly, bird, lizard), a foreign ant
at antenna range, vibration. Highest mortality of her whole life is during
the flight and before the chamber closes (Whitcomb et al. 1973: ≥9 ant species
plus spiders, centipedes, ground beetles, dragonflies, swifts, kingbirds,
bobwhite; on Kauaʻi read: mynas, cattle egrets, geckos, *Pheidole
megacephala*, *S. geminata*, *Anoplolepis*). Response, in order: run (≈6
BL/s), into cover, and — if winged and the sky permits — take off. She has a
sting; a cornered queen defends herself but never hunts (open question 5).
Alarm decays over seconds; a real queen resumes digging quickly.

**temperament / diet in the unions.** `skittish`; `omnivore`.

## Disagreements with the current table

1. **Cruise vs ceiling (v0 flight.ts).** Table: cruise 0.40, max 0.70 m/s.
   Literature: 0.70 is the female MEAN over a sustained mill run, i.e. a
   cruise, and it rises with temperature. Recommend cruise 0.70, burst
   0.9–1.0 (GAME TUNING above the mean). flight.ts's own note already says
   this; FIRE_ANT_BIOLOGY §14's "landed near a real number" is true of the
   number and wrong about where it sits. Confidence: high.
2. **Ground pace (v0 pace.ts).** Walk 9 cm/s, sprint 18 cm/s = 11–22 body
   lengths/s. No alate queen has been timed; workers measure 10–30 mm/s. A
   15 mg gravid alate at 11 BL/s would out-run a desert *Cataglyphis*.
   Recommend ~20 mm/s walk, ~50 mm/s flee, and a feel pass. Confidence:
   medium — the direction is certain, the exact figure is tuning.
3. **Takeoff needs a ground run (v0 TAKEOFF_SPEED 6.5 cm/s).** Field
   observation: alates launch from a standstill on the ground or from a grass
   tip. Recommend takeoff from rest with the wing-activation beat as the
   delay, and climbing a blade as the preferred launch. Confidence: high.
4. **Body length 10 mm (v0 castes.ts adult).** Sources give 7–9.5 mm; the one
   measured *richteri* alate is 8.3. Recommend 8 mm reference, 7–9.5 range
   for the individual draw. Confidence: medium (Buren's description unread).
5. **Founding mass ×0.68 (v0).** Measured loss is 54 % lean / 73 % fat.
   Recommend ×0.45–0.5 when the founding state is built. Confidence: high.
6. **Mature queen mass ×1.3 → 18 mg (v0).** Measured 24.3 mg monogyne.
   Recommend ×1.7. Confidence: high.
7. **LIFT_MAX 3.0 m/s (v0).** Four times her airspeed; exists as a
   wind-escape control, not a wing. No measurement supports a climb above
   about half the airspeed. Keep it only as an explicitly labelled control
   authority, or cap climb at ~0.35 m/s. Confidence: medium (design call).
8. **Wingbeat source.** 96 Hz / 8.3 mm / 11.4 mg are *S. richteri*
   (WING_MOTION.md says so; v0 and §14 read as *invicta*). Relabel
   "MEASURED, congener". Confidence: high.
9. **No weather gate on takeoff (v0).** Flights happen at 24–32 °C, light
   wind, daylight, after rain. New behaviour rather than a wrong number; the
   weather system already exists to drive it. Confidence: high on the shape.

## Open questions for Joshua

1. **Speed feel vs biology.** Accept a ~2 cm/s walk (an ant-scale crawl the
   camera can follow) or keep v0's 9 cm/s and label it GAME TUNING?
2. **The one-way door.** Biology says a MATED queen can fly for a few hours
   at most. Does the lab hold her flight open until she chooses to dealate
   (game), or start the histolysis clock at mating (biology)?
3. **Does she eat at all?** Biology says no; the survival lab says roam,
   feed, drink. If yes: sugars + water only, or carrion too?
4. **Takeoff weather: hard gate or soft cost?**
5. **Defence.** She stings when cornered. The vocabulary has attack/hunt for
   predators only — add a `defend` word, or let flee cover it?
6. **Morph.** Build the lighter polygyne/parasitic alate (≤12 mg, flies ~4×
   longer, cannot found alone) as a second species entry, or one queen?
7. **Water.** Implement the measured attraction to reflective surfaces (and
   the drowning), or leave water as a plain barrier for now?
8. **Reference size.** 8 mm with a 7–9.5 draw, matching the worm's rule?

## Sources

- Vogt JT, Appel AG, West MS (2000). Flight energetics and dispersal capability of the fire ant, *Solenopsis invicta*. *J. Insect Physiol.* 46:697–707. https://www.sciencedirect.com/science/article/abs/pii/S0022191099001584
- Markin GP, Dillier JH, Hill SO, Blum MS, Hermann HR (1971). Nuptial flight and flight ranges of the imported fire ant. *J. Georgia Entomol. Soc.* 6:145–156 (as cited by Gui 2010 and Burns 2007).
- Markin GP, Dillier JH, Collins HL (1972). Colony founding by queens of the red imported fire ant. *Ann. Entomol. Soc. Am.* 65:1053–1058. https://academic.oup.com/aesa/article-abstract/65/5/1053/13950
- Gui L, Fink T, Cao Z, Sun D, Seiner JM, Streett DA (2010). Fire ant alate wing motion data and numerical reconstruction. *J. Insect Sci.* 10:19. https://bioone.org/journals/journal-of-insect-science/volume-10/issue-19/031.010.1901/Fire-Ant-Alate-Wing-Motion-Data-and-Numerical-Reconstruction/10.1673/031.010.1901.full (see `docs/research/WING_MOTION.md`)
- Helms JA IV, Godfrey AP (2016). Dispersal polymorphisms in invasive fire ants. *PLOS ONE* 11:e0153955. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0153955
- Burns SN, Vander Meer RK, Teal PEA (2007). Mating flight activity as dealation factors for red imported fire ant female alates. *Ann. Entomol. Soc. Am.* 100:257–264. https://www.ars.usda.gov/ARSUserFiles/60360510/publications/Burns_et_at-2007(M-4181).pdf
- Huang J, Su H, Jiang Z, Chen W, Lu Y, Zhang J (2025). The dealation pattern of independent and alate virgin females of *Solenopsis invicta*. *J. Insect Sci.* 25(5):ieaf089. https://academic.oup.com/jinsectscience/article/25/5/ieaf089/8287251
- Fletcher DJC, Blum MS (1981). Pheromonal control of dealation and oogenesis in virgin queen fire ants. *Science* 212:73–75. https://www.science.org/doi/10.1126/science.212.4490.73
- Jones RG, Davis WL, Hung ACF, Vinson SB (1978). Insemination-induced histolysis of the flight musculature in fire ants. *Am. J. Anat.* 151:603–610. https://onlinelibrary.wiley.com/doi/10.1002/aja.1001510411
- Milio JF, Lofgren CS, Williams DF (1988). Nuptial flight studies of field-collected colonies of *Solenopsis invicta*. In *Advances in Myrmecology*, pp. 419–431. https://www.ars.usda.gov/arsuserfiles/60360510/publications/Milio_et_al-1988(M-2028).pdf
- Morrill WL (1974). Production and flight of alate red imported fire ants. *Environ. Entomol.* 3:265–271. https://academic.oup.com/ee/article/3/2/265/416712
- Zeng L et al. Observation of nuptial flights of the red imported fire ant in mainland China (as cited). https://www.researchgate.net/publication/287511686
- DeHeer CJ, Ross KG (2000). Unusual behavior of polygyne fire ant queens on nuptial flights. *J. Insect Behav.* https://link.springer.com/article/10.1023/A:1007770404496
- Keller L, Ross KG (1993). Phenotypic basis of reproductive success in a social insect. *Behav. Ecol. Sociobiol.* 33:121–129 (as cited).
- Keller L, Passera L (1989). Size and fat content of gynes in relation to the mode of colony founding in ants. *Oecologia* 80:236–240. https://link.springer.com/article/10.1007/BF00380157
- Tschinkel WR (1993). Resource allocation, brood production and cannibalism during colony founding in *S. invicta*. *Behav. Ecol. Sociobiol.* https://link.springer.com/article/10.1007/BF02027118
- Whitcomb WH, Bhatkar A, Nickerson JC (1973). Predators of *Solenopsis invicta* queens prior to successful colony establishment. *Environ. Entomol.* 2:1101–1103 (as cited).
- Porter SD, Tschinkel WR (1987). Foraging in *Solenopsis invicta*: effects of weather and season. *Environ. Entomol.* 16:802–808 (as cited).
- Hurlbert AH, Ballantyne F, Powell S (2008). Shaking a leg and hot to trot: body size and temperature on running speed in ants. *Ecol. Entomol.* 33:144–154. https://resjournals.onlinelibrary.wiley.com/doi/10.1111/j.1365-2311.2007.00962.x
- Gravish N, Monaenkova D, Goodisman MAD, Goldman DI (2013). Climbing, falling, and jamming during ant locomotion in confined environments. *PNAS* 110:9746. https://www.pnas.org/doi/10.1073/pnas.1302428110
- Wen C et al. (2020). Comparative quantification of trail-following behavior in pest ants. *Insects* 11(1):5. https://doi.org/10.3390/insects11010005
- Baker GT, Ma PWK (2006). Morphology and number of ommatidia in the compound eyes of *S. invicta*, *S. richteri* and their hybrid. *Zool. Anz.* 245:121–125. https://www.sciencedirect.com/science/article/abs/pii/S0044523106000337
- Narendra A, Ramirez-Esquivel F, Ribi WA (2016). Compound eye and ocellar structure for walking and flying modes in *Camponotus consobrinus*. *Sci. Rep.* 6:22331. https://www.nature.com/articles/srep22331
- Comparative cutaneous water loss and desiccation tolerance of four *Solenopsis* spp. (2020). *Insects* 11(7):418. https://doi.org/10.3390/insects11070418
- UF/IFAS EENY-195, Red imported fire ant. https://ask.ifas.ufl.edu/publication/IN352
- Texas A&M, Red imported fire ant field guide. https://texasinsects.tamu.edu/red-imported-fire-ant/
- Morisawa T. Red imported fire ant, TNC element stewardship abstract. https://www.invasive.org/gist/moredocs/solinv01.pdf
- Hawaiʻi Invasive Species Council, RIFA. https://dlnr.hawaii.gov/hisc/red-imported-fire-ant-rifa/
- Project notes: `docs/research/FIRE_ANT_BIOLOGY.md` §14–16, §38; `docs/research/WING_MOTION.md`; `legacy/v0-main:src/ant/castes.ts`, `flight.ts`, `pace.ts`.
