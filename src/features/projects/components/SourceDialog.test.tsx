import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../types";
import { SourceDialog } from "./SourceDialog";

const project = { chapters: [], running: false } as unknown as Project;

describe("source import feedback", () => {
  it("shows an inline empty-content error and focuses the field instead of disabling submission", () => {
    const onImport = vi.fn();
    render(<SourceDialog project={project} onImport={onImport} onClose={vi.fn()} />);
    const content = screen.getByRole("textbox", { name: "原著内容" });
    fireEvent.change(content, { target: { value: "   " } });
    const submit = screen.getByRole("button", {
      name: "导入本集原文",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("请填写原著内容");
    expect(document.activeElement).toBe(content);
  });
  it("preserves imported text and reports an API failure in the dialog", async () => {
    const onImport = vi.fn().mockRejectedValue(new Error("导入服务暂时不可用"));
    render(<SourceDialog project={project} onImport={onImport} onClose={vi.fn()} />);
    const content = screen.getByRole("textbox", {
      name: "原著内容",
    }) as HTMLTextAreaElement;
    fireEvent.change(content, { target: { value: "第一章的原文" } });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "导入本集原文" })),
    );
    expect(screen.getByRole("alert").textContent).toContain("导入服务暂时不可用");
    expect(content.value).toBe("第一章的原文");
    expect(content.disabled).toBe(false);
  });
});
