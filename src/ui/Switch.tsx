import { forwardRef } from "react";
import { cx } from "./cx";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, disabled, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("ui-switch", className)}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  );
});
