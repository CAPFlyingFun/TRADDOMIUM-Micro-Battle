# TRADDOMIUM: Micro Battle!
## Fire Ant Biology, Ecology, Landscaping, Food, and Gameplay Reference

**Primary species:** Red Imported Fire Ant, *Solenopsis invicta*  
**Project:** TRADDOMIUM: Micro Battle! (TMB)  
**Purpose:** Approved biology and gameplay reference for Claude and future development  
**Prepared:** 2026-08-23  
**Research performed by:** ChatGPT / OpenAI using scientific papers, university extension material, USDA material, and other accessible primary or authoritative references  
**Project approval:** Joshua has reviewed the direction and explicitly approved this document as the working biological/gameplay baseline.

---

# 0. IMPORTANT INSTRUCTION TO CLAUDE

This section is intentionally first.

ChatGPT performed the external research for this document because ChatGPT can access a number of scientific and public sources that Claude may sometimes have difficulty opening in its coding environment.

**Joshua has approved the research-backed information and design direction in this document.**

Therefore:

1. Treat the biological statements marked as research-backed in this document as the project's accepted factual baseline.
2. Do **not** block implementation merely because an external reference URL cannot be opened from Claude Code.
3. The links are included for provenance, further reading, and later verification, not as a requirement that every statement be re-researched before use.
4. Do not silently replace a documented biological fact because another simplified pest-control webpage says something different.
5. If genuinely stronger evidence later contradicts this document, flag the conflict to Joshua rather than silently changing behavior.
6. Clearly distinguish **real biology** from **gameplay tuning**. TMB should be biologically shaped, but it does not have to reproduce every real timescale literally.
7. Joshua's newest explicit instruction always overrides this document.

A useful rule throughout development is:

> **Preserve the real biological shape of the behavior, then tune the magnitude or timing for gameplay.**

Example: a submerged fire ant can survive far longer than the current TMB O2 meter allows. The real shape is hydrophobicity, trapped air, strong buoyancy, difficulty staying submerged, and return to the surface. A 45-second gameplay air reserve can remain a tuning decision as long as it is labeled as tuning rather than claimed as literal fire-ant physiology.

---

# 1. CURRENT TMB STATUS, READ THIS BEFORE ADDING NEW BIOLOGY

This biology document was written against the current repository status, not against an older conceptual version of the game.

At the time of this document, the newest inspected TMB commit is:

```text
a31f44f
Version: 0.57.0
"The trench was wider than the river, and the river was faster than it should be"
```

The current project already contains significant systems relevant to this reference:

- true-scale Kauaʻi terrain and world coordinates
- streamed terrain and multiple LOD tiers
- ocean, lakes, and real Kauaʻi drainage
- river channels and current
- drinking and thirst
- surface-water interaction
- swimming, wading, skating, and submersion states
- an O2 or air gameplay meter
- flight and atmospheric wind
- MSL and AGL flight behavior
- canyon wind shelter
- Queen growth and stat data
- Solo session, save, and pause groundwork
- session architecture designed so the simulation core can later run outside the browser
- early vegetation and landscape data port from Beyond Extinction

## 1.1 Water is close to a strong foundation

The recent water work already includes:

```text
LAND
 ↓
WADING
 ↓
SURFACE / SKATING
 ↓
SWIMMING
 ↓
SUBMERGED
```

River current now varies across a channel rather than applying full midstream velocity at the bank. The current is weak near the margins and strongest toward the thread of the channel.

The shared vertical lever now means:

```text
AIR:
up   = climb
down = descend

WATER:
up   = swim toward surface
down = dive
```

This is a good general control philosophy and should be preserved.

## 1.2 Important terminology correction

Fire ants do **not** have lungs.

They breathe through a tracheal system connected to spiracles.

Therefore comments such as:

```text
"air left in her lungs"
```

should eventually be corrected to wording such as:

```text
air reserve
trapped air
spiracle/tracheal reserve
plastron-supported air reserve
```

The HUD can still say **O2** because it is readable gameplay shorthand.

## 1.3 Landscape groundwork already exists

Before water took priority, TMB added an inert landscape foundation.

The repository currently contains work for:

- `kauai-veg.bin`
- `landcover.ts`
- `GroundCover.ts`
- a Beyond Extinction to TMB vegetation bake

The baked data uses real Kauaʻi land-cover and canopy information and currently identifies broad classes such as:

```text
TREE
SHRUB
GRASS
CROP
BUILT
BARE
WATER
WETLAND
```

The existing `GroundCover.ts` concept uses deterministic procedural placement for:

- grass blades
- pebbles
- twigs

This is exactly the right direction for the next phase.

**Do not throw this away merely because final plant models do not exist yet.**

The gameplay should depend on semantic plant and food definitions, while rendering can start procedural and later swap to GLTF or other authored models.

---

# 2. SPECIES SCOPE

The primary Fire Ant currently represented by TMB is the **Red Imported Fire Ant, *Solenopsis invicta*.**

This matters because "fire ant" is not one universal biological template.

When implementing species-specific mechanics, use *S. invicta* unless Joshua explicitly introduces another *Solenopsis* species.

## 2.1 Kauaʻi note

*S. invicta* is an invasive species from South America and is not the historically native ant fauna of Kauaʻi.

TMB can treat the Kauaʻi world as its own alternate ecological game scenario. That does not prevent us from accurately modeling the animal itself.

