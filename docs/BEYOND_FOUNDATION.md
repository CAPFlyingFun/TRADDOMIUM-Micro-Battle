# Beyond Extinction Island Foundation

## Purpose

This branch adopts Beyond Extinction's proven Kauaʻi-world conventions without importing its human story, character assets, dialogue, or gameplay. TRADDOMIUM remains the playable game: its winged fire-ant queen, ant camera, flight, survival, and water-state systems stay in charge.

## Shared contract

- Both projects use the same origin-centred Kauaʻi terrain source.
- Beyond Extinction uses metres; TRADDOMIUM uses centimetres. One Beyond metre equals 100 TRADDOMIUM world units.
- Imported hydrography is checked at load time against the shared ±28 km terrain extent, preventing a silent 100× placement error.
- River draw distances are declared in source metres and converted once at the rendering boundary. This makes the adaptation reviewable and prevents hand-entered duplicate scale values.

## What was deliberately not copied

- Human player models, humanoid animation logic, narrative scenes, dialogue, inventory, and cinematics.
- Beyond Extinction's wide-channel terrain carve. Its coarse terrain mesh needs that rendering workaround; TRADDOMIUM's near-field ant terrain has much finer cells and must keep its true-width channel treatment.
- A second terrain or hydrography dataset. There is one island and one coordinate frame.

## Claude review checklist

1. Confirm the PR targets `TRADDOMIUM-Micro-Battle:main` and keeps `main` unchanged until merge.
2. Verify `src/world/beyondFoundation.ts` remains the only metres-to-centimetres conversion boundary for imported Beyond water constants.
3. Verify hydrography load errors are surfaced rather than drawing displaced water.
4. Continue future water work by adapting individual Beyond rendering ideas to ant scale; do not replace the queen's movement, flight, or swim systems with human-player logic.
