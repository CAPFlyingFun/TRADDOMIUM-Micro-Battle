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

/** What the artwork currently in the box needs. */
export interface Shape {
  readonly ratio: number;
  /** Fraction of the artwork's HEIGHT that must stay on screen. */
  readonly keepVisible: number;
  /** Fraction of its WIDTH that must stay on screen. */
  readonly keepWide: number;
}

/**
 * Keep a stack of layers covering their parent, at a fixed shape.
 *
 * @param box the single element every layer is positioned inside
 * @param parent what it has to cover
 * @param shape asked on every resize rather than fixed once: turning
 *   the phone swaps the artwork for one composed the other way round,
 *   and its ratio and its caption are both somewhere else. Returns the
 *   artwork's width over height, and the fraction of its HEIGHT that
 *   must stay on screen — the bottom of the lowest caption.
 */
export function fitCover(
  box: HTMLElement,
  parent: HTMLElement,
  shape: () => Shape,
): () => void {
  const apply = (): void => {
    const wide = parent.clientWidth;
    const tall = parent.clientHeight;
    if (wide <= 0 || tall <= 0) return;
    const { ratio, keepVisible, keepWide } = shape();

    // Cover: whichever side falls short decides the size.
    let width = Math.max(wide, tall * ratio);

    // EXCEPT WHEN COVERING WOULD CUT THE BAR IN HALF. A phone taller
    // than the artwork crops its sides, and the loading bar runs most
    // of the way across — on Joshua's phone that sliced the rounded end
    // clean off and left the bar running out of the screen. Where the
    // two demands collide the bar wins: the picture stops covering and
    // is let out to the dark at the top and bottom, which looks
    // deliberate, where a bar with no end looks broken.
    const widest = wide / keepWide;
    if (width > widest) width = Math.max(wide, widest);
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