This could eventually become useful Solo or Story material:

```text
NEWLY ESTABLISHED FIRE ANT
        ↓
unfamiliar island ecosystem
        ↓
native + introduced insects
        ↓
competing colonies
        ↓
predators
        ↓
expansion / survival / ecological consequences
```

---

# 3. BODY SIZE, WORKERS, AND THE "MAJOR" QUESTION

Red imported fire-ant workers are polymorphic.

That means worker size exists along a continuum rather than as two perfectly discrete Worker and Soldier body plans.

Diagnostic material commonly emphasizes that a single colony contains visibly different worker sizes, and research on worker morphology finds continuous variation in measurements such as head width.

Therefore TMB should **not** model the Fire Ant Major like a *Pheidole* big-headed soldier.

A good TMB interpretation is:

```text
MINIM / NANITIC
     ↓
SMALL WORKER
     ↓
MEDIUM WORKER
     ↓
LARGE WORKER
     ↓
"MAJOR" GAMEPLAY CLASS
```

The label **Major** can remain useful for gameplay and UI.

Internally, however, it should represent the upper end of the Fire Ant worker-size distribution.

This improves the existing genetics and nutrition plan:

```text
genetic potential
      +
larval nutrition
      +
colony condition
      ↓
worker final size
      ↓
movement / health / carry / combat differences
```

Do not make every large worker simply "Worker × 2".

Larger workers can differ in:

- mass
- head and mandible dimensions
- carrying ability
- tunnel dimensions they comfortably use
- locomotor performance
- combat leverage
- ability to manipulate larger particles

Smaller workers may remain exceptionally useful for:

- narrow tunnels
- brood care
- rapid movement through confined spaces
- fine excavation
- low resource cost

---

# 4. HABITAT AND NEST-SITE PREFERENCE

*S. invicta* can occupy many soil types and is highly adaptable.

However, it is especially associated with disturbed, open, warm environments such as:

- pastures
- lawns
- parks
- meadows
- cultivated land
- roadsides
- disturbed soil

Colonies can also occur around:

- rotting logs
- stumps
- trees
- structures
- pavement
- moist areas
- waterways

Water availability matters.

Texas A&M notes that fire ants require water and are often associated with creeks, runoff ditches, streams, rivers, ponds, and lakes. If surface water is unavailable, colonies can tunnel toward subsurface moisture or water.

## TMB implication

A nest suitability function should eventually care about more than "is ground flat?"

Conceptually:

```text
FOUNDING SUITABILITY

soil type
+ soil moisture
+ flood risk
+ vegetation/root density
+ slope
+ exposure
+ nearby water
+ nearby rival nests
+ predator pressure
+ temperature
```

Do not implement every factor at once, but keep the site-validation interface open enough that these can become contributors later.

---

# 5. DIGGING, MANDIBLES, FORELEGS, PARTICLES, AND SOIL

Fire-ant excavation is an excellent candidate for realistic TMB gameplay.

Researchers observing *S. invicta* tunnel construction found workers manipulating substrate using mandibles and forelimbs. Workers excavate material, carry it away from the digging face, and deposit it elsewhere.

Only part of a worker group may actively excavate at once. Colony digging is an emergent group process rather than every ant simultaneously attacking the wall.

## 5.1 Moisture matters

Water is important to tunnel stability.

Fire-ant nest expansion is often associated with rainfall, and cohesive damp material can support tunnel structure better than very loose dry particles.

Coarse sand and gravel can be less suitable because particles may be too large to manipulate efficiently and particle bridging or cohesion is weaker.

This supports a future TMB soil system:

```text
DRY SAND
Easy particles
Poor cohesion
Higher collapse tendency

MOIST SAND / LOAM
Good excavation
Good cohesion
Excellent tunnel medium

CLAY-RICH SOIL
Strong walls
More resistance to excavation

GRAVEL
Large particles
Obstructions
Lower excavation efficiency

SATURATED MUD
Unstable / flooded
Poor founding conditions
```

Do not turn this into a giant geology simulator immediately.

An initial data model might only need:

```ts
interface SoilMaterial {
  hardness: number;
  cohesion: number;
  moisture: number;
  particleScale: number;
  drainage: number;
}
```

## 5.2 Worker size does not mean simply "bigger = better digger"

Research comparing worker size found all size groups capable of excavation and showed worker size influences tunnel morphology.

Possible TMB interpretation:

```text
small worker
→ fine excavation
→ narrow tunnel
→ efficient confined-space movement

large worker
→ larger particle handling
→ widening passages
→ larger body requires larger passage
```

Do not give Majors a generic +100% Dig Speed bonus without a specific reason.

---

# 6. REAL FIRE-ANT NEST ARCHITECTURE

The visible mound is only the surface component.

A mature *S. invicta* nest can contain:

```text
SURFACE MOUND
dense tunnel network
      │
      ▼
SUBSURFACE SHAFTS
      │
      ├── horizontal chambers
      │
      ├── brood areas
      │
      └── deeper shafts
      │
      ▼
DEEP NEST
```

Published descriptions include subsurface structures reaching on the order of a metre or more in deep mature nests, while shallow foraging tunnels spread laterally away from the central nest.

Foraging tunnel systems can reach many metres from the mound and total tens of metres of tunnel.

