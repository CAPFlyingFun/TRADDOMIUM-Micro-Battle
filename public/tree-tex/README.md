# Bark

One bark, worn by every landmark tree. That is not a placeholder for a
set: the stand is INSTANCED — one geometry, one material, two draw
calls for the whole visible forest — so a second bark would be a second
draw call per detail level for a difference nobody can see at the range
these are drawn.

`bark-mossy` is Thronemound's, and it earns its place here twice: it is
the smallest of that set on the wire (644 KB with its normal map) and
moss is what actually grows on a Kauaʻi rainforest trunk.

## The two rules that came with it, both forced rather than chosen

- **Use the OpenGL normal map, not DirectX.** Library sets ship both.
  Three.js reads the GL convention; the DX one has its green channel
  inverted, which lights every ridge as a groove.
- **Mirrored wrapping is safe HERE, and it is a property of the mesh
  rather than luck.** The photograph does not tile on its own edges, so
  both wraps are mirrored and every join is continuous whatever the
  edges do. A mirrored tile runs its U backwards, and a tangent-space
  normal read backwards has its X inverted — but the trunk carries no
  tangent attribute, so three.js derives the frame from the UV's own
  screen-space derivatives, and on a mirrored tile that derivative is
  negated too. The frame flips with the image and the map lands the
  right way round.

## Roughness maps are deliberately NOT shipped

Thronemound measured its six and found them near-uniform, and three.js
MULTIPLIES: `roughness` times the map's green channel, never an
override. A flat map at 0.6 mean is a 40% gloss applied to every tree on
the island, which is what "trees shouldn't be glossy" was looking at.
The material sets roughness 1 and loads no map.

## Displacement is not shipped either

It needs a trunk tessellated far past this one — twelve sides near, six
far — and at this scale the normal map is doing that work already.

## Where the tiling comes from

The mesh derives it from the trunk's own girth (`treeMesh.ts`,
`BARK_TILE`), so the image does not need to know how big the tree is.
About thirty centimetres of trunk to a tile puts a third of a millimetre
on a texel, viewed by something fourteen millimetres long.

## Provenance

Copied from Thronemound Colony Sim, which records that two of its barks
— `bark-oak` and `bark-pale` — were removed for carrying a stock
seller's watermark tiled across the image at low opacity: invisible in a
thumbnail and perfectly legible on a trunk an ant is standing on. Check
any candidate at full size, corners included, before adding it.
