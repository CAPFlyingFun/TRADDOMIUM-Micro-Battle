import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterOneShot} from '../app/game/three/lab-direction.ts';
test('canonical opening, arrival and final exchange select their intended shots',()=>{
 assert.equal(chapterOneShot(2).view,'room');
 assert.equal(chapterOneShot(4).view,'room');
 assert.equal(chapterOneShot(27).view,'webcam');
 assert.equal(chapterOneShot(6).view,'firstperson');
 assert.equal(chapterOneShot(8).view,'terminal');
 assert.equal(chapterOneShot(54).view,'room');
 assert.equal(chapterOneShot(59).view,'conversation');
 assert.equal(chapterOneShot(65).view,'terminal');
 assert.equal(chapterOneShot(103).view,'conversation');
 assert.equal(chapterOneShot(150).view,'terminal');
 assert.equal(chapterOneShot(180).view,'conversation');
 for(let index=2;index<182;index++)assert.ok(chapterOneShot(index).title);
});
