import * as THREE from 'three';
import { PlayerAnt } from '../ant/PlayerAnt';
import { FollowCamera } from '../camera/FollowCamera';
import { DirectControl } from '../input/DirectControl';
import { bandFor, DEFAULT_ISLAND, groundHeight, type Band } from '../world/heightfield';

/**
 * The island lab — TRADDOMIUM's first development scene.
 *
 * One small island surrounded by water, seen from ant height. This is
 * the integration gate for rebuild steps 01 (movement) and 02
 * (input + camera): a directly-controlled ant walking a real terrain
 * with a chase camera, on desktop and mobile landscape.
 */

const BAND_COLORS: Record<Band, THREE.Color> = {
  seabed: new THREE.Color(0x54473a),
  sand: new THREE.Color(0xd9c489),
  grass: new THREE.Color(0x6e9445),
  forest: new THREE.Color(0x41682f),
  rock: new THREE.Color(0x8b8578),
};

const SKY_COLOR = 0x9cc8e8;

export class IslandScene {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly follow: FollowCamera;
  private readonly control: DirectControl;
  private readonly ant = new PlayerAnt();
  private readonly clock = new THREE.Clock();
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 45, 160);

    this.buildLights();
    this.buildTerrain();
    this.buildWater();

    this.ant.placeAt(0, DEFAULT_ISLAND.radius * 0.45);
    this.scene.add(this.ant.root);

    this.control = new DirectControl(host);
    this.follow = new FollowCamera(this.aspect());
    this.follow.snapTo(this.ant.root);

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.control.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Clamp dt so a backgrounded tab does not teleport the ant on return.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const cameraYaw = Math.atan2(
      this.follow.camera.position.x - this.ant.root.position.x,
      this.follow.camera.position.z - this.ant.root.position.z,
    );
    this.ant.update(this.control.read(), cameraYaw, dt);
    this.follow.update(this.ant.root, dt);
    this.renderer.render(this.scene, this.follow.camera);
  };

  private readonly onResize = (): void => {
    const { clientWidth, clientHeight } = this.host;
    this.renderer.setSize(clientWidth, clientHeight);
    this.follow.resize(this.aspect());
  };

  private aspect(): number {
    return this.host.clientWidth / Math.max(1, this.host.clientHeight);
  }

  private buildLights(): void {
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(30, 50, 20);
    const sky = new THREE.HemisphereLight(SKY_COLOR, 0x5a4a38, 0.9);
    this.scene.add(sun, sky);
  }

  /**
   * Island mesh: a plane grid displaced by the heightfield and painted
   * per-vertex from the elevation bands. The grid extends past the rim
   * so the seabed slides under the water instead of ending in a cliff.
   */
  private buildTerrain(): void {
    const span = DEFAULT_ISLAND.radius * 3;
    const segments = 180;
    const geometry = new THREE.PlaneGeometry(span, span, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const h = groundHeight(x, z);
      positions.setY(i, h);
      const color = BAND_COLORS[bandFor(h)];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.scene.add(new THREE.Mesh(geometry, material));
  }

  private buildWater(): void {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(DEFAULT_ISLAND.radius * 6, 48),
      new THREE.MeshStandardMaterial({
        color: 0x2a6a8f,
        transparent: true,
        opacity: 0.86,
        roughness: 0.25,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    this.scene.add(water);
  }
}
