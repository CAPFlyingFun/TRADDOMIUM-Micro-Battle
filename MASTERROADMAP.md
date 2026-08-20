# TRADDOMIUM: Micro Battle!
## MASTER ROADMAP
### Long-form product vision and development guide
**Platform:** Web TypeScript  
**Stack:** three.js + TypeScript + Vite  
**Primary target:** Mobile landscape browser / installed web app, with desktop support  
**Game identity:** Direct-control ant survival RPG + living colony + persistent ecosystem  
**Document date:** 2026-08-20

---

# 1. PURPOSE OF THIS FILE

This file is the long-form product vision for **TRADDOMIUM: Micro Battle!**

Trello should stay shorter and more execution-focused. Trello cards can describe the current task, acceptance criteria, bugs, ownership, and what is being tested right now. This file exists so those shorter cards do not lose the larger game idea.

Use this hierarchy when sources disagree:

1. **Joshua's newest explicit instruction**
2. **This MASTERROADMAP.md for the long-term game vision**
3. **Trello for current execution, task order, acceptance criteria, and ownership**
4. **README / CLAUDE.md for stable engineering guidance**
5. Older experiments and prototypes only as references

This roadmap is intentionally broader than the current build. A feature appearing here does **not** mean it should be implemented immediately.

The game should continue to be built in focused, testable layers.

---

# 2. VERY IMPORTANT: THIS IS TRADDOMIUM, NOT TCS

Do not mix the identity of this game with **Thronemound Colony Sim (TCS)**.

## TRADDOMIUM: Micro Battle!

> **YOU ARE THE ANT.**

The player directly controls one individual ant at a time.

The colony becomes the persistent home, team, lineage, and long-term identity, but the moment-to-moment game is creature control:

- move
- fly when appropriate
- climb
- explore
- fight
- forage
- carry
- survive
- interact with insects
- return to the colony
- switch to another colony member later

## TCS

> **YOU ARE THE COLONY / KEEPER.**

TCS is the separate observational colony simulator.

Ideas can inspire each other, but code architecture and gameplay assumptions must not be copied between them automatically.

---

# 3. THE CORE FANTASY

TRADDOMIUM should feel like:

```text
PATH OF TITANS
direct creature control
growth
stats
abilities
combat
exploration

        +

ARK
persistent dangerous ecosystem
wild creature levels
survival
resources
genetics-inspired breeding
territory
base progression
world hazards

        +

EMPIRES OF THE UNDERGROWTH
living ant colony
brood
AI workers
automatic defense
nest economy
colony warfare

        +

REAL ANT BIOLOGY
castes
queen founding
male alates
brood care
pheromone-inspired behavior
food-driven colony development
tunnels
territory

        =

TRADDOMIUM: MICRO BATTLE!
```

The inspirations guide the feeling and systems. They are not templates to copy feature-for-feature.

The central promise is:

> **Start as one vulnerable ant in a gigantic world. Survive long enough to create a colony. Eventually that colony becomes your team, your home, your pool of playable ants, and your stake in the world.**

---

# 4. THE PLAYER'S LONG-TERM ARC

The game should evolve in acts rather than exposing every system at the beginning.

## ACT I: THE YOUNG QUEEN

The player begins as a **small newly emerged Fire Ant Queen**.

This is intentionally a gameplay abstraction inspired by Path of Titans. Real adult alates do not grow through a Path-of-Titans-style juvenile progression after emergence, but visible growth is more rewarding for this game.

The Queen:

- begins small
- has wings
- can fly
- is vulnerable
- can explore the surface world
- can forage enough to survive
- can flee from dangerous insects
- can fight when necessary
- grows visibly over time
- gains better stats as she matures
- eventually reaches adult / founding-ready maturity

The opening should feel dangerous because the player has no workers, army, nest, or safe colony.

```text
SMALL YOUNG QUEEN
        ↓
explore
        ↓
survive
        ↓
food / water / environmental hazards
        ↓
avoid or fight insects
        ↓
quests / objectives / discoveries
        ↓
grow
        ↓
ADULT WINGED QUEEN
```

The goal is not to rush through this stage. It should be enjoyable as a creature-survival game by itself.

---

# 5. GROWTH VS LIFE STATE

This distinction is important and should be reflected in the data model.

The Queen has **continuous creature growth**, but she also has **event-driven reproductive / colony states**.

These are not the same thing.

## 5.1 Creature growth

Recommended conceptual five-point curve:

```text
Young
  ↓
Growing
  ↓
Adolescent
  ↓
Sub-Adult
  ↓
Adult
```

Or equivalent names if a better naming set is chosen.

Growth owns stats that naturally interpolate as the playable animal develops:

- body size
- mass
- health
- stamina
- walk/run/sprint performance
- turn radius
- armor
- bite
- sting
- recovery
- carry strength
- flight performance
- other physical capabilities

The existing Path-of-Titans-style five-point curve format is a good foundation.

## 5.2 Queen life state

Queen life state should be driven by actual gameplay events, not arbitrary growth percentages.

Conceptually:

```text
ALATE_UNMATED
      ↓ successful mating
ALATE_MATED
      ↓ player commits to nest founding
FOUNDER
      ↓ first brood exists
FIRST_BROOD
      ↓ workers emerge
ESTABLISHED
      ↓ mature colony
MATURE_COLONY
```

