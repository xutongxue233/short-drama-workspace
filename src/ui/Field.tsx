import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

interface FieldContextValue {
  id: string;
  descriptionId?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

/** A stable id for manually associating a custom control with a Field's helper text. */
export function fieldDescriptionId(id: string) {
  return `${id}-description`;
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children?: ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
  ...props
}: FieldProps) {
  const description = error || hint;
  const descriptionId = description ? fieldDescriptionId(htmlFor) : undefined;
  return (
    <FieldContext.Provider
      value={{ id: htmlFor, descriptionId, invalid: Boolean(error) }}
    >
      <div
        {...props}
        className={cx("ui-field", Boolean(error) && "ui-field-invalid", className)}
      >
        <label className="ui-field-label" htmlFor={htmlFor}>
          <span>{label}</span>
          {optional && <span className="ui-field-optional">选填</span>}
        </label>
        {children}
        {description && (
          <div
            id={descriptionId}
            className={cx("ui-field-description", Boolean(error) && "ui-field-error")}
            role={error ? "alert" : undefined}
          >
            {description}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function useFieldControl(
  id: string | undefined,
  invalid: boolean | undefined,
  describedBy: string | undefined,
) {
  const field = useContext(FieldContext);
  const linkedField = !id || id === field?.id ? field : null;
  return {
    id: id ?? linkedField?.id,
    "aria-invalid": invalid ?? (linkedField?.invalid || undefined),
    "aria-describedby":
      [describedBy, linkedField?.descriptionId].filter(Boolean).join(" ") || undefined,
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    invalid,
    id,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const linked = useFieldControl(id, invalid, describedBy);
  return (
    <input
      {...props}
      {...linked}
      ref={ref}
      aria-invalid={ariaInvalid ?? linked["aria-invalid"]}
      className={cx("ui-input", className)}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      className,
      invalid,
      id,
      "aria-describedby": describedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) {
    const linked = useFieldControl(id, invalid, describedBy);
    return (
      <textarea
        {...props}
        {...linked}
        ref={ref}
        aria-invalid={ariaInvalid ?? linked["aria-invalid"]}
        className={cx("ui-textarea", className)}
      />
    );
  },
);
