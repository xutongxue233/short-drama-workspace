import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Form } from "./Form";
import { Field, Input, Textarea } from "./Field";
import { Select } from "./Select";

describe("Form validation", () => {
  it("retains controlled input edits when correcting a submitted error", () => {
    const form = createRef<HTMLFormElement>();
    const submit = vi.fn((event) => event.preventDefault());
    const order: string[] = [];
    function ControlledPassword() {
      const [password, setPassword] = useState("12345678901");
      return (
        <Form
          ref={form}
          onSubmit={submit}
          onInputCapture={() => order.push("input-capture")}
          onChangeCapture={() => order.push("change-capture")}
          onChange={() => order.push("form-change")}
        >
          <Field htmlFor="controlled-password" label="受控密码">
            <Input
              type="password"
              minLength={12}
              required
              value={password}
              onChange={(event) => {
                order.push("control-change");
                setPassword(event.currentTarget.value);
              }}
            />
          </Field>
          <output data-testid="password-state">{password}</output>
        </Form>
      );
    }
    render(<ControlledPassword />);
    fireEvent.submit(form.current!);
    expect(screen.getByRole("alert").textContent).toContain("至少需要 12 个字符");
    const input = screen.getByLabelText("受控密码") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "123456789012345" } });
    expect(input.value).toBe("123456789012345");
    expect(screen.getByTestId("password-state").textContent).toBe("123456789012345");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(order).toContain("input-capture");
    expect(order).toContain("change-capture");
    expect(order.indexOf("control-change")).toBeLessThan(order.indexOf("form-change"));
    fireEvent.submit(form.current!);
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.input(input, { target: { value: "short" } });
    expect(input.value).toBe("short");
    expect(screen.getByTestId("password-state").textContent).toBe("short");
    expect(screen.getByRole("alert").textContent).toContain("至少需要 12 个字符");
  });
  it("blocks an 11-character password inline, focuses it and never invokes native bubbles", () => {
    const ref = createRef<HTMLFormElement>();
    const submit = vi.fn((event) => {
      event.preventDefault();
      expect(new FormData(event.currentTarget).get("password")).toBe("123456789012");
    });
    const nativeCheck = vi.spyOn(HTMLFormElement.prototype, "checkValidity");
    const nativeReport = vi.spyOn(HTMLFormElement.prototype, "reportValidity");
    const nativeInputReport = vi.spyOn(HTMLInputElement.prototype, "reportValidity");
    const invalid = vi.fn();
    render(
      <Form ref={ref} noValidate={false} onSubmit={submit} onInvalid={invalid}>
        <Field htmlFor="password" label="密码" hint="至少 12 个字符">
          <Input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            defaultValue="12345678901"
          />
        </Field>
        <button type="submit">保存</button>
      </Form>,
    );
    const input = screen.getByLabelText("密码") as HTMLInputElement;
    expect(ref.current?.noValidate).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fireEvent.submit(ref.current!)).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("alert").textContent).toBe("密码至少需要 12 个字符");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("password-description");
    expect(nativeCheck).not.toHaveBeenCalled();
    expect(nativeReport).not.toHaveBeenCalled();
    expect(nativeInputReport).not.toHaveBeenCalled();
    expect(invalid).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "123456789012" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.submit(ref.current!);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("waits for blur, trims required text and updates pattern feedback while correcting", () => {
    render(
      <Form>
        <Field
          htmlFor="username"
          label="用户名"
          validationMessage="仅支持字母、数字和连字符"
          hint="填写账号名"
        >
          <Input required pattern={"[a-z][a-z0-9\\-]+"} />
        </Field>
        <button type="button">下一个字段</button>
      </Form>,
    );
    const input = screen.getByLabelText("用户名");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input, {
      relatedTarget: screen.getByRole("button", { name: "下一个字段" }),
    });
    expect(screen.getByRole("alert").textContent).toBe("请填写用户名");
    fireEvent.input(input, { target: { value: "a@" } });
    expect(screen.getByRole("alert").textContent).toBe("仅支持字母、数字和连字符");
    fireEvent.change(input, { target: { value: "alice-01" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("填写账号名")).toBeTruthy();
  });

  it("does not trim passwords and checks programmatic textarea length", () => {
    const submit = vi.fn((event) => event.preventDefault());
    const ref = createRef<HTMLFormElement>();
    render(
      <Form ref={ref} onSubmit={submit}>
        <Field htmlFor="spaces" label="密码">
          <Input type="password" required minLength={12} defaultValue="            " />
        </Field>
        <Field htmlFor="notes" label="说明">
          <Textarea maxLength={4} defaultValue="12345" />
        </Field>
      </Form>,
    );
    fireEvent.submit(ref.current!);
    expect(screen.getByRole("alert").textContent).toBe("说明最多允许 4 个字符");
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "1234" } });
    fireEvent.submit(ref.current!);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("skips readonly and disabled controls including disabled fieldsets", () => {
    const submit = vi.fn((event) => event.preventDefault());
    const ref = createRef<HTMLFormElement>();
    render(
      <Form ref={ref} onSubmit={submit}>
        <Field htmlFor="readonly" label="只读">
          <Input required readOnly defaultValue="" />
        </Field>
        <Field htmlFor="disabled" label="禁用">
          <Input required disabled />
        </Field>
        <Field htmlFor="readonly-text" label="只读说明">
          <Textarea required readOnly />
        </Field>
        <fieldset disabled>
          <Input required aria-label="组内禁用" />
        </fieldset>
      </Form>,
    );
    fireEvent.submit(ref.current!);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("associates hidden select constraints with the visible combobox and native FormData", () => {
    const form = createRef<HTMLFormElement>();
    const native = createRef<HTMLSelectElement>();
    const submit = vi.fn((event) => {
      event.preventDefault();
      expect(new FormData(event.currentTarget).get("access")).toBe("editor");
    });
    render(
      <Form ref={form} onSubmit={submit}>
        <Field htmlFor="access" label="项目权限">
          <Select name="access" ref={native} required defaultValue="">
            <option value="">请选择</option>
            <option value="editor">编辑者</option>
          </Select>
        </Field>
      </Form>,
    );
    const trigger = screen.getByRole("combobox", { name: "项目权限" });
    expect(native.current?.id).toBe("access-native");
    expect(native.current?.dataset.validationTarget).toBe("access");
    fireEvent.blur(trigger);
    expect(screen.getByRole("alert").textContent).toBe("请选择项目权限");
    fireEvent.submit(form.current!);
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "编辑者" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(form.current!);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("respects native email, URL, number range, step and custom validity", () => {
    const form = createRef<HTMLFormElement>();
    const custom = createRef<HTMLInputElement>();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <Form ref={form} onSubmit={submit}>
        <Field htmlFor="email" label="邮箱">
          <Input type="email" defaultValue="invalid" />
        </Field>
        <Field htmlFor="url" label="接口地址">
          <Input type="url" defaultValue="invalid" />
        </Field>
        <Field htmlFor="count" label="数量">
          <Input type="number" min={2} max={8} step={2} defaultValue="1" />
        </Field>
        <Field htmlFor="custom" label="自定义">
          <Input ref={custom} />
        </Field>
      </Form>,
    );
    custom.current!.setCustomValidity("服务端规则尚未满足");
    fireEvent.submit(form.current!);
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.getByText("数量不能小于 2")).toBeTruthy();
    expect(screen.getByText("服务端规则尚未满足")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "9" } });
    expect(screen.getByText("数量不能大于 8")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    expect(screen.getByText("数量须符合步长 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("接口地址"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "4" } });
    custom.current!.setCustomValidity("");
    fireEvent.submit(form.current!);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("provides fallback feedback for bare controls and clears feedback on reset", () => {
    const ref = createRef<HTMLFormElement>();
    render(
      <Form ref={ref}>
        <input name="原始字段" required />
        <button type="reset">重置</button>
      </Form>,
    );
    fireEvent.submit(ref.current!);
    expect(screen.getByRole("alert").textContent).toBe("请填写原始字段");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(ref.current!.querySelector("input")!, {
      target: { value: "" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps explicit Field errors and combines existing accessibility descriptions", () => {
    const ref = createRef<HTMLFormElement>();
    render(
      <Form ref={ref}>
        <p id="external-help">外部帮助</p>
        <Field htmlFor="manual" label="名称" error="服务器拒绝了这个名称">
          <Input required aria-describedby="external-help" />
        </Field>
      </Form>,
    );
    fireEvent.submit(ref.current!);
    expect(screen.getByRole("alert").textContent).toBe("服务器拒绝了这个名称");
    expect(screen.getByLabelText("名称").getAttribute("aria-describedby")).toBe(
      "external-help manual-description",
    );
  });

  it("shows one inline error for native controls associated with a Field", () => {
    const ref = createRef<HTMLFormElement>();
    const view = render(
      <Form ref={ref}>
        <Field htmlFor="native-name" label="原生名称">
          <input id="native-name" required />
        </Field>
      </Form>,
    );
    fireEvent.submit(ref.current!);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe("请填写原生名称");
    expect(view.container.querySelector(".ui-form-errors")).toBeNull();
  });
});
