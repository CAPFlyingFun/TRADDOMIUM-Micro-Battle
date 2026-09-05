/**
 * A capsule on screen: THE place an ActorState meets a mesh.
 *
 * `actor/` says where she is in world coordinates and knows nothing of
 * render space (ARCHITECTURE §3: actor → NEVER view). This class reads
 * that state and writes a three.js group, and the conversion from
 * WorldPoint to LocalPoint happens in exactly one line of `update`,
 * through `origin.toLocal` — no coordinate reaches three raw, and no
 * `.wx` is ever read here. Because the local position is recomputed
 * from the world position every frame, a floating-origin rebase needs
 * no special handling: the next `update` simply lands her where the
 * shifted origin says.
 *
 * Three parts: the capsule body in the actor's colour; a nose cone at
 * local +Z so the heading is visible (rotating the group about Y by
 * `heading` sends +Z to (sin h, 0, cos h), which is exactly the
 * direction `Transform.step` walks — the mesh and the maths share the
 * convention rather than one correcting for the other); and the name
 * label above. Lambert with a little emissive rather than a physically
 * based material: the Performance World has one directional light and
 * no ambient, and an unlit side that went black would hide the one
 * thing the colour is for.
 */
import * as THREE from 'three';
import type { ActorId } from '../actor/ActorId';
import type { ActorState } from '../actor/ActorState';
import { toLocal } from '../world/origin';
import { DEBUG_CAPSULE_LOOK, markerColorFor, type CapsuleLook } from './CapsuleLook';
import { NameLabel } from './NameLabel';

/** Enough facets to read as round at this size; more costs a phone and buys nothing. */
const CAP_SEGMENTS = 6;
const RADIAL_SEGMENTS = 16;
const MARKER_SEGMENTS = 12;
/** So the shadowed side is still clearly the actor's colour. */
const EMISSIVE = 0.3;

export class CapsuleView {
  readonly id: ActorId;
  /** Add this to the scene; everything the view draws hangs off it. */
  readonly object: THREE.Group;
  private readonly body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshLambertMaterial>;
  private readonly marker: THREE.Mesh<THREE.ConeGeometry, THREE.MeshLambertMaterial>;
  private readonly label: NameLabel;
  private color: string;

  constructor(state: ActorState, look: CapsuleLook = DEBUG_CAPSULE_LOOK) {
    this.id = state.id;
    this.color = state.color;
    this.object = new THREE.Group();
    this.object.name = `capsule:${state.id}`;

    // The group's origin is her feet; the body is lifted so it stands on the plane.
    const bodyCentre = look.radius + look.length / 2;
    this.body = new THREE.Mesh(
      new THREE.CapsuleGeometry(look.radius, look.length, CAP_SEGMENTS, RADIAL_SEGMENTS),
      new THREE.MeshLambertMaterial({ color: state.color, emissive: state.color, emissiveIntensity: EMISSIVE }),
    );
    this.body.position.set(0, bodyCentre, 0);
    this.object.add(this.body);

    // A cone points +Y as built; a quarter turn about X aims it down +Z, her nose.
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(look.radius * 0.45, look.markerLength, MARKER_SEGMENTS),
      new THREE.MeshLambertMaterial({ color: markerColorFor(state.color) }),
    );
    this.marker.rotation.x = Math.PI / 2;
    this.marker.position.set(0, bodyCentre, look.radius + look.markerLength / 2 - 1);
    this.object.add(this.marker);

    this.label = new NameLabel(state.name, state.color);
    this.label.sprite.scale.set(look.labelWidth, look.labelHeight, 1);
    this.label.sprite.position.set(0, look.radius * 2 + look.length + look.labelGap + look.labelHeight / 2, 0);
    this.object.add(this.label.sprite);

    this.update(state);
  }

  /**
   * Every frame, with the state as the authority holds it.
   *
   * `ground` is how high the terrain is under this actor, in render
   * units, and `state.height` is measured FROM it. The authority cannot
   * know about terrain — it is a relay running a pure `Host` with no DEM —
   * so an actor's height has to mean height above whatever it is standing
   * on, and the ground is added here, at the render boundary, where the
   * terrain is known. On flat ground (the empty world, and every build
   * before terrain existed) it is 0 and this is exactly what it was.
   */
  update(state: ActorState, ground = 0): void {
    // THE RENDER BOUNDARY: the only WorldPoint → LocalPoint conversion in the view.
    const at = toLocal(state.at);
    this.object.position.set(at.lx, ground + state.height, at.lz);
    this.object.rotation.y = state.heading;

    if (state.color !== this.color) {
      this.color = state.color;
      this.body.material.color.set(state.color);
      this.body.material.emissive.set(state.color);
      this.marker.material.color.set(markerColorFor(state.color));
    }
    this.label.paint(state.name, state.color);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.body.geometry.dispose();
    this.body.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.label.dispose();
  }
}
