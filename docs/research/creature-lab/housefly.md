# Housefly — biology for the Creature Lab

Research pass 2026-09-08 for the Creature Lab's air-control test. This file EXTENDS
`docs/research/FIRE_ANT_BIOLOGY.md` (cited as FAB §n) and reports DELTAS against
`src/creatures/species.ts` (`HOUSEFLY`, its `FlightSpec`) and `src/fauna/motion.ts`
(`WINGBEAT_HZ`). Every number carries one of FAB §38's labels: MEASURED, BIOLOGICAL
SHAPE, GAME TUNING. Where nothing is published it says so and proposes a tuning value.

Access note: the sandbox's egress policy blocks every journal, extension, encyclopaedia
and repository host (PubMed, PMC, Springer, Cambridge, Royal Society, Science, OUP,
Wiley, ScienceDirect, UF/IFAS, ADW, Wikipedia, arXiv, doi.org, archive.org). The pages
below were reached through the attached Nimble connector and the Europe PMC REST API,
and two PDFs (Zahn 2019; Wehrhahn et al. 1982) were decoded and read in full. Wagner
1986, Rockstein & Bhatnagar 1966 and Unwin & Corbet 1984 are paywalled: their numbers
come from abstracts and from a peer-reviewed compilation (Pinto et al. 2022), and say so.

## The animal

*Musca domestica* Linnaeus, the house fly. Cosmopolitan and synanthropic — "spread to
all inhabited land masses" (LSU AgCenter) — so it is on Kauaʻi wherever there is
livestock, refuse, dung or carrion, which is the lowland the ant lives in. It is the
right species for an AIR-control test because it is the best-measured flying insect
after *Drosophila*: free-flight kinematics (Wagner 1986; Wehrhahn et al. 1982), the
visually evoked escape (Holmqvist & Srinivasan 1991, on *Musca* itself), landing on
posts and ceilings (Wagner 1982; Liu et al. 2019), the eye's temporal resolution
(Juusola lab 2026) and the field flight day (Zahn & Gerry 2020) all exist. The current
table's length (4–8 mm, mean 6.35, ADW) is right; what changes below is the flight —
faster, twitchier and lower-beating than the code assumes — and the senses, which
should be angular and looming-based rather than a flat 300 mm. What it is NOT: the fly
that hovers in circles under a lamp (that is *Fannia canicularis*, the lesser house
fly) and not the wrack-line fly of a beach (kelp flies, Coelopidae).

## Numbers

