# Aphid — biology for the Creature Lab

Research pass 2026-09-08 for the Creature Lab. This file EXTENDS
`docs/research/FIRE_ANT_BIOLOGY.md` (cited as FAB §n) and reports DELTAS against
`src/creatures/species.ts` (`APHID`), `intent.ts` (`thinkPlant`) and `locomotion.ts`
(`DROP_MM_S`). Every number carries one of the three labels from FAB §38: MEASURED,
BIOLOGICAL SHAPE, GAME TUNING. Where nothing is published it says so.

Access note: every journal, extension and repository host tried (OUP, PMC, Springer,
ScienceDirect, Frontiers, Nature, Wiley, Cambridge, PLOS, EJE, UF/IFAS, CTAHR, UH
ScholarSpace, AntWiki, Europe PMC, Semantic Scholar) is blocked from this environment.
The numbers below come from abstracts and secondary summaries reachable through search.
Each row names its primary paper so Claude can verify one from an unblocked machine.

## The animal

*Aphis gossypii* Glover, the melon (cotton) aphid. The current table names a superfamily
(`Aphidoidea`), which is not an animal; this is the honest species for a Kauaʻi lowland
garden or forest edge. It is polyphagous across hundreds of dicots — cucurbits, hibiscus
and the other Malvaceae, citrus, taro, noni, kava, Solanaceae, Asteraceae — and it is
established on every main Hawaiian island: Messing & Klungness surveyed it on Kauaʻi and
Hawaiʻi farms for two years (Proc. Hawaiian Entomol. Soc. 2001), and Messing et al. (2007)
record it on native plants (e.g. *Boerhavia*) in a five-island survey. It is the aphid the
island's ants actually tend — AntWiki lists it as a trophobiont of *Solenopsis geminata*,
and CTAHR names the bigheaded, long-legged, Argentine and white-footed ants tending
Hawaiian aphids — which makes it the right species for FAB §18's honeydew loop. Its summer
form is pale yellow-green, so the existing green rig reads as it. What it is NOT: a grass
or fern aphid (see Disagreements 4), and it is about half the size the table draws.

## Numbers

