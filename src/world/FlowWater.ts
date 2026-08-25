import * as THREE from 'three';
import { toLocal } from './origin';
import { reliefScale, smoothingAmount, SMOOTH_PASSES } from './heightfield';
import { reliefUniform } from './terrainMaterial';
import { originAt } from './origin';
import { blurGrid, SAMPLES, type HeightGrid } from './kauai';
import { flowData, halfAt, type Flow } from './flow';
import { SPAN } from './kauai';

/**
 * THE SURFACE OF EVERY STREAM AND POND THE ISLAND MAKES FOR ITSELF.
 *
 * WATER IS A LEVEL FIELD, like the ocean. The bake stores each
 * station's water-surface LEVEL — valley floor plus a real depth,
 * clamped monotonic downstream — and each ponded cell's spill LEVEL.
 * This file draws deliberately over-wide flat slabs AT that level and
 * lets the terrain clip them: the banks rise through the surface, so
 * the water's edge, its curves, and the mid-stream stones all come out
 * of the depth test rather than out of anything drawn here. NOTHING IS
 * CARVED.
 *
 * OVER-WIDE IS MEASURED NOW, NOT GUESSED FROM THE CHANNEL. Version 2
 * sized every slab with slabHalf(width), and WIDTH is the TRUE
 * hydraulic channel — a median of 0.60 m across, which really is how
 * wide the water runs, and which slabHalf() drew as a 5.8 m ribbon. The
 * trouble is that the ground either side of that channel stays BELOW
 * the water surface for a median of about 106 m: the island has broad
 * valley floors and we were painting a thread down the middle of them.
 * Over 598 sampled stations, 92.6% had their wetted reach cut off by
 * the EDGE OF THE SLAB rather than by the terrain, so the water looked
 * narrow because it was drawn narrow, not because Kauai is. Version 3
 * carries a half-width per side per station, walked outward on the real
 * ground until it rises through the level or falls away into somebody
 * else's basin, and this file draws that number. Median drawn width
 * 5.8 m becomes 49.8 m, p95 165 m, max 347 m. The terrain still clips
 * the final shoreline exactly as it always did; it simply gets the
 * chance to.
 *
 * ONE RULE, BOTH SIDES: drawn level = level * reliefScale(); wet iff
 * that beats groundHeight(); depth = the difference. `flow.ts`'s
 * waterLevelAt() answers from the same rows these slabs are built
 * from, so what is wet and what is blue are one thing by construction
 * rather than by two implementations staying in step.
 *
 * NO SPLINE. The bake's stations are one grid cell apart and already
 * follow the steepest descent of the ground they came from; smoothing
 * them would move the water off the valley floor it was derived from,
 * which is the exact fault this whole rebuild exists to remove.
 */

/**
 * How far water is worth drawing — the transition tier's reach.
 *
 * MEASURED, over three releases of blaming the wrong thing. A channel
 * can only read as a channel while the valley holding it is resolved,
 * and past the transition tier it is not: a vertex every 3,125 units
 * cannot show a metre-wide trench, so the slab stretches away at a
 * grazing angle and paints a flat stripe with a dead-straight near
 * edge. The water stops where its channel stops being visible.
 *
 * TWO HUNDRED METRES WAS THE THIN-RIBBON ANSWER AND IT WAS COSTING US
 * THE WORST BUG IN THE WATER. Joshua, from the air: "some spots look
 * like land, but suddenly turn into water when I try to land on it."
 * That is not hydrology and not the level field. The TERRAIN draws to
 * the backdrop tens of kilometres out; the WATER stopped at two hundred
 * metres. Every approach from altitude therefore crossed dry-looking
 * ground that became a river underneath her at the moment she got close
 * enough for it to be drawn. Nothing was in the wrong place — it simply
 * was not there yet.
 *
 * The old limit was honest about a five-metre ribbon: past the
 * transition tier a vertex stands for thirty metres of ground, which
 * cannot clip a metre-wide trench, so the slab stretched away at a
 * grazing angle as a flat stripe with a dead-straight near edge. A
 * fifty-metre body of water is a different object. The tier that could
 * not resolve a ribbon resolves this easily, and the clip that used to
 * fail now works.
 *
 * MEASURED BEFORE MOVING IT, because the reason to stop was never
 * really the artefact — it was the fear of the geometry. Averaged over
 * twelve places she might stand:
 *
 *     200 m       1 reach,     22 stations,      44 vertices
 *     2,000 m   111 reaches, 1,506 stations,  3,012 vertices
 *     4,000 m   406 reaches, 4,524 stations,  9,048 vertices
 *
 * Three thousand vertices is nothing next to the terrain it sits on. So
 * the water now reaches as far as the MIDDLE terrain tier does, which
 * is the furthest distance at which the ground under it is still cut
 * from real heights rather than from the backdrop.
 */
