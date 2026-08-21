# TRADDOMIUM: Micro Battle!
## FLIGHT DESIGN
### Fire Ant Queen — Assisted Flight v1
**Platform:** Mobile-first Web TypeScript  
**Primary input:** Touch, with desktop equivalents later  
**Status:** Design baseline for implementation  
**Scope:** Queen flight, takeoff, landing, stamina, glide, emergency recovery, UI, collision response

---

# 1. PURPOSE

This document defines the first implementation target for Queen flight in **TRADDOMIUM: Micro Battle!**

The goal is to avoid repeated redesigns by agreeing on the full interaction model before implementation.

This is not intended to be a full flight simulator.

The target is:

> Simple mobile controls on the surface, believable aerodynamic behavior underneath.

The Queen should feel like a flying ant, not a helicopter locked to a point in space and not a hardcore aircraft simulator requiring pitch, roll, yaw, trim, throttle, and camera control all at once.

---

# 2. CORE FLIGHT PHILOSOPHY

The selected direction is:

## ASSISTED ANT FLIGHT

The player controls:

- horizontal movement with the left stick
- climb with an up button
- descend with a down button
- camera/look independently

The game handles:

- auto-leveling
- banking visuals
- pitch visuals
- aerodynamic momentum
- airspeed
- glide
- stamina cost
- descent energy recovery
- gentle flight stabilization

Conceptually:

```text
LEFT STICK
= horizontal flight request

⬆
= climb

⬇
= descend / recovery descent

CAMERA
= free look

UNDER THE HOOD
= airspeed + momentum + gravity + lift + drag + stamina
```

The Queen should never feel like she is moving through invisible rails.

---

# 3. GROUND VS AIR CONTROL MODES

## 3.1 Ground

On the ground:

```text
PACE
= player-selected ground speed ceiling

Left stick
= movement direction + amount

Sprint
= temporary stamina-limited override
```

The existing ground Pace system remains editable.

## 3.2 Air

While airborne:

```text
LEFT STICK
= horizontal flight direction / requested acceleration

⬆
= climb

⬇
= descend

PACE DISPLAY
= read-only flight power/speed band indicator
```

The player no longer edits Pace while airborne.

The airborne pace/power display is informational.

Actual airspeed is independent from the displayed pace/power band.

---

# 4. HORIZONTAL FLIGHT CONTROL

The left stick controls horizontal flight.

```text
              FORWARD
                 ↑

       LEFT  ←   ●   → RIGHT

                 ↓
              BACKWARD
```

Expected behavior:

## Forward

- Queen pitches slightly forward visually
- horizontal acceleration increases
- airspeed increases
- stamina use rises with sustained effort

## Left / Right

- Queen banks visually into the direction
- flight path curves naturally
- no instant sideways teleport
- the controller may add gentle coordinated-turn assistance

## Backward

Backward input does NOT create true reverse flight.

Instead it should:

- reduce forward speed
- pitch the Queen slightly back
- increase braking/deceleration
- allow tighter low-speed maneuvering

The Queen should not fly tail-first at full speed.

---

# 5. CAMERA

Camera control remains independent during flight.

This is important.

The right-side look/camera drag should NOT become the primary pitch/roll controller.

The player should be able to:

- fly forward
- look left/right
- look down at terrain
- look toward another flying insect
- inspect surroundings

without unintentionally banking or diving.

The flight controller should visually pitch and roll the Queen based on movement input while the camera remains free-look.

---

# 6. TAKEOFF

Takeoff uses forward ground speed.

The Queen does not vertically launch from a standstill.

## 6.1 Takeoff requirements

Takeoff becomes available only when:

- Queen is winged
- Queen is on valid ground
- actual forward ground speed is above the takeoff threshold
- enough stamina exists to perform takeoff

Important:

> Eligibility is based on ACTUAL speed, not the selected ground Pace.

Example:

```text
Run selected
but Queen barely moving
→ cannot take off

Walk selected
Queen actually at/above takeoff speed
→ can take off
```

## 6.2 Initial tuning target

The first implementation should test:

