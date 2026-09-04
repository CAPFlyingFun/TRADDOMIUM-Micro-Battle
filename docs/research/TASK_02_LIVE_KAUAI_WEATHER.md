# TASK 02 — Live Kauaʻi Weather

## Dependency

Start this only after Task 01 is stable:

- main menu works
- spawn map works
- global spawn positions work
- floating origin can start anywhere on Kauaʻi
- streamed terrain/backdrop transition is stable

Weather should build ON TOP of the spawn map/world, not become another rewrite.

---

## Goal

Add a first live weather system using real-world weather data for Kauaʻi.

Default experience:

```text
REAL KAUAI WEATHER
        ↓
sample multiple points across the island
        ↓
build a local weather field
        ↓
interpolate weather around the player
        ↓
cloud / rain / visibility / wind / humidity / temperature
change depending on where the Queen is
```

The entire island should NOT be forced to use one Lihue-style weather value.

The fun idea is that one side of Kauaʻi can be sunny while another area is
cloudy or raining.

---

## 1. Weather Source

Use **Open-Meteo** for Weather v1.

Reasons:

- no app-specific API key required for development/noncommercial use
- supports arbitrary latitude/longitude
- supports multiple coordinates
- provides current/hourly weather variables useful to the game
- lightweight JSON
- suitable for browser/TypeScript use

Do not hardwire the entire game to Open-Meteo internals.

Create a provider boundary so a future NOAA/radar/commercial provider could be
added later.

Example concept:

```ts
interface WeatherProvider {
  fetch(points: GeoPoint[]): Promise<WeatherSample[]>;
}
```

---

## 2. Fixed Kauaʻi Weather Sample Grid

Create approximately **16–30 fixed latitude/longitude weather sample points**
across the real island.

Do not request only one city.

The grid should include:

```text
north coast
northeast / windward
east
southeast
south
southwest
west
northwest
central interior
mountain/interior points where appropriate
```

The exact grid can be tuned later.

It does not have to match the 30 spawn regions one-for-one.

However, every spawn region should be able to derive nearby/interpolated weather
from the sample grid.

---

## 3. Coordinate Mapping

Create one explicit transform between:

```text
REAL GEO COORDINATES
latitude / longitude

and

TRADDOMIUM GLOBAL WORLD
global X / global Z
```

This must be centralized.

Do not scatter ad-hoc latitude/longitude conversion formulas through UI,
weather, spawn, and terrain code.

Concept:

```text
geoToWorld(lat, lon) -> globalX, globalZ
worldToGeo(globalX, globalZ) -> lat, lon
```

Weather itself remains associated with global/world locations, never floating
local render coordinates.

When the floating origin moves, the weather location does not move.

---

## 4. Weather Variables for v1

Request only variables that will actually be used.

Good Weather v1 set:

```text
temperature
relative humidity
precipitation / rain
cloud cover
wind speed
wind direction
wind gusts
visibility
weather code
```

Do not download huge forecast datasets yet.

A current value plus a small near-future/hourly window is enough.

---

## 5. Update Frequency

Do not hammer the weather service.

Suggested behavior:

```text
game start
  ↓
fetch Kauaʻi grid

every 10–15 minutes
  ↓
refresh grid

between network updates
  ↓
smoothly transition local weather
```

If a request fails:

```text
keep last-known weather
        ↓
if no cached live weather exists
        ↓
fall back to simulated Kauaʻi weather
```

The game must remain playable offline.

Weather is enhancement, not a boot requirement.

---

## 6. Weather Modes

Add a setting eventually visible in the menu/settings:

```text
WORLD WEATHER

● Live Kauaʻi
○ My Weather
○ Custom Location
○ Simulated
```

For Weather v1, prioritize:

```text
Live Kauaʻi
Simulated fallback
```

The other two may be implemented if straightforward, but do not let them delay
the core system.

### Live Kauaʻi

Default.

Uses the fixed real-island sample grid.

### My Weather

Optional.

Uses browser geolocation only after explicit user permission and applies the
player's local weather as the game's weather theme.

This does NOT represent real Kauaʻi weather.

### Custom Location

Optional.

User selects/types a location and applies that weather to the game.

### Simulated

No network required.

Produces plausible warm/humid tropical Kauaʻi-style conditions.

---

## 7. Spatial Interpolation

Do not make invisible hard weather borders.

Bad:

```text
cell A = rain
cross line
cell B = sun
instant change
```

Preferred:

```text
sample A
rain 0.8 mm/h
humidity 91%

       player

sample B
rain 0
humidity 76%

       ↓

interpolated local values
```

Use a simple maintainable first method:

- nearest 3–4 samples
- inverse-distance weighting
- or bilinear/grid interpolation if the sample layout supports it