Life state can own or modify:

- has wings
- can fly
- can found a nest
- founding metabolism
- egg production
- Queen AI priorities
- Queen mobility
- colony-fed status
- reproductive behavior
- nest-related abilities

A Queen can therefore be, for example:

```text
Growth: 84%
Life state: ALATE_UNMATED
```

and later:

```text
Growth: 84%
Life state: ALATE_MATED
```

Her physical growth stats do not have to jump simply because mating occurred.

---

# 6. CURRENT STAT-DATA DIRECTION

As of the current v0.5.0-era work, `src/ant/castes.ts` introduced the Fire Ant Queen as a data-driven five-point stat profile with:

- Attributes
- Multipliers
- Combat
- `WIRED` stats that distinguish live mechanics from future design values

This is a good general direction.

The important architectural principle is:

> Adding Worker or Major should primarily mean adding a new data profile, not adding caste-specific branches throughout movement and combat code.

However, before duplicating the Queen schema into Worker and Major, separate **growth** from **Queen life state** as described above.

Also note:

- The Queen now needs future flight stats because flight is part of her core opening loop.
- A Fire Ant Male may not belong cleanly inside a female caste enum such as `queen | worker | major`. Do not force the domain model if a separate reproductive/sex profile is cleaner.
- Design-only values may exist before their mechanics, but they must stay clearly inert until wired.
- A UI element must not imply a mechanic works when it does not.

---

# 7. QUEEN FLIGHT

The Queen begins winged and can fly from the start.

Flight is not a decorative animation. It is a gameplay capability used for:

- exploration
- escape
- reaching mating activity
- navigating hazards
- searching for a mate
- landing to found the colony

Possible future stats:

- flightSpeed
- flightStamina
- flightAcceleration
- flightTurnRate
- takeoffCost
- landingRecovery
- aerial maneuverability

These do not need to be implemented until flight reaches its proper development milestone.

The Queen eventually loses normal flight after committing to founding and shedding her wings.

```text
YOUNG / GROWING ALATE
🪽 can fly

        ↓

ADULT ALATE
🪽 can fly

        ↓

SUCCESSFUL MATING
🪽 still capable of flight / landing phase

        ↓

FOUNDING COMMITMENT
wings shed

        ↓

FOUNDER QUEEN
no normal flight
```

---

# 8. MALE FIRE ANTS AND MATING

A **male Fire Ant model** will be needed.

Male alates have wings and should exist as world/reproductive entities.

The presentation should remain game-friendly and non-graphic.

## 8.1 Encounter model

The world may use biologically inspired **nuptial-flight conditions/events**, while still allowing the gameplay abstraction of finding and pursuing male alates in active areas.

Example:

```text
weather / world conditions
        ↓
reproductive activity event
        ↓
male alates appear / fly / roam within the event region
        ↓
player Queen searches for a desirable male
        ↓
interaction / pairing attempt
        ↓
SUCCESS or FAILURE
```

If pairing fails, the male can:

- break away
- fly away
- run/fly out of reach
- remain unavailable for another attempt

The game can present this as compatibility, timing, condition, or successful pairing rather than showing explicit mating.

## 8.2 Successful mating

A successful mating event should be a major milestone:

```text
ADULT WINGED QUEEN
        ↓
find male
        ↓
attempt pairing
        ↓
SUCCESS
        ↓
NEST FOUNDING UNLOCKED
```

The Queen should not be allowed to establish the permanent colony before this condition is satisfied.

---

# 9. ARK-LIKE LEVELS AND GENETICS-INSPIRED INHERITANCE

The ecosystem should use visible creature levels.

A newly generated or newly spawned wild creature may begin low, but creatures in the persistent world can become stronger over time.

The player may eventually encounter:

- Lv. 1 insects
- Lv. 14 beetles
- Lv. 40 predators
- Lv. 80 male alates
- Lv. 100 exceptional wild creatures

Exact maximum level and leveling math are not locked yet.

## 9.1 Wild levels

A wild creature's level is a gameplay abstraction representing some combination of:

- physical quality
- age/experience
- stat roll
- genetics
- survival success

Not every high-level creature must be superior in every stat.

## 9.2 Male quality and colony inheritance

The male's quality should matter because the Queen's mating choice can influence the future colony.

Conceptually:

```text
QUEEN BASE / GENETIC STATS
            +
MALE BASE / GENETIC STATS
            ↓
COLONY BROOD STAT POTENTIAL
            ↓
individual Worker / Major base rolls
            ↓
that ant can still gain its own growth / level progression
```

This can borrow the satisfying selection pressure of ARK breeding without copying ARK's exact breeding implementation.

Potential inherited categories could eventually include:

- health tendency
- stamina tendency
- size tendency
- bite strength
- sting / venom quality
- speed
- recovery
- carry strength
- digging efficiency
- disease/toxin resistance

The exact inheritance formula is still open design.

A very high-level male should be exciting, but it should not automatically mean every stat is perfect.

---

# 10. FOUNDING THE FIRST NEST

After the Queen is adult/founding-ready and successfully mated, **nest creation unlocks**.

TRADDOMIUM should not require the player to manually sculpt every millimeter of the founding nest.

Instead, colony nests use **blueprints / premade layouts**.