```text
Takeoff threshold ≈ full WALK speed
```

Current exact value is tuning, not a permanent rule.

The intent is:

- Crawl is too slow
- a proper Walk can reach takeoff speed
- Run reaches it easily
- Sprint can help reach takeoff speed quickly but costs stamina

## 6.3 Takeoff button

The up button is always visible.

On ground:

```text
too slow
⬆ TAKEOFF = disabled / gray

takeoff speed reached
⬆ TAKEOFF = active
```

Tapping/holding the active button starts takeoff.

## 6.4 Takeoff transition

Takeoff should preserve momentum.

Do NOT:

```text
tap Fly
→ teleport Queen upward
```

Instead:

```text
running
   ↓
takeoff input
   ↓
wings engage
   ↓
brief assisted lift
   ↓
forward momentum continues
   ↓
normal flight state
```

A marginal takeoff may remain low and settle back toward the ground.

A clean takeoff with sufficient speed should smoothly transition airborne.

## 6.5 Takeoff stamina

Takeoff uses the same global stamina reserve.

First tuning target:

```text
Takeoff cost ≈ 2–4% of full stamina
```

This is intentionally modest because the player already paid effort while accelerating on the ground.

---

# 7. FLIGHT UI

The flight UI should reuse the existing HUD rather than redesigning the whole screen.

## 7.1 Up / Down buttons

Both buttons should remain visible all the time.

This avoids controls appearing/disappearing unexpectedly under the player's thumb.

### Up button

Ground:

```text
too slow
⬆ gray / disabled

takeoff speed reached
⬆ active
```

Airborne:

```text
⬆ = CLIMB
```

### Down button

Ground:

```text
⬇ gray / disabled
```

Airborne:

```text
⬇ = DESCEND
```

Near terrain, continuing to descend naturally becomes landing.

A separate LAND button is not required for v1.

## 7.2 Pace / Power display

Ground:

```text
PACE
editable
```

Airborne:

```text
POWER / PACE
read-only
```

The flight power/pacing indicator tells the player what level of effort is currently being requested.

It must NOT pretend to be actual airspeed.

## 7.3 Airspeed

Airspeed is separate from power.

Example:

```text
Power band: WALK
Actual airspeed: high

because Queen is descending
```

A future HUD may expose airspeed explicitly if useful.

Do not require an airspeed gauge for the first playable implementation unless testing shows the player needs it.

---

# 8. NO HOVER LOCK

Neutral input should NOT freeze the Queen in midair.

The game should not pin the ant to an XYZ coordinate.

Instead:

```text
release horizontal stick
        ↓
Queen auto-levels
        ↓
powered horizontal input reduces
        ↓
existing momentum continues
        ↓
Queen enters glide
```

There may be gentle stabilization, but not magical stationary hover.

---

# 9. GLIDE MODEL

The Queen should glide when powered horizontal input is released or sufficiently reduced.

The glide should depend on airspeed.

There is a best-glide speed.

## 9.1 Best glide

Initial conceptual target:

```text
Best glide ≈ 5:1
```

Meaning approximately:

```text
5 mm forward
for
1 mm altitude lost
```

This is a gameplay target, not a claim of measured fire-ant glide performance.

## 9.2 Glide curve

Glide ratio should worsen smoothly away from the best-glide airspeed.

Conceptual shape:

```text
AIRSPEED               APPROX GLIDE

too fast                ~3.5 : 1
                          \
best-glide speed          ~5 : 1
                          /
slightly slow             ~4 : 1
                        /
slow                     ~2.5 : 1
                      /
very slow                ~1 : 1
                    /
near exhausted/stall     ~1 : 3
                  /
extreme low-speed sink   ~1 : 5
```

These are first-pass gameplay values.

Do not build them as hard discrete bands if a smooth curve can be used.

The important behavior is:

- moderate airspeed glides best
- too fast loses efficiency to drag
- too slow loses efficiency dramatically
- very low-speed flight sinks steeply

---

# 10. AIRSPEED, ALTITUDE, AND ENERGY

