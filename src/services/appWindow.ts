import { getCurrentWindow } from "@tauri-apps/api/window";

const win = () => getCurrentWindow();

export const appWindow = {
  minimize: () => win().minimize(),
  toggleMaximize: () => win().toggleMaximize(),
  close: () => win().close(),
  isMaximized: () => win().isMaximized(),
  isFocused: () => win().isFocused(),
  onResized: (cb: () => void) => win().onResized(cb),
  onFocusChanged: (cb: (focused: boolean) => void) => win().onFocusChanged((e) => cb(e.payload)),
  /** Runs `beforeClose` (e.g. flushing saves) before the window closes. */
  onCloseRequested: (beforeClose: () => Promise<void>) => win().onCloseRequested(() => beforeClose()),
};
