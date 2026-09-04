/**
 * The app's top-level state, owned by `App` one layer ABOVE scenes.
 *
 * A session (a live connection, a room id, a load percentage) can outlive
 * a scene swap, and "the world is frozen" is a fact about the app rather
 * than about any one scene — so the frame loop gates ticking systems on
 * this centrally instead of each scene remembering to check.
 */
export type AppState = 'boot' | 'menu' | 'session' | 'loading' | 'playing' | 'paused';

/**
 * Which state may follow which. Written down in one place because v0 had
 * nine mutually-constrained booleans whose constraints were written down
 * nowhere (ARCHITECTURE §2.3).
 *
 * `menu` covers every front-door screen (settings, profile, about, the
 * dev-tools hub): swapping between them is a scene change, not a state
 * change. Every state may fall back to `menu`, because that is where the
 * SceneManager lands when a scene fails to enter.
 */
const NEXT: Readonly<Record<AppState, readonly AppState[]>> = {
  boot: ['menu'],
  menu: ['session', 'loading'],
  session: ['menu', 'loading'],
  loading: ['playing', 'menu'],
  playing: ['paused', 'loading', 'menu'],
  paused: ['playing', 'menu'],
};

/** Pure: may `to` follow `from`? Re-asserting the current state is allowed. */
export function canTransition(from: AppState, to: AppState): boolean {
  return from === to || NEXT[from].includes(to);
}

export type AppStateListener = (next: AppState, prev: AppState) => void;

export class AppStateMachine {
  private state: AppState;
  private readonly listeners = new Set<AppStateListener>();

  constructor(initial: AppState = 'boot') {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  /**
   * Throws on an illegal transition rather than ignoring it: a caller that
   * believes the app is somewhere it is not is a bug worth hearing about
   * immediately, not a state to be silently corrected.
   */
  set(next: AppState): void {
    const prev = this.state;
    if (!canTransition(prev, next)) {
      throw new Error(`AppState: illegal transition ${prev} → ${next}`);
    }
    if (prev === next) return;
    this.state = next;
    for (const cb of this.listeners) cb(next, prev);
  }

  /** Returns the unsubscribe function. */
  onChange(cb: AppStateListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
