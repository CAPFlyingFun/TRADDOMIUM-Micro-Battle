/** Phase 0 placeholder — replaced by the ui agent's real screens. Shared scraps of DOM. */

export function panel(uiLayer: HTMLElement, heading: string): HTMLElement {
  const root = uiLayer.ownerDocument.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:12px;color:#e8e2c8;font:16px system-ui,sans-serif;';
  const title = uiLayer.ownerDocument.createElement('h1');
  title.textContent = heading;
  title.style.cssText = 'margin:0 0 8px;font-size:22px;letter-spacing:0.04em;';
  root.appendChild(title);
  uiLayer.appendChild(root);
  return root;
}

export function styleButton(button: HTMLButtonElement): HTMLButtonElement {
  button.style.cssText =
    'min-width:220px;padding:12px 18px;font:inherit;color:inherit;background:#1a2014;' +
    'border:1px solid #c9a94a;border-radius:6px;';
  if (button.disabled) button.style.opacity = '0.45';
  return button;
}