const REACH = 200_000;
const FADE_FROM = 160_000;
/** The slab stops just short of the index claim, for the alpha fade. */
const EDGE = 0.98;

// THE BAKE OWNS THE LEVEL NOW. Version 1 stored the valley floor and
// this file lifted the surface half a channel depth off it (RIDE);
// version 2 stores the water-surface LEVEL itself, so the slab draws
// the file's number verbatim and nothing here invents an elevation.

/**
 * One pond cell's quad, exactly one grid cell wide.
 *
 * IT WAS 1.12 CELLS AND THE OVERLAP DREW ITSELF. Two coplanar
 * transparent quads double-blend where they overlap, so the fused
 * sheet came out with a dark lattice along every cell boundary — a
 * grid of seams across the whole Mana plain, photographed on the
 * first probe run. Exact fit needs no fusing: every cell of one pond
 * sits at the same spill level by construction (a basin fills to one
 * lip), so adjacent quads share edges and are one surface already.
 * The hairline float cracks exact fit risks are invisible against
 * terrain; the double-blend was not.
 */
const POND_QUAD = SPAN / 1024;

interface Drawn { readonly mesh: THREE.Mesh; readonly cx: number; readonly cz: number; }

/** One reach as a triangle strip of level slab, relative to (cx, 0, cz). */
export function buildReach(
  flow: Flow, first: number, count: number, cx: number, cz: number,
): THREE.BufferGeometry | null {
  if (count < 2) return null;
  const positions = new Float32Array(count * 2 * 3);
  // HOW DEEP THE WATER RUNS MID-CHANNEL, AS OUR OWN ATTRIBUTE. `vUv`
  // looked like the obvious thing to feed the fragment shader and is
  // not declared at all unless the material carries a map — three.js
  // gates it behind USE_UV, so the program failed to link and every
  // stream came out untextured black. Ours is always there.
  const deep = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = first + i;
    const x = flow.x[p], z = flow.z[p];
    const back = first + Math.max(0, i - 1);
    const fore = first + Math.min(count - 1, i + 1);
    let dx = flow.x[fore] - flow.x[back];
    let dz = flow.z[fore] - flow.z[back];
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) { dx = 1; dz = 0; } else { dx /= run; dz /= run; }
    // OVER-WIDE ON PURPOSE, AND ASYMMETRIC. The terrain clips the slab
    // back to the water the valley actually holds, and the same
    // halfAt() bounds the collision index's claim, so drawn and wet
    // share one edge. What is new is that the two sides no longer have
    // to agree. A stream sitting hard against one valley wall reaches a
    // couple of metres on the wall side and a couple of hundred across
    // the floor on the other, and drawing it that way is most of what
    // makes the widening read as a VALLEY rather than as a fat ribbon
    // laid over one: a single number for both sides would have to take
    // the smaller of the two to avoid painting the wall, which is how
    // we ended up drawing a thread in the first place. halfAt() falls
    // back to slabHalf() for any station the bake has not walked, and
    // floors every measured value at it, so this can only ever widen.
    //
    // COLLAPSED TO NOTHING WHERE A POND OWNS THE WATER. The bake tucks
    // a ponded station two units UNDER the spill level so the pond
    // sheet wins the depth test — level below bed, which is the flag,
    // and the only case that writes one. Winning the depth test was
    // not enough: the slab is TRANSPARENT, so it still drew first and
    // the pond blended over it, and its near-zero alpha (depth two
    // units, invisible over bare ground) came out as a darker band
    // across the lake. Joshua saw the band; drawing the two layers
    // separately proved the pond sheet alone was flawless and the slab
    // was the one adding it. A zero half-width makes every triangle in
    // the run degenerate, so the rasteriser discards them and the pond
    // is alone on those pixels — one owner, in geometry as well as in
    // level.
    //
    // The collapse is asked BEFORE the side, and answers for both: a
    // pond owning the water owns all of it, and a half-width that was
    // zero on one side only would leave the run a sliver rather than
    // degenerate, which is the same double-blend by a thinner name.
    const owned = flow.level[p] < flow.bed[p];
    for (const side of [-1, 1] as const) {
      const half = owned ? 0 : halfAt(flow, p, side) * EDGE;
      const v = i * 2 + (side + 1) / 2;
      positions[v * 3] = x - cx + -dz * half * side;
      positions[v * 3 + 1] = flow.level[p];
      positions[v * 3 + 2] = z - cz + dx * half * side;
      deep[v] = flow.level[p] - flow.bed[p];
    }
  }
  // WHAT TWENTY TIMES THE WIDTH DOES AT A BEND, WRITTEN DOWN BEFORE
  // ANYONE LOOKS AT A FRAME. Stations are one grid cell apart, about
  // 55 m, so the polyline's own radius of curvature through a turn is
  // 27.5 m divided by the sine of half that turn, and the strip folds
  // over itself on the INSIDE of a bend as soon as a half-width beats
  // it. At the new median half-width of 25 m that cannot happen at any
  // angle at all, which is why the question never arose while the
  // ribbon was three metres across. At the p95 of 83 m it folds on any
  // turn past about forty degrees, and at the widest stations, 174 m,
  // past about eighteen — and a steepest-descent path turns forty-five
  // degrees at a time as a matter of course. So the folding is real,
  // and it is concentrated in the widest reaches, which are the lowland
  // ones she will be standing beside.
  //
  // The OUTSIDE of a bend cannot open a wedge, at any width. The two
  // quads meeting at a station share that station's pair of vertices,
  // so the strip is closed by construction and a corner comes out
  // mitred rather than gapped. What the mitre does instead is give reach
  // away: the offset vertex sits one half-width along the bisector
  // normal, so its clearance from each adjoining segment is only that
  // times the cosine of half the turn, which is 7.6% short at
  // forty-five degrees and 29% short at a right angle. That was
  // millimetres when the slab was three metres wide and is twenty-four
  // metres at a p95 station now, reach the bake walked out for and the
  // geometry quietly declines to draw.
  //
  // Nothing drawn here can escape the collision index whatever the fold
  // does. Every corner lies within the largest halfAt() of its own
  // station, and distance to a segment is a convex function, so the
  // whole quad sits inside the radius useFlow() claims for that
  // segment. Drawn stays a subset of wet by construction rather than by
  // two numbers being kept in step, which is the fault the version 2
  // rebuild existed to remove.
  //
  // WHETHER AN OVERLAP SHOWS IS NOT SETTLED BY THE DEPTH TEST ALONE.
  // Where one lap hides another the winner swaps exactly along the line
  // where the two surfaces cross, and on that line they are the same
  // point at the same height; the fragment shades from where it stands
  // and how far the ground is below it, never from which quad painted
  // it, so both answer identically there and the seam is a crease in
  // the depth ramp rather than a step in it. That much holds from any
  // camera. What it does not cover is draw ORDER. Triangles within one
  // geometry go down in index order, which is downstream order, and
  // depth writing only rejects a later fragment that is FARTHER, so
  // wherever the downstream lap happens to be the nearer one it passes
  // the test and blends over an upstream lap that has already blended.
  // Two coats of the same sheet are darker than one, and near the
  // shoreline, where the alpha ramp is still small, the doubling is
  // very nearly exact and the band would carry the straight silhouette
  // edge of the later quad. That is the same shape of fault as the pond
  // lattice and the 1.12-cell overlap before it, and it would come and
  // go as she walks around the bend. It is the thing to look for in the
  // render, and it is deliberately not fixed here: a guess dressed up
  // as a fix costs a probe run to disprove.
  const faces: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2;
    faces.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setIndex(faces);
  // FLAT +Y NORMALS, written rather than computed: computeVertexNormals
  // shades each quad facet visibly through transparent water, and a
  // stream's real slope is metres over kilometres, which is flat.
  const normals = new Float32Array(count * 2 * 3);
  for (let v = 0; v < count * 2; v++) normals[v * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** The listed pond cells as one batch of quads, relative to (cx, 0, cz). */
export function buildPonds(
  flow: Flow, cells: readonly number[], cx: number, cz: number,
): THREE.BufferGeometry {
  const half = POND_QUAD / 2;
  const positions = new Float32Array(cells.length * 4 * 3);
  const deep = new Float32Array(cells.length * 4);
  const normals = new Float32Array(cells.length * 4 * 3);
  const faces: number[] = [];
  for (let q = 0; q < cells.length; q++) {
    const i = cells[q];
    const x = flow.pondX[i] - cx;
    const z = flow.pondZ[i] - cz;
    for (let corner = 0; corner < 4; corner++) {
      const v = q * 4 + corner;
      positions[v * 3] = x + (corner % 2 === 0 ? -half : half);
      positions[v * 3 + 1] = flow.pondLevel[i];
      positions[v * 3 + 2] = z + (corner < 2 ? -half : half);
      deep[v] = flow.pondDepth[i];
      normals[v * 3 + 1] = 1;
    }
    const a = q * 4;
    faces.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(faces);
  return geometry;
}

export class FlowWater {
  private readonly drawn = new Map<number, Drawn>();
  private ponds: Drawn | null = null;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private lastCell = '';
  private shownAll = true;

  /**
   * THE GROUND, AS A TEXTURE THE WATER CAN ASK. Depth used to ride the
   * geometry — each slab carried its own baked level-minus-bed — and
   * Joshua's screenshot showed what that does: every sheet its own
   * tone, every ownership boundary a straight polygon edge, the island
   * wearing shards instead of water. Depth is a property of WHERE the
   * fragment is, not of which slab painted it, so the fragment asks
   * the height grid: one texture, one answer, one continuous body —
   * and shorelines fade out on their own as the depth reaches zero.
   */
  private readonly groundTex: THREE.DataTexture;
  private readonly worldOrigin = { value: new THREE.Vector2() };

  constructor(private readonly scene: THREE.Scene, grid: HeightGrid) {
    // THE GROUND THE GAME DRAWS, NOT THE GRID IT WAS BAKED FROM — and
    // this file learnt that lesson last, having watched the bake learn
    // it first.
    //
    // The texture used to be the RAW grid, and the terrain is not the
    // raw grid: baseLand() blends it toward a pre-blurred copy by the
    // smoothing dial, which ships at 1, meaning the island she walks on
    // is the FULLY BLURRED grid. Measured against groundHeight over
    // 352,993 points the water claims, the raw grid is a mean of 8.07 m
    // out, and the shader and the level field disagreed about wet or
    // dry on 28.7% of them: 9.3% of the water was drawn at zero alpha
    // over ground the shader believed was above it, and 19.4% was
    // painted over dry land the shader believed was below it. Joshua
    // photographed both halves of that in one session — a stream he was
    // standing in that was not there, and slabs hanging in the sky over
    // brown hillside with their own straight edges showing.
    //
    // Blended here exactly as baseLand blends it. What is left out is
    // the procedural relief, and that is correct rather than a
    // compromise: the bake solved the hydrology on a 4x4-supersampled
    // average of the same surface, in which the noise averages away, so
    // this matches the ground the LEVELS were measured against as well
    // as the one the terrain is built from.
    const soft = blurGrid(grid, SMOOTH_PASSES);
    const blend = smoothingAmount();
    const units = new Float32Array(SAMPLES * SAMPLES);
    // The grid is int16 DECIMETRES; a unit is a centimetre.
    for (let i = 0; i < units.length; i++) {
      units[i] = (grid[i] + (soft[i] - grid[i]) * blend) * 10;
    }
    this.groundTex = new THREE.DataTexture(
      units, SAMPLES, SAMPLES, THREE.RedFormat, THREE.FloatType,
    );
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.minFilter = THREE.LinearFilter;
    this.groundTex.generateMipmaps = false;
    this.groundTex.needsUpdate = true;
    this.material = this.build();
  }

  /** Drawn reaches, plus one for the pond sheet when it exists. */
  get shown(): number { return this.drawn.size + (this.ponds ? 1 : 0); }

  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const d of this.drawn.values()) d.mesh.visible = on;
    if (this.ponds) this.ponds.mesh.visible = on;
  }

  /**
   * SHOW ONE KIND OF WATER AT A TIME — for telling them apart.
   *
   * Reach slabs and pond sheets can both put blue on a pixel and a
   * screenshot cannot say which did. Drawing them one at a time answers
   * in two frames what an afternoon of reasoning about depth precision
   * does not.
   */
  setLayer(which: 'reaches' | 'ponds', on: boolean): void {
    if (which === 'reaches') {
      for (const d of this.drawn.values()) d.mesh.visible = on;
    } else if (this.ponds) {
      this.ponds.mesh.visible = on;
    }
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      // ROUGH AND DIM, because the first version came back nearly
      // white. A smooth standard material under the island's sun blows
      // out to a pale sheet at every angle, which reads as plastic
      // rather than as water; the colour work below then has nothing
      // left to say.
      color: 0x1d4a5c, transparent: true, opacity: 0.72,
      roughness: 0.62, metalness: 0.0,
      // ONE WATER OWNER PER PIXEL. The water writes depth, so where two
      // transparent sheets overlap — a tributary's slab across its
      // trunk's at every junction, the strip folding at a sharp bend,
      // two ponds meeting — the first surface wins and the second is
      // z-rejected instead of blending again. Joshua photographed what
      // depthWrite:false does at this scale: every overlap painted
      // itself twice, darker, with a straight polygon edge, and the
      // island's water read as shards instead of one body.
      depthWrite: true,
      // Both faces, because the underwater pass to come looks at this
      // surface from below.
      side: THREE.DoubleSide,
    });
    // Water lies close over its own bed for its whole length, so
    // pushing its fragments DEEPER lets the bed win the depth test and
    // freckle through the surface. Lifted toward the camera instead.
    material.polygonOffset = true;
    material.polygonOffsetFactor = 0;
    material.polygonOffsetUnits = -8;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.clock = this.clock;
      shader.uniforms.groundTex = { value: this.groundTex };
      shader.uniforms.worldOrigin = this.worldOrigin;
      shader.uniforms.relief = reliefUniform;
      shader.vertexShader =
        'varying vec3 vWater;\n'
        + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vec4 tmbWorld = modelMatrix * vec4(transformed, 1.0);
  vWater = tmbWorld.xyz;`);
      shader.fragmentShader =
        'uniform float clock;\nuniform sampler2D groundTex;\n'
        + 'uniform vec2 worldOrigin;\nuniform float relief;\nvarying vec3 vWater;\n'
        + shader.fragmentShader.replace(
          '#include <color_fragment>', `#include <color_fragment>
        // DEPTH FROM WHERE THE FRAGMENT STANDS. The rendered frame is
        // the floating-origin one; worldOrigin puts the fragment back
        // in the island's own coordinates and the height grid answers
        // what the ground is under it. Every sheet — reach slab, pond
        // quad, whoever won the depth test — shades from the same
        // field, so no boundary between them can show.
        vec2 wxz = vWater.xz + worldOrigin;
        vec2 guv = (wxz + vec2(2800000.0)) / 5600000.0;
        float ground = texture2D(groundTex, guv).r * relief;
        float depth = vWater.y - ground;
        float deepness = smoothstep(0.0, 250.0, depth);
        diffuseColor.rgb = mix(vec3(0.10, 0.28, 0.30), vec3(0.014, 0.10, 0.15), deepness);
        // THE SHORELINE IS AN ALPHA RAMP, not an edge. Where the water
        // meets the bank the depth runs out and the surface fades with
        // it — the hard terrain clip happens under a transparency the
        // eye cannot see.
        diffuseColor.a = mix(0.0, 0.85, smoothstep(0.0, 45.0, depth));
        // Fade out where the channel stops being resolved, so the cut
        // is not a pop.
        diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM}.0, ${REACH}.0, length(vViewPosition));
      `);
    };
    return material;
  }

  update(dt: number): void { this.clock.value += dt; }

  /** Bring the nearby water into being and let the far water go. */
  follow(at: { wx: number; wz: number }): void {
    const flow = flowData();
    if (!flow) return;
    const cell = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (cell === this.lastCell) { this.place(); return; }
    this.lastCell = cell;

    const wanted = new Set<number>();
    for (let r = 0; r < flow.reaches.length; r++) {
      const reach = flow.reaches[r];
      for (let i = 0; i < reach.count; i += 4) {
        const p = reach.first + i;
        if (Math.abs(flow.x[p] - at.wx) < REACH && Math.abs(flow.z[p] - at.wz) < REACH) {
          wanted.add(r); break;
        }
      }
    }
    for (const [index, reach] of this.drawn) {
      if (wanted.has(index)) continue;
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
      this.drawn.delete(index);
    }
    for (const index of wanted) {
      if (this.drawn.has(index)) continue;
      const { first, count } = flow.reaches[index];
      let cx = 0, cz = 0;
      for (let i = 0; i < count; i++) { cx += flow.x[first + i]; cz += flow.z[first + i]; }
      cx /= count; cz /= count;
      const geometry = buildReach(flow, first, count, cx, cz);
      if (!geometry) continue;
      this.drawn.set(index, { mesh: this.show(geometry), cx, cz });
    }
    this.followPonds(flow, at);
    this.place();
  }

  /**
   * THE POND SHEET IS REBUILT WHOLE, not diffed. The decision cell
   * changes every 50,000 units of travel and the visibility box holds
   * at most a few dozen cells, so one batch geometry per rebuild is
   * cheaper than the bookkeeping that would avoid it.
   */
  private followPonds(flow: Flow, at: { wx: number; wz: number }): void {
    if (this.ponds) {
      this.scene.remove(this.ponds.mesh);
      this.ponds.mesh.geometry.dispose();
      this.ponds = null;
    }
    const cells: number[] = [];
    let cx = 0, cz = 0;
    for (let i = 0; i < flow.pondX.length; i++) {
      if (Math.abs(flow.pondX[i] - at.wx) < REACH && Math.abs(flow.pondZ[i] - at.wz) < REACH) {
        cells.push(i); cx += flow.pondX[i]; cz += flow.pondZ[i];
      }
    }
    if (cells.length === 0) return;
    cx /= cells.length; cz /= cells.length;
    this.ponds = { mesh: this.show(buildPonds(flow, cells, cx, cz)), cx, cz };
  }

  private show(geometry: THREE.BufferGeometry): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.renderOrder = 1;
    mesh.visible = this.shownAll;
    this.scene.add(mesh);
    return mesh;
  }

  /** Re-seat against the floating origin and the relief dial. */
  place(): void {
    // The fragment shader reconstructs island coordinates from the
    // rendered frame; a rebase moves that frame, so the offset rides
    // along here with the meshes.
    const seat = originAt();
    this.worldOrigin.value.set(seat.x, seat.z);
    const relief = reliefScale();
    for (const d of this.drawn.values()) this.seat(d, relief);
    if (this.ponds) this.seat(this.ponds, relief);
  }

  private seat(d: Drawn, relief: number): void {
    const at = toLocal({ wx: d.cx, wz: d.cz });
    d.mesh.position.set(at.lx, 0, at.lz);
    // Levels are stored at relief 1; the dial is applied here, the same
    // scale groundHeight() applies, so slab and terrain move as one.
    d.mesh.scale.y = relief;
  }

  dispose(): void {
    for (const d of this.drawn.values()) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
    }
    this.drawn.clear();
    if (this.ponds) {
      this.scene.remove(this.ponds.mesh);
      this.ponds.mesh.geometry.dispose();
      this.ponds = null;
    }
    this.material.dispose();
  }
}