At ant scale this is an underground city.

## 6.1 Founding nest is much smaller

A newly mated Queen does not immediately construct a giant mature mound.

Classic work describes newly mated queens creating a small founding tunnel or chamber, sealing themselves in, and raising the first brood claustrally.

This is important for TMB progression:

```text
MATED QUEEN
    ↓
SMALL FOUNDING CHAMBER
    ↓
SEALED CLAUSTRAL PERIOD
    ↓
FIRST MINIMS
    ↓
NEST REOPENS
    ↓
FORAGING
    ↓
EXPANSION
    ↓
MATURE NETWORK
```

This supports the existing blueprint progression extremely well.

---

# 7. FORAGING TUNNELS, THE UNDERGROUND HIGHWAY SYSTEM

Fire ants do not necessarily walk across the exposed surface for the entire trip from mound to food.

Research on *S. invicta* foraging shows extensive shallow underground tunnel networks radiating from the mound.

Surface openings can occur at intervals of roughly 50 to 100 cm in studied systems. Some mapped tunnels extended more than 15 m from a mound.

This means an established TMB colony should eventually behave more like:

```text
                 FOOD
                  ▲
                  │ short surface exposure
              EXIT HOLE
                  │
══════════════════╪════════════════ shallow tunnel
                  │
               BRANCH
               ╱    ╲
              ╱      ╲
          MAIN NEST  other exits
```

rather than:

```text
MOUND → 20 m exposed marching line → FOOD
```

## 7.1 Recruitment can originate outside the mound

Research indicates that a substantial reserve of recruitable foragers can occupy the tunnel network.

So when a scout discovers food:

```text
SCOUT FINDS FOOD
       ↓
chemical recruitment
       ↓
nearby tunnel workers respond
       ↓
recruitment wave spreads
       ↓
larger force arrives from nest/network
```

This can make colony AI feel much more natural.

---

# 8. INTER-NEST TUNNELS

A 2025 study found direct underground connections between neighboring *S. invicta* nests.

Among 80 studied nest pairs:

- 45% had connecting tunnels
- connected pairs had 1 to 11 tunnels
- tunnels were generally shallow
- many were around 1 to 3 cm below the surface
- tunnel cross-sections were under about 1.5 cm
- polygynous colonies were more likely to have such connections

This is a **late colony feature**, not an immediate requirement.

Potential future TMB use:

```text
MOUND A
   ╲
    ══════ SUBTERRANEAN COLONY LINK ═════
                                      ╲
                                     MOUND B
```

Possible benefits:

- worker transfer
- brood or resource movement
- protected travel
- distributed nest network
- colony relocation support
- coordinated defense

Do not build this before normal nest and foraging tunnels work.

---

# 9. CLIMBING AND CONFINED LOCOMOTION

Fire ants are excellent climbers and commonly forage on vegetation and tree trunks.

Research on tunnel locomotion has shown that confined tunnel geometry itself helps ants move safely. Narrow tunnels can allow ants to brace against walls and arrest falls using body contact and appendages.

This supports TMB's body-aware movement direction.

Future locomotion should consider:

```text
wide open vertical wall
→ adhesion / foot contact is critical

narrow shaft
→ multiple legs + body can brace
→ falling can be arrested more easily

tight tunnel
→ speed can remain surprisingly high
→ turning room decreases
```

This is another reason not to treat underground locomotion as normal walking with a brown texture around it.

---

# 10. WATER: WADING, SWIMMING, SURFACE TENSION, AND SUBMERSION

This is now directly relevant because TMB has real water gameplay.

## 10.1 Fire ants can cross wet and shallow submerged terrain

Experimental work published in 2024 found *S. invicta* workers capable of swimming through shallow water covering submerged substrate to locate food.

They were much less successful at collectively transporting food across those waterlogged conditions.

TMB implication:

```text
INDIVIDUAL ANT
thin water
→ can cross

GROUP CARRYING LARGE FOOD
same water
→ serious efficiency penalty
```

Excellent future environmental gameplay.

## 10.2 Surface tension matters at ant scale

Fire ants have hydrophobic cuticles.

At their size, water surface tension is not background decoration. It is a major physical boundary.

The current TMB concept of wading, surface interaction, swimming, and submersion is biologically appropriate as a game abstraction.

## 10.3 Important nuance: escaping the surface can be difficult

Raft experiments found differences by worker size when submerged ants reached the air-water interface.

Some smaller workers could become trapped beneath surface tension unless they contacted debris, another ant, a raft, or a solid surface crossing the interface.

Therefore future worker-size water behavior can differ.

Do not assume a 2 mm worker and a large Queen interact with the interface identically.

---

# 11. FIRE-ANT RAFTS

Flood rafting is one of the signature behaviors of *S. invicta*.

When colonies flood, workers interconnect their bodies and form a floating structure.

Observed connections include tarsus-to-tarsus and other appendage or body contacts. Workers curl into a dense interconnected network.

Brood is extremely important to successful raft behavior and buoyancy. Queens are protected within raft structure rather than casually left underneath.

## 11.1 A future TMB flood sequence writes itself

```text
HEAVY RAIN
    ↓
soil saturation
    ↓
nest flooding
    ↓
workers move brood upward
    ↓
colony evacuates mound
    ↓
brood + workers aggregate
    ↓
RAFT FORMS
    ↓
current carries colony
    ↓
raft contacts debris / bank
    ↓
workers disembark
    ↓
temporary/refounded nest
```