| quantity | value | unit | label | source | current table says | agrees? |
|---|---|---|---|---|---|---|
| Body length | 4–8, mean 6.35 | mm | MEASURED | ADW (Doctor 2013); LSU AgCenter 6–7 | 6.5, range 4–8 | yes |
| Wingspan | 13–15 | mm | MEASURED | ADW | not in table | not in table |
| Mass, adult | 12 (ADW average); 11.5 male / 17.5 female on an UNSOURCED popular page | mg | MEASURED (ADW); the sex split unverified | ADW; Quora | not in table | not in table |
| Lifespan, adult | 15–25 typical, 60 max; 2–3 d without food | d | MEASURED | ADW; LSU AgCenter | — | not in table |
| Walking speed | NOT PUBLISHED for *Musca* in anything reachable; the comment's "a few body lengths a second" has no source | mm/s | GAME TUNING (table's 15 = 2.3 body/s) | — | 15 wander, labelled BIOLOGICAL SHAPE | relabel |
| Walking turns | saccadic, 5–10 turns/s, ~1,000 °/s (17 rad/s) peak; head turns faster than thorax | °/s | MEASURED (*Calliphora vicina*, congener) | Blaj & van Hateren 2004 | turnRadS 6 | mean plausible, peak 3× higher |
| Flee on foot | moot: the flee IS a takeoff | — | — | Holmqvist & Srinivasan 1991 | fleeMmS 40 | unused in practice |
| Flight speed, average | ~2 (= 7 km/h; ~300 body lengths/s) | m/s | MEASURED, compiled | West 1951; Shepard et al. 1972; Wagner 1986; Dahlem 2009 — as compiled by Zahn 2019 | cruise 1.5 | no — see D1 |
| Flight speed, maximum | "not published … somewhere above 2 m/s" | m/s | GAME TUNING (recommend 3) | Zahn 2019 | none (flee handled by flight) | not in table |
| Chase speed law | forward speed = 10.1 s⁻¹ × distance to target, 70 ms delay; turning delay 30 ms | s⁻¹, ms | MEASURED (*Musca* males) | Wehrhahn, Poggio & Bülthoff 1982 | — | not in table |
| Cage flight, congener | average 0.58, up to 1.2 in a 40 cm cage; accel up to 1 g vertical, 2 g horizontal | m/s | MEASURED (*Calliphora vicina*) | Schilstra & van Hateren 1998, 1999 | — | not in table |
| Wingbeat frequency | 130 (free flight, Sotavalta 1947); 160–162 (tethered, Rockstein & Bhatnagar 1966); 180 (free flight, optical tachometer, Unwin & Corbet 1984) | Hz | MEASURED | Pinto et al. 2022, Table 1 | `WINGBEAT_HZ` 200, "commonly 150–250" | no — see D2 |
| Flight turn (saccade) | 20–30 ms, ~10/s, yaw up to 90° (90 % < 50°), peak 2,000 °/s (35 rad/s) | ms, °/s | MEASURED (*C. vicina*; "similar saccadic characteristics to *Musca* (Wagner 1986a)") | Schilstra & van Hateren 1999 | turnRadS 6 in air | no — see D3 |
| Escape trigger | approaching DARK object, not a receding one; a bright object only when it recedes; darkening contrast at escape roughly constant | — | MEASURED (*Musca*) | Holmqvist & Srinivasan 1991 | "looming threat", alarm by distance | shape yes, rule no — D4 |
| Escape pathway | freely moving flies escape > 100 ms before the jump-muscle spike: not the giant-fibre reflex | ms | MEASURED (*Musca*) | Holmqvist 1994 | — | not in table |
| Escape planning | ~200 ms of postural adjustment before takeoff; jump directed away from the loom | ms | MEASURED (*Drosophila*) | Card & Dickinson 2008 Curr. Biol. | comment cites this | yes |
| Escape takeoff | 0.48 m/s in the first 2 ms (voluntary 0.28); leg extension ~3.5 ms | m/s, ms | MEASURED (*Drosophila*) | Card & Dickinson 2008 J. Exp. Biol. | — | not in table |
| Airborne evasion | banked turn within a few wingbeats of a loom | — | MEASURED (*Drosophila*) | Muijres et al. 2014 | — | not in table |
| Landing trigger | deceleration when relative retinal expansion reaches a threshold, ~76 ms time-to-contact on a post | ms | MEASURED (*Musca*) | Wagner 1982 Nature; threshold as cited by Liu et al. 2019 | hover then land | shape yes |
| Landing latency | 100–200 | ms | MEASURED (*Drosophila*, *Musca*) | Borst 1986, as cited in J. Exp. Biol. 205:2785 | thinkS 0.15 | yes |
| Inverted (ceiling) landing | upward acceleration (Vz ~0.7–0.8 m/s), rotation triggered at RREV 19–32 rad/s (31–53 ms to contact), leg extension, leg-assisted swing on planted forelegs; failures headbutt the ceiling | m/s, ms | MEASURED (*Calliphora vomitoria*) | Liu et al. 2019 | no underside landing | not in table |
| Climb | see inverted landing: ~0.7–0.8 m/s upward in a heavier fly | m/s | BIOLOGICAL SHAPE | Liu et al. 2019 | climbMmS 600 | yes |
| Hover | no *Musca* measurement; the lamp-circling hover is *Fannia* | s | GAME TUNING | extension pages (Fannia) | hoverS 0.3–1.5 | see D6 |
| Flying height, field | caught evenly 12–204 cm on 2.13 m traps (quartiles 0–55 / 56–109 / 110–167 cm); land readily at 1.8 m | cm | MEASURED | Zahn 2019 ch. 2; Gerry et al. 2011 | ceiling 1500, band 120–600 | band is the lower half — D5 |
| Flying height, older | most on cards at 36–116 cm | cm | MEASURED | Black & Krafsur 1985, via Zahn 2019 | — | consistent |
| Hop length / duration | unmeasured; movement is "a series of short disjointed circuitous flights"; after 15 min releases more were at 10 m than 20 m | — | GAME TUNING | Schoof & Siverly 1954 via Geden et al. 2021; Zahn 2019 ch. 3 | hopMm 500–3000, hopS 0.8–3.5 | keep; see D7 |
| Flight endurance | continuous tethered flight for minutes to hours, declining with age; face fly > 10 min at > 167 beats/s | min | MEASURED (numbers paywalled; congener figure) | Rockstein & Bhatnagar 1966; face-fly tether study (*Musca autumnalis*) | fatiguePerS 1/40 | GAME TUNING, see D8 |
| Dispersal | most stay near source; > 12 km reported, 32 km record; urban 27–1,080 m, rural 8–11 km | km | MEASURED | Geden et al. 2021 (Bishopp & Laake 1921; Yates et al. 1952); ADW | reachM 40 | fine (design) |
| Wind | flies into or across winds ≤ 5.4 m/s; wind not a predictor of daily activity except near dusk | m/s | MEASURED | Nuttall et al. 1914 via Zahn 2019; Zahn & Gerry 2020 | no wind rule | not in table |
| Temperature, lower | walking/flight cease below ~10 °C | °C | MEASURED | as cited by Zahn & Gerry 2020 | — | never reached on Kauaʻi lowland |
| Temperature, curve | activity rises 10 → 30 °C, falls above 35; barn activity positive up to 42; behaviour shifts above ~29 | °C | MEASURED | Schou et al. 2013; Zahn & Gerry 2020 | — | not in table |
| Daily pattern, field | starts near dawn; one broad mid–late-morning peak; males peak 1–3 h after sunrise, females 3–8 h; falls with late-day temperature | h | MEASURED | Zahn & Gerry 2020 | no day/night | D9 |
| Daily pattern, lab | at 15 °C one broad afternoon peak; at 25 and 35 °C active through the whole photophase with a mild midday dip; inactive in the dark | — | MEASURED | Bazalova & Dolezel 2017 | — | D9 |
| Night | inactive; indoors on ceilings, beams, wires; outdoors in foliage, long grass, shrubs, trees; goes to lights | — | MEASURED (descriptive) | UF Featured Creatures (Sanchez-Arroyo & Capinera) as summarised on Wikipedia; ADW | — | D9 |
| Eye, spatial | interommatidial angle ~2.9° (Drosophila 4.5°); ~54,000 microvilli per photoreceptor | ° | MEASURED (*Musca*) | Juusola lab, Nat. Commun. 2026 | sightMm 300, fov 330 | see D4 |
| Eye, temporal | R1–R6 signalling bandwidth ~308 Hz (Drosophila ~72) | Hz | MEASURED (*Musca*) | Juusola lab 2026 | — | not in table |
| Eye, count | ~3,500 (male) / ~3,400 (female) ommatidia per eye; male "love spot" | — | popular figure; primary not reached | Ask an Entomologist; Hornstein et al. 2000 | — | not in table |
| Colour | UV, blue, green receptors; NO red receptor | — | MEASURED | Goldsmith 1965; Hardie 1985 | — | not in table |
| Smell | antennal olfaction to trimethylamine, ammonia, indole, linoleic acid; honeydew volatiles (Z)-3-hexenyl acetate, benzaldehyde | — | MEASURED | Mulla et al. 1977 and Hung et al. 2019, via Geden et al. 2021 | drawnTo list | add honeydew — D10 |
| Taste / touch | tastes with tarsal hairs; air-flow hairs over the body | — | MEASURED (descriptive) | ADW | — | not in table |
| Diet | liquids only: sugar, milk, blood, faeces, decaying fruit and vegetables, carrion fluids, honeydew; solids softened with saliva; particles < 0.045 mm; needs water; "bubbling" sheds water | — | MEASURED | ADW; Geden et al. 2021; Hung et al. 2015 | omnivore; eats sap, nectar, litter, water-edge | broadly yes — D10 |
| Predators | birds, reptiles, amphibians, insects, spiders (adults); histerid beetles, mites, parasitoids (immatures); fire ants take eggs and larvae at carrion, and *S. geminata* larval, pupal and newly emerged flies | — | MEASURED | Wikipedia (UF); ADW; Stoker, Grant & Vinson 1995; carcass study (secondary) | — | not in table |

