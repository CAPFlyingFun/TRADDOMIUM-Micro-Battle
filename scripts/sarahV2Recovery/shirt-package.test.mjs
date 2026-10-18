import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { packageGlbBytes, packageShirtGlb } from './shirt-package.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function glb(json, binary) {
 const text = Buffer.from(JSON.stringify(json));
 const jsonBytes = Math.ceil(text.length / 4) * 4, binBytes = Math.ceil(binary.length / 4) * 4;
 const out = Buffer.alloc(28 + jsonBytes + binBytes);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
 out.writeUInt32LE(jsonBytes,12);out.writeUInt32LE(0x4e4f534a,16);out.fill(32,20,20+jsonBytes);text.copy(out,20);
 out.writeUInt32LE(binBytes,20+jsonBytes);out.writeUInt32LE(0x004e4942,24+jsonBytes);Buffer.from(binary).copy(out,28+jsonBytes);return out;
}

test('packs physical raw and meshopt ranges, preserving the virtual fallback buffer',()=>{
 const fallback={byteLength:1000,extensions:{EXT_meshopt_compression:{fallback:true}}};
 const source={asset:{version:'2.0'},buffers:[{byteLength:32},fallback],bufferViews:[{buffer:0,byteOffset:4,byteLength:5},{buffer:1,byteOffset:96,byteLength:48,byteStride:12,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:16,byteLength:7,byteStride:12,count:4,mode:'ATTRIBUTES'}}}]};
 const bytes=Uint8Array.from({length:32},(_,i)=>i),packed=packageGlbBytes(glb(source,bytes),{maxChunkBytes:8});
 assert.deepEqual(packed.json.buffers[0],fallback);assert.equal(packed.parts.length,2);
 assert.ok(packed.parts.every(part=>part.bytes.length<=8&&part.name===`${hash(part.bytes)}.bin`));
 const raw=packed.json.bufferViews[0],compressed=packed.json.bufferViews[1],ext=compressed.extensions.EXT_meshopt_compression;
 const part=index=>packed.parts.find(p=>packed.json.buffers[index].uri.endsWith(p.name));
 assert.deepEqual(Array.from(part(raw.buffer).bytes.subarray(raw.byteOffset,raw.byteOffset+raw.byteLength)),[4,5,6,7,8]);
 assert.deepEqual(Array.from(part(ext.buffer).bytes.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength)),[16,17,18,19,20,21,22]);
 assert.equal(compressed.buffer,0);assert.equal(compressed.byteOffset,96);assert.equal(compressed.byteLength,48);
 assert.equal(ext.count,4);assert.equal(ext.mode,'ATTRIBUTES');
 assert.equal(source.bufferViews[0].buffer,0);assert.equal(source.bufferViews[1].buffer,1);
});

test('refuses to split a bufferView that exceeds the upload limit',()=>{
 assert.throws(()=>packageGlbBytes(glb({asset:{version:'2.0'},buffers:[{byteLength:12}],bufferViews:[{buffer:0,byteLength:12}]},new Uint8Array(12)),{maxChunkBytes:8}),/exceeds/);
});

test('round trips every accessor and texture exactly through external parts and reuses content hashes',async()=>{
 await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
 const doc=new Document(),buffer=doc.createBuffer(),acc=(type,array)=>doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
 const texture=doc.createTexture('raw-png').setMimeType('image/png').setImage(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hioAAAAASUVORK5CYII=','base64')));
 const primitive=doc.createPrimitive().setMaterial(doc.createMaterial().setBaseColorTexture(texture)).setIndices(acc('SCALAR',new Uint16Array([0,1,2]))).setAttribute('POSITION',acc('VEC3',new Float32Array([.123456789,0,0, 1,0,0, 0,1,0]))).setAttribute('NORMAL',acc('VEC3',new Float32Array([0,0,1,0,0,1,0,0,1]))).setAttribute('TEXCOORD_0',acc('VEC2',new Float32Array([0,0,1,0,0,1]))).setAttribute('JOINTS_0',acc('VEC4',new Uint16Array(12))).setAttribute('WEIGHTS_0',acc('VEC4',new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0])));
 primitive.addTarget(doc.createPrimitiveTarget('native').setAttribute('POSITION',acc('VEC3',new Float32Array([.000001,.2,0,0,0,0,0,0,0]))).setAttribute('NORMAL',acc('VEC3',new Float32Array([0,.000003,0,0,0,0,0,0,0]))));
 const bone=doc.createNode('bone'),skin=doc.createSkin().addJoint(bone).setInverseBindMatrices(acc('MAT4',new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])));
 doc.createScene().addChild(bone).addChild(doc.createNode().setSkin(skin).setMesh(doc.createMesh().setExtras({targetNames:['native']}).addPrimitive(primitive)));
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 const directory=await mkdtemp(path.join(tmpdir(),'shirt-package-'));
 try{
  const inputPath=path.join(directory,'strict.glb'),outPath=path.join(directory,'shirt.gltf'),partsDirectory=path.join(directory,'sarah-v2-cloth-parts');await io.write(inputPath,doc);
  const sourceHash=hash(await readFile(inputPath));
  const report=await packageShirtGlb({inputPath,outPath,partsDirectory,maxChunkBytes:8192});
  assert.equal(report.verified,true);assert.equal(report.accessors.count,9);assert.equal(report.textures.count,1);assert.equal(report.accessors.sourceSha256,report.accessors.packagedSha256);assert.ok(report.maxPartBytes<=8192);
  assert.equal(hash(await readFile(inputPath)),sourceHash);
  const names=await readdir(partsDirectory);await packageShirtGlb({inputPath,outPath:path.join(directory,'shirt-copy.gltf'),partsDirectory,maxChunkBytes:8192});assert.deepEqual(await readdir(partsDirectory),names);
  const json=JSON.parse(await readFile(outPath,'utf8'));assert.equal(json.buffers[0].extensions.EXT_meshopt_compression.fallback,true);assert.ok(json.buffers.slice(1).every(b=>b.uri.startsWith('sarah-v2-cloth-parts/')));
  for(const name of names)assert.equal(hash(await readFile(path.join(partsDirectory,name))),name.slice(0,-4));
  const roundtrip=await io.read(outPath);assert.deepEqual(roundtrip.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray(),primitive.getAttribute('POSITION').getArray());
 }finally{await rm(directory,{recursive:true,force:true});}
});
