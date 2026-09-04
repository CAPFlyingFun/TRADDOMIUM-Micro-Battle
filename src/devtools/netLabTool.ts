/**
 * The Network Lab's entry in the Editors / Dev Tools hub, and the names
 * its controls answer to.
 *
 * A plain record, like `perf/perfTool.ts`: the tool IS a scene, and the
 * hub opens it by asking the SceneManager for `sceneId`. The id is NOT
 * under the `world:` prefix on purpose — a world scene is entered
 * through the loading screen with a solo session behind it (the hub's
 * `openScene` does that for `world:*`), and the lab needs no session:
 * it carries its own host and both of its clients in-process. So it is
 * a plain tool scene, opened in the `menu` state like any front-door
 * screen, with a BACK control rather than a pause menu.
 *
 * The `data-action` names live here rather than in the scene so a test
 * can read them without loading three; the probe, which cannot import
 * TypeScript, repeats them and says so.
 *
 * Pure: no three, no DOM.
 */
import type { DevTool } from './DevTool';

/** The registry id integration binds to `createNetworkLabScene`. */
export const NET_LAB_SCENE_ID = 'devtools:net-lab';

export const netLabTool: DevTool = {
  id: 'net-lab',
  title: 'Network Lab',
  description:
    'Two capsules, one loopback session — identity, joining, authority, replication, reconnect. ' +
    'In-process only; no server yet.',
  sceneId: NET_LAB_SCENE_ID,
};

/**
 * Every control in the lab's HUD carries one of these as `data-action`
 * (`app/actions.ts` rule), plus the shared `back`. Prefixed so they can
 * never collide with the app's own vocabulary.
 */
export const NET_LAB_ACTION = {
  bDisconnect: 'netlab:b-disconnect',
  bReconnect: 'netlab:b-reconnect',
  aLeave: 'netlab:a-leave',
  aRejoin: 'netlab:a-rejoin',
  aTeleport: 'netlab:a-teleport',
  latency: 'netlab:latency',
  jitter: 'netlab:jitter',
  drop: 'netlab:drop',
} as const;

export type NetLabAction = (typeof NET_LAB_ACTION)[keyof typeof NET_LAB_ACTION];

/** The `data-role` of the HUD's root element: what a probe waits for to know the lab is up. */
export const NET_LAB_HUD_ROLE = 'net-lab-hud';

/** The slider ranges, as the brief fixes them. Milliseconds, milliseconds, per cent. */
export const NET_LAB_DIALS = Object.freeze({
  latencyMaxMs: 400,
  jitterMaxMs: 100,
  dropMaxPercent: 50,
});
