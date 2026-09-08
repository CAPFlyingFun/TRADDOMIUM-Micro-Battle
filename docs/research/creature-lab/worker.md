# Fire ant worker — biology for the Creature Lab

Research pass 2026-09-08 for the Creature Lab (Joshua §11, §12). This file EXTENDS
`docs/research/FIRE_ANT_BIOLOGY.md` (cited below as FAB §n) and does not repeat it.
Every number carries one of the three labels from FAB §38 / `creatures/species.ts`:
MEASURED, BIOLOGICAL SHAPE, GAME TUNING. Where nothing is published it says so.

Access note: the journal hosts (OUP, PMC, Springer, ScienceDirect, BioOne, arXiv,
ARS, FSU) are blocked from this environment, so the numbers below come from the
abstracts, extension pages and secondary summaries that were reachable. Each row
names its primary paper so Claude can verify one from a machine that can open it.

## The animal

*Solenopsis invicta* Buren, the red imported fire ant, worker caste. It is the species
FAB §2 fixes for the whole game, and the worker is the body the player will most often
be. Workers are CONTINUOUSLY polymorphic (FAB §3; Joshua §12: no discrete soldier):
head width runs 0.45–1.50 mm and the size-frequency curve of a mature colony is two
overlapping normals — a narrow "minor" hump and a broad "major" tail — not two body
plans (Tschinkel 1988). Everything that matters in the lab — speed, carry, sting,
tunnel bore, lifespan, which threat it answers — is a function of that one size draw.
Kauaʻi note: *S. invicta* is not established in Hawaiʻi; FAB §2.1 already treats the
island as an alternate scenario and nothing here changes that.

## Numbers

Body length ≈ 4 × head width across the range (1.6–6.0 mm against 0.45–1.50 mm; head
length holds a constant proportion to body length, Tschinkel et al. 2003) — a derived
rule, BIOLOGICAL SHAPE, for turning a head-width draw into a rig scale.