Airspeed is not the same as selected power.

The system should preserve this relationship:

```text
ALTITUDE
   ↕
AIRSPEED
   ↕
WING POWER / STAMINA
```

## Descending

```text
altitude ↓
airspeed ↑
```

## Climbing

```text
altitude ↑
airspeed tends to ↓
stamina cost ↑
```

## Gliding

```text
wing effort ↓
stamina drain ↓
```

This is intentionally aircraft-like without requiring aircraft-like controls.

---

# 11. CLIMB

Holding ⬆ while airborne requests a climb.

Expected behavior:

- Queen pitches slightly upward visually
- lift/power demand increases
- altitude increases
- airspeed tends to fall if climb is aggressive
- stamina drain increases

A climb should NOT maintain full airspeed for free.

Very aggressive climb behavior should naturally trade airspeed and stamina for altitude.

---

# 12. DESCENT

Holding ⬇ requests a deliberate descent.

Expected behavior:

- Queen pitches downward visually
- altitude decreases
- airspeed can increase
- wing effort can decrease
- stamina drain falls
- under the right conditions, stamina begins recovering

The down button is therefore both:

- normal descent control
- emergency recovery control

---

# 13. STAMINA PHILOSOPHY

There is ONE physical exertion reserve.

Do NOT create:

```text
Ground stamina
+
Flight stamina
```

The same stamina bar represents the Queen's physical effort.

Different activities drain it at different rates.

The old six-second ground sprint model is too short for the expanded game and should be rebalanced.

---

# 14. GROUND STAMINA — FIRST TUNING TARGET

Current design target:

```text
Full ground Sprint:         ~30 sec
Full recovery while moving: ~60 sec
Full recovery while resting: ~30 sec
Re-arm threshold:           ~25%
```

These are starting values.

The reason for ~30 seconds:

- enough time to escape a predator
- enough time to reach cover
- enough time to reach takeoff speed or a hiding place
- not long enough to sprint indefinitely

The longer sprint reserve should be balanced with slower recovery.

---

# 15. FLIGHT STAMINA — FIRST TUNING TARGET

Flight must last much longer than ground sprinting.

Initial gameplay targets:

```text
Slow / efficient flight:  ~8–10+ min
Normal cruise:            ~5–6 min
Fast flight:              ~2–3 min
Hard climb:               ~45–60 sec
Maximum effort / burst:   ~20–30 sec
```

These values are tuning targets, not biological constants.

The important design rule is:

> Normal flight should be transportation, not a four-second super-jump.

---

# 16. STAMINA AT ZERO

Zero stamina does NOT turn the wings off.

Do NOT:

```text
0% stamina
→ wings stop
→ Queen becomes a falling brick
```

Instead:

```text
0% stamina
→ emergency minimum-power flight
→ Queen remains steerable
→ cannot maintain normal altitude
→ very poor sink/glide state
```

Conceptual exhausted behavior:

```text
~1 forward : 5 down
```

at the worst low-speed condition.

The Queen still has enough wing function to remain controllable.

---

# 17. EMERGENCY RECOVERY DESCENT

This is a core flight mechanic.

It is inspired by the gameplay idea of helicopter autorotation, but the ant is not literally autorotating.

Use a neutral internal name such as:

```text
recovery descent
```

At very low or zero stamina:

```text
NO INPUT
→ poor low-power sinking flight
→ little useful recovery

hold ⬇
→ deliberate steeper descent
→ airspeed increases
→ wing effort falls
→ stamina recovery increases
```

Conceptual emergency loop:

```text
⚠ STAMINA EMPTY
      ↓
⬇ RECOVERY DESCENT
      ↓
ALTITUDE → AIRSPEED
      ↓
AIRSPEED reduces required wing effort
      ↓
STAMINA begins recovering
      ↓
re-arm threshold reached
      ↓
powered flight gradually becomes available
```

This makes altitude a survival resource.

If the Queen is high enough, good energy management may save the flight.

If she is too low, she lands.

---

# 18. GLIDE STAMINA RECOVERY

True gliding can recover stamina slowly.

