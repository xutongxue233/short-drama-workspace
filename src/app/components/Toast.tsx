import { AlertCircle, CheckCheck, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ToastMessage } from "../../shared/contracts";

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
}) {
  return createPortal(
    <div
      className={`toast ${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      {toast.kind === "error" ? <AlertCircle size={17} /> : <CheckCheck size={17} />}
      <span>{toast.message}</span>
      <button aria-label="关闭提示" onClick={() => onDismiss()}>
        <X size={15} />
      </button>
    </div>,
    document.body,
  );
}
