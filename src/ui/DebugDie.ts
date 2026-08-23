/**
 * A BUTTON THAT KILLS HER, for testing the loop.
 *
 * TEMPORARY, and it says so on itself. Nothing in the world can hurt
 * her yet, so the only way to walk the death → spawn map → new queen
 * path is to ask for it — and the keyboard shortcut is no use on the
 * phone the game is actually played on.
 *
 * Deliberately far from the thumbs. It sits under the settings gear
 * rather than on the action pad, because a button that ends the run
 * next to the one that makes her fly is a button that will end the run
 * by accident.
 */
export class DebugDie {
  private readonly button: HTMLButtonElement;

  constructor(host: HTMLElement, die: () => void) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.dataset.ui = 'debug-die';
    this.button.setAttribute('aria-label', 'debug: die');
    this.button.textContent = '☠ DIE';
    Object.assign(this.button.style, {
      position: 'fixed',
      top: 'calc(52px + min(env(safe-area-inset-top), 12px))',
      right: 'calc(10px + min(env(safe-area-inset-right), 14px))',
      appearance: 'none',
      padding: '7px 10px',
      borderRadius: '8px',
      border: '1px dashed rgba(255, 140, 120, .65)',
      background: 'rgba(60, 18, 14, .6)',
      color: 'rgba(255, 170, 150, .9)',
      font: '600 10px/1 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.08em',
      cursor: 'pointer',
      touchAction: 'manipulation',
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);
    // A dashed border and a muted red: it should read as scaffolding
    // rather than as part of the game, so nobody mistakes it for a
    // mechanic when the real ways to die arrive.
    this.button.addEventListener('click', die);
    host.appendChild(this.button);
  }

  /**
   * SCAFFOLDING KEEPS SCAFFOLDING HOURS.
   *
   * It reads as debug UI because it IS debug UI, and it was sitting in
   * the top right next to the weather and the settings cog — the one
   * corner of the interface that should be nothing but the game's own
   * furniture. It rides with the developer overlay now, so turning
   * that off leaves weather and settings alone up there.
   */
  show(on: boolean): void {
    this.button.style.display = on ? '' : 'none';
  }

  dispose(): void {
    this.button.remove();
  }
}
