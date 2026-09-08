# Earthworm — biology for the Creature Lab

Research pass 2026-09-08 for the Creature Lab. This file EXTENDS the earthworm entry in
`src/creatures/species.ts` (cited below as "table") and `docs/research/FIRE_ANT_BIOLOGY.md`
§38's three labels: MEASURED, BIOLOGICAL SHAPE, GAME TUNING. Where nothing is published it
says so and proposes a tuning value with its reasoning.

Access note: every journal host (Company of Biologists, PubMed/PMC, Europe PMC, Royal
Society, PLOS, ScienceDirect, Springer, Wiley, Nature), Wikipedia, the Bishop Museum and the
Semantic Scholar API are blocked from this environment. The numbers below come from search
snippets quoting the papers' abstracts and results, extension pages and news releases. Each
row names its primary paper; anything marked "derived" was computed here from cited
numbers and is NOT a reading from the paper. Claude should verify the starred rows (*) from a
machine that can open the paper before they reach the table.

## The animal

The table names *Lumbricus terrestris* L., the European night crawler, and cites Quillin's
three J. Exp. Biol. papers for it, which is the right species for the LOCOMOTION literature:
Quillin (1998, 1999, 2000), Seymour (1969), Drewes and Ruiz & Or all measured it. It is the
wrong species for Kauaʻi. Hawaiʻi had no earthworms before people (Nakamura 1990); the worms
there now are introduced tropical megascolecids and glossoscolecids, and the two found in
every treatment of the one quantitative Hawaiʻi survey reached are *Amynthas gracilis*
(Kinberg, 1867), an epi-endogeic litter-and-topsoil worm introduced to Hawaiʻi before 1852,
and *Pontoscolex corethrurus* (Müller, 1857), an endogeic soil-eater (Zou et al. 2010; Bishop
Museum Cook Islands database). No Hawaiʻi record of *L. terrestris* was found in the sources
reached, and the thermal work says why: 25 °C kills it in six months and 30 °C in a
fortnight (Berry & Jordan 2001), and lowland Kauaʻi soil sits at 21–25 °C all year. The
honest animal for the rig — a plain segmented worm of 60–160 mm — is *A. gracilis*, with
*L. terrestris* kept as the source of the numbers that have only ever been measured on it.
Recommended binomial: **Amynthas gracilis**; locomotion numbers carried from *L. terrestris*
and labelled as such.

## Numbers

