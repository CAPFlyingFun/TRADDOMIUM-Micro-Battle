# TRADDOMIUM: Micro Battle!
## Dual-Mode Player Profile, Solo Save, Multiplayer Server, Map, and Session Architecture

**Purpose:** Planning document for Claude / future implementation  
**Project:** TRADDOMIUM: Micro Battle!  
**Primary platform:** Mobile-first browser / PWA, with desktop support  
**Current stack:** TypeScript + Three.js + Vite  
**Design direction:** One shared game core supporting both Solo and Multiplayer

---

# 1. Why This Document Exists

TRADDOMIUM has grown beyond a simple ant movement prototype. The current build already has a large Kauaʻi world, ant movement, flight, terrain, weather, wind, rivers, survival systems, HUD instrumentation, player settings, and a growing long-term colony design.

The project is also becoming increasingly clear about its larger identity:

> **YOU ARE THE ANT.**

The player directly controls an individual ant in a huge living world. Over time that ant can survive, grow, mate, establish a nest, build a colony, control Workers and Majors, interact with wildlife, defend territory, and eventually fight or cooperate with other players.

The long-term game is primarily designed around multiplayer, but we do **not** want to throw away the useful single-player structure already being built.

The new design decision is therefore:

> **TRADDOMIUM should support two session modes: Solo and Multiplayer, both running the same underlying game systems.**

This gives us the best of both worlds.

Solo becomes useful for testing, practice, exploration, story content, survival sandbox play, offline play, and experimentation.

Multiplayer becomes the persistent shared-world experience with official servers, private servers, custom server settings, other players, and server-authoritative persistence.

The key architectural goal is to add this cleanly rather than rebuild the project twice.

---

# 2. Core Principle: One Game, Two Authorities

Do **not** create separate copies of major gameplay systems for Solo and Multiplayer.

Avoid architecture such as:

```text
SinglePlayerAnt.ts
MultiplayerAnt.ts

SinglePlayerCombat.ts
MultiplayerCombat.ts

SoloKauaiWorld.ts
OnlineKauaiWorld.ts
```

That will eventually cause every feature to require duplicate fixes and duplicate balancing.

Instead, the same game core should run under a different authority/session provider.

```text
                     TRADDOMIUM GAME CORE
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
     SOLO SESSION                           MULTIPLAYER SESSION
          │                                       │
   Local authority                          Server authority
   Local save state                         Persistent server state
   World can pause                          World never pauses
   One human player                         Many human players
          │                                       │
          └──────── SAME GAMEPLAY SYSTEMS ───────┘
```

Shared systems should include:

- ant movement
- flight
- stamina
- health
- hunger/thirst
- combat
- growth
- genetics
- nests
- brood
- colony AI
- wildlife
- terrain
- rivers
- weather
- quests
- progression
- items/resources
- world events

The difference is who owns the truth.

In Solo, the client/local simulation is authoritative.

In Multiplayer, the backend/server eventually becomes authoritative.

---

# 3. Main Frontend Flow

The game should no longer be structured around a generic **START GAME** or **NEW GAME** button.

The preferred main navigation is:

```text
TRADDOMIUM: MICRO BATTLE!

        [ PLAYER PROFILE ]

          🗺 PLAY MAP

          👤 PROFILE

          ⚙ SETTINGS

          INFO / CREDITS
```

The primary action is:

> **PLAY MAP**

This reflects the fact that players are choosing a world/map first, then deciding how they want to enter that world.

---

# 4. Map Selection

Currently there is one playable map: **Kauaʻi**.

Because only one map exists today, the first map screen should show one polished centered card rather than multiple empty slots.

```text
┌───────────────────────────────────────┐
│               PLAY MAP                │
│                                       │
│        [ LARGE KAUAʻI PREVIEW ]       │
│                                       │
│                 KAUAʻI                │
│                                       │
│       Tropical Island Survival        │
│     Mountains • Rivers • Coast        │
│                                       │
│                [ PLAY ]               │
└───────────────────────────────────────┘
```

Later, without changing the architecture:

```text
[ KAUAʻI ]     [ MAP 2 ]     [ MAP 3 ]
```

Each map needs a stable internal ID.

Example:

```ts
interface MapDefinition {
  mapId: string;          // "kauai"
  displayName: string;    // "Kauaʻi"
  description: string;
  previewAsset: string;
  enabled: boolean;
}
```

Never use display text itself as persistent identity.

---

# 5. After Map Selection: Choose Session Type

After selecting Kauaʻi:

```text
              KAUAʻI
                 │
         HOW DO YOU WANT TO PLAY?
                 │
       ┌─────────┴─────────┐
       │                   │
     🐜 SOLO           🌐 MULTIPLAYER
       │                   │
  Local world          Shared server
```

This is the main new branch.

The player profile stays above both modes.

The map remains the same.

The game core remains the same.

Only the authority, persistence model, pause behavior, and world population rules change.

---

# 6. Solo Mode

Solo should not be treated as a disposable developer mode.

It can become a legitimate way to play TRADDOMIUM.

Initial Solo menu:

```text
SOLO — KAUAʻI

▶ CONTINUE
🆕 NEW SOLO WORLD
📂 LOAD SAVE
```

Later it could expand into:

```text
SOLO

📖 STORY
🏝 SURVIVAL SANDBOX
🎓 PRACTICE
```

These can still use the same Kauaʻi simulation.

## Story

Story mode should not turn TRADDOMIUM into a linear cutscene game.

A better fit is environmental and objective-driven storytelling:

```text
Find water
    ↓
Investigate strange pheromones
    ↓
Discover abandoned colony
    ↓
Follow evidence of predator activity
    ↓
Survive regional weather event
    ↓
Find mating activity
    ↓
Establish first nest
```

The player can still wander, explore, forage, fight, or ignore the objective temporarily.

## Survival Sandbox

The world runs normally without mandatory story progression.

This is ideal for players who simply want to live as an ant in a giant ecosystem.

## Practice

Practice can eventually offer reduced penalties or training scenarios for:

- movement
- flight
- combat
- climbing
- weather
- landing
- survival mechanics

This is especially useful before entering multiplayer.

---

# 7. Solo Saving and Loading

Solo should retain traditional save functionality.

That means we should **not delete** existing save/resume ideas. We should define them as Solo features.

Suggested model:

```ts
interface SoloSave {
  saveVersion: number;
  saveId: string;
  playerId: string;
  mapId: string;
  createdAt: string;
  updatedAt: string;

  playerState: unknown;
  worldState: unknown;
  colonyState: unknown;
  questState: unknown;
  settingsSnapshot?: unknown;
}
```

Solo can support:

- autosave
- manual save
- Continue
- multiple save slots
- Load older save
- optional future cloud synchronization

Solo progress must remain separate from official multiplayer progression.

A player should never be able to modify a Solo save and import those stats into an official server.

```text
SOLO QUEEN LEVEL 100
        ≠
OFFICIAL SERVER QUEEN LEVEL 100
```

---

# 8. Multiplayer Mode

Selecting Multiplayer leads to the server browser.

```text
MULTIPLAYER — KAUAʻI

🌐 OFFICIAL SERVERS
🔒 PRIVATE SERVERS
🕘 RECENTLY PLAYED
➕ CREATE SERVER
```

A server card may eventually show:

```text
OFFICIAL KAUAʻI 01

Players: 18 / 40
Mode: Survival PvP
Ping: 42 ms
Password: No

[ JOIN ]
```

A private server might show:

```text
CAP'S ANT WORLD

Players: 7 / 20
PvP: Enabled
Growth: 1.5×
Password: Required

[ JOIN ]
```

The current implementation can begin with mock/local server entries. Production networking is not required yet.

---

# 9. Private Server Creation

Players should eventually be able to create custom servers directly inside TRADDOMIUM.

The app acts as the server-management frontend.

The phone/browser should **not** literally host the persistent world.

```text
Player configures server
        ↓
CreateServerRequest
        ↓
Backend / Server Manager
        ↓
Persistent World Instance
        ↓
serverId returned
```