The inspiration is similar to:

- selecting a premade ant-farm layout
- placing a base/building blueprint in a survival game
- waiting for construction in a mobile builder

But the nest is vertical/3D underground, not a flat ant farm sitting on a table.

---

# 11. NEST BLUEPRINT SYSTEM

## 11.1 Early game

At first the player chooses from a few simple unlocked designs.

Possible examples:

```text
STARTER FOUNDING NEST
Entrance
   │
   └── Queen Chamber
```

```text
FORK NEST
Entrance
   │
   ├── Brood Chamber
   │
   └── Food Chamber
```

```text
DEEP SHAFT
Entrance
   │
   │
   ├── Brood Chamber
   │
   └── Queen Chamber
```

The exact layouts are not locked.

## 11.2 Placement

The player:

1. chooses an unlocked blueprint
2. selects a suitable world location
3. rotates/orients the plan if appropriate
4. receives terrain-validity feedback
5. confirms construction
6. waits for the build timer

Terrain/world validation may eventually care about:

- soil depth
- rocks
- roots
- water
- existing nests
- boundaries
- protected areas
- collision with world geometry

---

# 12. TIMED NEST CONSTRUCTION

Nest construction should combine **gameplay simulation** with **mobile-builder timing**.

For the first nest, a target around **30 to 60 seconds** is a reasonable current concept.

Exact timers should be tuned later.

Example:

```text
SELECT BLUEPRINT
        ↓
PLACE NEST
        ↓
VALIDATE LOCATION
        ↓
CONFIRM
        ↓
⏱ CONSTRUCTION: 45 sec
        ↓
nearby ants may visibly dig / move soil
        ↓
timer completes
        ↓
nest becomes usable
```

The timer represents the colony doing the work.

When the player is nearby, visible ants can make the process feel physical:

- digging motions
- dirt carrying
- workers entering/exiting
- partial tunnel/chamber progression
- construction progress UI

When the player is far away, the same job may progress in a cheaper abstract simulation.

The game should not require full six-leg/mandible simulation for every off-screen construction job.

## Open timer decision

Still unresolved:

> Should construction timers continue while the game is completely closed, or only while TRADDOMIUM is running?

Do not assume one answer until Joshua decides.

---

# 13. NEST PROGRESSION AND UNLOCKS

Better nests should unlock as the player progresses.

Possible progression inputs:

- Queen growth / level
- colony level
- number of living ants
- brood milestones
- nest development
- discovered resources
- completed objectives
- species progression
- world progression

Avoid creating unnecessary overlapping currencies. Every progression bar should have a distinct purpose.

Conceptual unlock path:

```text
Starter Founding Chamber
        ↓
Two-Chamber Nest
        ↓
Deep Founding Nest
        ↓
Food Storage Branch
        ↓
Brood Complex
        ↓
Defensive Layouts
        ↓
Large Colony Networks
        ↓
CUSTOM NEST DESIGNER
```

Exact levels are TBD.

---

# 14. FUTURE CUSTOM NEST DESIGNER

The full custom designer is intentionally a later feature.

This gives development time to refine:

- underground representation
- terrain rules
- pathfinding
- colony AI
- digging visuals
- mobile UX
- multiplayer implications

The progression should therefore be:

```text
Phase A
premade nest blueprints

Phase B
more blueprint choices

Phase C
blueprint variants / modular expansion

Phase D
custom nest designer
```

The early blueprint format should be designed so it can evolve into the custom planner rather than being thrown away.

Manual precision digging should **not** be required for ordinary colony creation.

A direct Dig action may still exist for local interactions, small excavation, environmental gameplay, or future mechanics, but a player should be able to build a functioning colony without hand-carving every tunnel.

---

# 15. BROOD AND CASTE DEVELOPMENT

Once the Queen has a nest, the brood loop begins.

Conceptually:

```text
Queen
  ↓
Egg
  ↓
Larva
  ↓
Pupa
  ↓
Adult ant
```

The colony's AI should influence whether developing brood becomes a **Worker** or **Major** through feeding/resources.

The player should not simply press:

```text
[SPAWN MAJOR]
```

Instead:

```text
LARVA
  ↓
AI feeding behavior
food quantity
food quality
colony need
genetic/stat potential
  ↓
Worker / Major outcome
```

The exact biology and probability rules should be researched before final balancing.

The current gameplay idea is that the Queen produces brood and the colony's feeding behavior makes each new ant partly emergent.

That means the player can influence caste production indirectly through:

- available food
- colony conditions
- resource quality
- perhaps colony priorities later

while still allowing surprise and natural variation.

---

# 16. WORKER

The Worker should be one of the main playable bodies of the game.

General fantasy:

- fast
- small
- agile
- good explorer
- efficient forager
- useful carrier
- fits through smaller spaces
- lower individual durability
- less combat dominance than a Major
- important in almost every colony system

Worker gameplay can include:

- foraging
- scouting
- carrying food
- carrying small objects
- helping brood
- exploring far from home
- fighting smaller threats
- joining group battles
- retrieving bodies/resources
- assisting construction
- discovering rival colonies

Worker stats should use the same data-driven progression philosophy as the Queen once the growth/life-state schema is clean.

---

# 17. MAJOR

The Major should change how the player approaches danger.

General fantasy:

