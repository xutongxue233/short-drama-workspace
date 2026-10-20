import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request, requestScreen } from "../../api";
import type { Computer } from "../../types";
import { ComputerViewer } from "./ComputerViewer";

vi.mock("../../api", () => ({ request: vi.fn(), requestScreen: vi.fn() }));
const base: Computer = {
  id: "computer-1",
  name: "剪辑工作站",
  endpoint: "http://127.0.0.1:8765",
  hasToken: true,
  control: { mode: "agent" },
};
const owned: Computer = {
  ...base,
  control: { mode: "human", ownerId: "admin", ownerName: "小徐" },
};
let current: Computer;
beforeEach(() => {
  current = base;
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async () => ({ computers: [current] }));
  vi.mocked(requestScreen)
    .mockReset()
    .mockResolvedValue(new Blob(["frame"], { type: "image/png" }));
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:computer-screen");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const writes = () => vi.mocked(request).mock.calls.filter((call) => call[2] === "POST");
const connected = () => screen.findByText("画面已连接");
function imagePosition() {
  const image = screen.getByRole("img", { name: "剪辑工作站的实时画面" });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 120,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
  return image;
}

it("only views by default and cannot send pointer, key, scroll or text actions", async () => {
  render(<ComputerViewer computer={base} userId="admin" onClose={vi.fn()} />);
  await connected();
  expect(screen.getByText("仅查看")).toBeTruthy();
  fireEvent.click(imagePosition(), { clientX: 110, clientY: 70 });
  fireEvent.contextMenu(imagePosition(), { clientX: 110, clientY: 70 });
  for (const name of ["发送 Enter 键", "向上滚动", "发送文字"])
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  expect(
    (screen.getByRole("textbox", { name: "输入到电脑的文字" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  expect(writes()).toEqual([]);
});

it("waits for confirmed takeover and a fresh frame before allowing normalized pointer actions", async () => {
  let complete!: (value: { computer: Computer }) => void;
  vi.mocked(request).mockImplementation(async (path, _body, method) => {
    if (method === "GET") return { computers: [current] };
    if (path.endsWith("/takeover"))
      return new Promise((resolve) => {
        complete = resolve;
      });
    return { ok: true };
  });
  render(<ComputerViewer computer={base} userId="admin" onClose={vi.fn()} />);
  await connected();
  fireEvent.click(screen.getByRole("button", { name: "接管电脑" }));
  fireEvent.click(imagePosition(), { clientX: 110, clientY: 70 });
  expect(writes()).toHaveLength(1);
  expect(
    (screen.getByRole("button", { name: "发送 Enter 键" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  current = owned;
  await act(async () => complete({ computer: owned }));
  await connected();
  expect(screen.getByText("你正在接管")).toBeTruthy();
  fireEvent.click(imagePosition(), { clientX: 110, clientY: 70 });
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1]).toEqual([
    "/computers/computer-1/actions",
    { type: "click", x: 0.5, y: 0.5, button: "left" },
    "POST",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ]);
});

it("retains the takeover lock on close and cleans up the screen and polling", async () => {
  current = owned;
  const onClose = vi.fn();
  const { unmount } = render(
    <ComputerViewer computer={owned} userId="admin" onClose={onClose} />,
  );
  await connected();
  expect(screen.getByText("关闭窗口会保留接管状态")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭查看" }));
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:computer-screen");
  expect(writes()).toEqual([]);
  const pollSignal = vi.mocked(requestScreen).mock.calls[0][1];
  expect(pollSignal?.aborted).toBe(true);
});

it("does not permit input under another administrator's takeover", async () => {
  current = {
    ...owned,
    control: { mode: "human", ownerId: "other", ownerName: "另一位管理员" },
  };
  render(<ComputerViewer computer={current} userId="admin" onClose={vi.fn()} />);
  await connected();
  fireEvent.click(imagePosition(), { clientX: 110, clientY: 70 });
  expect(
    (screen.getByRole("button", { name: "发送 Enter 键" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "结束其他人的接管" }));
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "确认结束其他人的接管" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0][1]).toEqual({ force: true });
});

it("disables all input after losing the screen while retaining a manual release action", async () => {
  current = owned;
  vi.mocked(requestScreen).mockRejectedValue(new Error("电脑离线"));
  render(<ComputerViewer computer={owned} userId="admin" onClose={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain("电脑离线");
  expect(
    (screen.getByRole("button", { name: "发送 Enter 键" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "结束接管" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(writes()).toEqual([]);
});

it("keeps input disabled after failed takeover and shows the failure", async () => {
  vi.mocked(request).mockImplementation(async (_path, _body, method) => {
    if (method === "GET") return { computers: [base] };
    throw new Error("暂停 Agent 失败，请重试");
  });
  render(<ComputerViewer computer={base} userId="admin" onClose={vi.fn()} />);
  await connected();
  fireEvent.click(screen.getByRole("button", { name: "接管电脑" }));
  expect((await screen.findByRole("alert")).textContent).toContain("暂停 Agent 失败");
  await connected();
  fireEvent.click(imagePosition(), { clientX: 110, clientY: 70 });
  expect(writes()).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toContain("暂停 Agent 失败");
});