Possible settings:

```text
Server Name
Password / Private Access
Max Players
PvP / PvE
Growth Rate
Quest / XP Rate
Food Drain
Water Drain
Stamina Rate
Brood Development Rate
Nest Construction Speed
AI Population
Wild Creature Level Scaling
Death Penalty
Colony Limits
Weather Mode
Live Weather
Raid Rules
Friendly Fire
```

Official and private servers should use the **same Kauaʻi map and gameplay code**.

Private servers modify configuration, not the underlying implementation.

---

# 10. Player Profile and Permanent Identity

The player profile belongs above maps, saves, servers, colonies, and ants.

Suggested structure:

```ts
interface PlayerProfile {
  playerId: string;
  username: string;
  createdAt: string;
  lastSeenAt: string;
  profileVersion: number;
}
```

The most important rule is:

> **Username is not ownership.**

Example:

```text
playerId:
p_7f82c012...      ← permanent hidden identity

username:
CAPFlyingFun       ← public display name
```

Colonies, server ownership, bans, permissions, ant ownership, friends, achievements, and progression should reference `playerId`.

The username may someday change without breaking ownership relationships.

---

# 11. Two-Device Account Linking

The profile system should support up to two authorized devices initially.

Example:

```text
PLAYER ACCOUNT
│
├── 📱 Device 1: iPhone
│
└── 💻 Device 2: Desktop
```

Both devices access the same:

- player identity
- username
- server memberships
- multiplayer colonies
- multiplayer ants
- account-wide unlocks
- account-wide preferences where appropriate

Each device should still have its own local graphics and control configuration.

## First Device Flow

```text
FIRST LAUNCH
    ↓
CREATE PLAYER PROFILE
    ↓
CHOOSE UNIQUE USERNAME
    ↓
CREATE / RECEIVE playerId
    ↓
GENERATE DEVICE 1 IDENTITY
    ↓
STORE DEVICE CREDENTIAL
    ↓
PROFILE READY
```

For the prototype this can be simulated locally.

The interfaces should still look like future backend interfaces.

---

# 12. Device IDs, Device Keys, and Linking

These concepts must remain separate:

```text
playerId
= Who owns the account

deviceId
= Which installation/device is connecting

device credential
= Proof that this device is authorized
```

Never authenticate two devices merely because both entered the same username.

For a second device:

```text
DEVICE 1
   │
   ├── Generate / request pairing credential
   │
   ▼
DEVICE 2
   │
   ├── Enter username + pairing code
   │
   ▼
BACKEND
   │
   ├── Verify pairing
   ├── Attach Device 2 to SAME playerId
   └── Issue unique Device 2 credential
```

The two devices should not permanently share the same secret.

Each device should be independently revocable.

An eight-character human-readable code may be convenient for the UI, but the long-term design should preferably use it as a short-lived pairing code backed by a stronger token or server-side challenge.

A QR option could later supplement manual entry.

---

# 13. Device Management and Recovery

Player Profile should eventually include:

```text
AUTHORIZED DEVICES
2 / 2

📱 iPhone
Current Device
Last Active: Today

💻 Desktop
Last Active: Yesterday
[ REMOVE DEVICE ]
```

Revoking a device removes its authorization without deleting the account.

The account system should also plan for:

- lost phone
- replacement phone
- PWA reinstall
- cleared browser storage
- corrupted local storage
- lost second device

A separate recovery code or recovery method should exist eventually.

Do not rely on username alone for recovery.

---

# 14. Device-Local vs Account-Wide vs Server-Specific Data

Separate data into three categories.

## Device-local

```text
Graphics quality
Resolution scale
Touch layout
Keyboard bindings
Camera sensitivity
Volume
HUD scale
Accessibility display preferences
```

## Account-wide

```text
Username
Authorized devices
Friends
General account preferences
Achievements
Account-level cosmetics/unlocks if added
```

## Server-specific

```text
Colony
Ant roster
Individual growth
Inventory
Nest
Brood
Territory
Server progression
Quest state
Server permissions
```

This separation is important for two-device synchronization.

