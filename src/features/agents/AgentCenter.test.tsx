import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Agent, Skill, WorkspaceState } from "../../types";
import { AgentCenter } from "./AgentCenter";

it("waits for a toggle snapshot before opening an editor that could overwrite enabled", async () => {
  const agent: Agent = {
    id: "writer",
    name: "编剧",
    role: "剧本改编",
    description: "编写剧本",
    systemPrompt: "编写剧本",
    providerId: "",
    model: "",
    color: "#7160cf",
    enabled: true,
  };
  const state: WorkspaceState = { projects: [], providers: [], agents: [agent] };
  let finish!: () => void;
  const mutate = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({});
  const props = { mutate, notify: vi.fn() };
  const { rerender } = render(<AgentCenter state={state} {...props} />);
  fireEvent.click(screen.getByRole("switch", { name: "停用编剧" }));
  const configure = screen.getByRole("button", {
    name: "配置 编剧",
  }) as HTMLButtonElement;
  expect(configure.disabled).toBe(true);
  fireEvent.click(configure);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(
    <AgentCenter
      state={{ ...state, agents: [{ ...agent, enabled: false }] }}
      {...props}
    />,
  );
  await act(async () => finish());
  fireEvent.click(screen.getByRole("button", { name: "配置 编剧" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith(
      "/agents/writer",
      expect.objectContaining({ enabled: false }),
      "PATCH",
    ),
  );
});

const writer: Agent = {
  id: "writer",
  name: "编剧",
  role: "剧本改编",
  description: "编写剧本",
  systemPrompt: "编写剧本，保留角色动机。",
  providerId: "",
  model: "story-v1",
  color: "#7160cf",
  enabled: true,
  skillIds: ["review"],
};
const custom: Agent = { ...writer, id: "agent-dialogue", name: "对白顾问" };
const reviewSkill: Skill = {
  id: "review",
  name: "review",
  description: "审阅剧本",
  instructions: "检查故事连续性。",
  enabled: true,
  version: 1,
  createdAt: "2026-10-13",
  updatedAt: "2026-10-13",
};
const workspace = (agents = [writer, custom]): WorkspaceState => ({
  projects: [],
  providers: [],
  agents,
  skills: [reviewSkill],
});
const enter = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
const select = (name: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

it("creates an Agent from the visible entry with trimmed fields and chosen color", async () => {
  const mutate = vi.fn().mockResolvedValue({ ...custom, id: "created" });
  const notify = vi.fn();
  render(<AgentCenter state={workspace()} mutate={mutate} notify={notify} />);
  enter("搜索 Agent", "尚未存在的成员");
  fireEvent.click(screen.getByRole("button", { name: "新增 Agent" }));
  expect(screen.getByRole("dialog", { name: "新增 Agent" })).toBeTruthy();
  const save = screen.getByRole("button", { name: "创建 Agent" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  enter("Agent 名称", "  动作顾问  ");
  enter("工作职责", "  动作设计  ");
  enter(/职责说明/, "  保持动作连续性  ");
  enter("系统提示词", "  根据剧本设计动作节奏。  ");
  fireEvent.click(screen.getByRole("checkbox", { name: "绑定 review" }));
  fireEvent.click(screen.getByRole("button", { name: "绿色" }));
  fireEvent.click(save);
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents",
      {
        name: "动作顾问",
        role: "动作设计",
        description: "保持动作连续性",
        systemPrompt: "根据剧本设计动作节奏。",
        color: "#059669",
        enabled: true,
        providerId: "",
        model: "",
        skillIds: ["review"],
      },
      "POST",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    (screen.getByRole("textbox", { name: "搜索 Agent" }) as HTMLInputElement).value,
  ).toBe("");
  expect(notify).toHaveBeenCalledWith("动作顾问 已创建，可在项目中邀请加入制作组");
});

it("copies existing configuration into a new uniquely named Agent without patching the source", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentCenter
      state={workspace([writer, { ...custom, name: "编剧（副本）" }])}
      mutate={mutate}
      notify={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制 编剧" }));
  expect(
    (screen.getByRole("textbox", { name: "Agent 名称" }) as HTMLInputElement).value,
  ).toBe("编剧（副本 2）");
  expect(
    (screen.getByRole("textbox", { name: "系统提示词" }) as HTMLTextAreaElement).value,
  ).toBe(writer.systemPrompt);
  expect(mutate).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("checkbox", { name: "绑定 review" }) as HTMLInputElement).checked,
  ).toBe(true);
  enter("工作职责", "独立改编顾问");
  fireEvent.click(screen.getByRole("button", { name: "创建 Agent" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents",
      {
        name: "编剧（副本 2）",
        role: "独立改编顾问",
        description: writer.description,
        systemPrompt: writer.systemPrompt,
        color: writer.color,
        enabled: true,
        providerId: "",
        model: writer.model,
        skillIds: ["review"],
      },
      "POST",
    ),
  );
  expect(writer.name).toBe("编剧");
});

it("requires confirmation before deleting a custom member and blocks closing during the request", async () => {
  let finish!: () => void;
  const mutate = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const notify = vi.fn();
  render(<AgentCenter state={workspace()} mutate={mutate} notify={notify} />);
  expect(screen.queryByRole("button", { name: "删除 编剧" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除 对白顾问" }));
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除 对白顾问" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(mutate).toHaveBeenCalledWith("/agents/agent-dialogue", undefined, "DELETE");
  expect(
    (screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "删除 对白顾问" })).toBeTruthy();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(notify).toHaveBeenCalledWith("对白顾问 已删除");
});

it("keeps a failed deletion open, explains project references and allows retry", async () => {
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error("此 Agent 已被项目或历史记录引用，请改为停用。"))
    .mockResolvedValueOnce({});
  render(<AgentCenter state={workspace()} mutate={mutate} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "删除 对白顾问" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect((await screen.findByRole("alert")).textContent).toContain("请改为停用");
  expect(screen.getByRole("dialog", { name: "删除 对白顾问" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mutate).toHaveBeenCalledTimes(2);
});

it("combines status, type and search filters and clears an empty result", () => {
  render(
    <AgentCenter
      state={workspace([writer, { ...custom, enabled: false }])}
      mutate={vi.fn()}
      notify={vi.fn()}
    />,
  );
  select("成员类型", "自定义成员");
  expect(screen.queryByRole("article", { name: "编剧" })).toBeNull();
  expect(screen.getByRole("article", { name: "对白顾问" })).toBeTruthy();
  select("启用状态", "已停用");
  enter("搜索 Agent", "不存在");
  expect(screen.getByText("没有找到匹配的成员")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
});

it("offers creation in a genuinely empty workspace", () => {
  render(<AgentCenter state={workspace([])} mutate={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByText("创建你的第一位 Agent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "创建 Agent" }));
  expect(screen.getByRole("dialog", { name: "新增 Agent" })).toBeTruthy();
});

it("leaves the enabled state intact and displays a failed toggle", async () => {
  const mutate = vi.fn().mockRejectedValue(new Error("网络连接失败"));
  render(<AgentCenter state={workspace()} mutate={mutate} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole("switch", { name: "停用对白顾问" }));
  expect((await screen.findByRole("alert")).textContent).toBe("网络连接失败");
  expect(
    screen.getByRole("switch", { name: "停用对白顾问" }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    (screen.getByRole("button", { name: "配置 对白顾问" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
