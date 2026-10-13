import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  action?: ReactNode;
}

/** Contextual feedback stays next to the operation until it can be resolved. */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
  ...props
}: AlertProps) {
  const Icon = {
    info: Info,
    success: CircleCheck,
    warning: TriangleAlert,
    danger: CircleAlert,
  }[tone];
  return (
    <div
      {...props}
      className={cx("ui-alert", `ui-alert-${tone}`, className)}
      role={role ?? (tone === "danger" ? "alert" : tone === "info" ? "note" : "status")}
    >
      <Icon className="ui-alert-icon" size={17} aria-hidden="true" />
      <div className="ui-alert-content">
        {title && <strong className="ui-alert-title">{title}</strong>}
        {children && <div className="ui-alert-message">{children}</div>}
      </div>
      {action && <div className="ui-alert-action">{action}</div>}
    </div>
  );
}
