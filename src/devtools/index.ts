/**
 * The devtools module's public surface: the contract tools are written
 * to, the registry, the hub, and the one content store every editor uses.
 *
 * Registration (integration writes this, in `app/registry.ts`):
 *
 *   registerTool({ ...perfWorldTool, description: '…' });   // first, so it is listed first
 *   registerScene(DEVTOOLS_SCENE_ID, createDevToolsHubScene((ctx) => ({
 *     openScene: (id) => void ctx.scenes.goTo(sceneFactory(id)),
 *     onBack: () => void ctx.scenes.goTo(sceneFactory('menu')),
 *   })));
 *
 * The hooks are a `DevToolsHubWire` — a function of the scene context —
 * because opening a scene needs the SceneManager, and the registry hands
 * a factory nothing but the context.
 */
export { listTools, registerTool, toolAction, toolById, type DevTool } from './DevTool';
export {
  BACK_LABEL, DEVTOOLS_SCENE_ID, DevToolsHubScene, HUB_EMPTY, HUB_SUBTITLE, HUB_TITLE, OPEN_LABEL,
  createDevToolsHubScene, type DevToolsHubHooks, type DevToolsHubWire,
} from './DevToolsHubScene';
export { createKeyedContentStore, type KeyedContentSpec, type KeyedContentStore } from './KeyedContentStore';

// The Network Lab (Phase 1): a plain tool scene, opened from the hub in
// the `menu` state. Integration registers it AFTER the Performance World:
//
//   registerTool(netLabTool);
//   registerScene(NET_LAB_SCENE_ID, createNetworkLabScene((ctx) => ({
//     identity: () => { const p = loadProfile(ctx.storage.open(PLAYER_PROFILE_SPEC)); return { playerId: playerIdOf(p), name: p.displayName }; },
//     onBack: () => goToScreen(ctx, SCREEN_ID.editors),
//   })));
export {
  NET_LAB_ACTION, NET_LAB_DIALS, NET_LAB_HUD_ROLE, NET_LAB_SCENE_ID, netLabTool, type NetLabAction,
} from './netLabTool';
export {
  NetworkLab, TELEPORT_UNITS, buildNetworkLabScene, createNetworkLabScene, type LabIdentity, type LabReadout,
  type NetworkLabHooks, type NetworkLabScene, type NetworkLabWire, type PeerReadout,
} from './NetworkLabScene';
