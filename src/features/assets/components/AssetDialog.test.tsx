import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Asset } from "../../../types";
import { AssetDialog } from "./AssetDialog";

const asset: Asset = {
  id: "asset",
  name: "角色初稿",
  type: "character",
  description: "角色设定",
  content: "初稿内容",
  locked: false,
  version: 1,
  createdAt: "",
  tags: [],
};

describe("asset edit feedback", () => {
  it("focuses an invalid asset name, then preserves a failed edit with contextual feedback", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("保存服务暂时不可用"));
    render(<AssetDialog item={asset} onSave={onSave} onClose={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: "资产名称" }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存资产" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("请填写资产名称");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "角色定稿" } });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "保存资产" })),
    );
    expect(screen.getByRole("alert").textContent).toContain("保存服务暂时不可用");
    expect(name.value).toBe("角色定稿");
    expect(name.disabled).toBe(false);
  });
});