- larger
- heavier
- stronger bite
- more durable
- stronger carry / drag capability
- better defense
- more expensive for the colony to produce/support
- less agile than a Worker
- may require larger routes/tunnels

Major gameplay can include:

- defending nest entrances
- confronting dangerous insects
- leading colony counterattacks
- carrying/dragging larger food
- PvP defense
- raid support
- guarding brood/Queen
- breaking through tougher resistance

The Major should not merely be "Worker + bigger numbers." Its role should create different decisions.

---

# 18. FIRST THREE ANTS AND CONTROL SWITCHING

Current design target:

> Once the colony has approximately **three AI ants** active, control switching unlocks.

The exact threshold can be tuned, but three is the current concept because it marks the moment the colony feels alive enough to function while the player leaves the Queen.

Example:

```text
Queen founds colony
      ↓
first brood
      ↓
Worker #1
      ↓
Worker #2
      ↓
Worker / Major #3
      ↓
🐜 CONTROL SWITCHING UNLOCKED
```

From that point onward, the player may directly control different living members of their own colony.

---

# 19. THE COLONY IS THE PERSISTENT CHARACTER

This is one of the most important concepts in TRADDOMIUM.

> **The colony is your persistent identity. The ant you control is your current body.**

Example:

```text
YOU CONTROL
Worker #7
      ↓
switch to Major #2
      ↓
Worker #7 returns to AI
      ↓
Major #2 becomes player-controlled
```

The ant that is no longer controlled should not cease to exist.

It becomes AI-controlled / abstractly simulated based on distance and context.

Likewise, when the player leaves the Queen:

- the Queen remains alive in the nest
- workers care for her
- brood continues
- nest activity continues
- colony defense continues

---

# 20. SIMULATION LEVEL OF DETAIL FOR ANTS

A mature colony may contain far more ants than a phone can fully simulate with six-leg IK and combat logic at once.

Use simulation LOD.

Conceptually:

```text
NEAR PLAYER
full model
full animation
full collision
full combat
detailed AI

MID DISTANCE
simplified movement / AI

FAR AWAY
cheap agent simulation

DEEP INSIDE NEST / OFFSCREEN
job-state simulation
```

The ant remains part of the colony in every mode.

Only the simulation detail changes.

This is necessary for:

- mobile performance
- large colonies
- multiplayer
- distant nest activity
- persistent worlds

---

# 21. AI COLONY LIFE

The player should not have to micromanage every ant.

AI colony members should choose useful jobs based on colony needs.

Potential jobs:

- forage
- feed Queen
- feed larvae
- tend brood
- move brood
- store food
- dig/build
- clear debris
- patrol
- guard entrances
- respond to threats
- recover food
- move corpses
- help injured colony members if supported by mechanics
- follow/rally when commanded later

Example while the player is far away:

```text
YOU
Worker #12 exploring Zone F5

HOME NEST
Worker feeds larva
Worker stores food
Worker tends Queen
Major guards entrance
Worker works construction
Queen lays eggs
```

The goal is a living EOTU-inspired colony that continues functioning without turning the game into an RTS micromanagement screen.

---

# 22. AI THREAT RESPONSE

Colony ants should automatically recognize and respond to threats.

Examples:

- beetle enters nest
- spider approaches entrance
- rival ant enters territory
- player-controlled enemy enters tunnel
- brood is attacked
- Queen is threatened

AI defenders should engage appropriately based on:

- caste
- threat level
- distance
- colony priorities
- available numbers
- player-issued rally behavior if added later

A player can personally join by taking control of a nearby Worker or Major.

```text
⚠ NEST UNDER ATTACK

AI Majors engage
Workers move brood
Queen remains protected

Player:
switch to Major #4
join battle
```

---

# 23. INDIVIDUAL ANT DEATH

Individual ants should matter and can die permanently.

If the current playable Worker or Major dies, the colony continues as long as living colony members remain.

The player can then select another available colony ant according to whatever respawn/control-transfer rule is finally chosen.

A dead Worker should not simply respawn as the same individual.

The colony replaces losses through new brood.

---

# 24. ARK-STYLE COLONY / PLAYER LOG

TRADDOMIUM should have a readable event log similar in spirit to ARK's tribe/player log.

Example:

```text
☠ COLONY LOG

Your Worker #18 was killed by
Lv. 14 Ground Beetle
Zone F5

Last known carried items:
- Cricket Meat x2
- Seed Fragment x1

[MARK LOCATION]
```

This log can report:

- ant deaths
- killer level/species
- zone/grid location
- nest attacks
- Queen danger
- brood loss
- construction completion
- new ant emergence
- rival colony attacks
- significant discoveries
- multiplayer events

When useful, the player can return to the death location:

- recover carried resources
- inspect/recover the body if the design supports it
- rally nestmates
- hunt the predator
- avoid the area

The zone/grid system such as **F5** gives players a practical way to communicate locations.

---

# 25. QUEEN DEATH

Queen death is special because she is the reproductive heart of the colony.

Do **not** lock the final rule yet.

The system should be researched by species and balanced for gameplay.

For Fire Ants, possible future succession systems to investigate include:

- reproductive-capable brood
- raising/replacing a Queen under queenless conditions
- adoption of an outside mated Queen in appropriate situations
- eventual colony decline if succession fails

