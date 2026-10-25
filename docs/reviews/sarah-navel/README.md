# Sarah's NAVEL control (alpha.124)

Joshua, 2026-10-24: "a manual bellybutton in/out slider under the body section which is separate from the clothing so
I can adjust how much of an innie or outie bellybutton is there independent of the automatic bellybutton size per
belly % like the breast size".

BODY › BELLY SHAPE › **NAVEL** runs from −100 to +100. Like the bust's SIZE, it sits on top of what the belly slider
gives:

- **0** is the automatic navel at every size: an innie to 75%, rising to her modelled outie by 100%, an outie above.
- **−100** is the deepest innie at any size. It is her own `navelFlat` shape carried on 60% further inward.
- **+100** is the fullest outie at any size. It is her modelled outie and 30% more.

Between those points the slider is a straight line on each side, so no stretch of it does nothing. Its line says
where she stands now: "innie", "outie 45%", "deeper innie (…)" or "fuller outie (…)". The slider has a lock and a
range for RANDOMIZE, a reset, and is saved with her body like every body control.

It is her body, not her clothes. NAVEL DETAIL under fabric still settles it as before, and a fitted tee follows it
out but never deeper than an ordinary navel. v1's own navel shapes follow the same control.

Sheets:
- `01-navel-control.jpg`: −100, −50, 0, +50 and +100 at 72% and 120%, front and side.
- `02-body-section.jpg`: the slider in BELLY SHAPE.