First conceptual targets:

```text
ordinary glide
→ modest recovery

intentional recovery descent
→ stronger recovery

ground resting
→ still one of the strongest normal recovery states
```

Possible tuning range for testing:

```text
ordinary glide:
~0.4–0.6% full stamina per second

recovery descent:
up to ~1.5–2% per second
depending on airspeed / descent condition
```

Do not hard-lock these numbers until tested.

Recovery should depend on actual flight state, not simply whether the player is holding the down button.

---

# 19. STAMINA SYSTEM ARCHITECTURE

The current sprint-only stamina design should eventually become a generic effort system.

Avoid:

```text
update(sprinting, resting, dt)
```

as the permanent flight architecture.

Preferred conceptual direction:

```text
stamina update receives:
- current effort / drain rate
- current recovery rate
- dt
```

Then different activities can map cleanly:

```text
ground sprint
→ high drain

slow flight
→ tiny drain

cruise
→ low drain

fast flight
→ medium drain

hard climb
→ high drain

glide
→ recovery

recovery descent
→ stronger recovery
```

One bar, one reserve, many workloads.

---

# 20. LANDING

Landing does not require a separate LAND button.

The player descends with ⬇.

Near terrain:

```text
airborne
   ↓
hold ⬇
   ↓
feet/body approach valid surface
   ↓
contact
   ↓
flight state ends
   ↓
ground/climb state begins
```

Landing should preserve believable momentum.

A soft landing should transition smoothly.

A hard landing can stun the Queen but does NOT deal fall damage.

---

# 21. NO FALL DAMAGE

Ants do not take HP damage from ordinary falling or hard landings.

Explicit rule:

```text
TERRAIN IMPACT
=
0 FALL DAMAGE
```

This includes:

- normal landing
- failed takeoff
- exhausted descent
- hard ground arrival
- falling from height

Combat/environmental damage remains separate.

Example:

```text
hit by predator
→ can take damage

fall onto ground
→ no HP damage
```

---

# 22. HARD IMPACT / STUN

High-speed collisions should have consequences without HP loss.

Use a brief dizzy/stunned state.

Visual concept:

```text
✨  ✨
  🐜 😵‍💫
✨  ✨
```

During stun:

- movement input unavailable
- flight/climb input unavailable
- combat/actions unavailable
- stars orbit around the ant
- future animation may add body/head wobble
- control returns automatically

## 22.1 Severity

Impact severity should be continuous.

Conceptual tuning:

```text
gentle contact
→ no stun

moderate impact
→ ~0.5 sec stun

hard impact
→ ~1 sec stun

extreme high-speed impact
→ maximum ~2 sec stun
```

Maximum stun should remain short.

The goal is funny/readable feedback, not extended helplessness.

---

# 23. CLIMBABLE-SURFACE IMPACT

A high-speed collision with a tree/wall should NOT automatically attach the Queen on first contact.

The first impact behaves like hitting a door without fully opening it.

## First contact

```text
Queen hits climbable surface at speed
        ↓
hard impact
        ↓
small damped bounce
        ↓
stun begins
        ↓
NOT attached yet
```

The bounce should be small.

Do not use raw rigid-body reflection that launches the ant far away.

Initial conceptual bounce retention:

```text
~15–30% of perpendicular impact speed
```

Tuning only.

## Grip-ready window

After a hard climbable collision, the Queen enters a short temporary grip-ready state.

Conceptual target:

```text
~2 sec
```

## Second contact

If she contacts the climbable surface again during that window:

```text
second contact
      ↓
automatic grip reflex
      ↓
body rotates to surface normal
      ↓
Queen attaches
      ↓
remaining stun finishes
      ↓
climbing control resumes
```

Important:

> The game should not teleport the Queen back to the tree.

Attachment occurs only if actual second contact happens.

If she genuinely bounces clear, she keeps descending/flying.

---

# 24. CONTROLLED TREE APPROACH

The two-contact bounce rule applies to uncontrolled/high-energy impacts.

A slow, deliberate approach to a climbable surface should be allowed to transition smoothly.

