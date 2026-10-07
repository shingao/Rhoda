import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { CrashScreen } from "../features/crash/CrashScreen";
import { logEntry } from "./log";

interface State {
  error: Error | null;
}

/**
 * A rendering error never takes the app down with a blank window: the crash
 * screen saves the pending text, then offers to reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Component names only (no props, no text).
    const components = (info.componentStack ?? "")
      .split("\n")
      .map((l) => /at (\w+)/.exec(l)?.[1])
      .filter(Boolean)
      .slice(0, 8)
      .join(" < ");
    logEntry("error", "render", [`[render] in ${components || "?"}`, error]);
  }

  render(): ReactNode {
    if (this.state.error) return <CrashScreen error={this.state.error} />;
    return (
      <>
        {DEV_TOOLS && <DevCrash />}
        {this.props.children}
      </>
    );
  }
}

const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_URSA_MOCK === "1";

/** Development only: `window.__ursaCrash()` makes a component throw while rendering. */
function DevCrash() {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    (window as unknown as { __ursaCrash?: () => void }).__ursaCrash = () => setCrash(true);
  }, []);
  if (crash) throw new Error("Test crash (window.__ursaCrash)");
  return null;
}