Avoid a simplistic rule such as:

```text
Queen HP = 0
entire player's colony instantly deleted
```

unless later multiplayer balancing proves that is truly the best solution.

A better direction may be a **queenless crisis state**:

```text
QUEEN DIES
    ↓
COLONY QUEENLESS
    ↓
existing ants still alive
    ↓
brood / succession options checked
    ↓
player has limited time / resources to recover
```

Final species-specific rules remain TBD.

---

# 26. THE WORLD: ARK-LIKE ECOSYSTEM AT ANT SCALE

The surface world should feel enormous because the player is tiny.

Ordinary objects become terrain:

- grass
- roots
- bark
- rocks
- logs
- puddles
- soil
- fences
- plants
- litter
- fallen leaves
- human-made objects

Threats and opportunities include:

- beetles
- spiders
- other ants
- insects
- prey
- predators
- weather
- water
- environmental heat
- terrain hazards
- rival colonies

The world should not feel like a static level full of enemies waiting at fixed spawn points.

It should feel like an ecosystem.

---

# 27. WORLD CREATURE LEVELING

World creatures can have levels.

A low-level creature may survive long enough to become more dangerous.

The player can therefore discover that a familiar area has changed.

Example:

```text
Yesterday:
Lv. 4 Beetle near fallen log

Later:
Lv. 17 Beetle controls the same area

Much later:
rare Lv. 63 predator appears nearby
```

Exact leveling speed, despawn behavior, age, and persistence rules are TBD.

Important principle:

> Level should create risk/reward and stories, not simply inflate health bars.

Higher-level insects may have better:

- health
- damage
- stamina
- movement
- resistance
- behavior
- loot/resource value
- genetic value where applicable

---

# 28. FOOD, FORAGING, AND COLONY ECONOMY

Food should connect individual survival with colony growth.

The player can:

- find food
- carry food home
- hunt prey
- steal/scavenge resources
- defend food
- decide whether to consume now or invest in colony growth

Food delivered to the nest can affect:

- Queen support
- brood survival
- Worker/Major development
- construction
- colony growth
- future reproductive brood
- recovery

This creates an important loop:

```text
EXPLORE
  ↓
FIND / HUNT FOOD
  ↓
SURVIVE TRIP HOME
  ↓
DELIVER TO NEST
  ↓
BROOD / COLONY BENEFITS
  ↓
MORE / BETTER ANTS
  ↓
GREATER EXPLORATION AND COMBAT ABILITY
```

---

# 29. COMBAT

Combat should retain the project's physical-interaction rule:

Bad:

```text
press ATTACK
damage magically appears
```

Better:

```text
approach
  ↓
orient body/head
  ↓
reach
  ↓
bite / grip / sting
  ↓
target reacts
```

Fire Ant combat should eventually distinguish:

- bite as grip/attack
- sting as important weapon
- venom
- positioning
- stamina
- body size/combat weight
- group attacks
- caste differences

Majors and Workers should feel different in combat.

Predators should have readable behaviors so learning matters as much as stats.

---

# 30. DIRECT-CONTROL MOVEMENT

Current movement philosophy remains important:

- camera-relative direct control
- player controls one ant
- pace is a ceiling
- stick magnitude requests a portion of that pace
- reverse is limited
- sprint costs stamina
- Auto supports long travel
- sidestep should not become car steering
- camera and ant facing have a deliberate relationship
- mobile thumbs are the primary control constraint

The game is mobile-landscape first.

Do not sacrifice the action side of the screen with unnecessary permanent buttons.

Future actions may include:

- bite
- sting
- grab
- carry
- dig/interact
- abilities
- colony/rally commands

Controls should be designed around thumb reach and context.

---

# 31. SIX-LEG MOVEMENT AND PHYSICALITY

The long-term goal remains believable six-leg ant movement.

Ant movement should eventually react to:

- slopes
- rocks
- roots
- small steps
- tunnel floors/walls
- carrying
- combat
- climbing

Physical interaction is part of TRADDOMIUM's identity.

However, detail must scale with distance.

Only nearby/player-important ants need the most expensive movement simulation.

---

# 32. NESTS AS GAMEPLAY, NOT JUST DECORATION

A nest is:

- spawn/home point
- Queen sanctuary
- brood center
- food storage
- AI colony hub
- construction progression
- defensive terrain
- multiplayer objective
- persistent identity

Different layouts should have tradeoffs.

Examples:

```text
SHALLOW NEST
+ quick construction
+ easy access
- vulnerable

DEEP NEST
+ protected Queen
+ defensive depth
- slower travel/build

CHOKEPOINT NEST
+ easier defense
- traffic congestion

WIDE COLONY NEST
+ high capacity
- more entrances/area to defend
```

Eventually custom player-designed nests can create distinct colony identities.

---

# 33. MULTIPLAYER VISION

Multiplayer is a major future layer, not something to bolt onto the first movement milestone.

Each player has their own colony/team.

Conceptually:

```text
PLAYER A
Queen A
Nest A
Workers/Majors A
Colony genetics A
Territory A

        VS / COEXISTS WITH

PLAYER B
Queen B
Nest B
Workers/Majors B
Colony genetics B
Territory B
```

Players can directly control their ants in the same world.

Workers and Majors should be especially fun multiplayer bodies.

