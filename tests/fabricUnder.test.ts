/**
 * THE SKIN BEHIND THE CLEAVAGE BRIDGE loses its top's paint (Joshua, 2026-10-23, drawn: "I want the part directly
 * under that bridge to not be painted"). `setUnder` lays one value a vertex on her skin and names the paint layer it
 * takes off; the shader draws that layer's paint only where the value is under one half.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setUnder } from '../src/sarahlab/fabricMaterial';

function skin(): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const material = new THREE.MeshStandardMaterial();
  return { mesh: new THREE.Mesh(g, material), material };
}

function compiled(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <map_fragment>',
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe('the skin behind the cleavage bridge', () => {
  it('lays its values on her skin and takes that layer\'s paint off where they pass one half', () => {
    const { mesh, material } = skin();
    setUnder(mesh, material, 1, Float32Array.from([0, 1, 0.5]), { layers: 3, rest: null });
    expect(Array.from(mesh.geometry.getAttribute('fabricUnder').array)).toEqual([0, 1, 0.5]);
    const shader = compiled(material);
    expect(shader.uniforms.fabricUnderLayer.value).toBe(1);
    expect(shader.vertexShader).toContain('vFabricUnder = fabricUnder;');
    // only the bridge's own layer, drawn crisp at the half-way line like the paint's own edge
    expect(shader.fragmentShader).toContain('(1.0 - fabricEdge(vFabricUnder) * step(abs(fabricUnderLayer - 1.0), 0.5))');
  });

  it('puts the paint back when the bridge comes off', () => {
    const { mesh, material } = skin();
    setUnder(mesh, material, 2, Float32Array.from([1, 1, 1]), { layers: 3, rest: null });
    setUnder(mesh, material, -1, null, { layers: 3, rest: null });
    expect(compiled(material).uniforms.fabricUnderLayer.value).toBe(-1);
  });

  it('leaves a material it never dressed alone', () => {
    const { mesh, material } = skin();
    setUnder(mesh, material, -1, null, { layers: 3, rest: null });
    expect(mesh.geometry.getAttribute('fabricUnder')).toBeUndefined();
  });
});
