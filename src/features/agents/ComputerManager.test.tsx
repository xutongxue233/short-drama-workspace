import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../../api";
import type { Agent, Computer } from "../../types";
import { ComputerManager } from "./ComputerManager";

vi.mock("../../api", () => ({ request: vi.fn() }));
const computer: Computer = {
  id: "computer-1",
  name: "剪辑工作站",
  endpoint: "http://127.0.0.1:8765",
  hasToken: true,
  control: { mode: "agent" },
};
beforeEach(() => vi.mocked(request).mockReset().mockResolvedValue({ computer }));

it("creates a computer with an explicit connection and never reveals a stored token", async () => {
  const onChanged = vi.fn();
  render(
    <ComputerManager
      computers={[]}
      agents={[]}
      onClose={vi.fn()}
      onView={vi.fn()}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "添加电脑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "电脑名称" }), {
    target: { value: "剪辑工作站" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "连接地址" }), {
    target: { value: computer.endpoint },
  });
  fireEvent.change(screen.getByLabelText("访问密钥"), {
    target: { value: "new-secret-012345678901234567890123456789" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存电脑" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/computers",
      {
        name: "剪辑工作站",
        endpoint: computer.endpoint,
        token: "new-secret-012345678901234567890123456789",
      },
      "POST",
      expect.any(Object),
    ),
  );
  expect(onChanged).toHaveBeenCalledOnce();
});

it("preserves stored credentials when editing only the computer name", async () => {
  render(
    <ComputerManager
      computers={[computer]}
      agents={[]}
      onClose={vi.fn()}
      onView={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑 剪辑工作站" }));
  expect((screen.getByLabelText("访问密钥") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByRole("textbox", { name: "电脑名称" }), {
    target: { value: "Windows 剪辑机" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存电脑" }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(vi.mocked(request).mock.calls[0][1]).toEqual({
    name: "Windows 剪辑机",
    endpoint: computer.endpoint,
  });
});

it("blocks deleting a bound computer and editing a computer under human control", () => {
  const agent = { id: "writer", name: "编剧", computerId: computer.id } as Agent;
  const { rerender } = render(
    <ComputerManager
      computers={[computer]}
      agents={[agent]}
      onClose={vi.fn()}
      onView={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "删除 剪辑工作站" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <ComputerManager
      computers={[{ ...computer, control: { mode: "human", ownerId: "admin" } }]}
      agents={[]}
      onClose={vi.fn()}
      onView={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "删除 剪辑工作站" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "编辑 剪辑工作站" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "查看电脑" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