---

# 34. MULTIPLAYER COLONY WARFARE

A rival nest should not simply be:

```text
NEST HP: 1000
hit until it explodes
```

A raid should use the actual colony.

Possible escalation:

```text
SCOUT
  ↓
find rival worker

SKIRMISH
  ↓
fight over resources

TERRITORY CONFLICT
  ↓
multiple colony ants respond

RAID
  ↓
find enemy entrance

INVASION
  ↓
enter tunnels

COLONY WAR
  ↓
fight defenders
attack food stores
attack brood
damage strategic chambers
threaten Queen
```

The exact destruction/capture rules need balancing.

The Queen should be strategically important, but Queen death should not automatically be assumed to delete an entire player's account/save.

---

# 35. AI DEFENSE DURING MULTIPLAYER

A player's colony must not become helpless whenever the player is controlling one ant far away.

AI colony members should still:

- patrol
- defend
- protect Queen
- protect brood
- respond to enemy players
- respond to hostile insects

This lets multiplayer feel like real colony territory rather than avatar-only PvP.

Potential future alerts:

```text
⚠ Rival colony entered territory
⚠ Nest entrance under attack
⚠ Brood chamber breached
⚠ Queen threatened
```

The player may switch to a defender or travel home.

---

# 36. TUNNELS AND TACTICAL SIZE

Caste size can eventually matter underground.

Example:

- Worker fits smaller spaces
- Major may require wider routes
- Queen requires protected access
- narrow routes can act as defensive choke points

This creates interesting colony architecture.

Do not force this mechanic before the underground/nest representation can support it reliably.

---

# 37. SINGLE-PLAYER BEFORE FULL MULTIPLAYER

The best path is to prove the game loop offline/single-player first:

```text
one controllable ant
        ↓
survival
        ↓
growth
        ↓
world AI
        ↓
mating
        ↓
nest
        ↓
brood
        ↓
control switching
        ↓
AI colony
        ↓
rival AI colonies
        ↓
THEN multiplayer networking
```

If the single-player simulation is not fun, multiplayer will only network the problems.

---

# 38. CURRENT ENGINEERING SPINE

The existing clean-rebuild engineering spine remains useful as a low-level dependency order:

```text
01 movement
02 input + camera
03 six-leg IK
04 digging / physical interaction foundation
05 carry
06 HUD
07 combat
08 AI wildlife
09 colony / nest
10 hatch / tutorial
11 polished mini-world
```

The newer Queen/mating/colony vision expands what later milestones mean.

It does not require throwing away the already-proven movement/input work.

Some data work may happen out of order when it is low-risk and helps define future interfaces, as happened with the Queen stat file.

But do not let future data definitions force unfinished mechanics to pretend they exist.

---

# 39. PROPOSED HIGH-LEVEL PRODUCT PHASES

This is the larger product roadmap above the engineering spine.

## PHASE A: PLAYABLE ANT FOUNDATION

Goal:

> One ant feels genuinely good to control on mobile.

Includes:

- movement
- camera
- input
- pace
- sprint/stamina
- Auto
- settings
- basic body/leg motion
- six-leg IK
- collision/grounding
- direct physical interactions

Success test:

A player should enjoy simply moving around the world.

---

## PHASE B: SURVIVAL WORLD

Goal:

> The world gives the ant reasons to move.

Includes:

- food/resources
- hunger/thirst if retained
- environmental hazards
- world zones/grid
- AI insects
- wild creature levels
- basic combat
- death
- player/colony event log

Success test:

A lone Queen can have a ten-to-twenty-minute survival story without needing a colony.

---

## PHASE C: QUEEN GROWTH

Goal:

> Starting small and becoming adult feels rewarding.

Includes:

- growth percentage
- visible body scaling
- five-point stat curves
- growth UI
- progression objectives
- adult/founding-ready threshold
- clean separation of growth vs life state

Success test:

Players can clearly feel and see the difference between a new Queen and an adult Queen.

---

## PHASE D: FLIGHT + MATING

Goal:

> Reaching reproductive adulthood creates a new adventure, not just a menu unlock.

Includes:

- Queen flight
- male Fire Ant model
- male alate AI
- mating event/activity
- male levels/stat quality
- pairing success/failure
- genetics seed
- nest founding unlock

Success test:

Successfully finding and mating with a desirable male feels like an achievement.

---

## PHASE E: NEST FOUNDING

Goal:

> The player turns survival success into a permanent home.

Includes:

- founding site selection
- nest blueprint selection
- placement preview
- validation
- build timer
- simple starter nest
- Queen founding state
- wing-loss/dealation presentation
- basic nest interior

Success test:

The transition from roaming Queen to colony founder is clear, satisfying, and understandable.

---

## PHASE F: BROOD + FIRST COLONY

Goal:

> The nest becomes alive.

Includes:

- eggs
- larvae
- pupae
- AI feeding
- Worker/Major outcome rules
- first adult ants
- Queen care
- basic colony jobs
- food storage/use

Success test:

Producing the first Worker feels like a major milestone.

---

## PHASE G: CONTROL SWITCHING

Goal:

> The colony becomes the player's persistent team.

Includes:

- first-three-ant unlock target
- colony roster
- switch controlled ant
- old controlled ant returns to AI
- Queen remains in nest
- Worker gameplay
- Major gameplay
- individual ant death

