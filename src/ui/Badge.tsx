import { type HTMLAttributes } from "react";
import { cx } from "./cx";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span {...props} className={cx("ui-badge", `ui-badge-${tone}`, className)}>
      {children}
    </span>
  );
}
