// @vitest-environment jsdom
/**
 * THE ROOM STEP AS A PLAYER MEETS IT.
 *
 * Three things are worth a test here, and they are the three things that
 * would each be a lie on screen if they broke:
 *
 *  1. A code that cannot be used is refused WITH THE REASON IN WORDS. A
 *     disabled JOIN and no explanation is the same screen as a broken one
 *     (ARCHITECTURE §2.9).
 *  2. What reaches the wiring is the NORMALISED code — the exact string
 *     that will name the room on the relay — never the raw typing, or two
 *     people reading one code aloud end up in two rooms.
 *  3. A build with no relay behaves exactly as it did before there was
 *     one: MULTIPLAYER starts the honest mock, and no screen about rooms
 *     appears at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { ROOM_CODE_EDGES, ROOM_CODE_MISSING, ROOM_CODE_RULE, isRoomCode } from '../src/net/relayConfig';
import type { GameSession } from '../src/session/GameSession';
import { PlayFlow } from '../src/ui/PlayFlow';
import { ROOM_CODE_FIELD, ROOM_SCOPE_NOTE, RoomCodePicker, type RoomCodeHooks } from '../src/ui/RoomCodeScene';
import { ROOMS_CAPTION, ROOMS_SCOPE_NOTE, type SessionOffers } from '../src/ui/SessionPicker';

const byAction = (root: ParentNode, action: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-action="${action}"]`);

const field = (root: ParentNode): HTMLInputElement => {
  const input = root.querySelector<HTMLInputElement>(`input[data-action="${ROOM_CODE_FIELD}"]`);
  if (!input) throw new Error('the room screen has no code field');
  return input;
};

const join = (root: ParentNode): HTMLButtonElement => byAction(root, 'join-room') as HTMLButtonElement;

const reason = (root: ParentNode): string =>
  root.querySelector<HTMLElement>('[data-role="room-code-reason"]')?.textContent ?? '';

/** Type into the field the way a player does, so the screen's own listener runs. */
function type(root: ParentNode, text: string): void {
  const input = field(root);
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

function rig(overrides: Partial<RoomCodeHooks> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onJoin = vi.fn();
  const onBack = vi.fn();
  const picker = new RoomCodePicker(host, {
    relayUrl: 'https://traddomium-relay.joshua-622.workers.dev',
    suggest: () => 'hk4-m7p',
    onJoin,
    onBack,
    ...overrides,
  });
  return { host, picker, onJoin, onBack };
}

describe('the room screen', () => {
  it('arrives with a code ready to share, and that code is one the relay would accept', () => {
    const { host } = rig();
    expect(field(host).value).toBe('hk4-m7p');
    expect(isRoomCode(field(host).value)).toBe(true);
    expect(join(host).disabled).toBe(false);
    expect(reason(host)).toBe('');
  });

  it('says where the room would be, and what joining does and does not do', () => {
    const { host } = rig();
    expect(host.textContent).toContain('traddomium-relay.joshua-622.workers.dev');
    expect(host.textContent).toContain(ROOM_SCOPE_NOTE);
    // Both halves on screen: what a room IS (the link, the other players)
    // and what it is not yet. A line with only the first half would be the
    // screen promising a game (ARCHITECTURE §2.10).
    expect(ROOM_SCOPE_NOTE).toContain('link to the relay');
    expect(ROOM_SCOPE_NOTE).toContain('no ant');
  });

  it('offers a different code on request, and every one it offers is valid', () => {
    const codes = ['hk4-m7p', 'tn2-w9x', 'bd6-hj3'];
    let next = 0;
    const { host } = rig({ suggest: () => codes[next++ % codes.length] });
    byAction(host, 'new-room-code')?.click();
    expect(field(host).value).toBe('tn2-w9x');
    byAction(host, 'new-room-code')?.click();
    expect(field(host).value).toBe('bd6-hj3');
    expect(join(host).disabled).toBe(false);
    expect(reason(host)).toBe('');
  });

  it('refuses a code the relay would refuse, and says why, as it is typed', () => {
    const { host, onJoin } = rig();
    type(host, 'ab');
    expect(reason(host)).toBe(ROOM_CODE_RULE);
    expect(join(host).disabled).toBe(true);

    type(host, 'room_7');
    expect(reason(host)).toBe(ROOM_CODE_RULE);

    type(host, '-abc');
    expect(reason(host)).toBe(ROOM_CODE_EDGES);

    type(host, '');
    expect(reason(host)).toBe(ROOM_CODE_MISSING);

    // Pressing JOIN through a refused code does nothing at all.
    join(host).click();
    expect(onJoin).not.toHaveBeenCalled();

    // And it recovers: a good code clears the reason and the button.
    type(host, 'red-ant-7');
    expect(reason(host)).toBe('');
    expect(join(host).disabled).toBe(false);
  });

  it('joins with the normalised code, not with what was typed', () => {
    const { host, onJoin } = rig();
    type(host, '  RED-Ant-7 ');
    expect(join(host).disabled).toBe(false);
    join(host).click();
    expect(onJoin).toHaveBeenCalledWith('red-ant-7');
  });

  it('shows the wiring’s own reason when a room cannot be opened', () => {
    const { host } = rig({
      onJoin: () => {
        throw new Error('relay address "relay.example" is not a URL');
      },
    });
    join(host).click();
    expect(reason(host)).toContain('Could not open that room');
    expect(reason(host)).toContain('is not a URL');
    expect(join(host).disabled).toBe(true);
  });

  it('goes back without joining anything', () => {
    const { host, onBack, onJoin } = rig();
    byAction(host, 'back')?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onJoin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The step in its place: NEW GAME → SOLO | MULTIPLAYER → room → world.
// ---------------------------------------------------------------------------

function fakeSession(mode: 'solo' | 'multiplayer', caption: string, mapId = 'perf-empty'): GameSession {
  return {
    mode,
    mapId,
    canPauseWorld: mode === 'solo',
    authority: mode === 'solo' ? 'local' : 'server',
    caption,
    save: async () => {},
    leave: async () => {},
  };
}

function flow(rooms: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const joined: string[] = [];
  const mock = fakeSession('multiplayer', 'Online play is not built yet.');
  const offers: SessionOffers = {
    solo: () => fakeSession('solo', 'This device. Saved here.'),
    multiplayer: (room) => {
      if (room === undefined) return mock;
      joined.push(room);
      return fakeSession('multiplayer', 'Not connected to the relay.');
    },
    ...(rooms ? { rooms: () => ({ relayUrl: 'ws://127.0.0.1:8787' }) } : {}),
  };
  const onStart = vi.fn();
  const play = new PlayFlow(host, null, {
    sessions: offers,
    onStart,
    onNewGame: vi.fn(),
    onResume: vi.fn(),
    onClose: vi.fn(),
  });
  play.openSessions();
  return { host, play, onStart, joined, mock };
}

describe('MULTIPLAYER in the play flow', () => {
  it('with no relay, starts the honest mock at once and never mentions a room', () => {
    const { host, onStart, mock } = flow(false);
    expect(host.textContent).toContain('Online play is not built yet.');
    expect(host.textContent).not.toContain(ROOMS_SCOPE_NOTE);
    byAction(host, 'multiplayer')?.click();
    expect(onStart).toHaveBeenCalledWith(mock);
    expect(host.querySelector('[data-role="room-code"]')).toBeNull();
  });

  it('with a relay, asks which room first and starts the session built for it', () => {
    const { host, onStart, joined } = flow(true);
    // The card says what multiplayer is in THIS build, and what is not in
    // it. The no-relay line describes a build this is not, so it must not
    // be on screen beside a working room button.
    expect(host.textContent).toContain(ROOMS_CAPTION);
    expect(host.textContent).toContain(ROOMS_SCOPE_NOTE);
    expect(host.textContent).not.toContain('Online play is not built yet.');

    byAction(host, 'multiplayer')?.click();
    expect(onStart).not.toHaveBeenCalled();
    expect(host.querySelector('[data-role="session-picker"]')).toBeNull();
    expect(host.querySelector('[data-role="room-code"]')).not.toBeNull();
    expect(host.textContent).toContain('127.0.0.1:8787');

    type(host, 'RED-ant-7');
    join(host).click();
    expect(joined).toEqual(['red-ant-7']);
    expect(onStart).toHaveBeenCalledTimes(1);
    // No slot was asked for: a multiplayer game still keeps nothing here.
    expect(host.querySelector('[data-role="slot-picker"]')).toBeNull();
  });

  it('backs out of the room step to the how-to-play cards it came from', () => {
    const { host, onStart } = flow(true);
    byAction(host, 'multiplayer')?.click();
    byAction(host, 'back')?.click();
    expect(host.querySelector('[data-role="room-code"]')).toBeNull();
    expect(host.querySelector('[data-role="session-picker"]')).not.toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });
});
