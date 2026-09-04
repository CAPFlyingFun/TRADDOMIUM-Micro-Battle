/**
 * THE ROOM SCREEN: the step between MULTIPLAYER and the world, in a build
 * that has a relay.
 *
 * It asks the one question a relay cannot answer for the player — WHICH
 * ROOM — and it asks it the way two people actually meet: one of them
 * reads a code to the other. So the screen arrives with a code already
 * generated and ready to share, and the same field takes a code somebody
 * else read out. One field, because on a 430 px landscape screen two
 * fields (yours / theirs) is two thumb targets and a decision, for what
 * is one string either way.
 *
 * WHY IT IS A FRAGMENT AND NOT A REGISTERED SCENE. Choosing a room is one
 * step of starting a game, exactly like choosing a save slot, so it opens
 * IN PLACE inside whatever panel the play flow is running in
 * (`PlayFlow`), with no scene swap and no second front door. It also
 * cannot start a session or move the app itself: like `SessionPicker` and
 * `SlotPicker` it hands the answer back through typed hooks and the
 * hosting SCREEN does the transition (ARCHITECTURE §4, ui/screen.ts).
 *
 * VALIDATION IS THE RELAY'S OWN RULE, and it says why. The bounds, the
 * alphabet and the "starts and ends with a letter or number" edge rule
 * come from `net/relayConfig.ts`, which `tests/relayConfig.test.ts` pins
 * against the file the Worker itself enforces
 * (`worker/src/roomCode.ts`) — the client must never offer a code the
 * relay will refuse, and must never refuse one it would accept. When a
 * code cannot be used the reason is written under the field in words; the
 * JOIN control is disabled only WITH that reason on screen, never as the
 * only sign that something is wrong (ARCHITECTURE §2.9).
 *
 * HONESTY. This screen may not imply that online play is finished. What
 * joining does today is exactly this: the room is chosen, a multiplayer
 * session is built for it, the world opens and its link to the relay is
 * opened with it, so everyone who typed the same code appears in that
 * world as a capsule and moves in it. What is NOT there is the game —
 * no ant, no terrain, nothing saved — and `ROOM_SCOPE_NOTE` says both
 * halves on screen, because the player is the one who would otherwise
 * assume the rest of it.
 */
import { ACTION } from '../app/actions';
import {
  ROOM_CODE_MAX_LENGTH, ROOM_CODE_RULE, generateRoomCode, normaliseRoomCode, relayHost, roomCodeProblem,
} from '../net/relayConfig';
import { actionRow, actionsRow, footer, labelledRow, note } from './screen';

/**
 * What the wiring hands the ui about rooms. Its PRESENCE is the answer to
 * "does this build have a relay?" — a build without one offers no room
 * step at all, rather than an empty one (`SessionPicker`).
 */
export interface RoomOffer {
  /** The relay's address, shown so a developer on `?relay=` can see which one they are on. */
  readonly relayUrl: string;
}

/** The field a probe types into; a field is not a verb, so it is not in `ACTION`. */
export const ROOM_CODE_FIELD = 'room:code';

export interface RoomCodeHooks extends RoomOffer {
  /** A fresh code to offer. Defaults to `generateRoomCode`; a test owns the draw by passing its own. */
  suggest?(): string;
  /**
   * JOIN, with the NORMALISED code (trimmed, lower case) — the exact
   * string that will name the room on the relay, never the raw typing.
   * Throwing from here is how a broken relay address reaches the player:
   * the message is shown under the field.
   */
  onJoin(code: string): void;
  onBack(): void;
}

/** What the screen says a room is, before anybody has typed anything. */
export const ROOM_CODE_INTRO =
  'Share this code, or type the one you were given. The same code is the same room.';

/**
 * The whole of what joining does today, both halves of it. It is on the
 * screen, not only in this file, because the player is the one who would
 * otherwise assume more (ARCHITECTURE §2.10). Every claim in it is what
 * `npm run probe:multiplayer` drives two browsers through against a
 * running relay; when that stops being true, this line changes first.
 */
export const ROOM_SCOPE_NOTE =
  'Joining opens the world and the link to the relay: everyone who typed this code appears as a capsule ' +
  'and moves as they fly. There is no ant and no terrain yet, and nothing here is saved.';

export class RoomCodePicker {
  readonly element: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly reason: HTMLParagraphElement;
  private readonly join: HTMLButtonElement;

  constructor(host: HTMLElement, private readonly hooks: RoomCodeHooks) {
    const doc = host.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'ui-column';
    this.element.dataset.role = 'room-code';

    const heading = doc.createElement('p');
    heading.className = 'ui-subtitle';
    heading.textContent = ROOM_CODE_INTRO;
    this.element.appendChild(heading);

    this.field = doc.createElement('input');
    this.field.type = 'text';
    this.field.className = 'ui-input';
    this.field.dataset.action = ROOM_CODE_FIELD;
    this.field.maxLength = ROOM_CODE_MAX_LENGTH;
    this.field.autocomplete = 'off';
    this.field.spellcheck = false;
    this.field.setAttribute('aria-label', 'Room code');
    // The rule where a doubtful player looks for it, rather than only
    // after they have got it wrong.
    this.field.title = ROOM_CODE_RULE;
    this.field.value = this.suggest();
    this.field.addEventListener('input', () => this.check());

    labelledRow(this.element, 'Room code', [
      this.field,
      actionRow(ACTION.newRoomCode, 'New code', () => this.regenerate(), { compact: true }),
    ]);

    this.reason = note(this.element, '');
    this.reason.dataset.role = 'room-code-reason';
    note(this.element, ROOM_SCOPE_NOTE);
    footer(this.element, `Rooms are opened on ${relayHost(hooks.relayUrl)}.`);

    this.join = actionRow(ACTION.joinRoom, 'Join room', () => this.submit(), { primary: true, compact: true });
    actionsRow(this.element, [
      this.join,
      actionRow(ACTION.back, 'Back', () => hooks.onBack(), { compact: true }),
    ]);

    host.appendChild(this.element);
    this.check();
  }

  dispose(): void {
    this.element.remove();
  }

  /** Offer a different code to share. What was typed is replaced, because the button says so. */
  private regenerate(): void {
    this.field.value = this.suggest();
    this.check();
  }

  private suggest(): string {
    return this.hooks.suggest?.() ?? generateRoomCode();
  }

  /**
   * Every keystroke: say what is wrong, or nothing at all. The JOIN
   * control follows the reason — it is never disabled without one.
   */
  private check(): string | null {
    const problem = roomCodeProblem(this.field.value);
    this.say(problem);
    this.join.disabled = problem !== null;
    this.field.setAttribute('aria-invalid', problem === null ? 'false' : 'true');
    return problem;
  }

  private say(problem: string | null): void {
    this.reason.textContent = problem ?? '';
    this.reason.hidden = problem === null;
  }

  /**
   * JOIN. The code is re-checked here rather than trusted from the last
   * keystroke (a value can be set without one), and a wiring that cannot
   * build the room — a mistyped `?relay=`, most likely — reports its
   * reason in the same place every other reason appears.
   */
  private submit(): void {
    if (this.check() !== null) return;
    try {
      this.hooks.onJoin(normaliseRoomCode(this.field.value));
    } catch (error) {
      this.say(`Could not open that room: ${messageOf(error)}`);
      this.join.disabled = true;
    }
  }
}

/** An unknown throw is still a sentence to somebody: never "[object Object]". */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}
