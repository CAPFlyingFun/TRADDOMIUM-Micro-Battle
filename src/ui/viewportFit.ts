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
export function fitViewport(): () => void {
  const apply = () => {
    const seen = window.visualViewport;
    const height = seen ? seen.height : window.innerHeight;
    if (height > 0) {
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    }
  };

  const seen = window.visualViewport;
  seen?.addEventListener('resize', apply);
  seen?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();

  return () => {
    seen?.removeEventListener('resize', apply);
    seen?.removeEventListener('scroll', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