## Behaviour profile

**idle / rest.** The fly's day is mostly sitting: on a sunlit surface, a leaf, a
stem, a wire, the underside of anything, grooming. It perches in the sun and in the
lee. Real perches last from seconds to many minutes; nothing measured, so `perchS`
3–20 s is GAME TUNING and could stretch to 60 s without lying.

**wander (walking).** Short walks over a food patch, saccadic — a straight run, a
snap turn of tens of degrees in ~50 ms, another run (Blaj & van Hateren). No speed is
published for *Musca*; 15 mm/s is a guess and should say so.

**feed.** Lands ON the food, tastes it with its feet, extends the proboscis and
sponges liquid; a solid is wetted with regurgitate first. Meals are short; the fly
returns often. It drinks. It is drawn by odour (decay, ammonia, fermenting fruit,
honeydew) from further than it can see anything.

**takeoff.** Two kinds. Voluntary: wings raised first, a slower, stable launch.
Escape: legs extend in ~3.5 ms, the body is already leaning away from the threat
after ~200 ms of quiet preparation, and the fly leaves at nearly its top speed,
tumbling (Card & Dickinson, *Drosophila*; the *Musca* escape is the same jump-then-fly
and is NOT the giant-fibre reflex, Holmqvist 1994).

**fly.** Cruise ~2 m/s in straight segments broken about ten times a second by 20–30
ms banked saccades of up to 90°; accelerations of 1–2 g. Flights are short and
circuitous, a few metres, at 0.1–2 m up, and end on a surface. A chasing male
regulates speed by distance to its target (Wehrhahn).