| quantity | value | unit | label | source | current table says | agrees? |
|---|---|---|---|---|---|---|
| Body length, apterae | 0.9–1.8; typical 1.4 | mm | MEASURED | Influential Points; NatureSpot; UF/IFAS EENY-173 gives 1.5–1.8 long, 0.6 wide | 2.5, range 1.5–4 | no |
| Body length, alatae | 1.1–1.8 | mm | MEASURED | Influential Points; EPPO | not in table | not in table |
| Colour | pale yellow-green (hot, crowded) to dark green (cool) | — | MEASURED | Influential Points; EPPO | green rig | yes |
| Mass, adult | ~0.1–0.3 (fresh); no reachable figure | mg | GAME TUNING (derived) | Moreno-Delafuente et al. 2021 weighed adults fresh and dry — the figure is behind the block. Estimate: a 1.5 × 0.6 × 0.5 mm ellipsoid of ~1 g/cm³ is 0.24 mg | not in table | not in table |
| Walking pace on a leaf | ~1 (Myzus persicae, 5.8 cm/min at 25 °C); A. gossypii unmeasured, recommend 0.8 (≈0.6 body/s at 1.4 mm) | mm/s | MEASURED (Myzus); BIOLOGICAL SHAPE (transfer) | Alford, Blackburn & Bale 2012, Bull. Entomol. Res. | 0.6 mm/s, "about a body length a second" | pace yes; body-length claim no (0.24 body/s) |
| Walking stops below | 7.5–12.5 | °C | MEASURED | Alford et al. 2012 | not in table | not in table (never reached on Kauaʻi lowland) |
| Sustained walking, 24 h average | 0.27–0.47 (96–169 cm/h, pea aphid strains) | mm/s | MEASURED | Biology Open 2016 (PMC5087678) | not in table | not in table |
| Walk to a new plant | nearest plant within 1 h; up to 180 cm; 2 m in 4 h in alfalfa; 13.5 m in 7 h semi-natural | cm, h | MEASURED | Alyokhin & Sewell 2003; Ben-Ari, Gish & Inbar 2015 | never leaves host | yes as default; see Behaviour |
| Survival on bare soil | 1.16 ± 0.04 days; all dead by 3 | d | MEASURED | Alyokhin & Sewell 2003 | — | not in table |
| Flee pace (walk away) | none published; recommend 2 (≈1.5 body/s) | mm/s | GAME TUNING | — | 2.5 | near enough |
| Drop | gravity; 90 % right themselves within 0.17 s, land on their feet | s | MEASURED | Ribak, Gish, Weihs & Inbar 2013, Curr. Biol. | `DROP_MM_S` 1000 | yes (shape) |
| Return after a drop | nearly all adults dropped 13 cm away back on the plant in ~40 s, by SIGHT of the plant, not smell | s, cm | MEASURED (Macrosiphoniella artemisiae) | Gish & Inbar 2006, J. Insect Behav. 19:143 | `alarmS` 8, then walk back | no — see Disagreements 5 |
| Turn rate | none published | rad/s | GAME TUNING | — | 2.5 | keep |
| Sight of a host | ≥ 130 (host silhouette from 13 cm) | mm | MEASURED | Gish & Inbar 2006 | `sightMm` 30 | no — see Disagreements 6 |
| Colour vision | green-positive / blue-UV-negative opponency; yellow "preference" is brightness | — | MEASURED | Döring & Chittka 2007, Arthropod-Plant Interact. 1:3 | "sees poorly" | partly |
| Visual cue of a predator | antennal movement only; never a drop | — | MEASURED (pea aphid) | J. Pest Sci. 2020, doi 10.1007/s10340-020-01323-6 | camera at 20 mm alarms | no |
| Stem vibration of a walking insect | body-raising, antennation; predator told from non-predator by its vibration | — | MEASURED (pea aphid) | J. Pest Sci. 2020 | not in table | not in table |
| Contact by a climbing insect | stylet withdrawal, kick, then walk or drop | — | MEASURED (pea aphid) | J. Pest Sci. 2020 | flee = drop | partly |
| Warm humid breath | 65 % of a colony drops at once; weaker as air warms; nymphs need heat AND vibration | % | MEASURED (pea aphid, U. sonchi) | Gish, Dafni & Inbar 2010 Curr. Biol.; 2011 Naturwiss.; 2012 PLOS One | not in table | not in table |
| Reaction latency | "immediate"; no figure extractable; recommend 0.5–2 | s | GAME TUNING | Gish et al. 2010/2011 | one think (0.4 s) | yes |
| Alarm pheromone | (E)-β-farnesene, 0.7 ± 0.1 ng per A. gossypii (A. craccivora 6.2) | ng | MEASURED | Bayendi Loudit et al. 2018, J. Insect Sci. 18(1):1 | named in a comment | yes |
| Alarm range and life | 1–3 cm from a fresh droplet; repellent up to 60 min | cm, min | MEASURED | Basu et al. 2021 review (Insect Biochem. Mol. Biol.) | `alarmMm` 20 | yes |
| Alarm response, Aphis tribe | ant-tended Aphis walk or "waggle" rather than drop; ants depress it further | — | MEASURED | Nault, Montgomery & Bowers 1976 Science; Montgomery & Nault 1977 | every alarm is a drop | no — Disagreements 3 |
| Habituation | to constant EBF within 3 generations, reversible | — | MEASURED | de Vos et al. 2010 PNAS | — | not in table |
| Ant tending slows walking | walking speed and dispersal reduced by ant trail semiochemicals | — | MEASURED | Oliver et al. 2007 Proc. R. Soc. B 274:3127 | — | not in table |
| Time from first probe to sustained phloem feeding | 3.5–6.3 h on a good host (A. fabae, S. avenae); A. gossypii on susceptible melon: 82 % of sieve-element probes reach ingestion, 7 % of aphids never do | h, % | MEASURED | Walker 2024 EPG guidelines (EEA); Garzo et al. 2002 | `feedS` 30–120 s | no — Disagreements 2 |
| Sustained ingestion | E2 bouts of hours; "sustained" defined as > 8–10 min | h | MEASURED | Garzo et al. 2002; Walker 2024 | 30–120 s | no |
| Honeydew, ant-tended Aphis | 133 µg/aphid/h (A. fabae); A. gossypii most at 26.7 °C, no rate reachable | µg/h | MEASURED (fabae) | Völkl et al. 1999 Oecologia 118:483; cotton-aphid honeydew study (CABI) | 'honeydew-host' only | see Open questions 3 |
| Honeydew for the game | 1 droplet per 20–60 min, 0.01–0.05 µl | — | GAME TUNING | scaled from the row above | not simulated | not in table |
| Development band | 15–30 °C viable; 25–30 optimum; 35 lethal to nymphs | °C | MEASURED | Kersting, Satar & Uygun 1999 J. Appl. Entomol. | — | not in table |
| Reproduction | 1.7 nymphs/day; nymph to adult 4.1 d at 26.7 °C | /d | MEASURED | cotton-aphid biology (CABI abstract) | — | later |
| Diel rhythm | locomotion and honeydew are circadian; feeding round the clock; species differ on day/night peak | — | MEASURED (pea aphid, R. padi, M. persicae) | Beer et al. 2017 J. Insect Sci.; bioRxiv 2024 | "notices neither" | yes |
| Rain | raindrops dislodge aphids; no fraction reachable | — | BIOLOGICAL SHAPE | pecan rainfall study (ResearchGate) | ignored | Open questions 5 |
| Colony position | leaf undersides, growing tips, flower buds; several discrete colonies per leaf | — | MEASURED | UF/IFAS; PlantwisePlus | `clump` 0.9 | yes |
| Hosts | > 700 dicot species; on Kauaʻi cucurbits, hibiscus, citrus, taro, noni, kava, natives | — | MEASURED | CTAHR ADAP 2000-10; Messing et al. 2007 | shrub, broadleaf, flower, fern, grass, tree | fern, grass no |
| Enemies on Kauaʻi | Lysiphlebus testaceipes (commonest parasitoid, hyperparasitised), Aphidius colemani, Coelophora inaequalis and other ladybirds, syrphids, lacewings | — | MEASURED | Messing & Klungness 2001; UH OT | — | later |

