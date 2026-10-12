import { describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
// Bake modules are JavaScript, also used by the command-line rebuild.
// @ts-ignore
import { recoverSarahBody, fairSarahChest, softenSarahChestRelief } from '../scripts/rebakeSarah.mjs';
// @ts-ignore
import { growClothes, GARMENTS } from '../scripts/growClothes.mjs';

// @ts-ignore
import { fitClothToSkin } from '../scripts/fitClothToSkin.mjs';

// @ts-ignore
import { shirtFrontDepthGuide } from '../scripts/refineEarlyShirt.mjs';

it('interpolates sparse front rows without pulling the shirt toward back-panel samples', () => {
  const guide = shirtFrontDepthGuide(new Float32Array([
    0, .912, .10,
    0, .928, -.18, // this row contains back cloth only
    0, .944, .12,
    .20, .928, .30, // the side is not the centre profile
  ]));
  expect(guide(.928)).toBeCloseTo(.11, 6);
  expect(guide(.924)).toBeCloseTo(.1075, 6);
  expect(guide(.932)).toBeCloseTo(.1125, 6);
});

async function load() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read('public/models/sarah-base.glb');
}

describe('Sarah clothing rebuild', () => {
  it('updates fabric lighting to match the fitted triangle', () => {
    const doc=new Document(), buffer=doc.createBuffer();
    const attr=(v:number[])=>doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(v));
    const ids=()=>doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array([0,1,2]));
    const body=doc.createPrimitive().setMaterial(doc.createMaterial('Material_0'))
      .setAttribute('POSITION',attr([-1,-1,0,1,-1,0,0,1,0]))
      .setAttribute('NORMAL',attr([0,0,1,0,0,1,0,0,1])).setIndices(ids());
    const shirt=doc.createPrimitive().setMaterial(doc.createMaterial('shirt'))
      .setAttribute('POSITION',attr([0,0,-.004,.1,0,.002,0,.1,.05]))
      .setAttribute('NORMAL',attr([0,0,1,0,0,1,0,0,1])).setIndices(ids());
    doc.createMesh().addPrimitive(body).addPrimitive(shirt);
    fitClothToSkin(doc);
    const p=shirt.getAttribute('POSITION')!.getArray()!, n=shirt.getAttribute('NORMAL')!.getArray()!;
    const a=new Vector3().fromArray(p,0), b=new Vector3().fromArray(p,3), c=new Vector3().fromArray(p,6);
    const expected=b.sub(a).cross(c.sub(a)).normalize();
    expect(new Vector3().fromArray(n,0).dot(expected)).toBeGreaterThan(.9999);
  });

  it('fits inward fabric outside retained skin without flattening a distant drape', () => {
    const doc = new Document(), buffer = doc.createBuffer();
    const attr = (values: number[]) => doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(values));
    const skin = doc.createPrimitive().setMaterial(doc.createMaterial('Material_0'))
      .setAttribute('POSITION', attr([-1,-1,0,1,-1,0,0,1,0]))
      .setAttribute('NORMAL', attr([0,0,1,0,0,1,0,0,1]))
      .setIndices(doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array([0,1,2])));
    const fabric = doc.createPrimitive().setMaterial(doc.createMaterial('shirt'))
      .setAttribute('POSITION', attr([0,0,-.004,.1,0,.002,0,.1,.05]));
    doc.createMesh().addPrimitive(skin).addPrimitive(fabric);
    fitClothToSkin(doc);
    const positions = fabric.getAttribute('POSITION')!.getArray()!;
    expect(positions[2]).toBeCloseTo(.006,6);
    expect(positions[5]).toBeCloseTo(.006,6);
    expect(positions[8]).toBeCloseTo(.05,6);
  });

  it('smooths per-vertex skin weights across the shirt surface', () => {
    const doc = new Document(), buffer = doc.createBuffer();
    const attr = (type: 'VEC3' | 'VEC4', values: number[], integer = false) => {
      const accessor = doc.createAccessor().setBuffer(buffer).setType(type).setArray(integer ? new Uint16Array(values) : new Float32Array(values));
      return accessor;
    };
    const indices = (values: number[]) => doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array(values));
    const body = doc.createPrimitive().setMaterial(doc.createMaterial('Material_0'))
      .setAttribute('POSITION', attr('VEC3',[-1,-1,0,1,-1,0,-1,1,0,1,1,0]))
      .setAttribute('NORMAL', attr('VEC3',[0,0,1,0,0,1,0,0,1,0,0,1]))
      .setAttribute('JOINTS_0', attr('VEC4',[0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0],true))
      .setAttribute('WEIGHTS_0', attr('VEC4',[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]))
      .setIndices(indices([0,1,2,1,3,2]));
    const shirt = doc.createPrimitive().setMaterial(doc.createMaterial('shirt'))
      .setAttribute('POSITION', attr('VEC3',[-1,-1,-.002,1,-1,-.002,-1,1,-.002,1,1,-.002]))
      .setAttribute('JOINTS_0', attr('VEC4',[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],true))
      .setAttribute('WEIGHTS_0', attr('VEC4',[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]))
      .setIndices(indices([0,1,2,1,3,2]));
    doc.createMesh().addPrimitive(body).addPrimitive(shirt);
    fitClothToSkin(doc,{sliderSamples:[{percent:100,weights:{}}]});
    const weights = shirt.getAttribute('WEIGHTS_0')!.getArray()!;
    expect(weights[0]).toBeGreaterThan(0.1);
    expect(weights[8]).toBeGreaterThan(0.1);
    expect(Math.abs(weights[0]-weights[8])).toBeLessThan(.5);
    for(let i=0;i<4;i++)expect(weights[i*4]+weights[i*4+1]+weights[i*4+2]+weights[i*4+3]).toBeCloseTo(1,6);
  });

  it('softens drawn chest creases only inside the UV mask and only once', async () => {
    const doc = new Document(), buffer = doc.createBuffer();
    const attr = (type: 'VEC3' | 'VEC2', values: number[]) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(new Float32Array(values));
    const colour = Buffer.alloc(16*16*3, 200), crease = (6*16+6)*3;
    colour.fill(50, crease, crease+3);
    const normal = Buffer.alloc(16*16*3);
    for(let i=0;i<256;i++) normal.set([128,128,255],i*3);
    const png = (data: Buffer) => sharp(data,{raw:{width:16,height:16,channels:3}}).png().toBuffer();
    const texture = doc.createTexture().setImage(await png(colour));
    const material = doc.createMaterial().setBaseColorTexture(texture)
      .setNormalTexture(doc.createTexture().setImage(await png(normal)));
    const body = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION',attr('VEC3',[-.02,1.2,.04,.02,1.2,.04,0,1.25,.04]))
      .setAttribute('TEXCOORD_0',attr('VEC2',[.25,.25,.75,.25,.25,.75]))
      .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array([0,1,2])));
    await softenSarahChestRelief(body);
    const out = await sharp(texture.getImage()!).raw().toBuffer();
    expect(out[crease]).toBeGreaterThan(100);
    expect(Array.from(out.subarray(0,3))).toEqual([200,200,200]);
    const saved = new Uint8Array(texture.getImage()!);
    await softenSarahChestRelief(body);
    expect(new Uint8Array(texture.getImage()!)).toEqual(saved);
  });
  it('fairs the chest junction once and pins the outer rounded bust', async () => {
    const doc = await load(), body = await recoverSarahBody(doc);
    body.setExtras({ ...body.getExtras(), chestFairing: 0 });
    const before = new Float32Array(body.getAttribute('POSITION')!.getArray());
    fairSarahChest(body);
    const after = new Float32Array(body.getAttribute('POSITION')!.getArray());
    let caps = 0;
    for (let i = 0; i < before.length / 3; i++) {
      if (Math.abs(before[i*3]) > .085 && before[i*3+1] > 1.23 && before[i*3+1] < 1.28 && before[i*3+2] > .07) {
        expect(Array.from(after.slice(i*3,i*3+3))).toEqual(Array.from(before.slice(i*3,i*3+3))); caps++;
      }
    }
    expect(caps).toBeGreaterThan(20);
    fairSarahChest(body);
    expect(body.getAttribute('POSITION')!.getArray()).toEqual(after);
  });
  it('recovers metre measurements without moving skin or changing repaired weights', async () => {
    const doc = await load(), skin = doc.getRoot().listSkins()[0];
    const body = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0')!;
    const oldP = body.getAttribute('POSITION')!, oldW = body.getAttribute('WEIGHTS_0')!, oldJ = body.getAttribute('JOINTS_0')!;
    const v: number[] = [], w: number[] = [], j: number[] = [], ibm: number[] = [];
    const sample = Array.from({ length: 40 }, (_, i) => Math.floor(i * oldP.getCount() / 40));
    const before = sample.map((i) => {
      oldP.getElement(i, v); oldW.getElement(i, w); oldJ.getElement(i, j);
      const p = new Vector3(), q = new Vector3();
      for (let k = 0; k < 4; k += 1) {
        skin.getInverseBindMatrices()!.getElement(j[k], ibm);
        const m = new Matrix4().fromArray(skin.listJoints()[j[k]].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
        q.fromArray(v).applyMatrix4(m).multiplyScalar(w[k]); p.add(q);
      }
      return { p, w: [...w], j: [...j] };
    });
    await recoverSarahBody(doc);
    const P = body.getAttribute('POSITION')!, W = body.getAttribute('WEIGHTS_0')!, J = body.getAttribute('JOINTS_0')!;
    sample.forEach((i, at) => {
      P.getElement(i, v); W.getElement(i, w); J.getElement(i, j);
      expect(new Vector3().fromArray(v).distanceTo(before[at].p)).toBeLessThan(0.0002);
      w.forEach((value, k) => expect(value).toBeCloseTo(before[at].w[k], 7));
      expect(j).toEqual(before[at].j);
    });
    expect(body.listTargets()).toHaveLength(0);
    expect(doc.getRoot().listMeshes()[0].listPrimitives()).toHaveLength(1);
  });

  it('the bralette spans the hollow between the cups rather than following skin into it', async () => {
    const doc = await load();
    await recoverSarahBody(doc);
    const plain = cloneDocument(doc);
    const saved = GARMENTS.bikini.bridge;
    try {
      GARMENTS.bikini.bridge = 0;
      await growClothes(plain, { which: ['bikini'], paint: false });
    } finally { GARMENTS.bikini.bridge = saved; }
    await growClothes(doc, { which: ['bikini'], paint: false });
    const garment = (d: typeof doc) => d.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini')!.getAttribute('POSITION')!;
    const P = garment(doc), Q = garment(plain), v: number[] = [], q: number[] = [];
    expect(P.getCount()).toBe(Q.getCount());
    let forward = 0;
    for (let i = 0; i < P.getCount(); i += 1) {
      P.getElement(i, v); Q.getElement(i, q);
      if (Math.abs(v[0]) < 0.04 && v[1] > 1.15) forward = Math.max(forward, v[2] - q[2]);
    }
    expect(forward).toBeGreaterThan(0.002);
  }, 60000);
  it('keeps the rounded bust contour when bridging the tee and opens a lower U neckline', async () => {
    const doc = await load(); await recoverSarahBody(doc);
    const plain = cloneDocument(doc), saved = GARMENTS.shirt.bridge;
    try {
      GARMENTS.shirt.bridge = 0;
      await growClothes(plain, { which: ['shirt'], paint: false });
    } finally { GARMENTS.shirt.bridge = saved; }
    await growClothes(doc, { which: ['shirt'], paint: false });
    const garment = (d: typeof doc) => d.getRoot().listMeshes()[0].listPrimitives()
      .find((p) => p.getMaterial()?.getName() === 'shirt')!.getAttribute('POSITION')!;
    const P = garment(doc), Q = garment(plain), v: number[] = [], q: number[] = [];
    const skin = doc.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial()?.getName() === 'Material_0')!;
    const skinP = skin.getAttribute('POSITION')!.getArray()!, skinI = skin.getIndices()!.getArray()!;
    const rearDepth = (x: number, y: number) => {
      let depth = Infinity;
      for(let f=0;f<skinI.length;f+=3) {
        const a=skinI[f]*3,b=skinI[f+1]*3,c=skinI[f+2]*3;
        const den=(skinP[b+1]-skinP[c+1])*(skinP[a]-skinP[c])+(skinP[c]-skinP[b])*(skinP[a+1]-skinP[c+1]);
        if(Math.abs(den)<1e-10)continue;
        const u=((skinP[b+1]-skinP[c+1])*(x-skinP[c])+(skinP[c]-skinP[b])*(y-skinP[c+1]))/den;
        const w=((skinP[c+1]-skinP[a+1])*(x-skinP[c])+(skinP[a]-skinP[c])*(y-skinP[c+1]))/den;
        if(Math.min(u,w,1-u-w)<0)continue;
        depth=Math.min(depth,u*skinP[a+2]+w*skinP[b+2]+(1-u-w)*skinP[c+2]);
      }
      return depth;
    };
    let capMove = 0, centreTop = -Infinity, sideTop = -Infinity, samples = 0, centreLift = 0, rearLift = 0;
    for (let i = 0; i < P.getCount(); i += 1) {
      P.getElement(i, v); Q.getElement(i, q);
      const ax = Math.abs(q[0]);
      if (ax < .035 && q[1] > .72 && q[1] < .92 && q[2] < -.06) rearLift = Math.max(rearLift,q[2]-v[2]);
      if (i%100===0 && ax > .06 && ax < .20 && v[1] > .78 && v[1] < .93 && v[2] < -.06) {
        const depth=rearDepth(v[0],v[1]);
        if(Number.isFinite(depth))expect(v[2]).toBeLessThanOrEqual(depth-.002);
      }
      if (ax < .02 && q[1] > 1.20 && q[1] < 1.27 && q[2] > 0) {
        centreLift = Math.max(centreLift, v[2] - q[2]);
      }
      if (ax > .085 && ax < .13 && q[1] > 1.20 && q[1] < 1.27 && q[2] > .07) {
        capMove = Math.max(capMove, Math.hypot(...v.map((x, k) => x - q[k]))); samples++;
      }
      if (v[1] > 1.2) {
        if (v[2] > .02 && Math.abs(v[0]) < .02) centreTop = Math.max(centreTop, v[1]);
        if (v[2] > -.04 && Math.abs(v[0]) > .10 && Math.abs(v[0]) < .14) sideTop = Math.max(sideTop, v[1]);
      }
    }
    expect(samples).toBeGreaterThan(20);
    expect(capMove).toBeLessThan(.003);
    expect(centreLift).toBeGreaterThan(.025);
    expect(rearLift).toBeGreaterThan(.003);
    expect(sideTop - centreTop).toBeGreaterThan(.05);
  }, 60000);

});