**hover.** Only as the brake before touchdown — a fraction of a second of near-zero
speed as retinal expansion crosses threshold. It does not station-keep.

**land.** Deceleration triggered by looming of the surface (~76 ms before contact),
legs out, contact on the forelegs; on an underside it pitches up, rotates and swings
in on planted forelegs (Liu et al.). Any surface, any orientation.

**flee.** Trigger: an approaching DARK object, judged by darkening/expansion, not by
range. A slow-walking ant barely looms; a fast camera does. Escape is a takeoff, a few
metres of flight, a landing, and calm within seconds. Never fights, never bites.

**Around an ant:** shares a food patch, steps or flies off when touched, lifts when
the ant closes fast. Only a dead, drowned, trapped or teneral fly is ant food.

**Day, night, weather (Kauaʻi lowland, 20–30 °C):** active from dawn, peak by
mid-morning, quieter in the hottest hours, gone at dusk; roosts in foliage; no flight
in rain (extension consensus, unmeasured — GAME TUNING); flies in winds under ~5 m/s.

**"Quick, nimble, light, but not identical to Queen flight" — the numbers that
differ** (queen figures from `queen.md`, Vogt et al. 2000, Gui 2010):
cruise 2 m/s vs 0.7 (300 vs ~84 body lengths/s); burst ~3 m/s vs ~1; wingbeat
160–180 Hz vs 96; turn: 90° saccade in ~30 ms at 2,000 °/s vs a queen with no
measured saccade and a flight that the wind, not she, steers (FAB §14.2); takeoff:
a 3.5 ms leap away from a threat vs a deliberate climb from ground or leaf; landing:
any surface including undersides vs ground and vegetation; bout: metres, seconds,
then a perch, vs one long dispersal flight; mass: about equal (12 vs ~11 mg) — the
difference is power and gyroscopes (halteres), not size, so do NOT make the fly
lighter to make it quicker.