## Behaviour profile

**idle / feed.** The aphid's life is one long `feed`. Reaching the phloem costs hours of
probing (Walker 2024), so once the stylet is in it stays in: sustained ingestion runs for
hours and the animal does not move at all. A honeydew droplet leaves it every twenty to
sixty minutes. Hunger, as a meter, barely exists — the animal is never off the food unless
something takes it off. Feeding continues day and night; only the rhythm shifts.

**wander.** Short, rare, and on the host. Apterae "do not leave a plant that is adequate"
(Alyokhin & Sewell 2003); a small spontaneous fraction does (Hodgson 1991), and crowding
or a failing shoot drives more. Recommended as GAME TUNING: a within-host move of 1–5 cm
every 10–60 min, at ~0.8 mm/s, upward more often than down, to fresh growth or the
underside of a leaf. It never walks open soil for minutes: on the ground it beelines for
the nearest plant silhouette (within 1 h at worst, ~40 s from 13 cm) and dies in a day if
it fails. It will not cross water or bare rock; it is never placed on either.

**rest.** Indistinguishable from `feed` on screen; the word can stand for the pauses in
ingestion. No literature separates them.

**flee — the honest ladder, not a single drop.** A disturbance is first a VIBRATION of
the stem or a CONTACT, never a sight: a looming shape only moves the antennae. The
sequence, measured on pea aphids and reduced for an Aphis: stop feeding → withdraw the
stylet → kick with the hind legs → walk 1–3 cm away → and only then, for a minority, let
go. A. gossypii makes a tenth of the alarm pheromone a cowpea aphid does and belongs to
the tribe that "walks or waggles rather than drops" (Nault et al. 1976), and an
ant-tended colony drops less still. When it does drop it rights itself in 0.17 s, lands
on its feet, and is back on the plant in about 40 s by walking toward the silhouette.
Nymphs drop less than adults and first instars ride adults back. Warm, humid breath — the
one cue that empties a colony — is a mammal's, not an ant's, and not the camera's.