This should be a major dynamic-world event one day.

Do not build full rafting before established colonies, brood, and flooding simulation exist.

---

# 12. BUBBLES AND THE "FIRE-ANT ELEVATOR"

Research on flooded colonies documented an extraordinary behavior.

Submerged workers encounter air bubbles on underwater surfaces. Bubbles can attach to their bodies, especially around locations associated with spiracles. Workers and brood can accumulate bubbles. Brood hairs trap air particularly effectively.

Aggregations of workers, brood, and bubbles can become buoyant enough to rise toward the surface.

Researchers described this as effectively a **bubble-powered elevator**.

Possible emergent TMB event:

```text
UNDERWATER WORKERS
       ↓
find trapped bubbles
       ↓
bubble accumulation
       ↓
brood aggregation
       ↓
buoyancy increases
       ↓
group rises
```

It sounds fictional. It is not. 😂

---

# 13. CURRENT TMB O2 SYSTEM: WHAT IS REAL AND WHAT IS TUNED

The current build uses a visible O2 or air reserve and gameplay-scale submersion timing.

Keep the distinction clear.

### Research-backed shape

- insects breathe through spiracles and tracheae, not lungs
- hydrophobic surfaces retain air
- trapped air or plastron-like behavior supports underwater survival
- fire ants are strongly buoyant
- raft structures trap air and can remain afloat for extended periods
- submerged ants can survive vastly longer than a few seconds

### TMB tuning

- current 45-second O2 reserve
- current refill rate
- stamina cost of swimming
- exact dive controls
- inability to drown or permanently die solely from the meter, if retained as a survival invariant

The existing system is acceptable as game tuning.

Do not rewrite it merely to make the timer literally hours long.

---

# 14. FLIGHT: TMB LANDED NEAR A REAL NUMBER

A flight-mill study of *S. invicta* alates found:

```text
Female alate mean flight speed:
≈ 0.7 m/s
≈ 70 cm/s

Male mean flight speed:
≈ 1.0 m/s
```

TMB's current Queen flight numbers have been sitting around approximately the same 70 cm/s range.

That is remarkably close to the published female value.

**Do not casually "fix" the Queen into several metres per second because 70 cm/s looks slow at human scale.**

At ant scale, it is already fast.

## 14.1 Flight is metabolically expensive

Female metabolic rate during measured flight increased roughly fifty-fold relative to rest.

Female alates relied heavily on carbohydrate metabolism.

This strongly supports:

- high stamina cost of powered flight
- carbohydrate availability affecting flight readiness
- recovering or fueling before important flights
- flight not being free infinite travel

## 14.2 Wind matters enormously

The same research estimated female self-powered dispersal at under about 5 km without wind assistance.

Wind can carry queens much farther.

This validates TMB's decision that:

```text
ground speed = air motion + wind
```

and that strong winds can overwhelm a Queen's own flight authority.

---

# 15. NUPTIAL FLIGHT AND WEATHER

Mating flights are strongly weather-linked.

Field observations associate fire-ant reproductive flight with warm conditions and rainfall or moisture. Classic observations describe flight occurring following rain and being reduced by stronger wind or gusts.

This means TMB's existing weather system should eventually drive one of the most important reproductive world events.

Concept:

```text
RECENT RAIN          ✔
SOIL MOISTURE        ✔
TEMPERATURE          ✔
TIME WINDOW          ✔
WIND ACCEPTABLE      ✔
MATURE COLONIES      ✔

        ↓

NUPTIAL FLIGHT EVENT
        ↓

male + female alates emerge
        ↓

predator activity increases
        ↓

player Queen searches / pairs
```

Do not make males permanently float around the entire island like ordinary wildlife.

Their availability should eventually be linked to reproductive events and conditions.

---

# 16. QUEEN FOUNDING BIOLOGY

After mating, a founding *S. invicta* Queen is claustral.

That means she seals herself inside the founding nest and raises the first brood without normal outside foraging.

She relies on stored body resources. Her no-longer-needed flight muscles are broken down and help supply resources during founding.

The first workers are very small and are commonly called minims or nanitics.

Classic experimental timelines under favorable temperatures found approximately:

```text
mating / founding
     ↓
eggs within a few days
     ↓
larvae about a week
     ↓
pupae around two weeks
     ↓
first workers about three to four weeks
```

TMB does not need to use literal real-time weeks.

Preserve the progression shape and tune the clock.

## Gameplay loop

```text
WINGED QUEEN
    ↓
MATING
    ↓
FOUNDING SITE
    ↓
DIG CHAMBER
    ↓
DEALATION / WINGS LOST
    ↓
SEALED CLAUSTRAL PERIOD
    ↓
EGGS
    ↓
LARVAE
    ↓
PUPAE
    ↓
MINIMS
    ↓
FIRST FORAGING
```

This should feel like a major life-state transition.

---

# 17. FOOD: FIRE ANTS ARE OMNIVORES, BUT "FOOD" IS NOT ONE RESOURCE

Red imported fire ants consume a broad range of resources.

Major categories relevant to TMB include:

- other arthropods
- dead insects and carrion
- sugary liquids
- honeydew from sap-feeding insects
- plant-derived liquids and nectar-like resources
- seeds and plant material opportunistically
- fats and proteins from animal prey