## Disagreements with the current table

1. **Cruise 1.5 m/s.** Literature: ~2 m/s average (four sources compiled by Zahn
   2019), maximum unpublished but above that. Recommend `cruiseMmS` 2000 and a burst
   of 3000 for the escape hop, labelled GAME TUNING. Confidence: medium — the 2 m/s is
   a "reported average", not a modern tracked value, and Wagner's full text was
   unreachable.
2. **`WINGBEAT_HZ` 200, "commonly 150–250".** Measured *Musca* values are 130, 160–162
   and 180 Hz. Recommend 170 (MEASURED range 130–180) and drop the 150–250 claim. The
   aliasing argument stands either way. Confidence: high on the range.
3. **`turnRadS` 6 used in the air.** Flight turns are saccades: 90° in 20–30 ms,
   35 rad/s peak, ~10 a second, with straight segments between. Recommend the sim
   turn in flight as discrete saccades (or `turnRadS` ≈ 30 in air) and keep ~6–10 on
   foot. Confidence: medium (congener data; *Musca* said to be similar).
4. **Senses: `sightMm` 300, `alarmMm` 150, flat.** At a 2.9° pixel a 4 mm ant is
   resolvable only inside ~80 mm; a hand at 2 m. Recommend an angular rule (object
   size / distance) for sight, and a looming/darkening rule for alarm — expansion
   rate of a dark object, so a creeping ant is tolerated to a body length and a
   lunging camera is not. `alarmS` 3 has no data; keep. Confidence: medium (design).
5. **Cruise band 120–600 mm, ceiling 1500.** Measured flights spread evenly 0.1–2 m.
   The band is a stage for the ant, which is fine, but it is GAME TUNING, not shape;
   consider a 2000 mm ceiling with the band unchanged. Confidence: high on the data.
6. **`hoverS` 0.3–1.5.** No station-keeping hover in *Musca*; only the pre-landing
   brake. Recommend 0.2–0.8 s and only before `land`. Confidence: low–medium.
7. **Internal arithmetic.** `hopS` 0.8–3.5 s × cruise 1500 mm/s = 1.2–5.3 m, but
   `hopMm` is 0.5–3 m; at 2000 mm/s the gap widens. One of them should derive from the
   other. Confidence: high (it is arithmetic).
8. **`fatiguePerS` 1/40.** A real fly flies for minutes at least; 40 s of flight to
   exhaustion is GAME TUNING for the "short hops" brief and should be labelled so.
9. **No day/night.** Real activity is dawn-to-dusk with a morning peak and a roost at
   night; the time slider now exists. Recommend `feed`/`fly` gated by daylight and
   temperature, `rest` on foliage at night. Confidence: high.
