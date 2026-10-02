import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  /** Destructive action: danger button, and the focus starts on Cancel. */
  danger?: boolean;
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirm = create<ConfirmState>()(() => ({ request: null }));

/** Asks for confirmation in a modal; resolves to true when confirmed. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(false);
    useConfirm.setState({ request: { ...request, resolve } });
  });
}

export function settleConfirm(ok: boolean): void {
  const { request } = useConfirm.getState();
  useConfirm.setState({ request: null });
  request?.resolve(ok);
}