Conceptually:

```text
slow controlled approach
      ↓
climbable surface contact
      ↓
feet grip
      ↓
body rotates
      ↓
CLIMB
```

No forced comedy bounce when the player intentionally lands on bark.

---

# 25. GROUND RUNNING INTO VERTICAL SURFACES

This belongs partly to the future climbing system.

Potential rule:

- ordinary running into a climbable tree base may transition upward if the locomotion system supports it
- extremely high-speed face-first impact may still trigger the short stun

Do not implement this as part of flight unless required for the flight/climb transition.

---

# 26. AUTO-LEVELING

When the player releases flight movement input:

- Queen returns toward a stable level attitude
- bank reduces smoothly
- pitch reduces smoothly
- momentum remains
- glide continues

Do not instantly zero angular/linear velocity.

Stability assistance should feel forgiving but not robotic.

---

# 27. WIND / WEATHER — FUTURE

Do not build wind just because flight exists.

The flight model should leave room for future:

- wind drift
- gusts
- stronger weather
- mating-flight conditions
- rain hazards

A neutral glide should therefore not depend on perfect world-space position locking.

---

# 28. WINGED QUEEN STATE

Flight only applies when the Queen is biologically/gameplay-state winged.

Conceptually:

```text
young/growing Queen
→ winged
→ can fly

adult alate
→ winged
→ can fly

mated alate
→ winged
→ can fly

commits to founding
→ sheds wings

founder Queen
→ no normal flight
```

The current placeholder model may be used before the winged mesh/animations exist.

For early testing:

> Pretend the Queen has wings.

The flight code should not depend on having final wing animation assets.

---

# 29. ANIMATION / VISUALS — FUTURE PASS

Flight must work without final animations.

Later visuals can include:

- wing deployment
- high-frequency wing blur
- pitch/roll body attitude
- banking
- climb posture
- descent posture
- exhausted wing effort
- landing transition
- collision stun
- dizzy stars
- tree grip
- wing shedding after founding

Do not block mechanics on animation availability.

---

# 30. STATE MACHINE — RECOMMENDED SHAPE

Conceptual flight states:

```text
GROUNDED
   ↓ takeoff eligible + input

TAKEOFF
   ↓ established airborne

POWERED_FLIGHT

POWERED_FLIGHT
   ↓ input/effort reduced
GLIDE

POWERED_FLIGHT / GLIDE
   ↓ stamina exhausted
EXHAUSTED_FLIGHT

EXHAUSTED_FLIGHT
   ↓ hold descent + gain airspeed
RECOVERY_DESCENT

any airborne state
   ↓ valid soft surface contact
LANDED / CLIMB_ATTACHED

any airborne state
   ↓ hard impact
STUNNED_AIR / STUNNED_SURFACE
```

These exact names are not mandatory.

The important point is to avoid one giant boolean such as:

```text
flying = true/false
```

trying to represent all flight behavior.

---

# 31. IMPORTANT INVARIANTS

Keep these rules stable unless testing proves one is wrong.

```text
1. Flight is assisted, not hardcore sim control.
2. Left stick controls horizontal flight.
3. ⬆ climbs / takes off.
4. ⬇ descends / performs recovery descent.
5. Camera remains free-look.
6. Neutral does not hover-lock.
7. Neutral flight becomes a glide.
8. Best glide is roughly 5:1 at ideal airspeed.
9. Glide gets dramatically worse at very low airspeed.
10. Airspeed is independent of power/Pace.
11. Altitude can be traded for airspeed.
12. One stamina reserve serves ground and flight.
13. Zero stamina does not shut the wings off.
14. Zero stamina produces minimum-power sinking flight.
15. Recovery descent can rebuild airspeed and stamina.
16. No fall/terrain impact HP damage.
17. Hard impacts can stun for up to about 2 seconds.
18. First hard tree impact bounces.
19. Second climbable contact can auto-grip.
20. Slow intentional climbable contact can attach normally.
21. Takeoff uses actual speed, around walking-speed threshold.
22. Flight UI reuses the existing HUD instead of redesigning it.
```

