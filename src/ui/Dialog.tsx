import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { Button, IconButton, type ButtonProps } from "./Button";

type OpenDialog = {
  host: HTMLDivElement;
  panel: HTMLDivElement;
  restore: HTMLElement | null;
};
const openDialogs: OpenDialog[] = [];
let backgroundState: {
  root: HTMLElement | null;
  inert: boolean;
  overflow: string;
  paddingRight: string;
} | null = null;

function syncDialogLayers() {
  openDialogs.forEach((entry, index) => {
    entry.host.inert = index !== openDialogs.length - 1;
    entry.host.style.zIndex = String(1000 + index);
  });
}

function focusableElements(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      getComputedStyle(element).visibility !== "hidden" &&
      element.getClientRects().length > 0,
  );
}

export interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
  dirty?: boolean;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const DialogContext = createContext<{
  requestClose: () => void;
  busy: boolean;
} | null>(null);

export const DialogClose = forwardRef<HTMLButtonElement, ButtonProps>(
  function DialogClose({ onClick, disabled, children = "取消", ...props }, ref) {
    const dialog = useContext(DialogContext);
    return (
      <Button
        {...props}
        ref={ref}
        disabled={disabled || dialog?.busy}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) dialog?.requestClose();
        }}
      >
        {children}
      </Button>
    );
  },
);

export function Dialog({
  title,
  description,
  onClose,
  children,
  wide = false,
  busy = false,
  dirty = false,
  className,
  initialFocusRef,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationRestore = useRef<HTMLElement | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      confirmationRestore.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else onClose();
  };
  const callbacks = useRef({
    onClose,
    busy,
    initialFocusRef,
    requestClose,
    confirmClose,
  });
  callbacks.current = {
    onClose,
    busy,
    initialFocusRef,
    requestClose,
    confirmClose,
  };
  const pointerStartedOnBackdrop = useRef(false);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "ui-dialog-host";
    return element;
  });

  useLayoutEffect(() => {
    const restore =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(host);
    const panel = panelRef.current;
    if (!panel) return () => host.remove();
    if (!openDialogs.length) {
      const root = document.getElementById("root");
      backgroundState = {
        root,
        inert: root?.inert ?? false,
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight,
      };
      if (root) root.inert = true;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0)
        document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
      document.body.style.overflow = "hidden";
    }
    const entry = { host, panel, restore };
    openDialogs.push(entry);
    syncDialogLayers();
    const initialFocus = callbacks.current.initialFocusRef?.current;
    // Headings remain visible on long forms; explicit initial focus can target a field.
    if (
      initialFocus &&
      panel.contains(initialFocus) &&
      !initialFocus.matches(":disabled")
    )
      initialFocus.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });

    let composing = false;
    const isTop = () => openDialogs[openDialogs.length - 1] === entry;
    const compositionStart = () => {
      composing = true;
    };
    const compositionEnd = () => {
      composing = false;
    };
    const keydown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (
        event.key === "Escape" &&
        !event.isComposing &&
        !composing &&
        event.keyCode !== 229
      ) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (!callbacks.current.busy) {
          if (callbacks.current.confirmClose) setConfirmClose(false);
          else callbacks.current.requestClose();
        }
      }
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const focusable = focusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || active === panel || !panel.contains(active))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (active === last || active === panel || !panel.contains(active))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !panel.contains(event.target))
        panel.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    document.addEventListener("compositionstart", compositionStart);
    document.addEventListener("compositionend", compositionEnd);

    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      document.removeEventListener("compositionstart", compositionStart);
      document.removeEventListener("compositionend", compositionEnd);
      const wasTop = isTop();
      const index = openDialogs.indexOf(entry);
      if (index >= 0) openDialogs.splice(index, 1);
      host.remove();
      syncDialogLayers();
      if (!openDialogs.length && backgroundState) {
        if (backgroundState.root) backgroundState.root.inert = backgroundState.inert;
        document.body.style.overflow = backgroundState.overflow;
        document.body.style.paddingRight = backgroundState.paddingRight;
        backgroundState = null;
      }
      if (wasTop) {
        if (
          restore?.isConnected &&
          !restore.closest("[inert]") &&
          !restore.matches(":disabled")
        )
          restore.focus({ preventScroll: true });
        else
          openDialogs[openDialogs.length - 1]?.panel.focus({
            preventScroll: true,
          });
      }
    };
  }, [host]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!confirmClose || !panel) return;
    const content = Array.from(panel.children)
      .filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          !node.classList.contains("ui-dialog-header") &&
          node !== confirmationRef.current,
      )
      .map((node) => ({ node, inert: node.inert }));
    content.forEach(({ node }) => {
      node.inert = true;
    });
    continueButtonRef.current?.focus({ preventScroll: true });
    return () => {
      content.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      const previous = confirmationRestore.current;
      if (
        previous?.isConnected &&
        !previous.closest("[inert]") &&
        !previous.matches(":disabled")
      )
        previous.focus({ preventScroll: true });
      else panel.focus({ preventScroll: true });
    };
  }, [confirmClose]);

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      onPointerDown={(event) => {
        pointerStartedOnBackdrop.current =
          event.target === event.currentTarget && event.button === 0;
      }}
      onPointerCancel={() => {
        pointerStartedOnBackdrop.current = false;
      }}
      onClick={(event) => {
        if (
          pointerStartedOnBackdrop.current &&
          event.target === event.currentTarget &&
          !callbacks.current.busy &&
          !callbacks.current.confirmClose
        )
          callbacks.current.requestClose();
        pointerStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cx("ui-dialog", wide && "ui-dialog-wide", className)}
      >
        <header className="ui-dialog-header">
          <div className="ui-dialog-heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton
            label="关闭弹窗"
            disabled={busy || confirmClose}
            onClick={requestClose}
            className="ui-dialog-close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </IconButton>
        </header>
        {confirmClose && (
          <div ref={confirmationRef} className="ui-dialog-confirm" role="alert">
            <div>
              <strong>有尚未保存的修改</strong>
              <p>放弃修改后，本次编辑的内容不会保存。</p>
            </div>
            <div className="ui-dialog-confirm-actions">
              <Button
                ref={continueButtonRef}
                size="sm"
                disabled={busy}
                onClick={() => setConfirmClose(false)}
              >
                继续编辑
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={onClose}>
                放弃修改
              </Button>
            </div>
          </div>
        )}
        <DialogContext.Provider value={{ requestClose, busy }}>
          {children}
        </DialogContext.Provider>
      </div>
    </div>,
    host,
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-dialog-body", className)} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-dialog-footer", className)} />;
}