## 17.1 Carbohydrates and proteins play different roles

Carbohydrate-rich liquid food is especially important for worker energy.

Animal prey contributes protein and other nutrients important to colony development and brood.

This suggests TMB should eventually stop thinking only in terms of:

```text
FOOD +10
```

and at least distinguish broad nutrition classes.

A simple starting model:

```ts
interface Nutrition {
  carbohydrate: number;
  protein: number;
  lipid: number;
  water: number;
}
```

Do not expose all four as HUD bars.

They can influence internal outcomes while the HUD remains understandable.

---

# 18. HONEYDEW: PLANTS CAN CREATE FOOD WITHOUT BEING "EDIBLE"

A crucial ecological point for the upcoming landscaping phase:

Fire ants commonly exploit honeydew from sap-feeding insects such as aphids, scales, and mealybugs.

Therefore a tree or shrub does not need to be directly edible to be valuable.

A plant can become an ecological food site because it hosts another insect.

```text
PLANT
  ↓
supports APHIDS / SCALE / MEALYBUGS
  ↓
honeydew produced
  ↓
FIRE ANTS harvest carbohydrates
  ↓
ants may defend sap-feeding insects
  ↓
plant becomes recurring food location
```

This would make vegetation gameplay-relevant rather than decorative.

---

# 19. LARVAE HELP PROCESS SOLID FOOD

Adult workers primarily handle and redistribute liquid food efficiently through trophallaxis.

Solid prey has a different path. Late-stage larvae can process solid food material, helping convert it into material that can then circulate through the colony.

This is biologically fascinating and useful for colony simulation.

Possible simplified TMB logic:

```text
LIQUID SUGAR
→ workers ingest
→ rapid colony energy distribution

SOLID INSECT
→ transported to nest
→ larvae / processors
→ brood nutrition + redistributed nutrients
```

This gives brood functional importance beyond being a timer until "new worker".

---

# 20. FIRE ANTS MAKE "INSECT JERKY"

Research documented *S. invicta* workers processing excess insect prey into small pieces, drying them, and stockpiling them in warmer or drier mound locations for later use.

That gives TMB a real biological basis for long-term food storage.

Future colony stores can include:

```text
fresh prey
↓
processed pieces
↓
drying
↓
stored protein reserve
```

This is far more interesting than a generic magical pantry.

---

# 21. FOOD TRANSPORT

Fire ants can carry small food items individually.

For large food, workers may cooperate to transport the whole object, hold the item in place, cut it into smaller pieces, or carry fragments individually or in groups.

Research on vertical tree surfaces documented these strategies directly.

TMB item logic can therefore classify resources by relation to ant size:

```text
TINY
one ant carries

SMALL
one large worker OR two workers

LARGE
group carry

TOO LARGE / AWKWARD
anchor + cut into pieces
```

Waterlogged terrain should strongly penalize group transport.

That connects food directly to the current river system.

---

# 22. COMBAT: BITE, ANCHOR, CURL, STING

Fire-ant combat should not be represented as generic repeated biting.

A key attack sequence is:

```text
CONTACT
   ↓
MANDIBLES GRAB / BITE
   ↓
ANT ANCHORS
   ↓
GASTER CURLS FORWARD
   ↓
STINGER CONTACT
   ↓
VENOM DELIVERY
   ↓
release / reposition / sting again
```

Workers can sting repeatedly.

The mandibles are both weapons and grappling tools.

TMB animation should eventually make the abdomen or gaster a real part of combat.

---

# 23. VENOM

*S. invicta* venom is dominated by piperidine alkaloids.

For TMB, exact toxicology need not become a chemistry simulation.

A practical combat model could use:

```text
BITE / MANDIBLE
→ immediate physical damage
→ grapple / anchor chance

STING
→ puncture damage
→ venom dose

VENOM
→ damage over time
→ impairment
→ species-specific resistance
```

Different arthropods can later have different venom susceptibility.

Avoid making venom a generic poison that affects every creature identically.

---

# 24. ANT-ON-ANT WARFARE

Experiments with hostile non-nestmate *S. invicta* workers observed:

- immediate aggression
- grappling
- attempts to sever antennae
- attempts to sever limbs
- stinging
- pairs and small groups fighting together

One experimental battle series produced high injury and mortality, though outcomes varied greatly by colony.

This supports body-part consequences:

```text
ANTENNA DAMAGE
→ reduced sensing / pheromone perception

LEG DAMAGE
→ movement / climbing penalty

GRAPPLED
→ movement restricted

STUNG
→ venom effects

MULTIPLE ATTACKERS
→ major positional disadvantage
```

Do not implement gore merely for spectacle.

The important gameplay is functional damage and teamwork.

---

# 25. FIRE ANTS WIN THROUGH RECRUITMENT, NOT INVINCIBILITY

Fire ants can dominate resources through rapid recruitment, numbers, aggression, and chemical communication.

A lone worker should not automatically defeat everything because "fire ants are dangerous."

TMB should support intelligent retreat and recruitment:

```text
WORKER FINDS THREAT
       ↓
size-up encounter
       ↓
fight? flee?
       ↓
alarm / recruitment
       ↓
reinforcements
       ↓
group attack
```

That is more authentic and better gameplay.

---

# 26. PHEROMONES AND ANT SENSE

