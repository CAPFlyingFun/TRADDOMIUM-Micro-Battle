# Character room: loading indicator, progressive loading, pipeline audit

Trello card 255. Joshua, 2026-10-20: a real-time indicator ("15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)", ETA,
downloading vs preparing, cache, errors with Retry, phone first), the room usable as soon as she and what she
has on are ready, other outfits loaded only when needed, and an audit of what the room downloads.

`landscape.jpg` and `portrait.jpg` are rendered from the built game on a throttled connection (8 MB/s while
opening, 1.5 MB/s for the outfit strip). "Preparing" is staged: the real card component, in the real room, fed a
preparing snapshot. In the headless renderer the GPU compile blocks every frame until it finishes, so no
screenshot can catch that state, and on a phone it is short.

## What changed

- **The meter counts the loader's own bytes.** `assets.loadModel(path, …, { meter })` fetches the file itself,
  streams it into one buffer sized from the build's manifest, and hands that buffer to GLTFLoader's own parse. A
  `.gltf` shirt's twenty-odd external parts are requested at the URLs GLTFLoader would have used, so the browser
  cache works exactly as it did. Nothing is downloaded twice. Loads that don't pass a meter are unchanged.
- **The totals are exact.** `__PUBLIC_SIZE__` (`vite.config.ts`) holds every public file's decoded size; a `.gltf`'s
  entry includes every buffer it names. Content-Length is not used, because a compressed response reports the
  compressed size.
- **Downloading and preparing are separate phases.** The percentage reaches 100% only once downloading is over.
  The card then switches to "Preparing the 3D model…" and disappears only after the GPU has compiled her and drawn
  two frames.
- **Cache.** Bytes the browser served from its cache count as received but not as speed, so the ETA stays honest.
  The card shows how much came from the device's cache. A 304 revalidation counts as cache: GitHub Pages caches for
  ten minutes and then asks again.
- **When the size is unknown** the bar runs indeterminate and the line reads "15.0 MB (1.2 MB/s)".
- **Errors.** After the loader's usual three retries, the card says what failed, notes when the device is offline,
  and offers a 44-point RETRY. Retry re-fetches only what is missing; files that already arrived are not fetched
  again.
- **Progressive order.** The body downloads first. Her current outfit's files are requested the moment the body's
  bytes are in, so the outfit downloads while the body is being built. She appears only once that outfit is on, so
  she is never shown undressed first. Every other outfit's files load when that outfit is first chosen. While they
  download she keeps what she is wearing and the room stays usable, and a small card sits out of her way: under
  BACK in landscape, just above the controls in portrait. A 66–77 MB shirt download for an outfit you have already
  moved past is cancelled. Leggings and the bikini bottom are kept once fetched; only one shirt is held at a time,
  as before.

## Audit: what the room downloads (decimal MB)

| | before | now |
|---|---|---|
| body `sarah-v2-body.glb` | 39.2 | 39.2 |
| high leggings | 12.6 | 12.6 |
| relaxed shirt (JSON + 20 parts) | 69.8 | 69.8 |
| low leggings | 9.2 | only when worn |
| bikini bottom | 1.7 | only when worn |
| **opening total** | **132.5** | **121.6** |

Findings, none of them acted on. Every item below changes a file or a format, so each needs your approval and a
benchmark first:

1. **About 21 MB of the 39.2 MB body file is clothing the v2 room never shows.** Per-material compressed shares
   inside the body: old leggings 6.6 + 0.9 trim, old low leggings 5.2 + 0.9 trim, the old grown tee 6.1 + 1.1 trim,
   and the bikini 8.4 (its bottom is replaced by the recovered one; the top stays). Her skin is 6.4 MB. These meshes
   are hidden (`replacedByRecovered`) or never worn on v2, but they are still downloaded and decoded. A body file
   without them would leave her approved mesh byte-for-byte unchanged and cut opening by roughly a sixth. This
   changes the approved file, so it is your call.
2. **The two relaxed shirts share all 20 parts.** `relaxed-high` and `relaxed-low` differ only in their 65 kB JSON.
   Switching between them costs no download when the cache holds the parts, but it costs a full re-parse and
   re-upload. One parse could serve both.
3. **The two spandex shirts share 1 part of 22** (2.8 MB). Each is 81.3 MB, the largest thing the room loads.
4. **The shirts are mostly fit data, not geometry.** The fine-fit shape fields are stored every 5%. Meshopt is
   already on (`EXT_meshopt_compression`, `KHR_mesh_quantization`); the next steps would be filter and quantization
   choices for the shape fields, and they need a visual A/B at every key.
5. **Repeat opens still revalidate.** GitHub Pages cannot mark the content-hashed parts immutable. A small service
   worker cache for `sarah-v2-cloth-parts/*.bin` would make a second visit essentially free.
6. **Textures are small.** The body has a 3.0 MB and a 1.6 MB PNG, and the rest are under 1.2 MB JPEG/WebP.
   Converting the PNGs is minor next to points 1 and 4.
