import * as THREE from 'three';
import { GARMENTS, type Garment } from './sarahLabTool';

type Look = { material: THREE.MeshStandardMaterial; map: THREE.Texture | null; color: THREE.Color };
type Custom = { texture: THREE.CanvasTexture; name: string; aspect: number; scale: number; mirrorX: boolean; mirrorY: boolean; angle: number; mode: string };

/** Local image try-on; originals remain available for reset and scene release. */
export function garmentTexturePanel(meshes: () => THREE.SkinnedMesh[], onSelect: (name: Garment) => void) {
  const originals = new Map<Garment, Look[]>(), custom = new Map<Garment, Custom>();
  let target: Garment = 'shirt', request = 0, disposed = false;
  const panel = document.createElement('details');
  panel.dataset.role = 'sarahlab-textures';
  panel.style.cssText = 'border-top:1px solid #ffffff25;padding-top:8px;touch-action:pan-y';
  const summary = document.createElement('summary');
  summary.textContent = 'TEXTURE · custom image';
  summary.style.cssText = 'cursor:pointer;padding:8px 0;font-size:12px';
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:6px 0';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Texture garment');
  select.dataset.field = 'texture-garment';
  for (const name of GARMENTS) select.add(new Option(name, name));
  select.style.cssText = 'min-height:36px;font:12px system-ui';
  const upload = document.createElement('input');
  upload.type = 'file'; upload.accept = 'image/*'; upload.dataset.field = 'texture-upload';
  upload.setAttribute('aria-label', 'Upload garment texture');
  upload.style.cssText = 'max-width:100%;font:12px system-ui';
  const mode = document.createElement('select');
  mode.setAttribute('aria-label', 'Texture fitting'); mode.dataset.field = 'texture-mode';
  for (const [value,label] of [['auto','Auto · keep image proportions'],['wrap','Wrap image once'],['tile','Tile · repeating fabric']]) mode.add(new Option(label,value));
  mode.style.cssText = 'min-height:36px;font:12px system-ui';
  const label = document.createElement('label');
  label.textContent = 'Scale · 1.0×'; label.style.fontSize = '12px';
  const scale = document.createElement('input');
  scale.type = 'range'; scale.min = '.25'; scale.max = '12'; scale.step = '.25'; scale.value = '1';
  scale.dataset.field = 'texture-scale'; scale.setAttribute('aria-label','Texture repeat scale');
  scale.style.cssText = 'width:100%;accent-color:#d4a853';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap';
  const button = (title: string, action: string, click: () => void) => {
    const b = document.createElement('button'); b.textContent = title; b.dataset.action = action;
    b.style.cssText = 'min-height:40px;padding:8px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui';
    b.onclick = click; row.append(b); return b;
  };
  const status = document.createElement('div'); status.dataset.field = 'texture-status';
  status.style.cssText = 'font-size:11px;line-height:1.4;overflow-wrap:anywhere'; status.setAttribute('aria-live','polite');
  function looks(name: Garment) {
    if (!originals.has(name)) {
      const found: Look[] = [];
      for (const mesh of meshes()) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m.name === name && m instanceof THREE.MeshStandardMaterial && !found.some(l => l.material === m)) {
          found.push({ material: m, map: m.map, color: m.color.clone() });
          // Continuous cylindrical UVs bypass the upper/lower artwork atlas.
          const p = mesh.geometry.getAttribute('position'), uv = new Float32Array(p.count * 2);
          let low = Infinity, high = -Infinity;
          for (let i=0;i<p.count;i++) { low=Math.min(low,p.getY(i)); high=Math.max(high,p.getY(i)); }
          for (let i=0;i<p.count;i++) { uv[i*2]=.5+Math.atan2(p.getX(i),p.getZ(i))/(2*Math.PI); uv[i*2+1]=(p.getY(i)-low)/(high-low || 1); }
          mesh.geometry.setAttribute('uv2',new THREE.BufferAttribute(uv,2));
        }
      }
      if (found.length) originals.set(name,found);
      return found;
    }
    return originals.get(name)!;
  }
  function update() {
    const c = custom.get(target);
    if (c) {
      const y = c.mode === 'wrap' ? c.scale : c.scale * c.aspect * .5;
      c.texture.repeat.set(c.mirrorX ? -c.scale : c.scale, c.mirrorY ? -y : y);
      c.texture.center.set(.5,.5); c.texture.offset.set(0,0); c.texture.rotation=c.angle;
      for (const l of looks(target)) { l.material.map=c.texture; l.material.color.set(0xffffff); l.material.needsUpdate=true; }
    }
    mode.value=c?.mode ?? 'auto'; scale.value=String(c?.scale ?? 1);
    label.textContent=`Scale · ${(c?.scale ?? 1).toFixed(2)}×`;
    mx.setAttribute('aria-pressed',String(c?.mirrorX ?? false)); my.setAttribute('aria-pressed',String(c?.mirrorY ?? false));
    mx.style.background=c?.mirrorX ? '#806020' : '#151b23'; my.style.background=c?.mirrorY ? '#806020' : '#151b23';
    status.textContent=c ? `${c.name} · ${target}` : `Original ${target} material. Images stay in this lab session.`;
  }
  const mx=button('MIRROR X','sarahlab:texture-mirror-x',()=>{const c=custom.get(target);if(c)c.mirrorX=!c.mirrorX;update();});
  const my=button('MIRROR Y','sarahlab:texture-mirror-y',()=>{const c=custom.get(target);if(c)c.mirrorY=!c.mirrorY;update();});
  button('ROTATE 90°','sarahlab:texture-rotate',()=>{const c=custom.get(target);if(c)c.angle=(c.angle+Math.PI/2)%(Math.PI*2);update();});
  button('RESET','sarahlab:texture-reset',()=>{
    request++;
    for (const l of looks(target)) { l.material.map=l.map; l.material.color.copy(l.color); l.material.needsUpdate=true; }
    custom.get(target)?.texture.dispose(); custom.delete(target); upload.value=''; update();
  });
  select.onchange=()=>{request++;target=select.value as Garment;upload.value='';onSelect(target);update();};
  mode.onchange=()=>{const c=custom.get(target);if(c){c.mode=mode.value;if(c.mode==='tile' && c.scale===1)c.scale=4;}update();};
  scale.oninput=()=>{const c=custom.get(target);if(c)c.scale=Number(scale.value);update();};
  upload.onchange=async()=>{
    const file=upload.files?.[0]; if(!file)return;
    const id=++request,name=target,url=URL.createObjectURL(file);
    status.textContent='Loading image…';
    try {
      const image=new Image(); image.src=url; await image.decode();
      if(disposed || id!==request)return;
      if (!looks(name).length) throw new Error('Wait for the model to load, then try again.');
      const factor=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image preview is unavailable.');ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.channel=2;
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
      custom.get(name)?.texture.dispose();custom.set(name,{texture,name:file.name,aspect:canvas.width/canvas.height,scale:1,mirrorX:false,mirrorY:false,angle:0,mode:'auto'});update();
    } catch (error) {
      if(!disposed && id===request)status.textContent=error instanceof Error && error.message.startsWith('Wait') ? error.message : 'Could not read this image. Try a PNG, JPEG or WebP.';
    } finally {URL.revokeObjectURL(url);upload.value='';}
  };
  for (const event of ['pointerdown','pointermove','pointerup','wheel']) panel.addEventListener(event,e=>e.stopPropagation());
  content.append(select,upload,mode,label,scale,row,status);panel.append(summary,content);update();
  return {element:panel,dispose(){disposed=true;request++;for(const [name,items]of originals){for(const l of items){l.material.map=l.map;l.material.color.copy(l.color);}custom.get(name)?.texture.dispose();}custom.clear();}};
}
