import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pwaRevision} from '../scripts/pwa-revision.mjs';
test('an asset-only model or audio change rotates the PWA cache even with an unchanged shell',()=>{
 const root=mkdtempSync(join(tmpdir(),'tmb-pwa-'));try{
  mkdirSync(join(root,'models'));writeFileSync(join(root,'index.html'),'unchanged');writeFileSync(join(root,'models','sarah.glb'),'version A');
  const first=pwaRevision(root);writeFileSync(join(root,'models','sarah.glb'),'version B');assert.notEqual(pwaRevision(root),first);
  const second=pwaRevision(root);writeFileSync(join(root,'sw.js'),'generated');writeFileSync(join(root,'version.json'),'generated');assert.equal(pwaRevision(root),second);
 }finally{rmSync(root,{recursive:true,force:true});}
});
