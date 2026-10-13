import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../types";
import { MemoryPanel } from "./MemoryPanel";

const project = {
  id: "project",
  chapters: [],
  running: false,
  currentUserAccess: "editor",
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
} as unknown as Project;

describe("memory fact validation", () => {
  it("focuses an empty fact and preserves a newer draft when the previous save completes", async () => {
    let finish!: (ok: boolean) => void;
    const onAction = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<MemoryPanel project={project} busy={false} onAction={onAction} />);
    const input = screen.getByRole("textbox", {
      name: "添加项目事实",
    }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "保存事实" }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("请填写项目事实");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "角色来自北方" } });
    fireEvent.click(screen.getByRole("button", { name: "保存事实" }));
    fireEvent.change(input, { target: { value: "新的事实草稿" } });
    await act(async () => finish(true));
    expect(input.value).toBe("新的事实草稿");
  });
});
