import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";
import { useFieldControl } from "./Field";
import { cx } from "./cx";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

interface Choice {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
  index: number;
}

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join("");
}

function choicesFrom(children: ReactNode): Choice[] {
  const choices: Choice[] = [];
  const visit = (nodes: ReactNode, group?: string, disabled = false) => {
    Children.forEach(nodes, (node) => {
      if (
        !isValidElement<SelectHTMLAttributes<HTMLSelectElement> & { label?: string }>(
          node,
        )
      )
        return;
      if (node.type === "option") {
        const label = node.props.label ?? textContent(node.props.children);
        if (!node.props.hidden)
          choices.push({
            value: String(node.props.value ?? textContent(node.props.children)),
            label,
            disabled: disabled || Boolean(node.props.disabled),
            group,
            index: choices.length,
          });
      } else if (node.type === "optgroup") {
        visit(
          node.props.children,
          node.props.label,
          disabled || Boolean(node.props.disabled),
        );
      } else if (node.type === Fragment) visit(node.props.children, group, disabled);
    });
  };
  visit(children);
  return choices;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** The native element handles form submission/validation; only the custom control is exposed. */
const SingleSelect = forwardRef<HTMLSelectElement, SelectProps>(function SingleSelect(
  {
    children,
    value,
    defaultValue,
    onChange,
    onInvalid,
    name,
    form,
    required,
    autoComplete,
    disabled,
    className,
    searchable = false,
    searchPlaceholder = "搜索选项…",
    id,
    onKeyDown,
    onClick,
    ...props
  },
  forwardedRef,
) {
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const listId = `${controlId}-list`;
  const options = useMemo(() => choicesFrom(children), [children]);
  const firstValue = options.find((option) => !option.disabled)?.value ?? "";
  const [uncontrolledValue, setUncontrolledValue] = useState(
    String(defaultValue ?? firstValue),
  );
  const selectedValue = String(value ?? uncontrolledValue);
  const selected = options.find((option) => option.value === selectedValue);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const composing = useRef(false);
  const isOpen = Boolean(host) && !disabled;
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const enabled = filtered.filter((option) => !option.disabled);
  const groups: { name?: string; options: Choice[] }[] = [];
  for (const option of filtered) {
    const previous = groups.at(-1);
    if (previous && previous.name === option.group) previous.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }
  const active = enabled.find((option) => option.index === activeIndex) ?? enabled[0];
  const activeId = active ? `${listId}-${active.index}` : undefined;

  function close(restore = false) {
    setHost(null);
    setQuery("");
    typeahead.current = { text: "", time: 0 };
    if (restore) triggerRef.current?.focus({ preventScroll: true });
  }

  function open(initial?: "first" | "last", initialQuery = "") {
    const trigger = triggerRef.current;
    if (!trigger || trigger.matches(":disabled")) return;
    setQuery(initialQuery);
    const available = options.filter((option) => !option.disabled);
    const preferred =
      initial === "last"
        ? available.at(-1)
        : initial === "first"
          ? available[0]
          : selected;
    setActiveIndex(
      preferred && !preferred.disabled ? preferred.index : (available[0]?.index ?? -1),
    );
    // Staying inside the dialog preserves its focus trap and inert boundaries.
    setHost(trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body);
  }

  function commit(option: Choice | undefined, restore = true) {
    const native = nativeRef.current;
    if (!native || !option || option.disabled || native.matches(":disabled")) return;
    if (native.value !== option.value) {
      native.value = option.value;
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close(restore);
  }

  function handleKey(event: KeyboardEvent<HTMLElement>, inSearch = false) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
      return;
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab" && isOpen) {
      // Returning focus before the browser's Tab action resumes the form's natural order.
      commit(active, true);
      if (!active) close(true);
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "PageUp", "PageDown"].includes(event.key)
    ) {
      if (inSearch && ["Home", "End"].includes(event.key) && !event.ctrlKey) return;
      event.preventDefault();
      if (!isOpen) {
        open(event.key === "End" ? "last" : event.key === "Home" ? "first" : undefined);
      } else if (event.altKey && event.key === "ArrowUp") commit(active);
      else {
        const position = enabled.findIndex((option) => option.index === active?.index);
        const delta =
          event.key === "PageDown"
            ? 10
            : event.key === "PageUp"
              ? -10
              : event.key === "ArrowDown"
                ? 1
                : -1;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? enabled.length - 1
              : Math.max(0, Math.min(enabled.length - 1, position + delta));
        setActiveIndex(enabled[next]?.index ?? -1);
      }
      return;
    }
    if (event.key === "Enter" || (event.key === " " && !inSearch)) {
      event.preventDefault();
      if (isOpen) commit(active);
      else open();
      return;
    }
    if (
      !inSearch &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (searchable) {
        open(undefined, event.key);
        return;
      }
      const now = Date.now();
      const text =
        (now - typeahead.current.time < 650 ? typeahead.current.text : "") +
        event.key.toLocaleLowerCase();
      typeahead.current = { text, time: now };
      const repeating = [...text].every((character) => character === text[0]);
      const prefix = repeating ? text[0] : text;
      const available = options.filter((option) => !option.disabled);
      const start = repeating
        ? available.findIndex(
            (option) => option.index === (isOpen ? active?.index : selected?.index),
          ) + 1
        : 0;
      const sorted = [...available.slice(start), ...available.slice(0, start)];
      const match = sorted.find((option) =>
        option.label.toLocaleLowerCase().startsWith(prefix),
      );
      if (!isOpen) open();
      if (match) setActiveIndex(match.index);
    }
  }

  useEffect(() => {
    if (disabled) {
      setHost(null);
      setQuery("");
    }
    const trigger = triggerRef.current;
    const observer = new MutationObserver(() => {
      if (trigger?.matches(":disabled")) {
        setHost(null);
        setQuery("");
      }
    });
    let fieldset = trigger?.closest("fieldset");
    while (fieldset) {
      observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
      fieldset = fieldset.parentElement?.closest("fieldset") ?? null;
    }
    return () => observer.disconnect();
  }, [disabled]);

  useEffect(() => {
    const native = nativeRef.current;
    const ownerForm = native?.form;
    if (!native || !ownerForm) return;
    const reset = (event: Event) => {
      queueMicrotask(() => {
        if (event.defaultPrevented || !native.isConnected) return;
        const next = String(value ?? defaultValue ?? firstValue);
        if (value === undefined) setUncontrolledValue(next);
        native.value = next;
        setHost(null);
        setQuery("");
      });
    };
    ownerForm.addEventListener("reset", reset);
    return () => ownerForm.removeEventListener("reset", reset);
  }, [form, value, defaultValue, firstValue]);

  useLayoutEffect(() => {
    const native = nativeRef.current;
    if (!native) return;
    const originalFocus = native.focus;
    native.focus = (options) => triggerRef.current?.focus(options);
    return () => {
      native.focus = originalFocus;
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    if (typeof popup.showPopover === "function") popup.showPopover();
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const below = topEdge + height - rect.bottom - 14;
      const above = rect.top - topEdge - 14;
      const upwards = below < 180 && above > below;
      const available = Math.max(80, upwards ? above : below);
      const popupWidth = Math.min(
        Math.max(rect.width, searchable ? 240 : 180),
        width - 16,
      );
      popup.style.width = `${popupWidth}px`;
      popup.style.maxHeight = `${Math.min(344, available)}px`;
      popup.style.left = `${Math.max(leftEdge + 8, Math.min(rect.left, leftEdge + width - popupWidth - 8))}px`;
      popup.style.top = `${upwards ? Math.max(topEdge + 8, rect.top - popup.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
      popup.dataset.side = upwards ? "top" : "bottom";
    };
    position();
    searchRef.current?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      if (!trigger.contains(event.target) && !popup.contains(event.target)) {
        setHost(null);
        setQuery("");
      }
    };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && popup.contains(event.target)) return;
      position();
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    observer?.observe(trigger);
    observer?.observe(popup);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [isOpen, searchable]);

  useLayoutEffect(() => {
    if (isOpen && activeId)
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, isOpen]);

  const buttonProps = props as unknown as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <>
      <button
        {...buttonProps}
        ref={triggerRef}
        id={controlId}
        type="button"
        role={isOpen && searchable ? "button" : "combobox"}
        value={selectedValue}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen && !searchable ? activeId : undefined}
        aria-required={required || undefined}
        className={cx("ui-select", "ui-select-trigger", className)}
        onClick={(event) => {
          onClick?.(
            event as unknown as Parameters<NonNullable<SelectProps["onClick"]>>[0],
          );
          if (!event.defaultPrevented) {
            if (isOpen) close();
            else open();
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(
            event as unknown as Parameters<NonNullable<SelectProps["onKeyDown"]>>[0],
          );
          if (!event.defaultPrevented) handleKey(event);
        }}
      >
        <span className="ui-select-value">{selected?.label ?? selectedValue}</span>
      </button>
      <select
        ref={(element) => {
          nativeRef.current = element;
          assignRef(forwardedRef, element);
        }}
        className="ui-select-native"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        form={form}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        value={selectedValue}
        onChange={(event) => {
          if (value === undefined) setUncontrolledValue(event.target.value);
          onChange?.(event);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
          open();
          onInvalid?.(event);
        }}
      >
        {children}
      </select>
      {isOpen &&
        host &&
        createPortal(
          <div
            ref={popupRef}
            className="ui-select-popup"
            popover={
              typeof HTMLElement.prototype.showPopover === "function"
                ? "manual"
                : undefined
            }
            onKeyDown={(event) => handleKey(event, event.target === searchRef.current)}
          >
            {searchable && (
              <div className="ui-select-search">
                <Search size={15} aria-hidden="true" />
                <input
                  ref={searchRef}
                  role="combobox"
                  aria-label={searchPlaceholder}
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  autoComplete="off"
                  spellCheck={false}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(-1);
                  }}
                />
              </div>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={props["aria-label"]}
              aria-labelledby={
                props["aria-label"] ? undefined : props["aria-labelledby"] || controlId
              }
              className="ui-select-options"
            >
              {groups.map((group, index) => (
                <div
                  key={index}
                  role={group.name ? "group" : "presentation"}
                  aria-label={group.name}
                >
                  {group.name && (
                    <div className="ui-select-group" aria-hidden="true">
                      {group.name}
                    </div>
                  )}
                  {group.options.map((option) => (
                    <div
                      key={`${option.index}-${option.value}`}
                      id={`${listId}-${option.index}`}
                      role="option"
                      aria-selected={option.value === selectedValue}
                      aria-disabled={option.disabled || undefined}
                      data-active={active?.index === option.index || undefined}
                      className="ui-select-option"
                      onPointerMove={() => {
                        if (!option.disabled) setActiveIndex(option.index);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commit(option)}
                    >
                      <span>{option.label}</span>
                      {option.value === selectedValue && (
                        <Check size={15} aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {!filtered.length && (
              <p className="ui-select-empty" role="status">
                没有匹配的选项
              </p>
            )}
          </div>,
          host,
        )}
    </>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    invalid,
    id,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const linked = useFieldControl(id, invalid, describedBy);
  // Native multi-select remains available for existing form integrations.
  if (props.multiple || (props.size !== undefined && props.size > 1)) {
    const nativeProps = { ...props };
    delete nativeProps.searchable;
    delete nativeProps.searchPlaceholder;
    return (
      <select
        {...nativeProps}
        {...linked}
        ref={ref}
        aria-invalid={ariaInvalid ?? linked["aria-invalid"]}
        className={cx("ui-select", props.className)}
      />
    );
  }
  return (
    <SingleSelect
      {...props}
      {...linked}
      ref={ref}
      aria-invalid={ariaInvalid ?? linked["aria-invalid"]}
    />
  );
});
