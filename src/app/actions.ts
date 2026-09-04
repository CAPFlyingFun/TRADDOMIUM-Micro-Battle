/**
 * The vocabulary of things a player can press, shared by screens and
 * probes.
 *
 * RULE: every interactive control in any screen carries
 * `data-action="<action>"`, so a probe drives exactly the buttons a
 * player touches (`[data-action="new-game"]`) instead of a selector that
 * survives only until the next restyle. v0 shipped a build that passed
 * every check against a route nobody played; naming the controls, not the
 * layout, is part of the fix.
 */
export const ACTION = {
  /** The menu's NEW GAME: start over, in a slot the player then chooses. */
  newGame: 'new-game',
  /** The loader's press-to-continue. */
  continue: 'continue',
  solo: 'solo',
  multiplayer: 'multiplayer',
  profile: 'profile',
  settings: 'settings',
  editors: 'editors',
  about: 'about',
  back: 'back',
  pause: 'pause',
  /**
   * Back into the game I was in: the pause menu's RESUME, and the main
   * menu's. They are never on screen together — one is an overlay the
   * world owns, the other a scene — so a probe names the screen when it
   * needs to tell them apart.
   */
  resume: 'resume',
  quit: 'quit',
} as const;

export type Action = (typeof ACTION)[keyof typeof ACTION];

/** A button that carries its action name for probes and styling alike. */
export function actionButton(action: Action, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
