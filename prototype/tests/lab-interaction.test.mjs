import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {visibleForInteraction} from '../app/game/three/lab-interaction.ts';
test('hidden characters and hidden markers cannot intercept a floor tap',()=>{
 const actor=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(1,1,1));actor.add(mesh);
 actor.visible=false;assert.equal(visibleForInteraction(mesh),false);
 actor.visible=true;assert.equal(visibleForInteraction(mesh),true);
 mesh.visible=false;assert.equal(visibleForInteraction(mesh),false);
});
