import { assetUrl } from '../../../lib/asset-url';
// Scene rendering is isolated from story state. A future WebGL renderer may consume
// the same camera, event and character IDs without changing the narrative engine.
export const assets = {
  laboratory: assetUrl('/assets/tombs-laboratory.jpg'),
  exterior: assetUrl('/assets/settlement-edge.webp'),
  specimens: assetUrl('/assets/scale-atlas.webp'),
} as const;
export type SceneLook = 'console' | 'laboratory' | 'corridor' | 'array' | 'blackout' | 'aftermath' | 'window' | 'cameras' | 'ending';
export type RendererMode = 'cinematic-2d' | 'webgl';
export interface ScenePresentation { look: SceneLook; intensity: number; reducedMotion: boolean; paused: boolean; }
