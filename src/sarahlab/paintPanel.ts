/**
 * CHARACTER CREATOR / CLOTHING CREATOR PAINT (merged from the standalone
 * tools/character-creator v0.4, Joshua, 2026-10-18: "merge this file and tools with
 * what's already in the Sarah's Lab as it has body sliders").
 *
 * 🎥 CAMERA leaves the Lab's orbit alone; 🎨 PAINT locks it, and a drag paints on
 * whatever is under the pointer (skin or any garment), in that material's own UVs,
 * so the paint follows every body slider, pose and outfit. ERASE truly erases
 * (destination-out on the paint layer, the v0.4 fix), and each material keeps its
 * own transparent paint layer over its original look, so RESET gives it back.
 */
import * as THREE from 'three';

type Tool = 'paint' | 'erase';
interface Layer {
  material: THREE.MeshStandardMaterial;
  originalMap: THREE.Texture | null;
  originalColor: THREE.Color;
  base: HTMLCanvasElement;
  paint: HTMLCanvasElement;
  view: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

export interface PaintPanel {
  element: HTMLElement;
  /** True in 🎨 PAINT: the scene must not orbit on a one-finger drag. */
  painting(): boolean;
  /** Called by the scene's HUD for a pointer that is not on a control; true when it painted. */
  pointer(kind: 'down' | 'move' | 'up', e: PointerEvent, rect: DOMRect): boolean;
  /** The model changed: its materials are gone, so their layers are too. */
  reset(): void;
  dispose(): void;
}

const MAX_SIZE = 2048;

export function paintPanel(meshes: () => THREE.Object3D[], camera: () => THREE.Camera): PaintPanel {
  const layers = new Map<THREE.Material, Layer>();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let mode: 'camera' | 'paint' = 'camera';
  let tool: Tool = 'paint';
  let lastPaintTool: Tool = 'paint';
  let color = '#c0392b', size = 12, opacity = 1;
  let stroke: { pointer: number; layer: Layer; last: THREE.Vector2 | null } | null = null;
  let current: Layer | null = null;

  const panel = document.createElement('details');
  panel.dataset.role = 'sarahlab-paint';
  panel.style.cssText = 'border-top:1px solid #ffffff25;padding-top:8px;touch-action:pan-y';
  const summary = document.createElement('summary');
  summary.textContent = 'PAINT · skin & clothing';
  summary.style.cssText = 'cursor:pointer;padding:8px 0;font-size:12px';
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:6px 0';
  const row = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap'; return r; };
  const button = (parent: HTMLElement, title: string, action: string, click: () => void) => {
    const b = document.createElement('button'); b.textContent = title; b.dataset.action = action;
    b.style.cssText = 'min-height:40px;padding:8px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui';
    b.onclick = click; parent.append(b); return b;
  };
  const modes = row(), tools = row(), actions = row();
  const camBtn = button(modes, '🎥 CAMERA', 'sarahlab:paint-camera', () => { mode = 'camera'; update(); });
  // 🎨 restores the last paint tool rather than forcing one (v0.4 fix)
  const paintBtn = button(modes, '🎨 PAINT', 'sarahlab:paint-mode', () => { mode = 'paint'; tool = lastPaintTool; update(); });
  const brushBtn = button(tools, 'BRUSH', 'sarahlab:paint-brush', () => { tool = lastPaintTool = 'paint'; mode = 'paint'; update(); });
  const eraseBtn = button(tools, 'ERASE', 'sarahlab:paint-erase', () => { tool = lastPaintTool = 'erase'; mode = 'paint'; update(); });

  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = color; picker.dataset.field = 'paint-color';
  picker.setAttribute('aria-label', 'Paint colour');
  picker.style.cssText = 'width:100%;min-height:36px;border:0;background:none';
  picker.oninput = () => { color = picker.value; };
  const slider = (name: string, min: number, max: number, step: number, value: number, set: (v: number) => void, text: (v: number) => string) => {
    const label = document.createElement('label'); label.style.fontSize = '12px'; label.textContent = text(value);
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.dataset.field = name; input.setAttribute('aria-label', name);
    input.style.cssText = 'width:100%;accent-color:#d4a853';
    input.oninput = () => { set(Number(input.value)); label.textContent = text(Number(input.value)); };
    return [label, input] as const;
  };
  const sizeCtl = slider('paint-size', 1, 96, 1, size, v => { size = v; }, v => `Brush · ${v}px`);
  const opacityCtl = slider('paint-opacity', 0.05, 1, 0.05, opacity, v => { opacity = v; }, v => `Opacity · ${Math.round(v * 100)}%`);
  button(actions, 'CLEAR PAINT', 'sarahlab:paint-clear', () => {
    if (!current) return;
    current.paint.getContext('2d')!.clearRect(0, 0, current.paint.width, current.paint.height);
    compose(current);
  });
  button(actions, 'RESET ALL', 'sarahlab:paint-reset', () => { release(); update(); });
  button(actions, 'EXPORT PNG', 'sarahlab:paint-export', () => {
    if (!current) return;
    const a = document.createElement('a');
    a.download = `${current.material.name || 'material'}-painted.png`;
    a.href = current.view.toDataURL('image/png');
    a.click();
  });
  const status = document.createElement('div');
  status.dataset.field = 'paint-status';
  status.style.cssText = 'font-size:11px;line-height:1.4;overflow-wrap:anywhere';
  status.setAttribute('aria-live', 'polite');

  function update(): void {
    const on = (b: HTMLButtonElement, v: boolean) => { b.style.background = v ? '#806020' : '#151b23'; b.setAttribute('aria-pressed', String(v)); };
    on(camBtn, mode === 'camera'); on(paintBtn, mode === 'paint');
    on(brushBtn, tool === 'paint'); on(eraseBtn, tool === 'erase');
    status.textContent = mode === 'camera'
      ? 'Camera: drag to orbit. 🎨 PAINT locks the camera so a drag paints.'
      : `Paint (${tool}) · camera locked${current ? ` · last: ${current.material.name || 'material'}` : ''}. Pinch/scroll still zooms.`;
  }

  function imageOf(map: THREE.Texture | null): CanvasImageSource | null {
    const img = map?.image as CanvasImageSource & { width?: number; height?: number } | undefined;
    if (!img || !(img.width && img.height)) return null;
    if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img;
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return img;
    if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img;
    return null;
  }

  function layerFor(material: THREE.Material): Layer | null {
    const have = layers.get(material);
    if (have) return have;
    if (!(material instanceof THREE.MeshStandardMaterial)) return null;
    // a custom try-on image (TEXTURE panel) uses its own wrap UVs; paint over the real UVs only
    if (material.map && material.map.channel !== 0) return null;
    const source = imageOf(material.map);
    const w0 = source ? (material.map!.image as { width: number }).width : 1024;
    const h0 = source ? (material.map!.image as { height: number }).height : 1024;
    const k = Math.min(1, MAX_SIZE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const base = mk(), paint = mk(), view = mk();
    const b = base.getContext('2d')!;
    if (source) {
      b.drawImage(source, 0, 0, w, h);
      // the original tint multiplies the map; bake it so the material can go white
      if (material.color.getHex() !== 0xffffff) { b.globalCompositeOperation = 'multiply'; b.fillStyle = `#${material.color.getHexString()}`; b.fillRect(0, 0, w, h); b.globalCompositeOperation = 'source-over'; }
    } else { b.fillStyle = `#${material.color.getHexString(THREE.SRGBColorSpace)}`; b.fillRect(0, 0, w, h); }
    const texture = new THREE.CanvasTexture(view);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = material.map ? material.map.flipY : false;
    if (material.map) { texture.wrapS = material.map.wrapS; texture.wrapT = material.map.wrapT; }
    const layer: Layer = { material, originalMap: material.map, originalColor: material.color.clone(), base, paint, view, texture };
    material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
    layers.set(material, layer);
    compose(layer);
    return layer;
  }

  function compose(l: Layer): void {
    const v = l.view.getContext('2d')!;
    v.clearRect(0, 0, l.view.width, l.view.height);
    v.drawImage(l.base, 0, 0); v.drawImage(l.paint, 0, 0);
    l.texture.needsUpdate = true;
  }

  function hit(e: PointerEvent, rect: DOMRect): { layer: Layer; uv: THREE.Vector2 } | null {
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera());
    for (const h of ray.intersectObjects(meshes().filter(m => m.visible), false)) {
      if (!h.uv || !h.face) continue;
      const mesh = h.object as THREE.Mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material[h.face.materialIndex] : mesh.material;
      if (!mat || !mat.visible) continue;
      const layer = layerFor(mat);
      if (layer) return { layer, uv: h.uv.clone() };
      return null;
    }
    return null;
  }

  function dab(l: Layer, uv: THREE.Vector2, from: THREE.Vector2 | null): void {
    const c = l.paint.getContext('2d')!;
    const w = l.paint.width, h = l.paint.height, r = Math.max(0.5, size * (w / 1024) / 2);
    const px = (u: THREE.Vector2) => [THREE.MathUtils.euclideanModulo(u.x, 1) * w, (l.texture.flipY ? 1 - THREE.MathUtils.euclideanModulo(u.y, 1) : THREE.MathUtils.euclideanModulo(u.y, 1)) * h] as const;
    const [x, y] = px(uv);
    c.save();
    c.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    c.globalAlpha = opacity; c.fillStyle = color; c.strokeStyle = color; c.lineCap = 'round'; c.lineWidth = r * 2;
    if (from) {
      const [fx, fy] = px(from);
      // a stroke across a UV seam would smear over the whole sheet: join only near dabs
      if (Math.hypot(fx - x, fy - y) < Math.max(w, h) * 0.08) { c.beginPath(); c.moveTo(fx, fy); c.lineTo(x, y); c.stroke(); }
    }
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.restore();
    compose(l);
  }

  function release(): void {
    for (const l of layers.values()) {
      l.material.map = l.originalMap; l.material.color.copy(l.originalColor); l.material.needsUpdate = true;
      l.texture.dispose();
    }
    layers.clear(); current = null; stroke = null;
  }

  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) panel.addEventListener(event, e => e.stopPropagation());
  content.append(modes, tools, picker, ...sizeCtl, ...opacityCtl, actions, status);
  panel.append(summary, content);
  update();

  return {
    element: panel,
    painting: () => mode === 'paint',
    pointer(kind, e, rect) {
      if (mode !== 'paint') return false;
      if (kind === 'up') { if (stroke?.pointer === e.pointerId) stroke = null; return true; }
      if (kind === 'down') {
        const h = hit(e, rect);
        if (!h) { stroke = null; return true; }
        current = h.layer; stroke = { pointer: e.pointerId, layer: h.layer, last: h.uv };
        dab(h.layer, h.uv, null); update();
        return true;
      }
      if (!stroke || stroke.pointer !== e.pointerId) return true;
      const h = hit(e, rect);
      if (!h || h.layer !== stroke.layer) { stroke.last = null; return true; }
      dab(h.layer, h.uv, stroke.last); stroke.last = h.uv;
      return true;
    },
    reset() { release(); update(); },
    dispose() { release(); },
  };
}
