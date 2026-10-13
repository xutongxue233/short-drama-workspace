import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useRef,
  useState,
  type FormHTMLAttributes,
} from "react";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export interface FieldValidationAttributes {
  "data-validation-field"?: string;
  "data-validation-label"?: string;
  "data-validation-message"?: string;
}
interface Issue {
  message: string;
  control: Control;
  field: boolean;
}
interface FormValidation {
  errors: Readonly<Record<string, string>>;
}
const FormContext = createContext<FormValidation | null>(null);
export const useFormValidation = () => useContext(FormContext);

function isControl(element: unknown): element is Control {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function labelFor(control: Control) {
  const label = control.labels?.[0];
  return (
    control.dataset.validationLabel ||
    label?.querySelector("span")?.textContent?.trim() ||
    label?.textContent?.trim() ||
    control.getAttribute("aria-label") ||
    control.name ||
    "此项"
  );
}

/** Inspect native validity without checkValidity/reportValidity or native popovers. */
function validationError(control: Control): string | undefined {
  if (
    control.matches(":disabled") ||
    ("readOnly" in control && control.readOnly) ||
    !control.willValidate
  )
    return undefined;
  const label = labelFor(control);
  const validity = control.validity;
  const text =
    control instanceof HTMLTextAreaElement ||
    (control instanceof HTMLInputElement &&
      ["text", "search", "tel", "url", "email", "password"].includes(control.type));
  const blank =
    text &&
    (control instanceof HTMLInputElement && control.type === "password"
      ? !control.value.length
      : !control.value.trim().length);
  if (validity.badInput) return `请为${label}输入有效值`;
  if (validity.valueMissing || (control.required && blank)) {
    if (control instanceof HTMLSelectElement) return `请选择${label}`;
    if (
      control instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(control.type)
    )
      return `请选择${label}`;
    return `请填写${label}`;
  }
  if (validity.customError) return control.validationMessage || `${label}填写有误`;
  // Native tooShort/tooLong may remain false for programmatically populated values.
  if (text && control.value) {
    const min = Number(control.getAttribute("minlength") ?? -1);
    const max = Number(control.getAttribute("maxlength") ?? -1);
    if (min >= 0 && control.value.length < min) return `${label}至少需要 ${min} 个字符`;
    if (max >= 0 && control.value.length > max) return `${label}最多允许 ${max} 个字符`;
  }
  if (validity.typeMismatch) {
    if (control instanceof HTMLInputElement && control.type === "email")
      return "请输入有效的邮箱地址";
    if (control instanceof HTMLInputElement && control.type === "url")
      return "请输入完整网址，例如 https://example.com";
    return `${label}格式不正确`;
  }
  if (validity.patternMismatch)
    return control.dataset.validationMessage || `${label}格式不正确`;
  if (validity.rangeUnderflow) return `${label}不能小于 ${control.getAttribute("min")}`;
  if (validity.rangeOverflow) return `${label}不能大于 ${control.getAttribute("max")}`;
  if (validity.stepMismatch)
    return `${label}须符合步长 ${control.getAttribute("step") || "1"}`;
  if (!validity.valid) return `${label}填写有误`;
  return undefined;
}

function focusControl(control: Control) {
  const target = control.dataset.validationTarget;
  const visible = target ? control.ownerDocument.getElementById(target) : control;
  (visible || control).focus();
}

function eventControl(
  form: HTMLFormElement,
  target: EventTarget | null,
): Control | undefined {
  if (isControl(target) && target.form === form) return target;
  if (!(target instanceof HTMLElement)) return undefined;
  const controlId = target.closest<HTMLElement>("[data-validation-control]")?.dataset
    .validationControl;
  const control = controlId ? form.ownerDocument.getElementById(controlId) : null;
  return isControl(control) && control.form === form ? control : undefined;
}

export type FormProps = FormHTMLAttributes<HTMLFormElement>;

/** Standard form semantics with accessible inline validation instead of browser bubbles. */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  {
    children,
    onSubmit,
    onBlurCapture,
    onInputCapture,
    onChangeCapture,
    onChange,
    onInvalidCapture,
    onReset,
    noValidate: _noValidate,
    ...props
  },
  ref,
) {
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const touched = useRef(new Set<string>());
  const submitted = useRef(false);
  const anonymousKeys = useRef(new WeakMap<Control, string>());
  const nextKey = useRef(0);
  const summaryId = useId();
  function keyFor(control: Control) {
    const named = control.dataset.validationTarget || control.id;
    if (named) return named;
    let key = anonymousKeys.current.get(control);
    if (!key) {
      key = `anonymous-${nextKey.current++}`;
      anonymousKeys.current.set(control, key);
    }
    return key;
  }
  function issueFor(control: Control): Issue | undefined {
    const message = validationError(control);
    const field = control.closest<HTMLElement>("[data-validation-field]")?.dataset
      .validationField;
    return message ? { message, control, field: field === keyFor(control) } : undefined;
  }
  function update(control: Control, touch = false) {
    const key = keyFor(control);
    if (touch) touched.current.add(key);
    if (!submitted.current && !touched.current.has(key)) return;
    const issue = issueFor(control);
    setIssues((previous) => {
      const next = { ...previous };
      if (issue) next[key] = issue;
      else delete next[key];
      return next;
    });
  }
  const errors = Object.fromEntries(
    Object.entries(issues).map(([id, issue]) => [id, issue.message]),
  );
  const fallback = Object.entries(issues).filter(
    ([, issue]) => !issue.field && issue.control.isConnected,
  );
  return (
    <FormContext.Provider value={{ errors }}>
      <form
        {...props}
        ref={ref}
        noValidate
        onSubmit={(event) => {
          if (event.defaultPrevented) return;
          submitted.current = true;
          const next: Record<string, Issue> = {};
          let first: Issue | undefined;
          for (const element of Array.from(event.currentTarget.elements)) {
            if (!isControl(element)) continue;
            const issue = issueFor(element);
            if (issue) {
              next[keyFor(element)] = issue;
              first ??= issue;
            }
          }
          setIssues(next);
          if (first) {
            event.preventDefault();
            focusControl(first.control);
            return;
          }
          onSubmit?.(event);
        }}
        onBlurCapture={(event) => {
          onBlurCapture?.(event);
          const control = eventControl(event.currentTarget, event.target);
          const related = event.relatedTarget;
          if (
            control &&
            control.dataset.validationTarget &&
            related instanceof HTMLElement &&
            related.closest<HTMLElement>("[data-validation-owner]")?.dataset
              .validationOwner === control.dataset.validationTarget
          )
            return;
          if (control) update(control, true);
        }}
        onInputCapture={onInputCapture}
        onChangeCapture={onChangeCapture}
        onChange={(event) => {
          // React must let the control's onChange commit its value before a
          // validation render; capture-phase updates can restore a stale value.
          onChange?.(event);
          const control = eventControl(event.currentTarget, event.target);
          if (control) update(control);
        }}
        onInvalidCapture={(event) => {
          event.preventDefault();
          onInvalidCapture?.(event);
          const control = eventControl(event.currentTarget, event.target);
          if (control) update(control, true);
        }}
        onReset={(event) => {
          onReset?.(event);
          if (event.defaultPrevented) return;
          submitted.current = false;
          touched.current.clear();
          setIssues({});
        }}
      >
        {children}
        {fallback.length > 0 && (
          <div className="ui-field-error ui-form-errors" id={summaryId} role="alert">
            {fallback.map(([id, issue]) => (
              <div key={id}>{issue.message}</div>
            ))}
          </div>
        )}
      </form>
    </FormContext.Provider>
  );
});
