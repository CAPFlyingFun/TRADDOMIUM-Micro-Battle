/**
 * SIZE A STACK OF LAYERS AS ONE BOX, TO COVER THE SCREEN.
 *
 * The splash is a sandwich — a dark backing, a fill that changes width,
 * and the artwork on top with the bar's interior cut out of it — and
 * the only thing holding it together is that all three live in the same
 * box and are placed in fractions of it. Size that one box and every
 * layer follows. There is no per-layer arithmetic to get wrong, which
 * is the entire reason the bar stopped sliding off its rails.
 *
 * COVER, NOT CONTAIN. Fitting the picture inside the screen leaves bars
 * down the sides on a phone, and no amount of blurred backdrop makes
 * that look like anything but a picture in a box. Covering means the
 * box is bigger than the screen and the overflow is clipped, which is
 * what a splash screen should do.
 *
 * The catch is what gets clipped. A 16:9 picture on a 2.6:1 phone loses
 * a quarter of its height, and if that comes off evenly the caption
 * under the bar goes with it. So the box is centred only as far as it
 * can be while keeping the bottom of the readout on screen.
 */

export interface CoverFit {
  /** The layers, back to front. They all share the one box. */
  readonly layers: readonly HTMLElement[];
  /** Stop watching. */
  readonly stop: () => void;
}

/**
 * Keep a stack of layers covering their parent, at a fixed shape.
 *
 * @param box the single element every layer is positioned inside
 * @param parent what it has to cover
 * @param ratio width over height of the artwork
 * @param keepVisible fraction of the box's HEIGHT that must stay on
 *   screen — the bottom of the lowest caption. Pass 1 to keep all of it
 *   and accept letterboxing on extreme shapes.
 */
export function fitCover(
  box: HTMLElement,
  parent: HTMLElement,
  ratio: number,
  keepVisible = 1,
): () => void {
  const apply = (): void => {
    const wide = parent.clientWidth;
    const tall = parent.clientHeight;
    if (wide <= 0 || tall <= 0) return;

    // Cover: whichever side falls short decides the size.
    const width = Math.max(wide, tall * ratio);
    const height = width / ratio;

    // Centred, then slid up if centring would push the caption off the
    // bottom, then held so the slide never uncovers the top edge.
    const centred = (tall - height) / 2;
    const needed = tall - keepVisible * height;
    const top = Math.min(0, Math.max(tall - height, Math.min(centred, needed)));

    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.marginLeft = `${(wide - width) / 2}px`;
    box.style.marginTop = `${top}px`;
  };

  const watch = new ResizeObserver(apply);
  watch.observe(parent);
  apply();
  return () => watch.disconnect();
}