Success test:

Switching bodies feels like controlling one living colony, not selecting disposable units.

---

## PHASE H: LIVING COLONY

Goal:

> The colony works even when the player is elsewhere.

Includes:

- AI job system
- Queen care
- brood care
- foraging
- storage
- defense
- threat response
- nest expansion
- construction timers
- simulation LOD

Success test:

The player can leave home for a long expedition and return to a colony that visibly continued living.

---

## PHASE I: COLONY PROGRESSION

Goal:

> Long-term play keeps opening new possibilities.

Includes:

- better nest blueprints
- colony unlocks
- improved caste production
- advanced food/resources
- larger threats
- colony level/progression
- nest expansion
- possible reproductive brood
- custom nest designer later

Success test:

Adult/established is not "the end." It is where the sandbox opens.

---

## PHASE J: RIVAL AI COLONIES

Goal:

> Prove colony-vs-colony warfare before networking it.

Includes:

- AI rival nests
- territory
- scouts
- raids
- defense
- brood/food/Queen objectives
- AI colony succession rules
- colony diplomacy/hostility if useful

Success test:

An AI colony raid already feels interesting enough that PvP would improve it rather than create it.

---

## PHASE K: MULTIPLAYER

Goal:

> Multiple persistent colonies share the same ant-scale world.

Includes:

- player accounts/colony identity
- networking
- synchronized creature control
- synchronized AI/world state
- PvP
- nest raids
- colony defense while player is away
- death logs
- territory
- griefing/protection rules
- persistence
- server authority/security

Success test:

Multiplayer preserves the direct-control feel and colony simulation instead of reducing the game to laggy PvP avatars.

---

# 40. PROGRESSION PHILOSOPHY

TRADDOMIUM may eventually have multiple progression layers, but they must stay understandable.

Potential layers:

## Individual growth

Controls:

- maturity
- body size
- growth-curve stats

## Individual level

Could control:

- earned stat improvements
- abilities
- experience

## Colony progression

Could control:

- nest blueprints
- colony capabilities
- AI capacity
- larger systems

## Genetics / inherited potential

Could control:

- base stat tendencies
- offspring variation

Before adding a new progression system, ask:

> What decision does this progression layer create that the others do not?

If the answer is unclear, do not add another bar/currency.

---

# 41. QUESTS AND OBJECTIVES

Quests should support the creature fantasy rather than feel like human errands pasted onto an ant.

Good objective categories:

- find water
- locate food
- investigate scent/resource area
- survive a weather event
- escape a predator
- defeat/scare a threat
- reach a landmark
- return food to nest
- rescue/recover colony resources
- scout rival territory
- defend nest
- participate in mating activity
- establish nest
- raise first brood

Growth can partly come from meaningful activity so the player has reasons to explore.

---

# 42. WORLD EVENTS

Potential world events:

- rain
- flooding/puddles
- hot/dry periods
- insect emergence
- nuptial flights
- predator migration
- food abundance
- carcass/resource events
- rival colony activity

Events should make the world feel alive and create temporary opportunities.

---

# 43. DEATH SHOULD CREATE STORIES

Death should not only be punishment.

Examples:

```text
Worker #18 killed by Lv. 14 Beetle in F5
```

Now the player can:

- avoid F5
- take a Major
- rally several AI ants
- recover resources
- hunt the beetle
- mark it as a future target

Likewise, Queen danger should create colony-wide urgency.

The systems should create memorable "remember that beetle?" stories.

---

# 44. PERFORMANCE IS A GAMEPLAY CONSTRAINT

TRADDOMIUM targets mobile web.

Every major system should be designed with that reality.

Key rules:

- detailed simulation near the player
- cheaper simulation far away
- pooled effects/entities where useful
- avoid simulating every ant identically
- avoid unnecessary full-world updates
- measure on actual phones
- preserve responsive touch controls
- do not turn the phone into a hand warmer

A feature that only works with a tiny colony on desktop is not finished.

---

# 45. DEVELOPMENT LABS

Keep the clean-rebuild habit of focused permanent development scenes.

Examples may eventually include:

- movement lab
- leg/IK lab
- combat lab
- flight lab
- wildlife AI lab
- growth/stat lab
- mating lab
- nest placement lab
- brood lab
- colony AI lab
- multiplayer test arena

A lab is not throwaway if it remains useful for regression testing.

---

# 46. TESTING PRINCIPLES

Important project rules:

## Red before green

A new behavioral probe should be demonstrated failing against the broken/current behavior before its passing result is trusted.

A test that has never been shown red may be testing nothing meaningful.

## The visible world and gameplay truth should agree

Examples:

- feet should stand where terrain visibly exists
- attacks should have physical reach
- an unavailable button should not look active
- a stat should not be shown as live if the game does not read it

## Data-only future design stays inert

The `WIRED` concept is useful.

Stats can be recorded early, but wiring should happen only when the mechanic exists and has tests.

## Mobile testing matters

Desktop/headless success is not sufficient for:

- thumb controls
- camera feel
- UI size
- performance
- browser viewport behavior

---

# 47. VISUAL / UI DIRECTION

The HUD should feel like a real mobile survival game without covering the tiny world.

Priorities:

