/**
 * FITTING THE VISIBLE SCREEN, not the notional one.
 *
 * A browser toolbar can overlay the layout viewport rather than shrink
 * it, so `position: fixed; inset: 0` happily runs underneath the URL
 * bar and takes the top of the HUD with it — which is exactly what a
 * third-party iOS browser did to the throttle.
 *
 * `visualViewport` is the only thing that reports what is actually on
 * screen, so its height becomes a custom property the layout uses.
 * `100dvh` is the fallback for anything without it.
 */

/**
 * Frames the reported height must hold still before it is believed.
 *
 * THE FLASH THIS FIXES. `visualViewport` does not report a settled
 * height — it reports a running commentary. iOS fires `scroll` on it
 * throughout the toolbar's show/hide animation and on every
 * rubber-band, and the height is different on each one. Writing each
 * of those straight into `--app-height` resizes `#app` (and therefore
 * the canvas and every HUD anchor inside it) several times over a
 * third of a second, which is seen as exactly what Joshua described:
 * the ground detail jumping, the HUD ducking out, and everything
 * settling again a moment later. A single faked scroll event grew the
 * app box from 430 to 507 px in a headless repro.
 *
 * The height is real, so it still gets applied — just once the device
 * has stopped arguing about what it is.
 */
const SETTLE_FRAMES = 3;

/** Changes smaller than this are not worth a relayout. */
const NOISE_PX = 1;

export function fitViewport(): () => void {
  const seen = window.visualViewport;
  const read = (): number => (seen ? seen.height : window.innerHeight);

  let applied = 0;
  let pending = 0;

  const write = (height: number): void => {
    if (height <= 0 || Math.abs(height - applied) < NOISE_PX) return;
    applied = height;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };

  /**
   * Wait for the reported height to repeat itself before believing it.
   * Any fresh number restarts the count, so a burst of twenty events
   * during a toolbar animation costs one relayout at the end of it
   * rather than twenty along the way.
   */
  const settle = (): void => {
    let held = 0;
    let last = read();
    const step = (): void => {
      const now = read();
      held = Math.abs(now - last) < NOISE_PX ? held + 1 : 0;
      last = now;
      if (held >= SETTLE_FRAMES) {
        pending = 0;
        write(now);
        return;
      }
      pending = requestAnimationFrame(step);
    };
    pending = requestAnimationFrame(step);
  };

  const apply = (): void => {
    if (pending) return;   // already waiting for this burst to end
    settle();
  };

  seen?.addEventListener('resize', apply);
  seen?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  // The first one is not a change and has nobody to argue with: the
  // layout needs a height before the first paint, not three frames
  // later.
  write(read());

  return () => {
    if (pending) cancelAnimationFrame(pending);
    seen?.removeEventListener('resize', apply);
    seen?.removeEventListener('scroll', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
