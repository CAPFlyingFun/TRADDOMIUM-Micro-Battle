# Fire ant wing motion — what is measured, and what is not

Where the queen's wing motion comes from. `src/ant/wingbeat.ts`
implements it and `tests/wingbeat.test.ts` checks it against the
figures below, so a change to either has to argue with the paper.

## The source

> Gui L, Fink T, Cao Z, Sun D, Seiner JM, Streett DA (2010).
> **Fire ant alate wing motion data and numerical reconstruction.**
> *Journal of Insect Science* 10:19. insectscience.org/10.19
> Open access, CC-BY 3.0.

Stereo high-speed imaging at 8,000 fps of tethered *Solenopsis richteri*
alates, resolved to 74 phases per wingbeat for the male and 83 for the
female. This is the good stuff: it is a primary source, the method is
described in full, and the per-phase data are published.

*S. richteri* is the black imported fire ant rather than our *S.
invicta*. They are close congeners of near-identical size and the two
hybridise freely in the field, so these figures are the best available
proxy — but they are a proxy, and that is worth saying out loud rather
than quietly treating them as *invicta* numbers.

## The queen's numbers

She is female, so the female column is ours. The male is here only
because the difference between them is itself informative.

| | female | male |
|---|---|---|
| wingbeat | **96 Hz** | 108 Hz |
| body length | 8.3 mm | 6.2 mm |
| live weight | 11.4 mg | 5.5 mg |
| forewing stroke amplitude Φ | **114.3°** | 126.8° |
| hindwing stroke amplitude Φ | **135.3°** | 148.1° |
| stroke plane angle β | **67.7°** | 55.1° |
| body angle χ | **−1.0°** | 11.9° |
| β + χ | 66.7° | 67.0° |

Forewing root at (0.69, 0.69, 1.09) mm, hindwing root at
(0.61, 0.69, 1.85) mm, from the centre of the neck.

Two relationships hold for both sexes and are the sort of thing that
makes an animation read as an insect rather than as two flapping
planes:

- the **hindwing** sweeps about **15% further** than the forewing
- **β + χ is nearly identical** between the sexes (66.7° vs 67.0°),
  even though β and χ differ a lot — the stroke plane is held at a
  fixed angle to the world, and the body angle is what changes

### The part worth coming back for

Tables 1 and 2 of the paper give, for every one of the 74/83 phases in
a single beat, the wingtip position (xt, yt, zt in mm) and the two wing
surface angles (γ, α). That is a measured keyframe set for one complete
wingbeat. When the wings are animated, that table is the animation —
there is no need to invent a curve.

## Ninety-six hertz cannot be drawn at sixty

This is arithmetic, not a limitation to engineer around. A beat and a
half passes between one frame and the next, so anything sampled at
60 Hz is aliasing rather than motion — a strobe. Real wings at this
frequency read to the eye as a blur, and a renderer insisting on the
true rate produces a worse lie than one that slows down.

So the truth and the picture are kept apart. `WINGBEAT_HZ` is 96 and
never changes; anything physical takes it. `SHOWN_HZ` is 12, which is
the fastest that still reads as beating wings, and only the animation
takes that. A test pins them apart so nobody later "fixes" the
animation by setting it to the real frequency.

The 83-phase table is not used. It describes a TETHERED ant against a
blower at a resolution no display can show, and its fine structure —
the slight asymmetry between upstroke and downstroke — is exactly what
aliases away first. What survives at a watchable rate is the amplitude
and the fore/hind relationship, and those are what the code
reproduces. The table is there in the paper if a slow-motion shot or
the wing sound ever wants it.

## Flight behaviour, from the same paper's introduction

Second-hand and cited as such:

- **Vogt et al. (2000)** — on a flight mill, in the absence of wind,
  *S. invicta* female alates flew **less than 5 km**.
- **Markin et al. (1971)** — alates taken up to ~240 m (800 ft); males
  flew in a layer 60–150 m; **females remained aloft 30 minutes or
  less**; 95% returned inseminated.

**The thirty minutes is now the game's number.** A full reserve buys
1,800 seconds of level flight; a hard climb costs six times that rate
and flat-out twice, both still game tuning. At her 0.70 m/s top
airspeed, thirty minutes is 1.26 km of still air — comfortably under
Vogt's 5 km ceiling, at the low end of it. The two figures come from
different experiments rather than one flight, so they should not be
multiplied together.

## What NOT to use

The other PDF in that pair — *"Do Fire Ants Have Functional Wings?"*,
AquaWorldHub, August 2024 — is an affiliate blog post and is wrong in
ways that matter. Recorded here so nobody mines it later:

- "Egg-laying queens have fully formed wings." Backwards. A queen sheds
  her wings *before* she lays; a laying queen is by definition
  dealate.
- "Workers and males start out with rudimentary wing buds… these buds
  grow into functional wings." Workers never develop wings at all.
- Wing shedding by secreting "enzymes to break down their wings."
  Dealation is mechanical — she breaks them off at a preformed
  fracture line.
- "Fire ants are expert burrowers and their wings play a crucial role
  in their underground habits." Wings play no role underground; that
  is the reason for shedding them.
- "Many fire ant subspecies have lost their ability to fly." Not a
  described phenomenon in *Solenopsis invicta*.

It reads as machine-generated filler. Gui et al. is the one to build on.