Chemical information is central to fire-ant life.

Important categories include:

- recruitment and trail cues
- alarm cues
- colony and nestmate recognition
- reproductive and Queen-related chemical communication

This supports a future **Ant Sense** view.

Example visualization:

```text
GREEN / GOLD
food / recruitment trail

RED
alarm / battle

HOME COLOUR
nest / colony identity

FAINT / BROKEN
old degrading trail
```

Pheromone trails should decay and can strengthen when repeatedly traveled.

This can become an invisible information network laid over the real terrain.

---

# 27. NECROPHORESIS AND CORPSE HANDLING

Fire-ant workers remove dead ants and waste from colony space.

Research also shows they distinguish nestmate and non-nestmate corpses chemically, especially when fresh.

This supports:

- midden and refuse areas
- sanitation jobs
- corpse retrieval and removal
- disease-risk mechanics later
- different reactions to fresh enemy bodies

Do not make every dead ant disappear instantly.

A colony feels alive when workers have to deal with what happened.

---

# 28. TEMPERATURE, MOUNDS, AND BROOD MOVEMENT

The mound is not just a pile of excavated dirt.

It also affects temperature.

Research measured mound surfaces warmer than surrounding ground, with temperature varying strongly by sun exposure and time of day.

Brood location is temperature-sensitive. One Louisiana study found brood in above-ground mound portions when mound soil was approximately 25 to 30°C.

Workers move brood through the nest as conditions change.

Future colony AI:

```text
MORNING
upper mound warms
      ↓
brood moved upward

HOT AFTERNOON
upper mound overheats
      ↓
brood moved deeper

COOL PERIOD
deep nest / stable chamber
```

This gives landscaping, weather, shade, slope, and nest architecture actual colony consequences.

---

# 29. PROCEDURAL LANDSCAPING IS THE RIGHT NEXT STEP

Joshua's current direction is:

> Finish water, then landscaping such as trees, bushes, plants, grass, etc., then begin food.

That ordering is strong.

TMB does **not** need final artist-made vegetation models before landscaping becomes useful.

The current repo already has the beginning of the correct architecture.

## 29.1 Three visual and ecological scales

Use three layers:

```text
MACRO
real Kauaʻi landcover / canopy raster
"What biome/neighbourhood is this?"

        ↓

MID
procedural trees, shrubs, plant clumps, fallen logs
"What large obstacles/resources are here?"

        ↓

MICRO
grass blades, leaves, pebbles, twigs, seeds, litter
"What does a 5 to 10 mm ant actually walk through?"
```

At ant scale, a grass blade is not ground texture.

It is architecture.

A twig is not decoration.

It is a log.

A pebble is a boulder.

This is where TMB can feel radically different from human-scale survival games.

---

# 30. PROCEDURAL FIRST, AUTHORED MODELS LATER

The renderer should be replaceable without changing the ecology.

Bad architecture:

```text
if meshName === "hibiscus.glb":
    spawnFood()
```

Better:

```ts
interface PlantDefinition {
  id: string;
  visual: VisualDefinition;
  habitat: HabitatRules;
  food: PlantFoodRules;
  hostPotential: HostPotential;
}
```

Then today:

```text
visual = procedural shrub
```

Later:

```text
visual = hibiscus.glb
```

The gameplay identity remains the same.

This allows TMB to start with:

- procedural trunks
- procedural branches
- crossed or clustered leaf cards
- simple plant stems
- textured grass
- low-poly rocks
- instancing

and progressively replace the most visible objects.

---

# 31. REALISTIC TEXTURES CAN CARRY PROCEDURAL GEOMETRY A LONG WAY

For early landscaping, realistic materials will matter more than perfect geometry.

Useful categories:

```text
TREE BARK
roughness + normal variation

LEAVES
alpha-tested leaf atlas
roughness / translucency impression

GRASS
multiple blade textures
small hue / shape variation

DEAD LEAF LITTER
brown / tan atlas
curl / edge variation

TWIGS
bark texture

ROCKS
normal / roughness variation
```

Avoid making every procedural object glossy.

At this scale, texture detail becomes enormous from the Queen's point of view.

---

# 32. LANDSCAPING SHOULD ALREADY PREPARE FOR FOOD

Do not build landscaping as a purely visual system and then later bolt food onto it.

Each landscape object can expose ecological opportunities even if food is not implemented yet.

Example:

```ts
interface EcologicalNode {
  plantId?: string;
  canHostSapFeeders: boolean;
  nectarPotential: number;
  fruitDropPotential: number;
  seedDropPotential: number;
  preyHabitatPotential: number;
  shelterPotential: number;
}
```

This does not mean every plant instantly spawns food.

It means food systems later have something sensible to query.

---

# 33. RECOMMENDED FIRST FOOD SOURCES

Once landscaping is stable, do not immediately build fifty foods.

Start with a small set that exercises different systems.

## 33.1 Sugar or carbohydrate source

Example:

```text
HONEYDEW
```

Initially this could be represented as a resource spot on suitable vegetation.

Later it can require actual aphids, scales, or mealybugs.

Gameplay:

- fast worker energy
- recurring source
- plant-associated

## 33.2 Small dead insect

Example:

```text
dead fly / small beetle / insect fragment
```

Gameplay:

- protein
- carryable
- teaches solid food transport

## 33.3 Large carcass

