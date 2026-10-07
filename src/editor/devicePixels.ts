/**
 * The window's scale (Windows display scaling: 1, 1.25, 1.5, 1.75…). It
 * changes when the window moves to a screen with another scale: `listener`
 * runs then (a media query on the current resolution, renewed each time).
 */
export function watchDevicePixelRatio(listener: (dpr: number) => void): () => void {
  let query: MediaQueryList | null = null;
  const onChange = () => {
    listen();
    listener(window.devicePixelRatio);
  };
  const listen = () => {
    query?.removeEventListener("change", onChange);
    query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", onChange);
  };
  listen();
  return () => query?.removeEventListener("change", onChange);
}

/** `cssPx` rounded to a whole number of physical pixels. */
export function snap(cssPx: number, dpr: number): number {
  return Math.round(cssPx * dpr) / dpr;
}
