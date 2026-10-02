import { getCurrentWindow } from "@tauri-apps/api/window";

const win = () => getCurrentWindow();

export const appWindow = {
  minimize: () => win().minimize(),
  toggleMaximize: () => win().toggleMaximize(),
  close: () => win().close(),
  /** Closes without emitting close-requested again. */
  destroy: () => win().destroy(),
  isMaximized: () => win().isMaximized(),
  isFocused: () => win().isFocused(),
  onResized: (cb: () => void) => win().onResized(cb),
  onFocusChanged: (cb: (focused: boolean) => void) => win().onFocusChanged((e) => cb(e.payload)),
  /** Runs `beforeClose` before the window closes; it returns false to keep the window open. */
  onCloseRequested: (beforeClose: () => Promise<boolean>) =>
    win().onCloseRequested(async (event) => {
      if (!(await beforeClose())) event.preventDefault();
    }),
};