Example:

```text
large dead insect
```

Gameplay:

- too large for one ant
- cut or recruit
- creates colony traffic

## 33.4 Seed or plant fragment

Gameplay:

- opportunistic food or resource
- easy procedural ground spawn
- lightweight carry

## 33.5 Fallen sugary plant material

Example:

```text
fruit / sap / nectar-like droplet
```

Gameplay:

- hydration + carbohydrate overlap
- plant ecology link

This small set gives far more mechanics than twenty reskinned "+10 Food" pickups.

---

# 34. FOOD SHOULD CHANGE BY LIFE STATE

The existing TMB Queen has a special founding life state.

Use biology:

```text
ROAMING ALATE
→ food / water relevant

MATED BUT STILL ROAMING
→ food / water relevant

CLAUSTRAL FOUNDER
→ no normal outside foraging
→ relies on stored reserves / internal resources

COLONY WITH WORKERS
→ Queen becomes worker-fed
→ trophallaxis / colony supply replaces direct foraging
```

This is a strong example of a stat system following life state rather than simply growth percentage.

---

# 35. WEATHER SHOULD AFFECT MORE THAN FLIGHT

TMB already has sophisticated weather.

Eventually weather should influence:

```text
rain
→ soil moisture
→ digging suitability
→ flood risk
→ water availability
→ nuptial flight opportunity

heat
→ surface activity
→ brood placement
→ water demand
→ food activity

wind
→ Queen flight
→ exposed movement
→ scent dispersion later

flood
→ nest evacuation
→ raft behavior
```

One weather system can feed many biological systems.

Avoid building isolated weather minigames that do not touch ecology.

---

# 36. SUGGESTED IMPLEMENTATION ORDER FROM THE CURRENT REPO

Based on the current TMB state, the recommended order is:

## Phase A: Finish and stabilize water

Do not endlessly expand it.

Finish device verification of:

- bank current
- swimming
- surfacing
- O2 behavior
- river visuals
- transition geometry

Then freeze water as "good enough" and move on.

## Phase B: Wire the existing landscape groundwork

The repository already has inert vegetation data and `GroundCover.ts`.

Next:

1. wire vegetation load into boot
2. wire `GroundCover` into `IslandScene`
3. verify deterministic placement
4. verify no spawning in rivers and lakes
5. add distance and LOD rules
6. confirm mobile performance

## Phase C: Add mid-scale procedural landscape

Add simple instanced or procedural:

- trees
- shrubs
- plant clumps
- fallen logs and branches
- larger rocks

Use real landcover and canopy to decide density.

Do not chase final species-perfect models yet.

## Phase D: Add ecological metadata

Before Food v1, add semantic definitions:

```text
plant type
habitat
sugar potential
sap-feeder host potential
seed / fruit potential
insect habitat potential
```

## Phase E: Food v1

Start with:

- liquid carbohydrate source
- small insect protein source
- larger group or cuttable prey
- optional seed or plant fragment

Wire food drain only when reliable recovery and eating exists.

Preserve TMB's current survival invariant:

> A meter should not begin draining until the player has a real way to refill it.

## Phase F: Foraging and carrying

Then add:

- pick up
- carry
- drop
- cutting larger food
- weight and size limits
- water penalties

## Phase G: Wildlife

Once the environment contains shelter and food, insects have reasons to exist.

Then AI can interact with:

- plants
- water
- prey
- carrion
- colonies

This avoids spawning random enemies into an empty green field.

---

# 37. REALISM PRIORITY TABLE

| Priority | Biology/System | TMB Value | Timing |
|---|---|---|---|
| ⭐⭐⭐⭐⭐ | Procedural vegetation at ant scale | Makes world readable and alive | Next |
| ⭐⭐⭐⭐⭐ | Sugar vs protein food roles | Foundation for survival and colony | After landscape |
| ⭐⭐⭐⭐⭐ | Bite-grapple-sting combat | Species identity | Combat phase |
| ⭐⭐⭐⭐⭐ | Soil and moisture digging | Nest gameplay | Nest phase |
| ⭐⭐⭐⭐⭐ | Pheromone recruitment | Colony intelligence | Colony phase |
| ⭐⭐⭐⭐⭐ | Weather-linked mating | Connects flight, weather, progression | Mating phase |
| ⭐⭐⭐⭐ | Group carry and cutting food | Great ant gameplay | Food phase |
| ⭐⭐⭐⭐ | Thermal brood relocation | Living nest | Colony phase |
| ⭐⭐⭐⭐ | Worker size continuum | Genetics and caste realism | Worker/Major phase |
| ⭐⭐⭐⭐ | Underground foraging tunnels | Mature colony realism | Later |
| ⭐⭐⭐⭐ | Waterlogged food penalty | Uses current water | Food phase |
| ⭐⭐⭐ | Raft formation | Spectacular flood event | Established colony |
| ⭐⭐⭐ | Bubble elevator | Rare emergent behavior | Much later |
| ⭐⭐⭐ | Inter-nest tunnels | Mature network feature | Much later |

---

# 38. RULE FOR REALISM VS GAMEPLAY

Use three labels in future code and docs where useful:

```text
MEASURED
Directly based on published measurement

BIOLOGICAL SHAPE
Behavior or mechanism is real but magnitude is tuned

GAME TUNING
Invented number chosen for playability
```

