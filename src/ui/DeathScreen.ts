/**
 * SHE DIED. What now?
 *
 * Only the PRE-COLONY path, deliberately. Before there is a colony a
 * death is the end of that attempt and the player starts again
 * somewhere new. AFTER a colony exists the rule is different and it
 * matters: control should pass to another living ant rather than
 * erasing everything the player built. That needs a colony to be about,
 * so it is not written here — but the shape is left obvious enough that
 * adding it does not mean rewriting this.
 */
const LIVE = 'rgb(110, 255, 150)';

export class DeathScreen {
  private readonly root: HTMLDivElement;

  constructor(host: HTMLElement, private readonly again: () => void) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'death';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: '24px',
      background: 'rgba(6, 4, 3, .88)',
      backdropFilter: 'blur(3px)',
      zIndex: '60',
      textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);

    const said = document.createElement('div');
    said.innerHTML = `
      <div style="font:800 24px/1.2 'Chakra Petch',system-ui,sans-serif;
                  letter-spacing:.12em;color:rgba(255,170,150,.95)">THE QUEEN HAS DIED</div>
      <div style="margin-top:8px;font:13px/1.6 system-ui,sans-serif;
                  color:rgba(255,226,160,.6);max-width:34ch">
        She never founded a colony, so there is nothing to carry on.
        Begin again somewhere else on the island.
      </div>`;

    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.ui = 'choose-new-start';
    go.textContent = 'CHOOSE NEW START';
    Object.assign(go.style, {
      appearance: 'none',
      padding: '14px 26px',
      borderRadius: '11px',
      border: `2px solid ${LIVE}`,
      background: 'rgba(110,255,150,.14)',
      color: LIVE,
      font: '700 14px/1 system-ui, sans-serif',
      letterSpacing: '.1em',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    go.addEventListener('click', () => this.again());

    this.root.append(said, go);
    host.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }
}