**Weather.** Kauaʻi lowland air (roughly 18–30 °C) never leaves the 15–30 °C band it
breeds in, so temperature changes nothing on screen. Heavy rain knocks a fraction off the
underside of a leaf; there is no measured fraction. Night: feed on; walk less.

**Toward an ant.** It never attacks. An ant that touches it gets a kick or a cornicle
droplet; an ant of a tending species gets honeydew and a calmer, slower aphid (Oliver
et al. 2007). Nothing here should assume aphid = food (Joshua §11): the resource it
offers is the honeydew, the plant is the site, and the aphid is the producer.

## Disagreements with the current table

1. **Size.** Table: 2.5 mm, range 1.5–4 ("garden aphids", extension pages). Literature for
   *A. gossypii*: 0.9–1.8 mm apterae. Recommend `lengthMm` 1.4, `lengthRangeMm` [0.9, 1.8],
   `lengthSource` Influential Points / UF/IFAS EENY-173. Confidence high. The rig's
   `spineUnits` is unchanged; only the scale halves. If Joshua wants the rig to stand for
   "an aphid" rather than this species, keep 2.5 and rename nothing — but then the comment
   must stop calling it MEASURED.
2. **Feed length.** Table: `feedS` 30–120 s with a 50 % chance of a stem walk after each.
   Literature: reaching the phloem takes hours and ingestion lasts hours. Recommend
   `feedS` [900, 3600] s and `WALK_CHANCE` ~0.15, so a walk comes every few simulated
   hours, not every minute. Confidence high on the biology; the seconds are GAME TUNING
   chosen so a player who watches for a minute sees a still animal, which is correct.
3. **Every alarm is a drop.** `thinkPlant` enters `flee` as a drop toward the ground on any
   alarm. Literature: an Aphis walks away first and drops as a minority response
   (~20–30 % is a GAME TUNING guess; no number for A. gossypii was reachable). Recommend a
   two-stage flee: walk 1–3 cm along the host at ~2 mm/s; drop only if the disturbance is
   still within `alarmMm` after that, or on contact. Confidence high on the ladder,
   medium on the fraction.
4. **Hosts.** Table: shrub, broadleaf, flower, fern, grass, tree; `HONEYDEW_HOST_FAMILIES`
   mirrors it and a test ties the two lists. Literature: *A. gossypii* is a dicot feeder;
   Hawaiʻi's grass aphids are other genera (*Rhopalosiphum*, *Sitobion*, *Hysteroneura*)
   and its fern aphid is *Idiopterus nephrelepidis*. Recommend hosts [shrub, broadleaf,
   flower, tree] (tree = broadleaf trees such as citrus) for this species, and the same
   edit to `HONEYDEW_HOST_FAMILIES`. Confidence high — but see Open question 1.
5. **Alarm hold.** Table: `alarmS` 8 s, then walk back at 0.6 mm/s over three body lengths.
   Literature: ~40 s from drop to being back on the plant, walking most of it. Recommend
   `alarmS` 20–40 s with the walk-back inside it. Confidence medium (one species, one paper).
6. **Senses.** Table: `sightMm` 30, `alarmMm` 20, `fovDeg` 300. Literature: it SEES a plant
   from 13 cm but is not alarmed by sight at any distance; alarm is vibration, contact, and
   pheromone within 1–3 cm. Recommend `sightMm` 130 (host-finding), `alarmMm` 20 kept but
   re-labelled as the contact/vibration radius, and the camera treated as a non-alarming
   sight cue unless it touches the plant. Confidence medium-high.
7. **Name.** `scientificName: 'Aphidoidea'` → `'Aphis gossypii'`, `name` "Melon aphid".
   Confidence high, pending Open question 1.
