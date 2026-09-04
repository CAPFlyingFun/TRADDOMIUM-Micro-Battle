/**
 * Profile: the device id (shortened — it identifies, it is not meant to be
 * read aloud) and an editable display name. Minimal on purpose; accounts
 * are a later layer and this screen must not pretend otherwise.
 *
 * The profile itself lives in session/PlayerProfile, which the ui may not
 * import, so reads and writes arrive through `ProfileSource`. The name the
 * screen shows after Save is the one the source actually kept, so any
 * trimming or bounding is visible rather than silent.
 */
import { ACTION } from '../app/actions';
import type { SceneContext, SceneFactory } from '../app/Scene';
import { goToScreen, SCREEN_ID } from './navigation';
import { actionRow, actionsRow, labelledRow, namedButton, Screen, titledPanel, type Wire } from './screen';

export interface ProfileView {
  readonly deviceId: string;
  readonly displayName: string;
}

/** Supplied by integration from the PlayerProfile store. */
export interface ProfileSource {
  read(): ProfileView;
  /** Persists and returns what was kept (trimmed, bounded, defaulted). */
  setDisplayName(name: string): ProfileView;
  readonly maxNameLength: number;
}

export interface ProfileHooks extends ProfileSource {
  onBack(): void;
}

export const PROFILE_NAME_ACTION = 'profile:name';
export const PROFILE_SAVE_ACTION = 'profile:save';

export class ProfileScene extends Screen {
  readonly name = 'profile';

  constructor(ctx: SceneContext, private readonly hooks: ProfileHooks) {
    super(ctx, 'plain');
  }

  protected build(root: HTMLElement): void {
    const panel = titledPanel(root, 'Profile', { wide: true });
    const doc = root.ownerDocument;
    const profile = this.hooks.read();

    const device = doc.createElement('span');
    device.className = 'ui-readout';
    device.textContent = shortDeviceId(profile.deviceId);
    device.title = profile.deviceId;
    labelledRow(panel, 'Device id', [device]);

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'ui-input';
    input.dataset.action = PROFILE_NAME_ACTION;
    input.maxLength = this.hooks.maxNameLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = profile.displayName;
    input.setAttribute('aria-label', 'Display name');

    const status = doc.createElement('p');
    status.className = 'ui-subtitle';
    status.textContent = `Shown to other players as “${profile.displayName}”.`;

    const save = (): void => {
      const kept = this.hooks.setDisplayName(input.value);
      input.value = kept.displayName;
      status.textContent = `Saved. Shown to other players as “${kept.displayName}”.`;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });

    labelledRow(panel, 'Display name', [input, namedButton(PROFILE_SAVE_ACTION, 'Save', save, { compact: true })]);
    panel.appendChild(status);
    actionsRow(panel, [actionRow(ACTION.back, 'Back', () => this.hooks.onBack(), { compact: true })]);
  }
}

/** First eight and last four characters of a long id: enough to tell two devices apart at a glance. */
export function shortDeviceId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function createProfileScene(source: Wire<ProfileSource>): SceneFactory {
  return (ctx) => {
    const profile = source(ctx);
    return new ProfileScene(ctx, {
      read: () => profile.read(),
      setDisplayName: (name) => profile.setDisplayName(name),
      maxNameLength: profile.maxNameLength,
      onBack: () => goToScreen(ctx, SCREEN_ID.menu),
    });
  };
}
