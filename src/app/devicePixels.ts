import { watchDevicePixelRatio } from "../editor/devicePixels";

/** `--dpr` on the root: page backgrounds draw whole physical pixels (decision P10-15). */
export function connectDevicePixels(): void {
  const apply = (dpr: number) => document.documentElement.style.setProperty("--dpr", String(dpr || 1));
  apply(window.devicePixelRatio);
  watchDevicePixelRatio(apply);
}