8. **What agrees.** `medium: plant`, `diet: sap`, `temperament: passive`, `clump` 0.9,
   hosts-only placement, `canEditTerrain: false`, `DROP_MM_S` as a shape, "notices neither
   rain nor night", `turnRadS` 2.5 (nothing published either way).

## Open questions for Joshua

1. One species or "the aphids"? If the green rig must also sit on the grass and the ferns,
   it is honestly three species (melon aphid, a grass aphid, the black fern aphid) sharing
   a rig, and the table should say so rather than call it one animal. A second aphid entry
   costs nothing but a name.
2. Is the player's ant a disturbance? A real *A. gossypii* does not flee an ant; it is
   tended by one. Until tending is built, does an approaching ant make it kick, walk, or
   nothing? The camera today alarms it at 20 mm, which no aphid does for a sight cue.
3. Honeydew as a RESOURCE. The kind `honeydew-host` is a plant; the honeydew itself (a
   droplet the aphid puts out every 20–60 min, sugar the ant drinks) has no kind. FAB §18
   and Joshua §11 want the loop plant → aphid → honeydew → ant without aphid = food. Add a
   `honeydew` kind now, or leave it until tending?
4. Drop fraction. Biology says "a minority walks off first"; the number is a guess. Pick a
   fraction, or make it depend on whether the aphid is tended.
5. Rain. Shed a fraction of a colony in heavy rain (they return within a minute), or leave
   them as the sheltered underside they usually are? No published fraction.
6. Hunger meter. The animal feeds twenty-plus hours a day; `hungerPerS` 1/90 exists to
   schedule stem walks. Keep it as a scheduler, or retire it for this species?

## Sources

