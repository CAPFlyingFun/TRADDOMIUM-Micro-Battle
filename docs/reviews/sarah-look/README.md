# Sarah as Joshua set her, and the cloth tee on by default (alpha.125)

Joshua, 2026-10-24: "Here is Sarah and the minor tweaks I did… we need to make sure the cloth sim is on by default,
you have it off…"

- **`src/sarahlab/sarahLook.ts`** holds his saved Sarah, taken from the Lab's own export
  (`traddomium-characters.json`). It is read through the saves' own `sanitizeBook`, the way IMPORT reads a file:
  - the v2 body at **73%**, with **NAVEL +20** (an outie 26% of the way at that size);
  - the red light spandex tee, dyed **athletic swatch 8**;
  - the painted charcoal leggings, with breast and navel detail through them held at **0.45 / 0.8**.
- **The Lab opens on her.** Her bump, shape and clothes are put on as the outfit is first dressed. Every control
  still moves her from there.
- **CLOTH SIM is on by default.** Whenever she has the light tee on, it is worn as cloth. Switching CLOTH SIM off keeps
  it off until it is switched on again.
- **The TRADDOMIUM and TMB-Story test scenes start from this Sarah.**
- `probe:sarahlab` checks she opens at 73%, then takes her to 100% for its own checks as before.

Sheet: `01-opens-as-saved.jpg`, the room as it opens (front, then ¾ full length).
