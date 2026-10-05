import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {loadAssetBatch, formatLoadingProgress} from '../lib/load-assets.ts';
import {cachedAsset, clearAssetCache} from '../lib/asset-cache.ts';

afterEach(clearAssetCache);
test('size display uses decimal MB and one decimal percent', () => {
  assert.equal(formatLoadingProgress({loaded:4_000_000,total:16_000_000}), '4.0MB/16.0MB (25.0%)');
  assert.equal(formatLoadingProgress({loaded:16_000_000,total:16_000_000}), '16.0MB/16.0MB (100.0%)');
});
test('streamed bytes update progress and playback reuses the downloaded Blob', async () => {
  const reports = [], signal = new AbortController().signal;
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1,2]));
        queueMicrotask(() => {controller.enqueue(new Uint8Array([3,4,5])); controller.close();});
      },
    }), {headers:{'Content-Type':'audio/mpeg'}});
  };
  const assets = [{path:'/audio/test.mp3',bytes:5}];
  await loadAssetBatch(assets, p => reports.push(p), signal, fetcher);
  assert.deepEqual(reports.map(p=>p.loaded), [0,2,5]);
  assert.equal(cachedAsset(assets[0].path).bytes, 5);
  assert.equal((await fetch(cachedAsset(assets[0].path).url)).headers.get('Content-Type'), 'audio/mpeg');
  await loadAssetBatch(assets, ()=>{}, signal, fetcher);
  assert.equal(requests, 1);
});
test('incomplete responses fail visibly and do not cache an incomplete asset', async () => {
  await assert.rejects(loadAssetBatch([{path:'/short.glb',bytes:5}],()=>{},new AbortController().signal,async()=>new Response(new Uint8Array([1,2]))), /Incomplete asset/);
  assert.equal(cachedAsset('/short.glb'), undefined);
});
test('HTTP errors are not turned into a successful load', async () => {
  await assert.rejects(loadAssetBatch([{path:'/missing.glb',bytes:5}],()=>{},new AbortController().signal,async()=>new Response('',{status:404})), /HTTP 404/);
  assert.equal(cachedAsset('/missing.glb'), undefined);
});
test('leaving during loading cancels the batch without starting a transfer', async () => {
  const controller = new AbortController();controller.abort();
  let requests=0;
  await assert.rejects(loadAssetBatch([{path:'/cancel.glb',bytes:5}],()=>{},controller.signal,async()=>{requests++;return new Response('12345');}), {name:'AbortError'});
  assert.equal(requests,0);
});