| quantity | value | unit | label | source | current table says | agrees? |
|---|---|---|---|---|---|---|
| *L. terrestris* body length | 110–200 (some sources 120–250) | mm | MEASURED | CABI Compendium; Monaco Nature Enc. | 150, range 120–250 | yes |
| *L. terrestris* diameter | 7–10 | mm | MEASURED | CABI Compendium | boreMm 6 | no (see §Disagreements) |
| *L. terrestris* segments | 120–170, usually 135–150; count fixed at hatching | — | MEASURED | Wikipedia summary of Sims & Gerard; Quillin 1998 | 17-bone rig | not in table |
| *L. terrestris* mass, hatchling → adult | 0.012 → 8.5–8.9 (0.03 → 12.89 in a second sample) | g | MEASURED | Quillin 1999, 2000; Kurth & Kier 2014 | not in table | not in table |
| Mass of a 150 mm × 7.5 mm worm | ≈ 4–5 | g | BIOLOGICAL SHAPE (derived: tapered cylinder at 1.05 g/cm³) | — | not in table | not in table |
| Shape with growth | longer and thinner: longitudinal muscle area ∝ M^0.6, circular ∝ M^0.8 | — | MEASURED | Kurth & Kier 2014 | not in table | not in table |
| *A. gracilis* body length / diameter | 60–160 / 3–6, dark blue-black to brown, iridescent | mm | MEASURED | Bishop Museum Cook Islands database; VT ENTO-427 (jumping worms 70–160) | not in table | not in table |
| *A. gracilis* mass | not published in sources reached; ≈ 1 g for 100 mm × 4 mm | g | BIOLOGICAL SHAPE (derived as above) | — | not in table | not in table |
| *P. corethrurus* body | 60–120 × 4–6; endogeic, geophagous | mm | MEASURED | Wikipedia/PLOS ONE 2019 summary | not in table | not in table |
| Crawl speed, surface | ≈ 0.1 body length/s (15 mm/s at 150 mm) * | BL/s | MEASURED | Quillin 1999 (abstract confirms speed rises with size; the absolute BL/s figure is the table's reading of the paper, which could not be reopened here) | wanderMmS 15 | yes |
| Crawl speed vs mass | U ∝ M^0.33; stride length ∝ M^0.41; stride frequency ∝ M^−0.07; duty factor ∝ M^−0.03 | — | MEASURED | Quillin 1999 | pace ∝ length (`sizeRatio`) | yes: with L ∝ M^~0.36 this is U ∝ L^0.9, near enough linear |
| How a worm goes faster | longer strides first; more strides and lower duty factor second | — | MEASURED | Quillin 1999 | not in table | not in table |
| Peristaltic wave frequency | 5–20 per minute (0.08–0.33 Hz) crawling and burrowing | Hz | MEASURED | Seymour 1969 | renderer has no wave (`fauna/motion.ts`: "PERISTALSIS IS GONE") | not in table |
| Stride (advance per wave) | ≈ 0.2–0.3 body length * | BL | BIOLOGICAL SHAPE (derived: 0.1 BL/s ÷ 0.3–0.5 Hz; read Quillin 1999 Fig. 3 to replace) | — | not in table | not in table |
| Duty factor / anchored fraction | size-independent (exponent −0.03); value not retrieved * | — | MEASURED (shape), value GAME TUNING until read | Quillin 1999 | not in table | not in table |
| Body-wall strain per segment | independent of body mass | — | MEASURED | Quillin 1999 | not in table | not in table |
| Burrowing force vs mass | radial and axial forces ∝ M^0.4, not the M^0.67 of geometric similarity | — | MEASURED | Quillin 2000 (J. Exp. Biol. 203:2757) — the primary behind Wikipedia's [31] | not in table | not in table |
| Push relative to body weight | hatchling (0.012 g) 500×; adult (8.9 g) 10× | × body weight | MEASURED | Quillin 2000 | not in table | not in table |
| Max hydroskeletal pressure | ≈ 200 (60–230 across lumbricid studies) | kPa | MEASURED | Ruiz & Or 2018; Keudel & Schrader 1999 | not in table | not in table |
| Hardest soil it enters | compacted to 40 % pore volume; a plough pan | — | MEASURED | Joschko et al. 1989 | not in table | not in table |
| New-burrow penetration rate | ≈ 0.2 (modelled 0.5) while actively burrowing; field mean bioturbation 0.1 m/day ≈ 0.001 | mm/s | MEASURED (range) | Ruiz et al. 2017; Ruiz, Or & Schymanski 2015 | burrow pace = crawl pace (15 mm/s) | no: 30–75× too fast for NEW burrow; right for travel in an EXISTING one |
| Rate vs soil resistance | falls with penetrometer resistance; mode shifts to ingestion; casts and energy per unit length rise | — | MEASURED | Arrázola-Vásquez et al. 2022 | not in table | not in table |
| Burrowing modes | cavity (crevice) expansion; ingestion; following existing channels/root channels | — | MEASURED (first two); BIOLOGICAL SHAPE (third, standard in the literature, not in a source reached) | Arrázola-Vásquez 2022; Ruiz 2015 | not in table | not in table |
| Giant-fibre conduction | MGF 15–45 (head-end stimuli); LGF 7.5–15 (tail-end) | m/s | MEASURED | Shannon et al. 2014 (Adv. Physiol. Educ.) | not in table | not in table |
| Withdrawal reflex latency | minimum 6 ms to first spike; tail flattens a few ms BEFORE the anterior shortens, anchoring the tail in the burrow | ms | MEASURED | Drewes 1980 (J. Exp. Biol. 83:231); Drewes et al. 1980 | alarm → flee on next think (≤ 0.5 s) | yes (the game is coarser, not wrong) |
| Withdrawal is anterior-weighted | escape shortening focused into the front segments, "most vulnerable when extended from the burrow" | — | MEASURED | Drewes et al. 1980 | flee = crawl away at 25 mm/s | no (see §Disagreements) |
| Retreat from a LIGHT spot | 7.1 s (19:00) to 9.9 s (12:00) to withdraw the head | s | MEASURED | Bennett & Reinschmidt 1965 | alarmS 6 | not in table |
| Vibration band it answers | < 500 Hz, dominant 97 Hz (mole-like); rain-like < 500; mole digging < 1 000 | Hz | MEASURED | Mitra et al. 2009; Roberts & Wickings 2022 | fovDeg 360, senses "vibration" | yes |
| Vibration reach | surfacing falls with distance, zero by 8–9 m from a grunting stake | m | MEASURED (*Diplocardia*) | Mitra et al. 2009 | sightMm 60 | not comparable: that is a stake driven by a man |
| Response to a digging predator | 23.6 worms/h surfaced per mole trial, "shortly after the mole entered"; emerged at 50 cm/min then slowed; crawled AWAY across the surface | — | MEASURED (*Diplocardia mississippiensis*) | Catania 2008; Vanderbilt release | flee pace 25 mm/s | partly: 8 mm/s for a ~250 mm worm |
| Response to simulated rain | 6 worms in 3 h-long trials, none before 25 min of steady rain | — | MEASURED (*Diplocardia*) | Catania 2008 | surfacesInRain true | weak for this species |
| Rain surfacing, tropical species | *A. gracilis*: poor immersion tolerance + night O₂ peak → crawls out at night after heavy rain; *P. corethrurus* never does | — | MEASURED | Chuang & Chen 2008 | surfacesInRain true, surfacesAtNight true | yes for *A. gracilis* |
| CO₂ as a trigger | worms are extremely CO₂-tolerant; receptors read protons/bicarbonate | — | MEASURED | Frontiers Ecol. Evol. 2023 (*Dendrobaena*) | not in table | CO₂ is NOT a surfacing trigger |
| Light | no eyes; epidermal photoreceptors, prostomium most sensitive; negative phototaxis; foraging drops at ≥ 10 lx, aggregate work −37 % at 5 lx | lx | MEASURED | Cai, Bennie & Gaston 2025; Cai et al. 2025 | sightMm 60 | not in table |
| Night activity | surface foraging, mating and dispersal at night; high-latitude summer light suppresses it | — | MEASURED | Nuutinen et al. 2014; Cai et al. 2025 | surfacesAtNight true | yes |
| Surface range from burrow | forages with tail in the burrow over 0.28–0.63 m² (r ≈ 30–45 cm); homes from up to 0.7 m | m² | MEASURED | Nuutinen & Butt 2005 | surfaceS 20–90 s, then re-burrows anywhere | no (see §Disagreements) |
| Anecic burrow depth | permanent vertical shaft 1–2 m (to 3 m); diameter ≈ body diameter | m | MEASURED | CABI; Bouché 1977 via review | underMm 12 | no, and the table says so |
| Endogeic / epi-endogeic depth | endogeic 10–30 cm horizontal; *A. gracilis* upper ~15 cm, sampled from the organic layer and first 5 cm | cm | MEASURED | Arrázola-Vásquez 2022; *A. gracilis* mesocosm/field studies | underMm 12 | closer, still shallow |
| Temperature, *L. terrestris* | growth best ~15–20; 25 lethal by 182 d; 30 lethal by 14 d | °C | MEASURED | Berry & Jordan 2001 | not in table | not in table |
| Hawaiʻi density | 92–469 worms/m² (both species) in Hawaiʻi Island plantations, 21 °C, 4 600 mm rain | /m² | MEASURED | Zou et al. 2010; UH thesis | 400/ha = 0.04/m² GAME TUNING | no, by 10⁴, and labelled |
| Litter intake, *L. terrestris* | 2–13 mg per g worm per day (lab); pulls leaves into the burrow, builds middens | mg/g/day | MEASURED | Biol. Fertil. Soils juvenile study; PLOS ONE 2015 | eats: litter | yes |
| Predators on Kauaʻi | hammerhead flatworm *Bipalium kewense* (earthworm specialist), *Scolopendra subspinipes*, cane toad, ground birds incl. feral chickens; ants recruit to worms | — | MEASURED (presence); BIOLOGICAL SHAPE (as a game list) | invasivespeciesinfo.gov; extento.hawaii.edu; NPIN | not in table | not in table |
| Turn rate | nothing published | rad/s | GAME TUNING | — | 1.2 | keep |
| Escape crawl speed | nothing published for a lumbricid; the only figure is *Diplocardia*'s 8 mm/s surfacing burst | mm/s | GAME TUNING | Catania 2008 | fleeMmS 25 | see §Disagreements |

## Behaviour profile

**Idle / rest.** The animal's default state is not `wander`; it is lying in its burrow. An
anecic worm spends the day in its shaft; an epi-endogeic *A. gracilis* lies in the litter
layer or the top 5 cm. Hunger and fatigue as needs are GAME TUNING throughout — nothing here
was measured — but the shape is right: a worm rests for hours and moves for minutes.

**Burrow.** Two different speeds, and the table has only one. Travelling along a burrow
that already exists, the worm crawls at Quillin's pace: about a tenth of its own length a
second, waves at 5–20 a minute (Seymour), each wave advancing it roughly a fifth of a body
length. Making NEW burrow it slows by a factor of thirty to seventy — about 0.2–0.5 mm/s in
soft wet soil (Ruiz), slower still as the soil hardens, switching from pushing the soil
aside to eating through it as resistance rises (Arrázola-Vásquez), and stopping altogether
when the soil's resistance passes the ~200 kPa its body can generate (Ruiz & Or), which is
what a dry spell does. A hatchling pushes 500 times its weight, an adult ten (Quillin 2000):
small worms are the ones that get into hard ground.

**Surface.** At night, in damp air. *L. terrestris* keeps its tail in the shaft and sweeps
a circle 30–45 cm across for litter (Nuutinen & Butt); *A. gracilis* is a litter-layer animal
and moves about in it. Light of 10 lx — a bright moon is 0.3, a streetlamp 10 — cuts
foraging (Cai). A light spot on the head is answered in 7–10 s (Bennett & Reinschmidt); a
touch or a substrate vibration is answered in milliseconds.

**Feed.** Litter and the microbes on it: leaves pulled into the burrow mouth, 2–13 mg per
gram of worm per day. *P. corethrurus* eats soil and never needs the surface.

**Flee.** Three different animals' worth of escape, and the game should pick one word's
worth. (1) Touch or vibration at the head while extended from the burrow: the giant-fibre
withdrawal — tail flattens to anchor, the anterior shortens back into the burrow, all inside
a few tens of milliseconds; DOWN and AWAY, the direction the table's brain already uses.
(2) A digging predator's vibration (< 500 Hz, ~100 Hz peak) felt from BELOW: the opposite —
surface within minutes at up to 8 mm/s, then crawl away across the ground. Kauaʻi has no
moles; the nearest thing is a chicken scratching or a toad, both from above, so (2) is a
response the animal carries but rarely uses here. (3) *Amynthas* specifically: violent
side-to-side thrashing and tail autotomy when handled (extension sources) — a grabbed worm
fights the grab. Calming: no measurement; Catania's worms kept crawling for minutes.

**Weather.** Heavy rain at night brings *A. gracilis* up because its night-time oxygen
demand cannot be met in flooded soil (Chuang & Chen); dry soil pins it down because it cannot
push (Ruiz 2021). *L. terrestris* is a weak rain-surfacer (Catania). CO₂ does nothing.

**Temperament.** Passive to everything that is not a touch, a vibration or a light. It never
attacks; an ant walking on it is a touch and gets the withdrawal. What eats it: the
hammerhead flatworm, the centipede, the toad, the chicken, and — in the ant's world — fire
ants, which recruit nestmates to a worm on the surface (NPIN). A worm is meat at colony
scale: one gram of worm is the mass of a thousand workers.

## Disagreements with the current table

1. **Species.** Table: *L. terrestris*, "Kauaʻi's introduced earthworms include it".
   Literature: no Hawaiʻi record found; 25 °C is lethal to it over months and lowland Kauaʻi
   soil never cools below that; the Hawaiʻi worms are *A. gracilis* and *P. corethrurus*.
   Recommend: rename to *Amynthas gracilis*, keep the rig, carry the *L. terrestris*
   locomotion numbers with the label saying so. Confidence: high on the thermal argument,
   medium on "no record" (Nakamura 1990 and the Bishop Museum checklist could not be opened).
2. **Length.** Table: 150 mm, range 120–250. *A. gracilis*: 60–160, typical ~100–110.
   Recommend 110 mm cited, range 60–160, if the rename is approved; else 150 with CABI's
   110–200. Confidence: high.
3. **Burrow pace = crawl pace.** Table docblock: "there is no measured discount for pushing
   through soil". There is: 0.2–0.5 mm/s of new burrow against 15 mm/s of crawl (Ruiz; Ruiz &
   Or). Recommend two paces — crawl in existing burrow and at the surface (Quillin), dig at
   ~0.3 mm/s scaled down by soil resistance — and a design call on which the wandering worm
   uses (§Open questions 2). Confidence: high on the existence and order of the discount;
   medium on the exact figure, which is a modelled/typical rate, not a *L. terrestris* run.
