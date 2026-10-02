import { useRef } from "react";
import { settleConfirm, useConfirm } from "../app/confirm";
import { useT } from "../app/i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

/** Renders the pending confirmation, if any (see app/confirm.ts). */
export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  if (!request) return null;
  return (
    <Modal
      title={request.title}
      subtitle={request.body}
      closeLabel={t.modal.close}
      onClose={() => settleConfirm(false)}
      initialFocus={request.danger ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => settleConfirm(false)}>
            {t.dialog.cancel}
          </Button>
          <Button ref={confirmRef} variant={request.danger ? "danger" : "primary"} onClick={() => settleConfirm(true)}>
            {request.confirmLabel}
          </Button>
        </>
      }
    />
  );
}
