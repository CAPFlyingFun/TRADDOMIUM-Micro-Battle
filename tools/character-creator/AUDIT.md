# Character Creator / Clothing Creator — Code Audit
**File audited:** `character_creation_clothing_v03.html`  
**Fixed version:** `character_creation_clothing_v04.html`  
**Date:** October 2026

---

## ✅ What Works Correctly in v0.3

| Feature | Status |
|---|---|
| Three.js 0.164.1 import via importmap (jsDelivr CDN) | ✅ Working |
| OrbitControls / GLTFLoader / GLTFExporter imports | ✅ Working |
| Camera ↔ Paint mode toggle (🎥 / 🎨 buttons) | ✅ Working |
| Camera lock during paint — `controls.enabled=false` | ✅ Working |
| Vertex color painting with radial brush falloff | ✅ Working |
| UV texture painting (requires mesh UVs) | ✅ Working |
| Sculpt + Smooth geometry tools | ✅ Working |
| Garment generation from boundary (offset geometry) | ✅ Working |
| Garment offset / thickness / opacity sliders | ✅ Working |
| Horizontal guide ring (boundary height) | ✅ Working |
| Fill-below-boundary UV fill | ✅ Working |
| Save / Load JSON project | ✅ Working |
| Export GLB | ✅ Working |
| Save PNG screenshot | ✅ Working |
| Undo / Redo (12-step stack) | ✅ Working |
| Demo body mannequin (no GLB needed) | ✅ Working |
| GLB/GLTF model loading | ✅ Working |
| Mesh layer list (right panel) | ✅ Working |
| Material color picker | ✅ Working |
| Texture image upload overlay | ✅ Working |
| Front/Back/Side/45° camera presets | ✅ Working |
| Wireframe toggle | ✅ Working |
| Responsive layout (mobile / tablet breakpoints) | ✅ Working |
| Title renamed to "Character Creation and Clothing" | ✅ Already done in v0.3 |

---

## 🐛 Bugs Found & Fixed in v0.4

### Bug 1 — Erase tool painted white instead of removing paint
**Severity: High**  
`applyPaint(hit, erase=true)` used `source-over` composite with `#ffffff` — it painted a white circle rather than removing the existing paint. On a transparent canvas layer this is visually wrong and doesn't recover the original texture.

**Fix:** Switched to `destination-out` composite operation, which truly punches through paint to reveal what's underneath. Also wrapped both paint and erase paths in `ctx.save()` / `ctx.restore()` so composite state never bleeds.

---

### Bug 2 — Erase tool always tried UV erase, even on vertex-painted meshes
**Severity: Medium**  
`processHit()` always called `applyPaint(hit, true)` for the `erase` tool. If the mesh was painted with vertex colors and had no UVs, `makeLayer()` returned `null` and the erase silently did nothing.

**Fix:** Erase now checks `hit.object.geometry.attributes.color` — if vertex colors exist it calls `vertexPaint(hit, true)` (which restores verts to white), otherwise it calls `applyPaint(hit, true)` (UV canvas erase).

---

### Bug 3 — 🎨 Paint button always reset to Vertex Paint, ignoring tool dropdown
**Severity: Medium**  
Clicking 🎨 always hardcoded `$('tool').value='vertex'`. If you had switched the dropdown to UV texture paint, erase, sculpt, or smooth, clicking 🎨 lost your selection.

**Fix:** Added a `lastPaintTool` variable (defaults to `'vertex'`). The tool dropdown's `onchange` handler saves any non-orbit selection to `lastPaintTool`. The 🎨 button restores `lastPaintTool` instead of hardcoding vertex.

---

### Bug 4 — Canvas base fill was opaque white, blocking true erase
**Severity: Medium**  
`makeLayer()` filled the new canvas with `#ffff` (opaque white). Since erase now uses `destination-out`, the erased pixels should show as transparent — but an opaque white base meant the erased area showed white instead of the underlying material color.

**Fix:** Base fill changed to `rgba(255,255,255,0)` (fully transparent). The material's base color shows through erased areas as intended.

