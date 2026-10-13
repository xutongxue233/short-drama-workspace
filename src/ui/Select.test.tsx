import { createRef, StrictMode, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogBody, Field, Select } from "./index";

const choices = (
  <>
    <option value="alpha">Alpha</option>
    <option value="beta" disabled>
      Beta
    </option>
    <option value="gamma">Gamma</option>
    <option value="delta">Delta</option>
  </>
);

afterEach(() => vi.restoreAllMocks());

describe("Select", () => {
  it("exposes a single labeled control and preserves native change events and form data", () => {
    const change = vi.fn();
    const view = render(
      <form>
        <Field label="生成模型" htmlFor="generation" hint="请选择模型">
          <Select
            name="model"
            defaultValue="alpha"
            onChange={(event) => change(event.target.value, event.target.tagName)}
          >
            {choices}
          </Select>
        </Field>
      </form>,
    );
    const trigger = screen.getByRole("combobox", { name: "生成模型" });
    expect(trigger.getAttribute("aria-describedby")).toBe("generation-description");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("option")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Gamma" }));
    expect(change).toHaveBeenCalledWith("gamma", "SELECT");
    expect(trigger.textContent).toBe("Gamma");
    expect(new FormData(view.container.querySelector("form")!).get("model")).toBe(
      "gamma",
    );
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps controlled selection synchronized when changed by the parent", () => {
    function Form() {
      const [value, setValue] = useState("alpha");
      return (
        <>
          <Select
            aria-label="模型"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {choices}
          </Select>
          <button onClick={() => setValue("delta")}>外部更新</button>
        </>
      );
    }
    render(
      <StrictMode>
        <Form />
      </StrictMode>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Gamma" }));
    expect(trigger.textContent).toBe("Gamma");
    fireEvent.click(screen.getByRole("button", { name: "外部更新" }));
    expect(trigger.textContent).toBe("Delta");
  });

  it("navigates enabled options without committing until Enter and restores focus", () => {
    const change = vi.fn();
    render(
      <Select aria-label="模型" onChange={(event) => change(event.target.value)}>
        {choices}
      </Select>,
    );
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Gamma");
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(change).toHaveBeenCalledWith("gamma");
    expect(document.activeElement).toBe(trigger);
  });

  it("handles Home, End, typeahead and Escape without overwriting selection", () => {
    render(
      <Select aria-label="模型" defaultValue="gamma">
        {choices}
      </Select>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Alpha");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Delta");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.textContent).toBe("Gamma");
    fireEvent.keyDown(trigger, { key: "d" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.textContent).toBe("Delta");
  });

  it("cycles repeated typeahead characters and skips disabled options", () => {
    render(
      <Select aria-label="模型">
        <option>Alpha</option>
        <option>Apple</option>
        <option disabled>Atlas</option>
      </Select>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "a" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Apple");
    fireEvent.keyDown(trigger, { key: "a" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Alpha");
  });

  it("supports searchable long lists, empty results and only one accessible combobox", () => {
    render(
      <Select aria-label="模型" searchable searchPlaceholder="搜索模型 ID">
        {choices}
      </Select>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox", { name: "搜索模型 ID" });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "gAmM" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "不存在的模型" } });
    expect(screen.getByRole("status").textContent).toBe("没有匹配的选项");
    fireEvent.change(search, { target: { value: "delta" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("combobox").textContent).toBe("Delta");
    expect(document.activeElement).toBe(trigger);
  });

  it("does not close or select during Chinese input composition", () => {
    render(
      <Select aria-label="模型" searchable>
        {choices}
      </Select>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    const search = screen.getByRole("combobox");
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ignores disabled controls, inherited fieldsets and disabled groups", () => {
    const view = render(
      <Select disabled aria-label="模型">
        {choices}
      </Select>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).toBeNull();
    view.rerender(
      <fieldset disabled>
        <Select aria-label="模型">{choices}</Select>
      </fieldset>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).toBeNull();
    view.rerender(
      <Select aria-label="模型">
        <optgroup label="不可用" disabled>
          <option value="a">Alpha</option>
        </optgroup>
        <optgroup label="可用">
          <option value="g">Gamma</option>
        </optgroup>
      </Select>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(
      screen.getByRole("option", { name: /Alpha/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: /Alpha/ }));
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByRole("combobox").textContent).toBe("Gamma");
  });

  it("closes on outside clicks or focus leaving without changing the value", () => {
    render(
      <>
        <Select aria-label="模型">{choices}</Select>
        <button>其他操作</button>
      </>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "其他操作" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    act(() => screen.getByRole("button", { name: "其他操作" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toBe("Alpha");
  });

  it("restores uncontrolled default values on native form reset", async () => {
    const view = render(
      <form>
        <Select aria-label="模型" name="model" defaultValue="gamma">
          {choices}
        </Select>
        <button type="reset">重置</button>
      </form>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Delta" }));
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() => expect(screen.getByRole("combobox").textContent).toBe("Gamma"));
    expect(new FormData(view.container.querySelector("form")!).get("model")).toBe(
      "gamma",
    );
  });

  it("routes native required validation to the visible control", () => {
    const view = render(
      <form>
        <Field label="模型" htmlFor="required-model" error="请选择模型">
          <Select name="model" required defaultValue="">
            <option value="">请选择</option>
            <option value="image">图片</option>
          </Select>
        </Field>
      </form>,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    act(() =>
      expect(view.container.querySelector("form")!.checkValidity()).toBe(false),
    );
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("option", { name: "图片" }));
    expect(view.container.querySelector("form")!.checkValidity()).toBe(true);
  });

  it("preserves native refs while routing focus to the visible trigger", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select ref={ref} aria-label="模型">
        {choices}
      </Select>,
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    ref.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    expect(ref.current?.value).toBe("alpha");
  });

  it("respects a cancelled form reset", async () => {
    render(
      <form onReset={(event) => event.preventDefault()}>
        <Select aria-label="模型">{choices}</Select>
        <button type="reset">重置</button>
      </form>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Gamma" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重置" }));
    });
    expect(screen.getByRole("combobox").textContent).toBe("Gamma");
  });

  it("closes when disabled and does not reopen when re-enabled", () => {
    const view = render(<Select aria-label="模型">{choices}</Select>);
    fireEvent.click(screen.getByRole("combobox"));
    view.rerender(
      <Select aria-label="模型" disabled>
        {choices}
      </Select>,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    view.rerender(<Select aria-label="模型">{choices}</Select>);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the popup in its dialog and consumes Escape before the dialog closes", () => {
    const close = vi.fn();
    render(
      <Dialog title="模型设置" onClose={close}>
        <DialogBody>
          <Select aria-label="模型" searchable>
            {choices}
          </Select>
        </DialogBody>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("bounds its popup to a narrow viewport and opens above low controls", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("ui-select-trigger")
          ? new DOMRect(300, 540, 80, 40)
          : new DOMRect(0, 0, 180, 140);
      },
    );
    render(<Select aria-label="模型">{choices}</Select>);
    fireEvent.click(screen.getByRole("combobox"));
    const popup = screen.getByRole("listbox").parentElement!;
    expect(popup.dataset.side).toBe("top");
    expect(
      Number.parseFloat(popup.style.left) + Number.parseFloat(popup.style.width),
    ).toBeLessThanOrEqual(382);
    expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(8);
  });
});