---

# 15. Pause/Menu Behavior

Solo and Multiplayer must behave differently.

```text
FEATURE                     SOLO        MULTIPLAYER
----------------------------------------------------
Menu pauses simulation      YES         NO
Manual save                 YES         NO
Load older save             YES         NO
Autosave                    YES         SERVER
World runs while closed     NO*         YES
Other human players         NO          YES
```

`*` Solo could later optionally simulate offline timers, but that is a separate design decision.

## Solo Menu

Opening the menu can freeze:

- ant physics
- wildlife AI
- weather simulation
- survival timers
- combat
- colony simulation
- world timers

UI remains active.

## Multiplayer Menu

Opening the menu suspends **local player input only**.

The server/world continues.

```text
SERVER WORLD
Other players       RUNNING
Weather             RUNNING
Wildlife            RUNNING
Colony AI           RUNNING
Combat              RUNNING
Survival            RUNNING
```

The player's ant remains present and vulnerable.

---

# 16. Flight While Multiplayer Menu Is Open

Flight needs special handling.

Opening the menu should neutralize controls safely:

```text
Fore/aft input       → neutral
Turn input           → neutral
Climb/descent        → center
Vertical command     → 0
Auto airspeed        → may continue if already active
```

This is not magical protection.

Wind, exhaustion, terrain, predators, and water still matter.

If the player opens Settings in terrible weather, the Queen can still drift.

---

# 17. Spawn and Resume Flow

A new player joining a server:

```text
JOIN SERVER
     ↓
NO SERVER-SPECIFIC CHARACTER
     ↓
CREATE / ASSIGN NEW QUEEN
     ↓
SELECT SPAWN REGION
     ↓
SPAWN
```

A returning player:

```text
JOIN SERVER
     ↓
SERVER STATE FOUND
     ↓
COLONY / CHARACTER STATE
     ↓
SELECT AVAILABLE ANT OR RESUME
     ↓
ENTER WORLD
```

Later, when control switching exists:

```text
COLONY
├── Queen
├── Worker #12
├── Worker #27
└── Major #4
```

Do not build the entire roster system now, but the session flow should leave room for it.

---

# 18. Security and Server Authority

Multiplayer must eventually become server authoritative.

The client should not be trusted to declare:

```text
"I have 9000 health."
"I gained 50 levels."
"I own this colony."
"I am a server admin."
```

Keep these concepts separate:

```text
Account identity
Device authorization
Server membership
Server admin privilege
Colony ownership
Ant ownership/control
```

The prototype can temporarily emulate server behavior locally, but the interfaces should make the future trust boundary obvious.

---

# 19. Recommended Session Interface

A useful abstraction might resemble:

```ts
type SessionMode = "solo" | "multiplayer";

interface GameSession {
  mode: SessionMode;
  mapId: string;

  canPauseWorld: boolean;
  authority: "local" | "server";

  save(): Promise<void>;
  leave(): Promise<void>;
}
```

Then specialized implementations:

```text
LocalSoloSession
RemoteMultiplayerSession
```

Gameplay code should talk to the session/world APIs rather than asking browser storage or network services directly.

This makes future networking substantially easier.

---

# 20. Recommended Development Phases

Do not build production multiplayer in one jump.

## Phase 1: Frontend Session Foundation

Add:

- Player Profile placeholder
- PLAY MAP
- Kauaʻi map card
- Solo / Multiplayer selection
- session state enum
- navigation state machine
- no destructive rewrite of current gameplay

Goal:

> Visible new menu flow works on mobile.

## Phase 2: Solo Persistence

Add:

- versioned Solo save
- autosave
- Continue
- New Solo World
- Load Save
- proper Solo pause

Goal:

> Current game becomes a legitimate persistent Solo experience.

## Phase 3: Profile + Device Architecture

Add local prototype structures for:

- playerId
- username
- deviceId
- credential placeholder
- authorized devices
- profile versioning

Goal:

> Account architecture exists before backend work.

## Phase 4: Multiplayer UI Mock

Add:

