import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
  Switch,
} from "./index";

beforeEach(() => {
  // jsdom has no layout engine; expose a box so the real focus filtering can run.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function () {
    return {
      0: new DOMRect(0, 0, 100, 32),
      length: 1,
      item: () => new DOMRect(0, 0, 100, 32),
      [Symbol.iterator]: () => [new DOMRect(0, 0, 100, 32)].values(),
    };
  });
});
afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
});

function Editor({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>编辑项目</Button>
      {open && (
        <Dialog
          title="项目设置"
          onClose={() => setOpen(false)}
          dirty={Boolean(draft)}
          busy={busy}
        >
          <DialogBody>
            <Field htmlFor="test-name" label="项目名称">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose>取消编辑</DialogClose>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
function openEditor(busy = false) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  render(
    <StrictMode>
      <Editor busy={busy} />
    </StrictMode>,
    { container: root },
  );
  const trigger = screen.getByRole("button", { name: "编辑项目" });
  trigger.focus();
  fireEvent.click(trigger);
  return { root, trigger };
}

describe("shared UI behavior contracts", () => {
  it("does not accidentally submit forms and blocks repeated loading actions", () => {
    const submit = vi.fn((e) => e.preventDefault());
    const click = vi.fn();
    const view = render(
      <form onSubmit={submit}>
        <Button onClick={click}>操作</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "操作" }));
    expect(submit).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    view.rerender(
      <Button onClick={click} loading>
        操作
      </Button>,
    );
    const button = screen.getByRole("button", { name: "操作" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("connects labels, hints and validation errors to the control", () => {
    render(
      <Field htmlFor="field-name" label="角色名称" error="请填写角色名称">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "角色名称" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("请填写角色名称");
  });

  it("exposes switch state and respects disabled actions", () => {
    const change = vi.fn();
    const view = render(
      <Switch label="启用服务" checked={false} onCheckedChange={change} />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(change).toHaveBeenCalledWith(true);
    view.rerender(
      <Switch label="启用服务" checked disabled onCheckedChange={change} />,
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch"));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("keeps drafts after cancelled dismissal, then restores the opener after discard", () => {
    const { root, trigger } = openEditor();
    expect(root.inert).toBe(true);
    const field = screen.getByRole("textbox", { name: "项目名称" });
    field.focus();
    fireEvent.change(field, { target: { value: "不应丢失的故事" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("alert").textContent).toContain("有尚未保存的修改");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect((field as HTMLInputElement).value).toBe("不应丢失的故事");
    expect(document.activeElement).toBe(field);
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("traps keyboard focus and ignores Escape during Chinese input composition", () => {
    openEditor();
    const dialog = screen.getByRole("dialog", { name: "项目设置" });
    const close = within(dialog).getByRole("button", { name: "关闭弹窗" });
    const cancel = within(dialog).getByRole("button", { name: "取消编辑" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.compositionStart(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.compositionEnd(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("blocks dismissal while a save is in flight", () => {
    openEditor(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  });
});