4. **Flee = faster crawl (25 mm/s, invented).** Literature: the fast escape is a withdrawal
   of a few centimetres into the burrow in milliseconds; the surface escape crawl is not
   measurably faster than a crawl (8 mm/s for a 250 mm *Diplocardia*). Recommend: `flee` for
   a soil species = retract-and-dive (short, quick, down-and-away), with the flee pace read as
   the withdrawal's speed over its first body length, not a sustained sprint; keep 25 mm/s as
   GAME TUNING only for that first second. Confidence: medium.
5. **Surface bout.** Table: surface 20–90 s, then burrow anywhere. Literature: anchored to
   ONE burrow, tail in, foraging a 30–45 cm circle, for a good part of a night. Recommend a
   `homeBurrow` point and surface bouts of minutes, re-entering at the same hole; keep the
   seconds as GAME TUNING if the phone cannot afford it. Confidence: high for *L. terrestris*,
   medium for *A. gracilis* (litter wanderer, less burrow-faithful).
6. **Depth band 12 mm.** The table already calls this a stage for the ant. With the rename
   the honest band is the litter layer and first 5 cm, which is 4× the stage, not 100×.
   Recommend 12 mm stays if the ant needs it, with the docblock rewritten to cite the
   epi-endogeic band. Confidence: high.
