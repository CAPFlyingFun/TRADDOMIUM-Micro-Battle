/**
 * THE TOMBS LABORATORY'S RENDERER — the building `world/tombs` plans,
 * turned into three.js objects.
 *
 *   labLook.ts   what each surface is made of, what the array's rings
 *                are made of, and how dark the room goes when the
 *                shutdown lever is pulled. Pure: no three, so the
 *                palette is testable in plain node
 *   LabView.ts   the assembly: one InstancedMesh per surface, a torus
 *                per ring, both lamp sets at once, and the ONE place
 *                local metres become world units
 *
 * What `terrain/` is to `world/heightfield` and `flora/` to
 * `world/objects`, this is to `world/tombs` (ARCHITECTURE §3): the only
 * place a floor plan meets a mesh. Renderer-side, so three is allowed;
 * `world/tombs` stays three-free and a server can hold the building's
 * collision without a GPU.
 */
export {
  FITTING, FITTING_DARK, FITTING_LIT, LIGHTING, LIGHT_MODES, LOOK, METALLIC, RING_LOOK, SURFACES,
  ambientLevel, lookFor, luminance,
  type FittingLook, type LightingLook, type SurfaceLook,
} from './labLook';
export { LabView, type LabViewOptions, type LabViewStats } from './LabView';
