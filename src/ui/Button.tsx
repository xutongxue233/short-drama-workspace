import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    disabled,
    type = "button",
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={cx(
        "ui-button",
        `ui-button-${variant}`,
        `ui-control-${size}`,
        loading && "ui-is-loading",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className="ui-button-content">{children}</span>
      {loading && <span className="ui-spinner" aria-hidden="true" />}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  label: string;
  size?: "sm" | "md";
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      size = "sm",
      loading = false,
      className,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        aria-label={label}
        title={props.title ?? label}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cx(
          "ui-icon-button",
          `ui-control-${size}`,
          loading && "ui-is-loading",
          className,
        )}
      >
        <span className="ui-button-content" aria-hidden="true">
          {children}
        </span>
        {loading && <span className="ui-spinner" aria-hidden="true" />}
      </button>
    );
  },
);