- Alford L, Blackburn TM, Bale JS (2012) Walking speed adaptation ability of *Myzus persicae* to different temperature conditions. Bull. Entomol. Res. 102:261–268. https://pubmed.ncbi.nlm.nih.gov/22123410/
- Alyokhin A, Sewell G (2003) On-soil movement and plant colonization by walking wingless morphs of three aphid species. Environ. Entomol. 32:1393–1398. https://academic.oup.com/ee/article/32/6/1393/448079
- Basu S, Clark RE, Fu Z, Lee BW, Crowder DW (2021) Insect alarm pheromones in response to predators. Insect Biochem. Mol. Biol. 128:103514. https://www.sciencedirect.com/science/article/abs/pii/S0965174820302034
- Bayendi Loudit SM et al. (2018) Identification of the alarm pheromone of cowpea aphid, and comparison with two other Aphididae species. J. Insect Sci. 18(1):1. https://academic.oup.com/jinsectscience/article/18/1/1/4781594
- Beer K et al. (2017) Pea aphids have diurnal rhythms when raised independently of a host plant. J. Insect Sci. 16(1):31. https://academic.oup.com/jinsectscience/article/16/1/31/2726646
- Ben-Ari M, Gish M, Inbar M (2015) Walking aphids can partake in within-field dispersal to distant plants. Basic Appl. Ecol. 16:162–171. https://www.sciencedirect.com/science/article/abs/pii/S1439179114001686
- Biology Open (2016) Strategies used by two apterous strains of the pea aphid for passive dispersal. https://ncbi.nlm.nih.gov/pmc/articles/PMC5087678
- CTAHR ADAP (2000) Melon aphid (*Aphis gossypii*): Agricultural Pests of the Pacific 2000-10. https://www.ctahr.hawaii.edu/adap/Publications/ADAP_pubs/2000-10.pdf
- CTAHR Master Gardener FAQ, aphids (ant species tending aphids in Hawaiʻi). https://www.ctahr.hawaii.edu/uhmg/faq/faq-aphid.asp
- de Vos M et al. (2010) Alarm pheromone habituation in *Myzus persicae*. PNAS 107:14673. https://www.pnas.org/doi/10.1073/pnas.1001539107
- Döring TF, Chittka L (2007) Visual ecology of aphids. Arthropod-Plant Interact. 1:3–16. https://link.springer.com/article/10.1007/s11829-006-9000-1
- Garzo E, Soria C, Gómez-Guillamón ML, Fereres A (2002) Feeding behavior of *Aphis gossypii* on resistant melon accessions. Phytoparasitica 30:129. https://link.springer.com/article/10.1007/BF02979695 (numbers via PMC7379274)
- Gish M, Inbar M (2006) Host location by apterous aphids after escape dropping from the plant. J. Insect Behav. 19:143–153. https://link.springer.com/article/10.1007/s10905-005-9009-9
- Gish M, Dafni A, Inbar M (2010) Mammalian herbivore breath alerts aphids to flee host plant. Curr. Biol. 20:R628. https://www.sciencedirect.com/science/article/pii/S0960982210008134
- Gish M, Dafni A, Inbar M (2011) Avoiding incidental predation by mammalian herbivores. Naturwissenschaften 98:731. https://link.springer.com/article/10.1007/s00114-011-0819-7
- Gish M, Dafni A, Inbar M (2012) Young aphids avoid erroneous dropping … two sensory modalities. PLOS One 7:e32706. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0032706
- Influential Points, *Aphis gossypii* (size, colour, hosts, ants). https://influentialpoints.com/Gallery/Aphis_gossypii_melon_or_cotton_aphid.htm
- J. Pest Sci. (2020) Aphids detect approaching predators using plant-borne vibrations and visual cues. https://link.springer.com/article/10.1007/s10340-020-01323-6
- Kersting U, Satar S, Uygun N (1999) Effect of temperature on development rate and fecundity of apterous *Aphis gossypii*. J. Appl. Entomol. 123:23. https://onlinelibrary.wiley.com/doi/abs/10.1046/j.1439-0418.1999.00309.x
- Messing RH, Klungness LM (2001) A two-year survey of the melon aphid on crop plants in Hawaii. Proc. Hawaiian Entomol. Soc. 35:91–101. https://www.researchgate.net/publication/29740000
- Messing RH, Tremblay MN, Mondor EB, Foottit RG, Pike KS (2007) Invasive aphids attack native Hawaiian plants. Biol. Invasions 9:601–607. https://link.springer.com/article/10.1007/s10530-006-9045-1
- Moreno-Delafuente A et al. (2021) Changes in melon plant phytochemistry impair *Aphis gossypii* growth and weight under elevated CO2. Sci. Rep. 11:2186. https://www.nature.com/articles/s41598-021-81167-x
- Nault LR, Montgomery ME, Bowers WS (1976) Ant-aphid association: role of aphid alarm pheromone. Science 192:1349. https://www.science.org/doi/10.1126/science.1273595
- Oliver TH, Mashanova A, Leather SR, Cook JM, Jansen VAA (2007) Ant semiochemicals limit apterous aphid dispersal. Proc. R. Soc. B 274:3127. https://centaur.reading.ac.uk/10055/
- Ribak G, Gish M, Weihs D, Inbar M (2013) Adaptive aerial righting during the escape dropping of wingless pea aphids. Curr. Biol. 23:R102. https://www.sciencedirect.com/science/article/pii/S0960982212014509
- UF/IFAS EENY-173, Melon aphid or cotton aphid (size 1.5–1.8 × 0.6 mm, hosts, enemies). https://ask.ifas.ufl.edu/publication/IN330
- Völkl W, Woodring J, Fischer M, Lorenz MW, Hoffmann KH (1999) Ant-aphid mutualisms: honeydew production and sugar composition. Oecologia 118:483–491. https://link.springer.com/article/10.1007/s004420050751
- Walker GP (2024) Guidelines for conducting, analyzing, and interpreting EPG experiments. Entomol. Exp. Appl. https://onlinelibrary.wiley.com/doi/full/10.1111/eea.13434
- AntWiki, *Solenopsis geminata* (trophobiont list incl. *Aphis gossypii*). https://www.antwiki.org/wiki/Solenopsis_geminata
- University of Hawaiʻi Organic Transitions, natural enemies of aphids in Hawaiʻi. https://www.uhot.org/post/part-2-targeting-aphids-thrips-scales-and-whiteflies