| quantity | value | unit | label | source | current table says | agrees? |
|---|---|---|---|---|---|---|
| Body length, range | 1.6–6.0 | mm | MEASURED | Texas A&M fire ant project (identification page); CDFA profile | not in table | not in table |
| Head width, range | 0.45–1.50 | mm | MEASURED | Wood & Tschinkel 1981; Haight 2010 (0.5–1.5) | not in table | not in table |
| Size classes by head width | small ≤0.80, medium ≤1.00, large ≤1.50 | mm | MEASURED | Wood & Tschinkel 1981 | FAB §3 names the ladder, no numbers | yes |
| Mature colony proportions | 45 / 42 / 16 (small / medium / large) | % of workers | MEASURED | Wood & Tschinkel 1981 | not in table | not in table |
| Incipient colony | monomorphic, small workers only; majors appear as the colony grows | — | MEASURED | Tschinkel 1988 | FAB §16 minims first | yes |
| Live mass, small worker | 0.65 ± 0.31 | mg | MEASURED | Chen, Rashid & Feng 2014 (PLOS One) | not in table | not in table |
| Live mass, large worker | 3.99 ± 0.65 | mg | MEASURED | Chen, Rashid & Feng 2014 | not in table | not in table |
| Live mass, extremes seen | 0.16 (lightest) to 4.62 (heaviest) | mg | MEASURED | InvictDetect immunostrip study, Insects 2020 | not in table | not in table |
| Mass vs head width | isometric (mass ∝ HW³); 6-fold small→large | — | MEASURED | Tschinkel et al. 2003; Calabi & Porter 1989 | not in table | not in table |
| Typical worker | ~3 mm, ~1 mg (median sits at the small/medium line, HW ≈ 0.8) | mm, mg | BIOLOGICAL SHAPE | derived from the two rows above | not in table | not in table |
| Lifespan vs size | large workers live 50–140 % longer than small (24–30 °C) | — | MEASURED | Calabi & Porter 1989 | not in table | not in table |
| Walking pace on a trail | 9.6 ± 0.16 (≈2.7 body lengths/s for a 3.5 mm worker) | mm/s | MEASURED | Comparative trail-following study, Insects 2020, doi 10.3390/insects11010005 | housefly wander 15 mm/s (BIOLOGICAL SHAPE) | not in table |
| Running burst, in tunnels | > 9 (≈27 mm/s at 3 mm, ≈54 mm/s at 6 mm) | body lengths/s | MEASURED (tunnel); applying it on the flat is GAME TUNING | Gravish et al. 2013 (PNAS) | not in table | not in table |
| Flat-ground burst | none published for *S. invicta*; recommend the tunnel figure as the ceiling | — | GAME TUNING | — | not in table | not in table |
| Speed vs size | speed ∝ mass^0.25 (≈ length^0.75): major ≈ 1.9 × minim, NOT 3 × | — | BIOLOGICAL SHAPE | Hurlbert, Ballantyne & Powell 2008 (24 ant species) | `sizeRatio` scales pace linearly with length (worm law) | no |
| Turn rate | ~6 (a half-turn in half a second at walking pace) | rad/s | GAME TUNING | no measurement found | housefly 6, worm 1.2 | not in table |
| Acceleration | none published | — | GAME TUNING | — | not in table | not in table |
| Activity band, soil surface | forages 15–43; maximal 22–36 | °C | MEASURED | Porter & Tschinkel 1987; Vogt et al. 2003 (Oklahoma) | not in table | not in table |
| Critical thermal maximum | 40.7 (field, Blue Ridge) to 46.4 ± 0.1 (lab) | °C | MEASURED | PLOS One 2020 acclimation study; Chen, Rashid & Feng 2014 | not in table | not in table |
| Rain | foraging rate falls ≈ 40 % | — | MEASURED | Porter & Tschinkel 1987 | not in table | not in table |
| Day / night | nocturnal when the surface exceeds ~36 °C (summer), diurnal in cool seasons | — | MEASURED | Porter & Tschinkel 1987; Vogt et al. 2003 | not in table | not in table |
| Surface exposure per trip | every point of the territory is within 26 cm of a tunnel exit; ~0.5 m of surface walking | cm, m | MEASURED | Tschinkel 2011 | FAB §7 exits every 50–100 cm | yes |
| Territory (monogyne) | 12–197 | m² | MEASURED | Tschinkel 2011 (citing Showler/Tschinkel field work) | not in table | not in table |
| Route fidelity | none — a marked forager turns up anywhere in the territory a day later | — | MEASURED | Tschinkel 2011 | not in table | not in table |
| Trail pheromone life | fades in ≈ 100 s; below detection ≈ 2 min unless re-laid; (Z,E)-α-farnesene | s | MEASURED | Wilson 1962; Wilson & Bossert 1963; Vander Meer et al. 1988 | not in table | not in table |
| Alarm pheromone | 2-ethyl-3,6-dimethylpyrazine, detected at 30 pg/ml; rapid erratic running + attraction | — | MEASURED | Vander Meer, Preston & Choi 2010 | not in table | not in table |
| Compound eye | 48 (minor) to 92 (major) ommatidia; colour discrimination present | facets | MEASURED | Baker & Ma 2006; Insectes Sociaux 2019 colour study | not in table | not in table |
| Sight distance (moving object) | 50 | mm | GAME TUNING | 48–92 facets resolve only coarse motion | aphid 30, fly 300 | not in table |
| Vibration | substrate vibration via subgenual organs; stridulation rises 6-fold in a simulated cave-in | — | MEASURED | J. Insect Behav. 2006 stridulation study; vibroacoustic review | not in table | not in table |
| Reaction latency, single worker | 0.2–0.5 | s | GAME TUNING | no per-worker measurement; "hundreds emerge within seconds" is extension-level | fly 200 ms (Card & Dickinson) | not in table |
| Sleep | 253 naps/day × 1.1 min ≈ 4.8 h; ~80 % of workers awake at any moment; deep sleep = antennae folded, unresponsive | — | MEASURED | Cassill et al. 2009 | not in table | not in table |
| Liquid vs solid loads | 70–80 % of successful foragers return with liquid | % | MEASURED | Tennant & Porter 1991 | FAB §17 sugar vs protein | yes |
| Solid prey, by habitat | Diptera adults + larvae + pupae > 58 % (lakeshore); termites > 21 % (wooded roadside); seeds 15–17 % (grassland, pasture) | % of particles | MEASURED | Vogt et al. 2002 | not in table | not in table |
| Fly predation | horn fly larvae/pupae/tenerals in cowpats: 94.3 % and 62.9 % mortality (two years); stable flies preyed on | % | MEASURED | Hu & Frank 1996; Summerlin & Kunz 1978 | housefly listed as `omnivore`, no predator | not in table |
| Earthworm | in the diet as DEAD animal matter (with insects, vertebrates); no published record of a worker killing a healthy adult *Lumbricus* | — | MEASURED (diet list) | UF/IFAS EENY-195; Wilson & Oliver 1969 | worm `skittish`, alarmed by camera only | not in table |
| Aphid | tended for honeydew; ants kill coccinellid larvae attacking tended aphids; parasitised mummies removed; culling of low-yield aphids is documented for ants generally, not measured for *S. invicta* | — | MEASURED (mutualism); BIOLOGICAL SHAPE (culling) | Kaplan & Eubanks 2002; Styrsky & Eubanks 2007, 2010; Rice & Eubanks 2013; Persad & Hoy 2004 | aphid `passive`, `honeydew-host` sites exist | not in table |
| Crop load | scales with body mass (≈ 40 % of variance) and viscosity; recruits 32 m out load more than at 8–16 m | — | MEASURED | Insectes Sociaux 2008 travel-distance study | not in table | not in table |
| Maximum lift | 8.78 ± 0.26 × body mass, isometric across sizes — *Atta cephalotes*, used as PROXY; no *S. invicta* figure found | × body mass | BIOLOGICAL SHAPE | Segre & Taylor 2019 (J. Exp. Biol.) | FAB §21 tiny/small/large/too-large | yes (shape) |
| Solo carry | a 1 mm³ sausage cube is carried by one ant; larger items group-carried or cut | — | MEASURED | Sci. Rep. 2019 vertical-surface study (FAB ref 13) | FAB §21 | yes |
| Venom reserve | ≈ 18 µg in a mature worker; scales positively with size | µg | MEASURED | Haight & Tschinkel 2003; Haight 2010 | not in table | not in table |
| Venom per sting | 0.66 nl ≈ 0.56 µg ≈ 3.1 % of the reserve (≈ 30 full stings) | nl, µg | MEASURED | Haight & Tschinkel 2003 | FAB §22 "stings repeatedly" | yes, extends |
| Venom synthesis | 1.17 µg/day at 1 day old (HW 1 mm); 0.30 at 15 days; negligible after | µg/day | MEASURED | Haight & Tschinkel 2003 | not in table | not in table |
| Sting length | majors ≈ 0.20 mm (40 %) longer than minors, little overlap | mm | MEASURED | Haight 2010 | not in table | not in table |
| Who answers a threat | heavy, vertebrate-like disturbance draws larger workers; majors' share rises five-fold vs a light insect-like one | — | MEASURED | Haight 2010 | not in table | not in table |
| Bite force | none published; mandible length isometric, head width positively allometric (strength kept up with size) | — | BIOLOGICAL SHAPE (bite ∝ mass^⅔, slight major bonus) | Tschinkel et al. 2003 | not in table | not in table |
| Tunnel bore | tracks worker body length; falls are self-arrested only below 1.31 ± 0.02 body lengths of diameter | body lengths | MEASURED | Gravish et al. 2012, 2013 | FAB §5.2 | yes |
| Dig rate | all sizes excavate; total tunnel area no different large vs small; mixed group dug most; wetted fine particles best | — | MEASURED (shape), no rate retrieved | Gravish et al. 2012; Monaenkova et al. 2015 | FAB §5 | yes |
| Phorid response | freeze, or curl into an inverted "C"; one fly can halt hundreds of foragers; food retrieval down ≈ 50 % (*S. geminata* field) | — | MEASURED | Wuellner et al. 2002; Feener & Brown 1992; USDA ARS phorid page | not in table | not in table |
| Water | workers carry water in the crop; cuticular lipids cut water loss (removal raises it 14×); no *S. invicta* water-foraging rate found | — | MEASURED (physiology); GAME TUNING (drink rate) | Chen, Rashid & Feng 2014; FAB §4 (Texas A&M) | `water-edge` sites exist | not in table |

