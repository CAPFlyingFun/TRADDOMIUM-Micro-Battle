export interface SoilInspectorHooks {
  onWorm(): boolean;
  /** Millimetres below the surface. Zero restores the ordinary view. */
  onDepth(mm: number): void;
}

/** An observer tool: its controls select a view and never submit a dig. */
export class SoilInspector {
  private readonly root = document.createElement('div');
  private readonly panel = document.createElement('section');
  private readonly toggle: HTMLButtonElement;
  private readonly slider = document.createElement('input');
  private readonly depthLabel = document.createElement('label');
  private readonly status = document.createElement('p');
  private readonly message = document.createElement('p');

  constructor(host: HTMLElement, private readonly hooks: SoilInspectorHooks) {
    this.root.className = 'soil-inspector';
    const button = (action: string, label: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.action = action;
      b.textContent = label; b.addEventListener('click', click); return b;
    };
    this.panel.dataset.soilPanel = ''; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Soil inspection');
    this.toggle = button('soil', 'SOIL', () => {
      if (!this.panel.hidden) this.close();
      else { this.panel.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); }
    });
    this.toggle.setAttribute('aria-label', 'Inspect soil and burrows');
    this.toggle.setAttribute('aria-expanded', 'false');
    const title = document.createElement('strong'); title.textContent = 'BURROWS';
    const head = document.createElement('div'); head.className = 'soil-inspector-row';
    head.append(title, button('soil-close', 'Close', () => this.close()));
    const actions = document.createElement('div'); actions.className = 'soil-inspector-row';
    actions.append(button('soil-worm', 'Find worm', () => {
      if (hooks.onWorm()) { this.message.textContent = 'Cutaway on. Movement is slowed for a closer look.'; this.setDepth(12); }
      else this.message.textContent = 'No worm nearby. Try another area of the island.';
    }), button('soil-surface', 'Surface', () => { this.setDepth(0); this.message.textContent = 'Normal view and camera speed.'; }));
    this.slider.type = 'range'; this.slider.min = '0'; this.slider.max = '24'; this.slider.step = '1'; this.slider.value = '0';
    this.slider.setAttribute('aria-label', 'Cutaway depth in millimetres');
    this.depthLabel.append(document.createTextNode('Surface view'), this.slider);
    this.slider.addEventListener('input', () => this.setDepth(Number(this.slider.value)));
    this.status.setAttribute('role', 'status');
    this.message.textContent = 'Find a worm, then change the depth to see its saved tunnels.';
    this.panel.append(head, actions, this.depthLabel, this.status, this.message);
    this.root.append(this.panel, this.toggle);
    // A thumb on the slider and an arrow key on a focused control belong
    // to the tool, not to the camera behind it.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'])
      this.root.addEventListener(type, event => event.stopPropagation());
    this.root.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); this.toggle.focus(); }
    });
    host.append(this.root);
  }

  private setDepth(mm: number): void {
    const value = Math.max(0, Math.min(24, Number.isFinite(mm) ? mm : 0));
    this.slider.value = String(value);
    this.depthLabel.firstChild!.textContent = value === 0 ? 'Surface view' : `Cutaway · ${value} mm deep`;
    this.hooks.onDepth(value);
  }

  private close(): void {
    this.setDepth(0); this.panel.hidden = true; this.toggle.setAttribute('aria-expanded', 'false');
  }

  update(cuts: number, atLimit: boolean, preparing: boolean): void {
    const text = atLimit ? 'Digging paused: local save limit reached.'
      : preparing ? 'Preparing soil view…' : `${cuts.toLocaleString()} soil cuts · saves on pause`;
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  dispose(): void { this.root.remove(); }
}
