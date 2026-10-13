import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Project } from "../../../types";
import { ChatComposer } from "./ChatComposer";

const agents: Agent[] = [
  { id: "producer", name: "总制片", role: "统筹", enabled: true },
  { id: "writer", name: "编剧", role: "故事改编", enabled: true },
  { id: "director", name: "导演", role: "影像导演", enabled: true },
  { id: "disabled", name: "已停用", role: "测试", enabled: false },
].map((agent) => ({
  description: "",
  color: "#7160cf",
  providerId: "",
  model: "",
  systemPrompt: "",
  ...agent,
}));
const project: Project = {
  id: "mention-test",
  name: "短剧",
  description: "",
  genre: "",
  style: "",
  createdAt: "",
  updatedAt: "",
  members: ["producer", "writer", "disabled"],
  messages: [],
  nodes: [],
  assets: [],
  chapters: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  approval: null,
  running: false,
};

beforeEach(() => sessionStorage.clear());

function setup(onAction = vi.fn().mockResolvedValue(true)) {
  const onSendingChange = vi.fn();
  const view = render(
    <ChatComposer
      project={project}
      agents={agents}
      busy={false}
      onAction={onAction}
      onSource={vi.fn()}
      autoFollow
      onFollowLatest={vi.fn()}
      onSendingChange={onSendingChange}
    />,
  );
  const input = screen.getByRole("textbox", {
    name: "群聊消息",
  }) as HTMLTextAreaElement;
  return { ...view, input, onAction, onSendingChange };
}
function type(input: HTMLTextAreaElement, value: string, caret = value.length) {
  fireEvent.change(input, {
    target: { value, selectionStart: caret, selectionEnd: caret },
  });
}

describe("chat composer mentions", () => {
  it("lets the author explicitly discuss a creative request without starting production", async () => {
    const { input, onAction } = setup();
    fireEvent.click(screen.getByRole("combobox", { name: "消息协作模式" }));
    fireEvent.click(screen.getByRole("option", { name: "仅讨论" }));
    type(input, "先创作一集");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith("/projects/mention-test/messages", {
        content: "先创作一集",
        agentId: undefined,
        intent: "discussion",
      }),
    );
  });
  it("opens suggestions on typing @ and filters eligible members by name or role", () => {
    const { input } = setup();
    type(input, "@");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /导演|已停用/ })).toBeNull();
    type(input, "＠改编");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    expect(
      within(screen.getByRole("listbox")).getByRole("option").textContent,
    ).toContain("编剧");
    type(input, "@无匹配");
    expect(screen.getByRole("status").textContent).toContain("没有匹配");
  });

  it("selects with arrows and Enter, highlights the mention, and sends to that member", async () => {
    const { input, container, onAction, onSendingChange } = setup();
    type(input, "@");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")[1]
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("@编剧 ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(container.querySelector(".composer-mention")?.textContent).toBe("@编剧");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(input.value).toBe(""));
    expect(onAction).toHaveBeenCalledWith("/projects/mention-test/messages", {
      content: "@编剧",
      agentId: "writer",
    });
    expect(onSendingChange.mock.calls).toEqual([["writer"], [null]]);
  });

  it("inserts from the toolbar at the caret and keeps text after a mention query", () => {
    const { input } = setup();
    type(input, "请看后文", 2);
    fireEvent.click(screen.getByRole("button", { name: "选择回复 Agent" }));
    fireEvent.click(screen.getByRole("option", { name: /编剧/ }));
    expect(input.value).toBe("请看 @编剧 后文");
    expect(input.selectionStart).toBe(7);
    type(input, "请 @总 后文", 4);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("请 @总制片 后文");
  });

  it("does not consume composition confirmation or submit while Chinese input is active", () => {
    const { input, onAction } = setup();
    type(input, "@");
    fireEvent.compositionStart(input);
    type(input, "@编");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.compositionEnd(input);
    expect(
      within(screen.getByRole("listbox")).getByRole("option").textContent,
    ).toContain("编剧");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("@编");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps suggestions closed when writing the message after selecting a member", () => {
    const { input } = setup();
    type(input, "@编");
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, `${input.value}请写一集`);
    expect(input.value).toBe("@编剧 请写一集");
    expect(screen.queryByRole("listbox")).toBeNull();
    type(input, `${input.value} @`);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
  });

  it("routes the first mention and restores automatic routing after mentions are removed", async () => {
    const { input, onAction } = setup();
    type(input, "@编剧 和 @总制片 请讨论");
    expect(screen.getByText(/本次由首位「编剧」回复/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消指定回复 Agent：编剧" }));
    expect(input.value).toBe(" 和 @总制片 请讨论");
    type(input, "请创作第一集");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(onAction).toHaveBeenCalledWith("/projects/mention-test/messages", {
      content: "请创作第一集",
      agentId: undefined,
    });
  });

  it("preserves a newer draft during the reply and prevents duplicate sends", async () => {
    let resolve!: (value: boolean) => void;
    const onAction = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const { input, onSendingChange } = setup(onAction);
    type(input, "第一条");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    type(input, "正在写第二条");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onAction).toHaveBeenCalledOnce();
    await act(async () => resolve(true));
    expect(input.value).toBe("正在写第二条");
    expect(onSendingChange.mock.calls).toEqual([["producer"], [null]]);
  });

  it("restores recipient routing from a saved draft and retains a failed send", async () => {
    sessionStorage.setItem("yingxu-draft-mention-test", "@编剧 保留草稿");
    const { input, onAction, onSendingChange } = setup(
      vi.fn().mockResolvedValue(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(onSendingChange).toHaveBeenLastCalledWith(null));
    expect(onAction).toHaveBeenCalledWith("/projects/mention-test/messages", {
      content: "@编剧 保留草稿",
      agentId: "writer",
    });
    expect(input.value).toBe("@编剧 保留草稿");
  });

  it("clears a successful draft even when the composer unmounts before the reply", async () => {
    let resolve!: (value: boolean) => void;
    const onAction = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const view = setup(onAction);
    type(view.input, "切页前已发送");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    view.unmount();
    await act(async () => resolve(true));
    const returned = setup();
    expect(returned.input.value).toBe("");
    expect(sessionStorage.getItem("yingxu-draft-mention-test")).toBeNull();
  });

  it("updates a remounted composer when a previous request completes", async () => {
    let resolve!: (value: boolean) => void;
    const onAction = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const view = setup(onAction);
    type(view.input, "仍在生成回复");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    view.unmount();
    const returned = setup();
    expect(returned.input.value).toBe("仍在生成回复");
    await act(async () => resolve(true));
    expect(returned.input.value).toBe("");
  });

  it("does not erase a new draft written after leaving and returning to the chat", async () => {
    let resolve!: (value: boolean) => void;
    const onAction = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const view = setup(onAction);
    type(view.input, "原始请求");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    view.unmount();
    const returned = setup();
    type(returned.input, "返回后写的新草稿");
    await act(async () => resolve(true));
    expect(returned.input.value).toBe("返回后写的新草稿");
    expect(sessionStorage.getItem("yingxu-draft-mention-test")).toBe(
      "返回后写的新草稿",
    );
  });
});