Do not overbuild atmospheric fluid simulation.

---

## 8. Temporal Smoothing

New API results should not instantly snap the sky.

Example:

```text
old:
cloud 30%
rain 0

new:
cloud 90%
rain 1.2 mm/h
```

Transition over time.

Suggested:

```text
cloud cover        minutes
fog/visibility     minutes
wind               seconds to minutes
rain onset         tens of seconds / minutes
temperature        slowly
humidity           slowly
```

This will also make 10–15 minute API refreshes feel continuous.

---

## 9. Separate Real Data From Gameplay Effects

Never feed raw real-world wind/rain directly into the Queen's physics.

Architecture:

```text
Open-Meteo values
       ↓
WeatherField
       ↓
GameplayWeatherAdapter
       ↓
safe normalized game values
```

Example:

```text
real wind: 20 mph

game:
windStrength = 0.65
windDirection = ENE
```

This prevents a tiny Queen from being unrealistically launched across the map
because real-world meteorology was applied literally.

Weather v1 should mostly affect visuals with only mild gameplay influence.

---

## 10. Weather v1 Visual Effects

Prioritize:

```text
sky/cloudiness
ambient brightness
rain particles
visibility/fog
wind direction cue
wet/dry feel if simple
```

Important:

Fog must become a WEATHER EFFECT.

Do not use permanently heavy fog merely to hide terrain streaming.

Clear weather should allow long-range navigation cues such as coastline,
mountains, ocean, and major ridges where the renderer/backdrop supports them.

Actual fog or heavy rain can lower visibility.

---

## 11. Rain Should Be Local

Do not render rain across all 56 km of Kauaʻi.

Only render weather around the active player/camera.

Concept:

```text
GLOBAL WEATHER FIELD
entire island = lightweight numbers

LOCAL WEATHER EFFECTS
around player = rain particles, wind audio, clouds, visibility
```

This fits the same local-detail philosophy as terrain and future multiplayer.

Multiple future players could be in different conditions on the same island.

---

## 12. Spawn Map Integration

Once live weather exists, reuse the Task 01 spawn map.

Each selected spawn region can show current conditions:

```text
North Shore Jungle
🌧️ 78°F
Humidity: 88%
Wind: ENE 12 mph
Current: Showers

Environment: Jungle
Difficulty: ★★★

[ SPAWN HERE ]
```

Do not make weather the only source of difficulty.

For v1, the difficulty label may remain mostly static while weather is presented
as extra information.

Later difficulty can respond dynamically.

---

## 13. In-Game Weather HUD

Avoid clutter.

Do not permanently place a giant weather station on the HUD.

A small optional indicator is enough:

```text
🌧️ 78°
ENE 12
```

Tapping it could open:

```text
Live Kauaʻi Weather
Temperature
Humidity
Wind
Rain
Visibility
Last updated
```

The current source/mode should be clear:

```text
Live Kauaʻi
Simulated
My Weather
Custom
```

---

## 14. Caching / Offline

Cache the most recent successful live weather field locally.

On launch:

```text
if internet available:
fetch fresh weather

if request fails:
use last-known weather if reasonably recent

if none:
use simulated weather
```

Do not prevent the game from loading because a third-party weather API is down.

Store a timestamp with cached samples.

---

## 15. Future Expansion Hooks, Not Required Now

Design so these can be added later without rewriting Weather v1:

```text
NOAA station observations
weather radar / precipitation radar
storms
moving rain cells
lightning
wet ground
puddles
nest flooding
flight turbulence
scent-trail degradation
food availability changes
insect shelter behavior
seasonal climate
```

Do NOT implement those in this task.

---

## 16. Acceptance Criteria

Task 02 is complete when:

- `Live Kauaʻi` is the default weather mode.
- The game requests multiple real weather sample points across Kauaʻi.
- Weather samples map correctly to TRADDOMIUM global/world coordinates.
- The Queen receives interpolated weather based on her GLOBAL location.
- Different parts of the island can have different weather values.
- Weather refreshes approximately every 10–15 minutes rather than continuously.
- New values transition smoothly instead of snapping.
- Clear weather no longer has permanent heavy fog.
- Rain/cloud/visibility effects render locally around the player.
- Raw real-world wind values are normalized before affecting gameplay.
- Spawn map can display live weather for selected spawn regions.
- Weather failure does not prevent game startup.
- Last-known or simulated weather provides fallback.
- Floating-origin shifts do not alter weather ownership/location.
- Mobile and desktop browser builds remain playable.

---

## 17. Recommended Task Boundary

Weather v1 should feel like:

```text
"The real island's current atmosphere is alive in the game."
```

It should NOT become:

```text
"Build a complete meteorological simulator before adding the first spider."
🤣
```

Keep it compact, robust, and expandable.
