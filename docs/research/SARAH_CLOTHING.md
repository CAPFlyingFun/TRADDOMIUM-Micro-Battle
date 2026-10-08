# Sarah Lab clothing — alpha.86

Joshua's 2026-10-08 clarification: finish the bright red tee and black leggings
first, then fitted one-piece suits. Original bust size is normal at belly 0%;
belly 100% adds 50%, and belly 200% adds 100%. These are local geometric shape
scales with a fade into the chest, not volume or cup-size measurements.

The shirt remains a separate cloth mesh, with the existing eight-view reference
providing fabric folds and seams. Its colour is brighter red. Every garment
copies the body's final bone weights and morph targets. Cleavage-only bridging
now runs for the bikini and swimsuit as intended.

The body carries `_CLOTH_COVER`: four bits, in the order shirt, leggings, bikini,
swimsuit. Each bit marks original vertices safely inside the garment, with a
3 mm margin at the cut. Sarah Lab hides a body triangle only when all three
vertices belong to the same visible garment. Boundary skin remains visible;
switching to `none` restores every original triangle. Outfit indices are cached
on the CPU and reuse one GPU buffer, without filtering triangles each frame.

## Rebuild without the source master

`npm run bake:sarah-clothes` reads the shipped `public/models/sarah-base.glb`.
It recovers the mesh's corrective bind-space transform from each joint and its
inverse bind matrix, verifies they agree, dequantizes the body back to metres,
and preserves its geometry, UVs, skeleton and repaired weights. It regenerates
shapes and clothing, compresses them, and replaces the file only after writing
a complete temporary GLB. It can run again on its own output. The original
source master is neither needed nor changed; normal `bake:humans` also uses the
updated growth and clothing definitions when that master is available.

Next recommended order: sleeveless catsuit, bodysuit, long-sleeved wetsuit.
A loose jumper needs its own hanging garment surface rather than copying the
skin into the space between the legs. Keep all new designs in Sarah Lab until
Joshua reviews their appearance and movement.
