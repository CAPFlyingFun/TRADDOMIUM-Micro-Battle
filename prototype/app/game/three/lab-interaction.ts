import type {Object3D} from 'three';
/** Three's raycaster can intersect invisible descendants. Ignore their hits. */
export function visibleForInteraction(object:Object3D){
 let node:Object3D|null=object;
 while(node){if(!node.visible)return false;node=node.parent;}
 return true;
}
