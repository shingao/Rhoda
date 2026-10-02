import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
  /** The window starts hidden (no white flash) and is shown after the first render. */
  show: () => win().show(),
  /** Native window and webview background, behind the app (seen while resizing). */
  setBackground: async (color: string) => {
    await win().setBackgroundColor(color);
    await getCurrentWebviewWindow().setBackgroundColor(color);
  },
  onResized: (cb: () => void) => win().onResized(cb),
  onFocusChanged: (cb: (focused: boolean) => void) => win().onFocusChanged((e) => cb(e.payload)),
  /** Runs `beforeClose` before the window closes; it returns false to keep the window open. */
  onCloseRequested: (beforeClose: () => Promise<boolean>) =>
    win().onCloseRequested(async (event) => {
      if (!(await beforeClose())) event.preventDefault();
    }),
};