10. **`drawnTo` / `eats`.** Add `honeydew-host` (Hung et al. 2015: attracted to
    honeydew-contaminated plants) and, when offered, `fruit`. `sap` and `nectar` are
    reasonable; `litter` is weak for an adult fly (it is the larva's world).
11. **Walking pace labelled BIOLOGICAL SHAPE.** Nothing measured; relabel GAME TUNING.
12. **Mass absent.** Add 12 mg (ADW) so the queen comparison is on the sheet.

## Open questions for Joshua

1. Keep the fly LOW (0.12–0.6 m) for the ant's sake, or let it use the measured
   0.1–2 m and accept that many flights leave the ant's view?
2. How skittish to the ANT? Biology says a slow ant gets within a body length before
   the fly steps off; a looming rule would make the fly ignore the ant and fear the
   camera. Is that the feel you want?
3. Any station-keeping hover at all? It reads as "fly" to players but is *Fannia*.
4. Underside and ceiling landings are real and distinctive, but Creature Lab D
   (surface traversal) is deferred — land on leaf undersides now as a visual pose,
   or wait?
5. At night (slider), should flies roost visibly on foliage, or thin out?
6. Beach density 300/ha: the wrack-line fly is a kelp fly, not *Musca*. Keep it for
   readability, or lower it and let a future kelp fly own the beach?
7. Should flight speed scale with `sizeRatio` as the worm's crawl does? Wingbeat and
   speed scale weakly with size in flies; I would not scale cruise linearly.
8. Is the buzz in scope? A ~170 Hz tone is the cheapest fly-vs-queen differentiator.

## Sources

- Doctor J (2013). *Musca domestica*. Animal Diversity Web. https://animaldiversity.org/accounts/Musca_domestica/
- LSU AgCenter (2022). *Musca domestica*, House Fly (Diptera: Muscidae). https://www.lsuagcenter.com/articles/page1669656019180
- Geden CJ, Nayduch D, Scott JG, Burgess ER, Gerry AC, Kaufman PE, Thomson J, et al. (2021). House fly: biology, pest status, current management prospects, and research needs. *J. Integr. Pest Manag.* 12(1):39. https://doi.org/10.1093/jipm/pmaa021
- Zahn LK (2019). Flight behavior of the house fly (*Musca domestica*) under field conditions in southern California. PhD dissertation, UC Riverside. https://escholarship.org/uc/item/2wf8h6bf
- Zahn LK, Gerry AC (2020). Diurnal flight activity of house flies is influenced by sex, time of day, and environmental conditions. *Insects* 11(6):391. https://doi.org/10.3390/insects11060391
- Bazalova O, Dolezel D (2017). Daily activity of the housefly is influenced by temperature independent of 3′ UTR *period* gene splicing. *G3* 7(8):2637–2649. https://doi.org/10.1534/g3.117.042374
- Schou TM, Faurby S, Kjærsgaard A, Pertoldi C, Loeschcke V, Hald B, Bahrndorff S (2013). Temperature and population density effects on locomotor activity of *Musca domestica*. *Environ. Entomol.* 42(6):1322–1328. https://doi.org/10.1603/en13039
- Holmqvist MH, Srinivasan MV (1991). A visually evoked escape response of the housefly. *J. Comp. Physiol. A* 169:451–459. https://doi.org/10.1007/BF00197657
- Holmqvist MH (1994). A visually elicited escape response in the fly that does not use the giant fiber pathway. *Vis. Neurosci.* 11(6). https://www.cambridge.org/core/journals/visual-neuroscience/article/abs/visually-elicited-escape-response-in-the-fly-that-does-not-use-the-giant-fiber-pathway/A00AC2BCA7133EA14D33DA38E742CDD9
- Card G, Dickinson MH (2008). Visually mediated motor planning in the escape response of *Drosophila*. *Curr. Biol.* 18:1300–1307. https://doi.org/10.1016/j.cub.2008.07.094
- Card G, Dickinson M (2008). Performance trade-offs in the flight initiation of *Drosophila*. *J. Exp. Biol.* 211:341–353. https://doi.org/10.1242/jeb.012682
- Muijres FT, Elzinga MJ, Melis JM, Dickinson MH (2014). Flies evade looming targets by executing rapid visually directed banked turns. *Science* 344:172–177. https://doi.org/10.1126/science.1248955
- Wagner H (1986). Flight performance and visual control of flight of the free-flying housefly (*Musca domestica* L.) I. Organization of the flight motor. *Phil. Trans. R. Soc. B* 312:527–551. https://doi.org/10.1098/rstb.1986.0017
- Wagner H (1982). Flow-field variables trigger landing in flies. *Nature* 297:147–148. https://doi.org/10.1038/297147a0
- Wehrhahn C, Poggio T, Bülthoff H (1982). Tracking and chasing in houseflies (*Musca*). *Biol. Cybern.* 45:123–130. http://cbcl.mit.edu/people/poggio/journals/wehrhahn-poggio-buelthoff-BiolCybern-1982.pdf
- Schilstra C, van Hateren JH (1999). Blowfly flight and optic flow. I. Thorax kinematics and flight dynamics. *J. Exp. Biol.* 202:1481–1490. https://doi.org/10.1242/jeb.202.11.1481
- Schilstra C, van Hateren JH (1998). Stabilizing gaze in flying blowflies. *Nature* 395:654. https://doi.org/10.1038/27114
- Blaj G, van Hateren JH (2004). Saccadic head and thorax movements in freely walking blowflies. *J. Comp. Physiol. A* 190:861–868. https://doi.org/10.1007/s00359-004-0541-4
- Liu P, Sane SP, Mongeau J-M, Zhao J, Cheng B (2019). Flies land upside down on a ceiling using rapid visually mediated rotational maneuvers. *Sci. Adv.* 5:eaax1877. https://doi.org/10.1126/sciadv.aax1877
- Pinto J, Magni PA, O'Brien RC, Dadour IR (2022). Chasing flies: the use of wingbeat frequency as a communication cue in calyptrate flies (Diptera: Calyptratae). *Insects* 13(9):822 — Table 1 compiles Sotavalta 1947 (*Acta Entomol. Fenn.* 4:1–117), Rockstein & Bhatnagar 1966 and Unwin & Corbet 1984. https://doi.org/10.3390/insects13090822
- Measuring the duration and frequency of wing beat of *Musca autumnalis* (Diptera: Muscidae) using a novel tether method. *Can. Entomol.* https://www.cambridge.org/core/journals/canadian-entomologist/article/abs/measuring-the-duration-and-frequency-of-wing-beat-of-musca-autumnalis-diptera-muscidae-using-a-novel-tether-method/82F30648ECBAC0A7EC33A3775B843F91
- Rockstein M, Bhatnagar PL (1966). Duration and frequency of wing beat in the aging house fly, *Musca domestica* L. *Biol. Bull.* 131:479–486. https://doi.org/10.2307/1539987
- Unwin DM, Corbet SA (1984). Wingbeat frequency, temperature and body size in bees and flies. *Physiol. Entomol.* 9:115–121. https://doi.org/10.1111/j.1365-3032.1984.tb00687.x
- Hung KY, Michailides TJ, Millar JG, Wayadande A, Gerry AC (2015). House fly (*Musca domestica* L.) attraction to insect honeydew. *PLoS ONE* 10:e0124746. https://doi.org/10.1371/journal.pone.0124746
- Juusola lab (2026). Synaptic high-frequency jumping synchronises vision to high-speed motion (housefly photoreceptors, interommatidial angle 2.9°, ~308 Hz bandwidth). *Nat. Commun.* https://www.nature.com/articles/s41467-026-72509-2
- Hornstein EP, O'Carroll DC, Anderson JC, Laughlin SB (2000). Sexual dimorphism matches photoreceptor performance to behavioural requirements. *Proc. R. Soc. B* 267:2111–2117.
- Goldsmith TH (1965). Do flies have a red receptor? *J. Gen. Physiol.* 49:265–287. Hardie RC (1985). Functional organization of the fly retina. *Prog. Sens. Physiol.* 5.
- Stoker RL, Grant WE, Vinson SB (1995). *Solenopsis invicta* effect on invertebrate decomposers of carrion in central Texas. *Environ. Entomol.* 24:817–822.
- Wing buzzing as a potential antipredator defense against an invasive fire ant (2021). *Food Webs*. https://www.sciencedirect.com/science/article/abs/pii/S2352249621000057
- Wikipedia, Housefly (resting sites and predators, citing UF/IFAS Featured Creatures EENY-48, Sanchez-Arroyo & Capinera). https://en.wikipedia.org/wiki/Housefly
- Collision-avoidance and landing responses are mediated by separate pathways in the fruit fly (2002). *J. Exp. Biol.* 205:2785 (for Borst 1986's 100–200 ms landing latency in *Drosophila* and *Musca*). https://journals.biologists.com/jeb/article/205/18/2785/9092