## Behaviour profile

In the game's words (`creatures/state.ts`), plus the lab's `attack` / `hunt` for a
predator, and two the worker will need that no current species has: `carry` and
`dig` (the tunnel is FAB §7's whole foraging model).

**Where it starts.** A worker on the surface is a forager (older, larger — Mirenda &
Vinson 1981) and is almost never far from a hole: Tschinkel 2011 puts every point of
the territory within 26 cm of a tunnel exit, so `wander` for a fire ant is a short
loop out of one exit and back into it or the next, not a walk across the island.
Idle-on-the-surface is rare; `rest` is indoors, and it is polyphasic — a nap of about
a minute, 250 times a day, so at any moment four in five workers are awake (Cassill
2009). For the lab, `restS` of 40–120 s is the measured shape; the six-hour night the
worm has is wrong for an ant.

**Pace.** `wander` 9.6 mm/s on a trail, MEASURED; `flee` and `hunt` at the tunnel
burst, >9 body lengths/s (27 mm/s at 3 mm, 54 at 6 mm); both scaled by
sizeRatio^0.75, not sizeRatio (Hurlbert 2008), and by a temperature hump that is zero
below 15 °C and above 43 °C and flat between 22 and 36 °C (Porter & Tschinkel 1987) —
the same soil-surface temperature the sky/solar stack can already supply. Rain cuts
the number of foragers out by ~40 %; the ones out keep moving. Night is not a bar:
when the day surface is over ~36 °C the colony forages after dark instead.

**Feed.** Omnivore, but 70–80 % of loads are liquid (Tennant & Porter 1991): the
resource kinds in preference order are `honeydew-host` (an aphid colony), `nectar`,
`sap`, then `carrion` and live prey for protein, `seed` last (S. invicta takes an
eighth of the seeds S. geminata does). A feed at a liquid source is a crop fill that
scales with body mass; the forager then returns — `feed` for the worker is short (tens
of seconds) and ends in a trip home, which is the loop the colony later hangs
recruitment on (FAB §7.1, §25). Drinking is the same act at a `water-edge`.

**Senses.** Antennae first: a trail is followed by chemistry that fades in about
100 s, and alarm pheromone is detected at 30 pg/ml and answers with fast erratic
running TOWARD the source (Vander Meer 2010) — the fire ant's alarm is an attraction,
the opposite of the worm's and the fly's. Eyes second: 48–92 facets see motion at a
few centimetres, so `sightMm` ≈ 50, `fovDeg` wide. Vibration third, through the legs,
and it is the trigger that empties a mound.

**Attack and flee are one decision, sized.** Near the nest a disturbance is answered
by attack, and the heavier it is, the larger the workers that answer (Haight 2010): a
light insect-like touch draws minors; a vertebrate-like stamp draws majors five times
as often. The attack itself is FAB §22 — grab, anchor, curl, sting — and each sting
spends ~3 % of a finite reserve that an old forager no longer replenishes. Away from
the nest a lone forager does not fight what it cannot win: the documented flee is the
phorid response — stop, hide or curl into a "C" — and food retrieval halves while a
fly hangs over the trail. So `flee` for a worker is FREEZE/RETREAT toward the nearest
exit at burst pace, `alarmS` short (the pyrazine is short-lived), and the lab's
`attack` is gated on nest proximity, recruitment count and threat size, all of which
are Joshua's calls (below).

**Aphid, earthworm, housefly, in that order of restraint.** An aphid colony is a
`honeydew-host` to stand on and defend — the worker kills a ladybird larva that
touches it and carries off a parasitised mummy — and is only eaten as a cull, which the
ant literature documents but nobody has measured for *S. invicta*: NOT default prey
(Joshua §11 confirmed by the biology). A housefly is prey at every stage it can be
caught — larvae, pupae and tenerals in dung at 63–94 % mortality — and carrion when
dead (cut and group-carried per §21); a healthy adult on the wing has a 200 ms escape
(the fly's own entry) and is not documented as caught. An earthworm is in the diet as a
corpse; a live 150 mm *Lumbricus* is three thousand worker-masses and no paper shows
one killed — capability with recruitment, not a lone worker's hunt.

**Habitat.** Open, warm, disturbed ground — grassland, lawn, roadside, pasture edge,
near water (FAB §4) — the `grassland` and `shrubland` habitats, thin in `forest`, none
on `beach`, `rocky`, `ridge` or at sea. Will not cross: open water (a film over
substrate excepted, FAB §10.1), a surface above ~43 °C, ground below ~15 °C.

## Disagreements with the current table

1. **Pace scaling.** `species.ts` scales every pace by `sizeRatio` (length¹), which is
   Quillin's worm law. For ants the compiled measurement is speed ∝ mass^0.25 ≈
   length^0.75 (Hurlbert 2008): a 6 mm major runs ~1.9× a 2 mm minim, not 3×.
   Recommend a per-species exponent on `sizeRatio` (worm 1, ant 0.75). Confidence: high
   that the law differs; medium on the exact exponent (0.14–0.34 across species).
2. **"Major" as a caste entry.** `data/registries.ts` says major "is a caste entry with
   its own curves". Joshua §12 and Wood & Tschinkel / Tschinkel 1988 say one worker,
   one continuous draw (two overlapping normals, 45/42/16 in a mature colony, all-small
   in a founding one). Recommend ONE worker caste whose curves are indexed by the size
   draw, with "Major" kept only as the UI word for the top of the distribution (FAB §3
   already says so). Confidence: high.
3. **Temperament vocabulary.** The union is `passive | skittish`; a worker is neither.
   It needs a word that attacks (`defensive`, with the size/proximity gate above). The
   diet union's `omnivore` fits as it stands. Confidence: high.
4. **Rest shape.** Every current species rests for tens of seconds to minutes in one
   block; the measured worker rests in ~1 min naps 250 times a day, mostly indoors.
   Recommend short `restS`, low `restAt`, rest only inside a tunnel. Confidence: high.
5. **Venom is finite and a meter.** FAB §22 says "stings repeatedly"; the measurement
   is ~30 full stings per reserve and synthesis stops by day 15 of adult life. The
   survival invariant says a bar may only move if it can move back — so either venom
   refills (young-worker biology, BIOLOGICAL SHAPE) or the sting has no meter. Flagged,
   not decided. Confidence: high on the biology.
6. **The aphid's alarm.** The aphid entry is alarmed by anything closer than 20 mm; a
   tending fire ant stands ON it. The aphid must not flee its tender. Confidence: high.
7. **Surface exposure.** Nothing in the table assumes it, but the lab should: a fire
   ant is within 26 cm of a hole. A worker wandering 10 m across open ground is not
   this species (Tschinkel 2011). Confidence: high.

## Open questions for Joshua

1. When does a worker ATTACK an aphid? Biology says never by default and cull when
   honeydew is plentiful and protein short — is the cull a mechanic, and who decides?
2. Earthworm: capability-with-recruitment only, or can the PLAYER's lone worker start
   the fight? Biology gives no lone-worker kill.
3. Housefly adults: uncatchable on the wing (200 ms escape) — or does a grounded/
   feeding fly count as catchable for play?
4. Venom: a finite reserve that does not refill in an old worker, a slow-refilling
   meter, or no meter (invariant §"a bar may only move…")?
5. Size draw: two-normal mixture at 45/42/16 from the start, or all-small until the
   colony grows (Tschinkel 1988), which makes the player's early workers minims?
6. Speed on the flat: adopt the tunnel burst (>9 BL/s) as the sprint ceiling, or hold
   sprint nearer the 2.7 BL/s trail pace until a flat-ground measurement is found?
7. Temperature gating: should the 15–43 °C band actually stop surface activity, given
   Kauaʻi's real readings, or only scale it?
8. Threat sizing (Haight 2010): does the lab model "who answers" by size, i.e. the
   camera/player registering as vertebrate-heavy and drawing majors?

## Sources

- Baker GT, Ma PWK (2006). Morphology and number of ommatidia in the compound eyes of *S. invicta*, *S. richteri* and their hybrid. Zool. Anz. 245:121–125. https://www.researchgate.net/publication/248907637
- Calabi P, Porter SD (1989). Worker longevity in the fire ant *S. invicta*: ergonomic considerations of correlations between temperature, size and metabolic rates. J. Insect Physiol. 35:643–649. https://www.sciencedirect.com/science/article/abs/pii/0022191089901273
- Cassill DL, Brown S, Swick D, Yanev G (2009). Polyphasic wake/sleep episodes in the fire ant, *S. invicta*. J. Insect Behav. 22:313–323. https://link.springer.com/article/10.1007/s10905-009-9173-4
- Chen J, Rashid T, Feng G (2014). A comparative study between *S. invicta* and *S. richteri* on tolerance to heat and desiccation stresses. PLOS One 9(6):e96842. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0096842
- Comparative quantification of trail-following behavior in pest ants (2020). Insects 11(1):5. https://doi.org/10.3390/insects11010005
- Efficacy of the InvictDetect Immunostrip to identify *S. invicta* using a single worker (2020). Insects 11(1):37. https://doi.org/10.3390/insects11010037
- Feener DH, Brown BV (1992). Reduced foraging of *S. geminata* in the presence of parasitic *Pseudacteon* spp. Ann. Entomol. Soc. Am. 85:80–84; USDA ARS, Phorid flies as biocontrol agents. https://www.ars.usda.gov/southeast-area/gainesville-fl/cmave/imported-fire-ant-and-household-insects-research/docs/phorid-flies-as-biocontrol-agents/
- Gravish N, Monaenkova D, Goodisman MAD, Goldman DI (2013). Climbing, falling, and jamming during ant locomotion in confined environments. PNAS 110:9746–9751. https://www.pnas.org/doi/10.1073/pnas.1302428110
- Gravish N et al. (2012). Effects of worker size on the dynamics of fire ant tunnel construction. J. R. Soc. Interface 9:3312–3322. https://royalsocietypublishing.org/doi/10.1098/rsif.2012.0423
- Haight KL (2010). Worker size and nest defense in *S. invicta*. Ann. Entomol. Soc. Am. 103(4):678–682. https://academic.oup.com/aesa/article/103/4/678/166427
- Haight KL, Tschinkel WR (2003). Patterns of venom synthesis and use in the fire ant, *S. invicta*. Toxicon 42:673–682. https://pubmed.ncbi.nlm.nih.gov/14602123/
- Hu GY, Frank JH (1996). Effect of the red imported fire ant on dung-inhabiting arthropods in Florida. Environ. Entomol. 25(6):1290–1296. https://academic.oup.com/ee/article-abstract/25/6/1290/367267
- Hurlbert AH, Ballantyne F, Powell S (2008). Shaking a leg and hot to trot: the effects of body size and temperature on running speed in ants. Ecol. Entomol. 33:144–154. https://resjournals.onlinelibrary.wiley.com/doi/10.1111/j.1365-2311.2007.00962.x
- The influence of travel distance on sugar loading decisions and water balance in the central place foraging ant *S. invicta* (2008). Insectes Soc. https://link.springer.com/article/10.1007/s00040-008-0980-y
- Kaplan I, Eubanks MD (2002). Disruption of cotton aphid–natural enemy dynamics by red imported fire ants. Environ. Entomol. 31:1175–1183. https://academic.oup.com/ee/article/31/6/1175/461255
- Mirenda JT, Vinson SB (1981). Division of labour and specification of castes in the red imported fire ant. Anim. Behav. 29:410–420. https://www.sciencedirect.com/science/article/abs/pii/S0003347281801005
- Monaenkova D et al. (2015). Behavioral and mechanical determinants of collective subsurface nest excavation. J. Exp. Biol. 218:1295–1305. https://journals.biologists.com/jeb/article/218/9/1295/14545
- Persad AB, Hoy MA (2004). Predation by *S. invicta* and *Blattella asahinai* on *Toxoptera citricida* parasitized by *Lysiphlebus testaceipes* and *Lipolexis oregmae* on citrus in Florida. Biol. Control 30:531–537. https://www.sciencedirect.com/science/article/abs/pii/S1049964403002391
- Porter SD, Tschinkel WR (1987). Foraging in *S. invicta*: effects of weather and season. Environ. Entomol. 16:802–808. https://academic.oup.com/ee/article-abstract/16/3/802/383634
- Rice KB, Eubanks MD (2013). No enemies needed: cotton aphids directly benefit from red imported fire ant tending. Fla. Entomol. 96(3). https://bioone.org/journals/florida-entomologist/volume-96/issue-3/024.096.0329/
- Segre PS, Taylor ED (2019). Large ants do not carry their fair share: maximal load-carrying performance of leaf-cutter ants (*Atta cephalotes*). J. Exp. Biol. 222:jeb199240. https://journals.biologists.com/jeb/article/222/12/jeb199240/20373
- Styrsky JD, Eubanks MD (2007). Ecological consequences of interactions between ants and honeydew-producing insects. Proc. R. Soc. B 274:151–164; (2010) A facultative mutualism between aphids and an invasive ant increases plant reproduction. Ecol. Entomol. 35:190–199. https://www.researchgate.net/publication/6651392
- Summerlin JW, Kunz SE (1978). Predation of the red imported fire ant on stable flies. Southwest. Entomol. 3:260–262.
- Tennant LE, Porter SD (1991). Comparison of diets of two fire ant species: solid and liquid components. J. Entomol. Sci. 26:450–465. https://www.ars.usda.gov/arsuserfiles/60360510/publications/Tennant_and_Porter-1991(M-2551).pdf
- Texas A&M Imported Fire Ant Research and Management Project, Fire ant identification. https://fireant.tamu.edu/learn/fire-ant-identification/ ; CDFA RIFA pest profile. https://www.cdfa.ca.gov/plant/pdep/target_pest_disease_profiles/rifa_profile.html
- Tschinkel WR (1988). Colony growth and the ontogeny of worker polymorphism in the fire ant, *S. invicta*. Behav. Ecol. Sociobiol. 22:103–115. https://link.springer.com/article/10.1007/BF00303545
- Tschinkel WR (2011). The organization of foraging in the fire ant, *S. invicta*. J. Insect Sci. 11:26. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3391925/
- Tschinkel WR, Mikheyev AS, Storz SR (2003). Allometry of workers of the fire ant, *S. invicta*. J. Insect Sci. 3:2. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC524642/
- UF/IFAS EENY-195 / IN352, Red imported fire ant. https://ask.ifas.ufl.edu/publication/IN352
- Vander Meer RK, Alvarez F, Lofgren CS (1988). Isolation of the trail recruitment pheromone of *S. invicta*. J. Chem. Ecol. 14:825–838. https://link.springer.com/article/10.1007/BF01018776
- Vander Meer RK, Preston CA, Choi MY (2010). Isolation of a pyrazine alarm pheromone component from the fire ant, *S. invicta*. J. Chem. Ecol. 36:163–170. https://link.springer.com/article/10.1007/s10886-010-9743-0
- Vogt JT, Grantham RA, Smith WA, Arnold DC (2002). Dietary habits of *S. invicta* in four Oklahoma habitats. Environ. Entomol. 31(1):47–53. https://bioone.org/journals/environmental-entomology/volume-31/issue-1/0046-225X-31.1.47/
- Vogt JT et al. (2003). Effects of temperature and season on foraging activity of red imported fire ants in Oklahoma. Environ. Entomol. 32(3):447–451. https://academic.oup.com/ee/article/32/3/447/385941
- Wilson EO (1962). Chemical communication among workers of the fire ant *S. saevissima* (= *invicta*). Anim. Behav. 10:134–164; Wilson EO, Bossert WH (1963). Chemical communication among animals. Recent Prog. Horm. Res. 19:673–716. https://www.sciencedirect.com/science/article/abs/pii/0003347262901422
- Wilson NL, Oliver AD (1969). Food habits of the imported fire ant in pasture and pine forest areas in southeastern Louisiana. J. Econ. Entomol. 62:1268–1271.
- Wood LA, Tschinkel WR (1981). Quantification and modification of worker size variation in the fire ant *S. invicta*. Insectes Soc. 28:117–128. https://link.springer.com/article/10.1007/BF02223700
- Wuellner CT, Porter SD, Gilbert LE (2002). Phorid fly oviposition behavior and fire ant reaction to attack differ according to phorid species. Ann. Entomol. Soc. Am. 95:257–266. https://academic.oup.com/aesa/article/95/2/257/51010
- Invasion and high-elevation acclimation of *S. invicta* in the southern Blue Ridge Escarpment (2020). PLOS One. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232264
- Colony-wide behavioral contexts of stridulation in imported fire ants (2006). J. Insect Behav. https://link.springer.com/article/10.1007/s10905-006-9026-3
- Food transport of red imported fire ants on vertical surfaces (2019). Sci. Rep. 9. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6397150/ (FAB ref 13)