Examples:

```text
Queen ≈ 0.7 m/s flight speed
→ MEASURED / strong reference

fire ant becomes buoyant and returns toward surface
→ BIOLOGICAL SHAPE

45-second O2 gauge
→ GAME TUNING

+25 HP from a sting
→ GAME TUNING
```

This prevents future developers from "correcting" gameplay numbers under the mistaken belief that they are biological measurements.

---

# 39. REFERENCE LINKS

Claude: these references are included so provenance is preserved. If an environment cannot open one of them, use the research summary in this document as the Joshua-approved baseline rather than blocking work.

## General biology, habitat, identification

1. Texas A&M, Fire Ant Biology  
   https://fireant.tamu.edu/learn/biology/

2. Texas A&M, Identifying Fire Ants  
   https://fireant.tamu.edu/manage/how-can-i-tell-if-i-have-fire-ants/

3. Texas A&M, Site and Habitat Management Information  
   https://fireant.tamu.edu/manage/site/

4. UF/IFAS, Red Imported Fire Ant, *Solenopsis invicta*  
   https://ask.ifas.ufl.edu/publication/IN352

## Digging, tunnels, and foraging architecture

5. Gravish et al., Effects of worker size on fire-ant tunnel construction  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3481571/

6. Tschinkel, Organization of foraging in *Solenopsis invicta*  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3391925/

7. Underground inter-nest tunnels in *Solenopsis invicta* (2025)  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC12387039/

8. Excavation self-organization  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC10189599/

## Water, swimming, rafting, and bubbles

9. Mlot, Tovey and Hu, Fire ants self-assemble into waterproof rafts  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3093451/

10. Foster et al., Raft formation, brood, and bubble use  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC3462402/

11. Food search and transport under wet conditions, including swimming through shallow submerged substrate  
    https://www.sciencedirect.com/science/article/pii/S1226861523001346

## Food, nutrition, and transport

12. Fire ants dry and store insect pieces for later use, or "insect jerky"  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC3127378/

13. Food transport on vertical surfaces  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC6397150/

14. Fire-ant and mealybug mutualism and honeydew importance  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC3402455/

15. Sugar-feeding preferences and feeding biology  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC8364317/

## Combat, aggression, and pheromones

16. Fire-ant battle mortality, grappling, limb and antenna attacks  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC1559866/

17. Pheromone-mediated social organization review  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC12940258/

18. Nestmate and non-nestmate corpse recognition and aggression  
    https://pmc.ncbi.nlm.nih.gov/articles/PMC7387867/

## Flight and Queen founding

19. Vogt, Appel and West, Flight energetics and dispersal capability  
    https://www.sciencedirect.com/science/article/pii/S0022191099001584

20. PubMed record for the same flight study  
    https://pubmed.ncbi.nlm.nih.gov/10742518/

21. USDA, Fire-ant colony founding and Queen biological variation  
    https://www.ars.usda.gov/arsuserfiles/60360510/publications/Vander_Meer-1988%28M-2045%29.pdf

22. Classic colony-founding study  
    https://academic.oup.com/aesa/article-abstract/65/5/1053/13950

23. Brood care by newly mated Queens  
    https://academic.oup.com/aesa/article/95/2/208/50995

## Temperature and mound ecology

24. Mound temperature and brood location  
    https://academic.oup.com/ee/article/32/1/204/491794

25. Dynamic thermal structure of imported fire-ant mounds  
    https://academic.oup.com/jinsectscience/article/8/1/31/896286

26. Temperature and seasonal foraging activity  
    https://academic.oup.com/ee/article/32/3/447/385941

---

# 40. FINAL DESIGN SUMMARY FOR CLAUDE

The next goal should not be "add random plants" followed by "spawn food pickups."

The emerging world should work like this:

```text
REAL KAUAʻI TERRAIN + WATER
            ↓
REAL LANDCOVER / CANOPY CLASSES
            ↓
PROCEDURAL VEGETATION
            ↓
ANT-SCALE GROUND COVER
            ↓
ECOLOGICAL RESOURCE POTENTIAL
            ↓
FOOD / PREY / HONEYDEW / SEEDS
            ↓
FORAGING
            ↓
CARRY / CUT / RECRUIT
            ↓
COLONY NUTRITION
            ↓
BROOD / WORKER SIZE / GROWTH
            ↓
COLONY EXPANSION
```

And eventually:

```text
WEATHER
   ├── changes water
   ├── changes soil
   ├── changes foraging
   ├── changes brood temperature
   └── triggers mating conditions

VEGETATION
   ├── provides structure
   ├── hosts food-producing insects
   ├── creates shade / moisture
   ├── creates climbing routes
   └── creates prey habitat

WATER
   ├── provides drinking
   ├── creates current hazards
   ├── changes food transport
   ├── floods nests
   └── eventually triggers rafting

FIRE ANT BIOLOGY
   ├── bite + grapple + sting
   ├── pheromone recruitment
   ├── tunnel highways
   ├── size-polymorphic workers
   ├── claustral Queen founding
   └── living colony behavior
```

The result should be a world where systems produce gameplay instead of a world where gameplay objects are placed randomly on top of scenery.

That is the realism target for TRADDOMIUM.

**Joshua has approved this document as the current biological and gameplay reference. Use it as the baseline unless Joshua gives a newer explicit instruction.**
