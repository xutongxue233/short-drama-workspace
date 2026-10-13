import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

function setup(onCreate = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<NewProjectDialog onCreate={onCreate} onClose={onClose} />);
  return { onCreate, onClose };
}

describe("single episode project creation", () => {
  it("creates from a project name and optional creative preferences, without asking for a total episode count or a mode", async () => {
    const { onCreate } = setup();
    expect(screen.getByText(/无需确定总集数，也无需上传整本小说/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByText(/演示模式/)).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "故事简介 选填" }) as HTMLTextAreaElement)
        .required,
    ).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "  借邪骨，我以鬼仙破阴阳  " },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "初步风格" }));
    fireEvent.click(screen.getByRole("option", { name: "二次元动画" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "创建项目群聊" })),
    );
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      name: "借邪骨，我以鬼仙破阴阳",
      description: "",
      genre: "悬疑",
      style: "二次元动画",
    });
  });

  it("rejects a whitespace-only title even when the form is submitted directly", () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "   " },
    });
    fireEvent.submit(screen.getByRole("form", { name: "创建项目" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "创建项目群聊" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("prevents duplicate creation and dismissal while a request is pending, then preserves edits after failure", async () => {
    let reject!: (reason: Error) => void;
    const onCreate = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { onClose } = setup(onCreate);
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "本集测试" },
    });
    const form = screen.getByRole("form", { name: "创建项目" });
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    for (const control of [
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ]) {
      expect((control as HTMLInputElement).disabled).toBe(true);
    }
    await act(async () => reject(new Error("创建失败")));
    expect(
      (screen.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value,
    ).toBe("本集测试");
    expect(
      (screen.getByRole("button", { name: "创建项目群聊" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