---

# 32. FIRST IMPLEMENTATION ORDER

Recommended implementation sequence:

```text
1. Add flight state shell
2. Add permanent ⬆ / ⬇ UI buttons
3. Ground takeoff eligibility by actual speed
4. Takeoff transition
5. Horizontal assisted flight
6. Climb / descend
7. Auto-level
8. Airspeed tracking
9. Glide behavior
10. Glide-ratio curve
11. Generic stamina effort model
12. Powered-flight stamina drains
13. Zero-stamina emergency flight
14. Recovery descent
15. Landing
16. Hard-impact stun
17. Climbable bounce + second-contact grip
18. Device tuning
```

Do not begin with final animations.

Do not begin with multiplayer.

Do not begin with wind/weather.

---

# 33. TEST / PROBE IDEAS

Useful automated or manual probes:

## Takeoff

```text
speed below threshold
→ up button disabled

speed above threshold
→ up button active
```

## Momentum

```text
accelerate
release input
→ airspeed does not instantly become zero
```

## Glide

```text
neutral at best-glide speed
→ approximately 5 horizontal per 1 vertical
```

## Low-speed sink

```text
very low airspeed
→ glide ratio becomes much worse
```

## Climb

```text
hold up
→ altitude rises
→ stamina drains faster
```

## Recovery descent

```text
stamina near zero
hold down
→ airspeed rises
→ stamina recovery increases
```

## Zero stamina

```text
stamina = 0
→ Queen remains controllable
→ altitude cannot be held normally
```

## No fall damage

```text
hard ground impact
→ HP unchanged
```

## Hard impact

```text
high-speed tree collision
→ stun
→ first contact does not attach
```

## Second contact

```text
second climbable contact during grip-ready window
→ attach to surface
```

---

# 34. OPEN QUESTIONS / TUNING ITEMS

These are NOT locked yet:

1. Exact takeoff speed
2. Exact takeoff stamina cost
3. Exact airspeed scale in world units
4. Exact best-glide airspeed
5. Exact glide-curve equation
6. Exact climb rates
7. Exact descent rates
8. Exact pitch/bank visual angles
9. Exact auto-level rate
10. Exact flight stamina drain curve
11. Exact glide recovery rate
12. Exact recovery-descent bonus
13. Exact exhausted sink curve
14. Exact bounce damping
15. Exact stun thresholds
16. Exact grip-ready duration
17. Whether an explicit airspeed gauge is needed
18. Desktop keyboard mappings
19. Whether flight has its own settings sliders beyond camera inversion
20. Final wing animations and mesh behavior

These should be tuned after the first working flight lab.

---

# 35. FIRST-PASS TARGET FEEL

The target experience:

```text
Queen runs across the ground.

At about walking speed:
⬆ lights up.

Player taps/holds ⬆.

The Queen lifts off without teleporting.
Momentum carries forward.

The left stick guides horizontal flight.
The camera remains free.

The player climbs.
Stamina drains faster.

The player releases movement.
The Queen levels and glides.

At good speed:
she travels about 5 forward for 1 down.

She slows too much:
the glide steepens badly.

Stamina reaches zero:
she does not fall like a rock.

Instead:
she sinks in minimum-power flight.

The player presses ⬇.

She dives.
Airspeed builds.
Stamina starts returning.

The player recovers enough power,
levels out,
and keeps going.

Then immediately flies full speed into a tree.

💥

✨ 😵‍💫 ✨

She bounces away slightly.

A second contact catches the bark.

She hangs there dizzy for another moment.

Then climbing control returns.

No HP lost.

Perfectly intentional.
Probably.
😂🐜🪽
```

---

# 36. ONE-SENTENCE FLIGHT DEFINITION

> **TRADDOMIUM flight is a mobile-friendly assisted ant-flight system where the player steers horizontally, climbs and descends with dedicated controls, while airspeed, glide, momentum, stamina, altitude-energy tradeoffs, emergency recovery descent, landing, and surface impacts create believable depth underneath the simple controls.**
