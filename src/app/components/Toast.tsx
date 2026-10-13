import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ToastMessage } from "../../shared/contracts";
import { IconButton } from "../../ui";

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.visibilityState === "hidden");
  const remaining = useRef(4500);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    remaining.current = 4500;
  }, [toast]);
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    // Failures stay available for reading/copying; success notices pause while read.
    if (toast.kind === "error" || hovered || focused || hidden) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [toast, hovered, focused, hidden]);
  const Icon = toast.kind === "error" ? CircleAlert : CircleCheck;
  return createPortal(
    <div
      className={`ui-toast ui-toast-${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{toast.message}</span>
      <IconButton label="关闭提示" size="sm" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </IconButton>
    </div>,
    document.body,
  );
}