- Official
- Private
- Recent
- Create Server
- mock server cards
- server details

Goal:

> Full intended frontend flow can be tested without networking.

## Phase 5: Multiplayer Session Boundary

Introduce a fake/local server adapter or test arena using the same interface future networking will implement.

Goal:

> Gameplay code stops assuming local authority everywhere.

## Phase 6: Backend / Real Networking

Only after the above is stable:

- authentication
- device linking
- persistent player profiles
- actual server browser
- world server hosting
- server-authoritative simulation
- real multiplayer synchronization

---

# 21. What Not to Build Yet

Do not prematurely build:

- production-scale MMO infrastructure
- hundreds of networked ants
- full clan/social systems
- monetization
- complex account recovery UI
- cross-server transfers
- giant server moderation suite
- full story campaign
- three unused map slots
- separate Solo and Multiplayer gameplay forks

Build interfaces that allow those systems later.

---

# 22. First Recommended Implementation Milestone

The best first milestone is:

> **Implement the new frontend/session flow without changing the actual world simulation yet.**

Specifically:

```text
MAIN MENU
    ↓
PLAY MAP
    ↓
KAUAʻI
    ↓
SOLO / MULTIPLAYER
```

SOLO initially launches the current game through a `SoloSession`.

MULTIPLAYER opens a placeholder server browser instead of launching production networking.

Add Player Profile as a real menu destination with a locally generated prototype `playerId`.

This gives immediate visible progress while establishing the correct hierarchy.

Then implement Solo saving/pause before moving deeper into multiplayer.

---

# 23. Acceptance Tests / Probes

Before calling each stage complete, test:

### Navigation

- Main Menu → Play Map works.
- Kauaʻi appears once.
- Solo and Multiplayer are clearly separated.
- Back navigation never traps the player.

### Solo

- Menu pauses the entire simulation.
- Resume continues correctly.
- Save survives browser refresh.
- Load restores the same position/state.
- Save version is stored.
- Corrupt or incompatible save fails gracefully.

### Profile

- First run creates exactly one playerId.
- Refresh does not generate a new playerId.
- Username is not used as internal identity.
- Device ID differs from player ID.
- Device-local settings do not overwrite account state.

### Multiplayer UI

- Server browser opens without entering the world.
- Official/private filters work.
- Password state is displayable.
- Create Server produces a configuration object rather than a second copy of the map.

### Multiplayer Menu

- Opening menu does not stop world simulation.
- Movement input becomes neutral.
- Player remains vulnerable.
- Flight controls neutralize rather than snap or dive.
- Closing menu restores control cleanly.

### Shared Core

- Adding a gameplay feature does not require separate Solo and Multiplayer implementations.
- Map ID is identical for Kauaʻi in both session types.
- Server configuration modifies rules without cloning world code.

---

# 24. Final Architectural Picture

```text
                         PLAYER ACCOUNT
                              │
                    ┌─────────┴─────────┐
                    │                   │
              Device 1              Device 2
              iPhone                Desktop
                    │                   │
                    └─────────┬─────────┘
                              │
                           PLAY MAP
                              │
                            KAUAʻI
                              │
                 ┌────────────┴────────────┐
                 │                         │
               SOLO                  MULTIPLAYER
                 │                         │
         Local authority             Server browser
         Save / Load                      │
         Pause world                Select server
         Story / Sandbox                  │
                 │                  Server authority
                 │                         │
                 └────────────┬────────────┘
                              │
                       SHARED GAME CORE
                              │
       ┌──────────┬───────────┼───────────┬──────────┐
       │          │           │           │          │
     Ant       Flight      Wildlife     Colony     World
   movement    physics        AI         systems   simulation
```

The design goal is simple:

> Build TRADDOMIUM once, then let Solo and Multiplayer decide who owns the simulation and persistence.

Solo should remain useful, polished, and fun.

Multiplayer should remain the long-term shared-world centerpiece.

Player identity should survive devices.

Maps should be reusable across server instances.

Private servers should customize rules instead of forking code.

And every system added from this point forward should fit somewhere inside this structure without forcing a future rewrite.