7. **Bore 6 mm.** Right for *A. gracilis* (3–6 mm body), thin for *L. terrestris* (7–10).
   Keep with the rename. Confidence: high.
8. **Peristalsis absent from the renderer.** Measured: 0.08–0.33 Hz waves (Seymour), stride
   ~0.2 BL, strain independent of size. Recommend re-adding as a wave in RADIUS (thick
   anchored segments, thin extending ones) with the bones held on the path — which is what
   `motion.ts` says went wrong last time: the wave was put into position. Confidence: high on
   the frequency, medium on the stride until Quillin's figure is read.
9. **Alarm distance 40 mm for an ant.** An ant's footfalls are not a vibration a worm
   answers; contact is. Recommend the ant's alarm reach = contact (≤ 5 mm) while the camera's
   stays a tuning number. Confidence: medium (no ant-on-worm vibration study exists).
10. **Density** is 10⁴ below Hawaiʻi's 92–469/m². Already GAME TUNING; agrees.
11. **`sizeRatio` linear in length.** For the worm this is the measured law (U ∝ M^0.33 ≈
    L^0.9). Agrees — note that worker.md found the OPPOSITE for ants (speed ∝ L^0.75).

## Open questions for Joshua

1. Rename to *Amynthas gracilis* (the animal actually under Kauaʻi's litter), or keep the
   night crawler as a knowingly imported "scenario" species the way *S. invicta* is?
2. Digging speed: at the honest 0.3 mm/s a worm making new burrow is invisible again
   (8 minutes per body length). Options: (a) worms travel in existing burrows at crawl pace
   and dig new ground rarely and slowly; (b) a GAME TUNING discount (say 3–5×, not 50×)
   labelled as such; (c) the surface is where worms are seen and the burrow is a hiding
   state. This is the number that bit the project twice; it needs a decision, not a value.
3. Does the ant get to eat the worm? Fire ants recruit to earthworms in the field. A surfaced
   worm as a large carrion/prey resource is a whole food mechanic (FAB §21 group carry).
4. Which flee: retract-into-burrow (biology's fast one), crawl-away (biology's slow one), or
   *Amynthas*'s thrash when grabbed? One word in `state.ts`, three motions.
5. A second soil species — *P. corethrurus*, the worm that NEVER surfaces — as the contrast
   that makes the rain-surfacing one legible?
6. Should the predator set (hammerhead flatworm, centipede, toad, chicken) enter the lab as
   creatures, or only as the reason the worm hides?
7. Home burrow fidelity (a remembered point per worm) versus the current "burrow anywhere".

## Sources

- Quillin, K.J. (1998). Ontogenetic scaling of hydrostatic skeletons: geometric, static stress and dynamic stress scaling of the earthworm *Lumbricus terrestris*. J. Exp. Biol. 201:1871–1883. https://journals.biologists.com/jeb/article/201/12/1871/8115/
- Quillin, K.J. (1999). Kinematic scaling of locomotion by hydrostatic animals: ontogeny of peristaltic crawling by the earthworm *Lumbricus terrestris*. J. Exp. Biol. 202:661–674. https://pubmed.ncbi.nlm.nih.gov/10021320/
- Quillin, K.J. (2000). Ontogenetic scaling of burrowing forces in the earthworm *Lumbricus terrestris*. J. Exp. Biol. 203:2757–2770. https://pubmed.ncbi.nlm.nih.gov/10952876/ (secondary carrying the 500×/10× wording: https://asknature.org/strategy/small-structures-burrow-efficiently/)
- Kurth, J.A. & Kier, W.M. (2014). Scaling of the hydrostatic skeleton in the earthworm *Lumbricus terrestris*. J. Exp. Biol. 217:1860–1867. https://journals.biologists.com/jeb/article/217/11/1860/12150/
- Seymour, M.K. (1969). Locomotion and coelomic pressure in *Lumbricus terrestris* L. J. Exp. Biol. 51:47–58. https://journals.biologists.com/jeb/article/51/1/47/21536/
- Ruiz, S., Or, D. & Schymanski, S.J. (2015). Soil penetration by earthworms and plant roots — mechanical energetics of bioturbation of compacted soils. PLoS ONE 10(6):e0128914. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0128914
- Ruiz, S. et al. (2017). Mechanics and energetics of soil penetration by earthworms and plant roots: higher rates cost more. Vadose Zone J. 16(8). https://acsess.onlinelibrary.wiley.com/doi/full/10.2136/vzj2017.01.0021
- Ruiz, S. & Or, D. (2018). Biomechanical limits to soil penetration by earthworms: direct measurements of hydroskeletal pressures and peristaltic motions. J. R. Soc. Interface 15:20180127. https://royalsocietypublishing.org/doi/10.1098/rsif.2018.0127
- Ruiz, S., Bickel, S. & Or, D. (2021). Global earthworm distribution and activity windows based on soil hydromechanical constraints. Commun. Biol. 4:612. https://www.nature.com/articles/s42003-021-02139-5
- Arrázola-Vásquez, E. et al. (2022). Earthworm burrowing modes and rates depend on earthworm species and soil mechanical resistance. Appl. Soil Ecol. 178:104568. https://www.sciencedirect.com/science/article/pii/S0929139322001846
- Keudel, M. & Schrader, S. (1999). Axial and radial pressure exerted by earthworms of different ecological groups. Biol. Fertil. Soils 29:262–269. https://link.springer.com/article/10.1007/s003740050551
- Joschko, M. et al. (1989). Assessment of earthworm burrowing efficiency in compacted soil. Biol. Fertil. Soils 8:191–196. https://link.springer.com/article/10.1007/BF00266478
- Drewes, C.D. (1980). The rapid escape response of the earthworm *Lumbricus terrestris*: overlapping sensory fields of the median and lateral giant fibres. J. Exp. Biol. 83:231–239. https://journals.biologists.com/jeb/article/83/1/231/22855/
- Drewes, C.D., Landa, K.B. & McFall, J.L. (1978). Giant nerve fibre activity in intact, freely moving earthworms. J. Exp. Biol. 72:217–227; and Drewes et al. (1980) Comp. Biochem. Physiol. A, longitudinal variations in MGF-mediated escape shortening. https://www.sciencedirect.com/science/article/abs/pii/030096298090256X
- Shannon, K.M. et al. (2014). Portable conduction velocity experiments using earthworms. Adv. Physiol. Educ. 38:62–70. https://journals.physiology.org/doi/full/10.1152/advan.00088.2013
- Bennett, M.F. & Reinschmidt, D.C. (1965). The diurnal cycle and a difference in reaction times in earthworms. Z. Vergl. Physiol. 49:407–411. https://link.springer.com/article/10.1007/BF00298110
- Catania, K.C. (2008). Worm grunting, fiddling, and charming — humans unknowingly mimic a predator to harvest bait. PLoS ONE 3(10):e3472. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0003472 (release with the 50 cm/min figure: https://news.vanderbilt.edu/2008/10/14/floridas-worm-grunters-collect-bait-worms-by-inadvertently-imitating-mole-sounds-66305/)
- Mitra, O., Callaham, M.A., Smith, M.L. & Yack, J.E. (2009). Grunting for worms: seismic vibrations cause *Diplocardia* earthworms to emerge from the soil. Biol. Lett. 5:16–19. https://royalsocietypublishing.org/doi/10.1098/rsbl.2008.0456
- Chuang, S.-C. & Chen, J.H. (2008). Role of diurnal rhythm of oxygen consumption in emergence from soil at night after heavy rain by earthworms. Invertebr. Biol. 127:80–86. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-7410.2007.00117.x
- Nuutinen, V. & Butt, K.R. (2005). Homing ability widens the sphere of influence of the earthworm *Lumbricus terrestris* L. Soil Biol. Biochem. 37:805–807. https://www.sciencedirect.com/science/article/abs/pii/S0038071704003888
- Nuutinen, V. et al. (2014). Dew-worms in white nights: high-latitude light constrains earthworm (*Lumbricus terrestris*) behaviour at the soil surface. Soil Biol. Biochem. 72:66–74. https://www.sciencedirect.com/science/article/abs/pii/S0038071714000248
- Cai, J., Bennie, J. & Gaston, K.J. (2025). Altered surface behaviour in earthworms (*Lumbricus terrestris*) under artificial light at night. Oecologia 207:114. https://link.springer.com/article/10.1007/s00442-025-05750-z ; and Cai et al. (2025) J. Appl. Ecol. https://besjournals.onlinelibrary.wiley.com/doi/10.1111/1365-2664.70202
- Berry, E.C. & Jordan, D. (2001). Temperature and soil moisture content effects on the growth of *Lumbricus terrestris* under laboratory conditions. Soil Biol. Biochem. 33:133–136. https://www.sciencedirect.com/science/article/abs/pii/S0038071700001127
- Zou, X. et al. (2010). The effects of tree plantation rotation on earthworm abundance and biomass in Hawaii. Appl. Soil Ecol. 46:... https://www.sciencedirect.com/science/article/abs/pii/S092913931000123X ; UH thesis: https://dspace.lib.hawaii.edu/items/eceb94aa-8df9-43cb-b3e1-b43c989e528d
- Nakamura, Y. (1990). How to identify Hawaiian earthworms. (Not opened.) Bishop Museum, Fauna Hawaiiensis, Annelida: https://hbs.bishopmuseum.org/pubs-online/pdf/fh2-4annelida.pdf
- Bishop Museum Cook Islands Biodiversity Database: *Amynthas gracilis* http://cookislands.bishopmuseum.org/species.asp?id=13871 ; *Pontoscolex corethrurus* http://cookislands.bishopmuseum.org/species.asp?id=13873
- CABI Compendium, *Lumbricus terrestris*. https://www.cabidigitallibrary.org/doi/abs/10.1079/cabicompendium.109385
- Virginia Tech Extension ENTO-427, Jumping worms (*Amynthas* spp.). https://www.pubs.ext.vt.edu/content/pubs_ext_vt_edu/en/ENTO/ENTO-427/ENTO-427.html
- Frontiers Ecol. Evol. (2023). Mechanisms of carbon dioxide detection in the earthworm *Dendrobaena veneta*. https://www.frontiersin.org/journals/ecology-and-evolution/articles/10.3389/fevo.2023.1202410/full
- Roberts, L. & Wickings, K. (2022). Biotremology: tapping into the world of substrate-borne waves. Acoustics Today. https://acousticstoday.org/wp-content/uploads/2022/08/Biotremology-Tapping-into-the-World-of-Substrate-Borne-Waves-Louise-Roberts-and-Kyle-Wickings-1.pdf
- Leaf-litter consumption and assimilation by juveniles of *Lumbricus terrestris*. Biol. Fertil. Soils. https://link.springer.com/article/10.1007/BF00337203
- Native Plant Information Network, "Beneficial earthworms attacked by fire ants". https://www.wildflower.org/expert/show.php?id=811
- Hammerhead worm (*Bipalium kewense*): https://www.invasivespeciesinfo.gov/terrestrial/invertebrates/hammerhead-worm ; *Scolopendra subspinipes* in Hawaiʻi: http://www.extento.hawaii.edu/kbase/urban/Site/Centip.htm
