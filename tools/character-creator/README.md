# Character Creator / Clothing Creator (TMB)

A browser-based Three.js character and clothing editor for **TRADDOMIUM / Beyond Extinction**.

- Loads GLB/GLTF models.
- 🎥 **Camera** vs 🎨 **Paint** modes — Paint mode locks the orbit camera so you can paint without spinning the model.
- Vertex and UV body painting, erase, and garment layers.

## How to run

Open it via GitHub Pages, or serve the repo locally:

```bash
python3 -m http.server
# then open http://localhost:8000/tools/character-creator/
```

An internet connection is required: Three.js 0.164.1 is loaded from the jsDelivr CDN.

## Known limitations & roadmap

See [AUDIT.md](AUDIT.md) for the v0.4 audit, known limitations, and the roadmap
(including morph-target / pregnancy shape-key blending for Sarah).