- sharp icons
- compact readable stats
- thumb-friendly controls
- contextual action buttons
- clear health/stamina/growth information
- unobtrusive colony alerts
- event/death log
- map/grid access
- colony/nest management without turning gameplay into spreadsheets

The right side remains valuable for action controls.

Menus can hold deeper systems:

- colony roster
- ant stats
- genetics
- nest blueprints
- brood status
- colony log
- progression
- map

---

# 48. WHAT NOT TO BUILD YET JUST BECAUSE IT IS IN THIS FILE

This roadmap intentionally includes long-term ideas.

Do not jump ahead and implement these before their dependencies:

- full multiplayer
- full custom nest designer
- hundreds of fully simulated ants
- complex genetics
- Queen succession
- large-scale raids
- advanced reproductive brood
- offline construction timers
- giant skill trees
- every possible insect
- every future stat

Build the smallest system that proves the next part of the fantasy.

---

# 49. NEAR-TERM DESIGN ITEMS THAT SHOULD BE CLEANED UP NOW

These are worth resolving early because later systems will copy their structure.

## 49.1 Queen growth schema

Separate:

```text
growth curve
```

from:

```text
Queen life state
```

before Worker/Major patterns are copied from the Queen.

## 49.2 Queen visible size progression

The current biologically conservative 8-to-10 mm curve may be too subtle for the intentional Path-of-Titans-style gameplay abstraction.

Measure/recommend a visually meaningful young-to-adult size curve before locking it.

Current conceptual target only:

```text
roughly 5-6 mm young
        ↓
roughly 9-10 mm adult
```

Exact values require model/world testing.

## 49.3 Flight data

Flight is now a known future Queen mechanic.

The schema should allow it without pretending it is already wired.

## 49.4 Male ant domain model

Add a male Fire Ant model later.

Decide whether male reproductive ants belong in the same `CasteStats` abstraction or deserve a separate ant/reproductive profile.

Do not force the wrong abstraction simply to reuse an enum.

## 49.5 Nest blueprint data

When the nest system begins, define blueprints as data rather than hardcoded scene branches so future custom designs can use the same underlying representation.

---

# 50. OPEN DESIGN DECISIONS

These are intentionally not locked yet.

1. Exact Queen young-to-adult size curve
2. Exact growth duration
3. Exact wild max level
4. How individual XP and growth relate
5. Exact genetics/inheritance formula
6. How much information about a male is visible before mating
7. Whether unsuccessful males can be retried
8. Exact mating event frequency/conditions
9. Exact starter nest blueprints
10. Exact nest build timers
11. Whether build timers continue while the game is closed
12. Exact Worker/Major nutrition formula
13. Exact threshold for control switching, current target is about three ants
14. What happens immediately when the currently controlled ant dies
15. Exact Fire Ant Queen succession mechanics
16. Colony-wipe / defeat rules
17. PvP protection / anti-griefing rules
18. Server architecture
19. How many ants receive full simulation at once
20. How custom nest editing will work on a phone

These are questions, not blockers for the current movement/foundation work unless a current implementation would make a future answer impossible.

---

# 51. THE NORTH STAR

When deciding whether a feature belongs in TRADDOMIUM, picture this sequence:

```text
You begin as one tiny winged Queen.

The grass is a forest.
A beetle is a boss-sized threat.
Rain changes the map.

You survive.
You grow.
You learn which fights to take.

One day you find a high-quality male during reproductive activity.
You successfully mate.

For the first time:
FOUND NEST unlocks.

You choose a small underground blueprint.
You place it.
Construction begins.

The Queen becomes a founder.

Eggs appear.
Larvae are fed.
The first Worker emerges.

Then another.

Then a third.

CONTROL COLONY MEMBER unlocks.

You leave the Queen safely underground
and become one of her Workers.

You cross the world for food.
A Lv. 14 beetle kills that Worker in Zone F5.

The colony log records it.

You return as a Major with AI nestmates.
This time the beetle loses.

The food comes home.
More brood survives.
The colony grows.
New nest designs unlock.

Eventually another player's scout finds your entrance.

Now the tiny survival game that began with one Queen
has become a living colony war.
```

If the systems eventually create stories like that, the game is on target.

---

# 52. ONE-SENTENCE PRODUCT DEFINITION

> **TRADDOMIUM: Micro Battle! is a mobile-first Web TypeScript ant survival RPG where you begin as a vulnerable winged Queen, grow and mate in a dangerous leveled ecosystem, found a living AI colony, then directly control its Workers and Majors as you forage, fight, expand, defend territory, and eventually battle rival colonies.**

---

# 53. SHORT VERSION FOR TRELLO CARDS

When converting this roadmap into Trello, cards should be short.

A Trello card should answer:

```text
WHAT are we building now?
WHY does it matter?
WHAT is explicitly not included yet?
HOW do we prove it works?
```

Do not try to paste this entire roadmap into every card.

Instead:

```text
MASTERROADMAP.md
        ↓
long-term destination

TRELLO CARD
        ↓
next safe slice

CODE / TESTS
        ↓
proof that slice works
```

That separation is intentional.

---

# 54. CURRENT WORKING PRINCIPLE

Build TRADDOMIUM in a way that makes the future possible without trying to build the whole future today.

Or, in ant terms:

> **One tunnel at a time. 🐜**