---

## ⚠️ Known Limitations (Not Fixed — Future Work)

### L1 — No stroke interpolation between pointer positions
**Impact:** Fast brush strokes leave gaps on the mesh. Painting slowly is fine, but quick gestures on mobile/tablet will have visible skips.  
**Fix needed:** Track `lastHitPoint` UV per pointer move and fill intermediate positions by lerping between the last and current UV before applying paint — similar to how Procreate handles fast stylus input.

---

### L2 — No morph target / body shape blending system
**Impact:** Cannot blend body shapes (e.g., standard → pregnant belly growth, weight gain/loss).  
**Fix needed:** Load a GLB with embedded morph targets (shape keys set up in Blender), then expose the `.morphTargetInfluences[]` array as sliders per target. Three.js fully supports this — it just requires the source GLB to have the shape keys baked in.

**Recommended Blender workflow for Sarah's body:**
1. In Blender: create a "Base" shape, then add shape keys for `Belly_Month3`, `Belly_Month6`, `Belly_Month9`, `WeightGain`, etc.
2. Export as GLB with shape keys embedded.
3. The tool can then expose sliders that drive `mesh.morphTargetInfluences[index]` in real time — the garment offset geometry will update to match since it samples vertex positions.

---

### L3 — Multi-material meshes reduced to one editable material
When a GLB contains a mesh with multiple materials (e.g., skin + eye + lip sub-materials), `prepMesh()` picks one and discards the rest. Original materials are not restored on export.  
**Fix needed:** Support per-material-group paint layers and preserve the material array on export.

---

### L4 — 1024×1024 UV paint canvas is fixed
No way to increase texture resolution for detail work on intricate fabrics or patterns.  
**Fix needed:** Add a resolution selector (512 / 1024 / 2048 / 4096) in the project settings and rebuild the canvas layer when changed.

---

### L5 — No keyboard shortcuts (removed from v2)
v2 had shortcuts for camera/paint toggle; v3 removed them.  
**Fix needed:** Add at minimum — `C` = camera mode, `V` = vertex paint, `P` = UV paint, `E` = erase, `Z` = undo, `Shift+Z` = redo.

---

### L6 — Skinned mesh (rigged character) painting is unreliable
Raycaster hits on `SkinnedMesh` return world-space points that don't map cleanly back to local vertex space for vertex painting. The tool notes `isSkinnedMesh` but doesn't compensate.  
**Fix needed:** Use `BVH` (three-mesh-bvh) acceleration and bake the skeleton pose before painting, or paint in bind pose only.

---

### L7 — Garment doesn't follow body deformation
Generated garments copy geometry at creation time. If sculpt tools move body vertices after garment creation, the garment doesn't update.  
**Fix needed:** Re-run `triangleData()` and `applyOffset()` on the source mesh after any sculpt operation that affects it, or mark garments as "dirty" and re-bake on next frame.

---

## 📋 Recommended Next Steps for TRADDOMIUM / Beyond Extinction

1. **Build Sarah's morph-target GLB in Blender** (base + 9 pregnancy stages + general body weight slider) — this unlocks L2 above immediately with minimal code change.
2. **Add keyboard shortcuts** (L5) — a one-afternoon fix that dramatically improves workflow.
3. **Stroke interpolation** (L1) — important for stylus users on iPad/Surface.
4. **Preset garment library** — save/load named garment presets (bikini bottom, tank top, lab coat, maternity dress) as JSON snippets so clothing shapes are reusable across characters.
5. **Boundary anchor types** — currently the boundary is a horizontal plane. For a bikini bottom specifically, add a "hip curve" boundary mode that follows the mesh contour rather than a flat slice — this would have solved the Claude / AI positioning problem directly.

---

## Internet Requirement Note
The tool loads Three.js from jsDelivr CDN. **It will not work if opened from a local filesystem without an internet connection.** For offline use, host it on localhost, GitHub Pages, or bundle the Three.js modules locally. This is noted in the UI already.
