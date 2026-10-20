import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Agent, Computer, Provider, Skill } from "../../types";
import { AgentEditor } from "./AgentEditor";

it("clears the old model override when switching to a different model service", async () => {
  const agent: Agent = {
    id: "writer",
    name: "编剧",
    role: "剧本改编",
    description: "编写剧本",
    systemPrompt: "编写剧本",
    providerId: "old",
    model: "old-private-model",
    color: "#7160cf",
    enabled: true,
  };
  const providers: Provider[] = [
    {
      id: "old",
      name: "旧服务",
      kind: "text",
      protocol: "openai",
      baseUrl: "https://old.test",
      model: "old-default",
      hasKey: true,
      enabled: true,
    },
    {
      id: "new",
      name: "新服务",
      kind: "text",
      protocol: "anthropic",
      baseUrl: "https://new.test",
      model: "new-default",
      hasKey: true,
      enabled: true,
    },
  ];
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentEditor
      agent={agent}
      providers={providers}
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "模型服务" }));
  fireEvent.click(screen.getByRole("option", { name: "新服务 · 文本生成" }));
  expect(screen.getByRole("combobox", { name: "模型名称" }).textContent).toBe(
    "服务默认：new-default",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents/writer",
      expect.objectContaining({ providerId: "new", model: "" }),
      "PATCH",
    ),
  );
});

const custom: Agent = {
  id: "agent-dialogue",
  name: "对白顾问",
  role: "对白润色",
  description: "检查对白",
  systemPrompt: "检查对白是否符合角色身份。",
  providerId: "",
  model: "",
  color: "#7160cf",
  enabled: true,
};

const computer: Computer = {
  id: "computer-1",
  name: "剪辑工作站",
  endpoint: "http://127.0.0.1:8765",
  hasToken: true,
  control: { mode: "agent" },
};

it("saves and clears an Agent's selected computer binding", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  const props = {
    providers: [],
    computers: [computer],
    canManageComputers: true,
    mutate,
    onClose: vi.fn(),
    notify: vi.fn(),
  };
  const { unmount } = render(<AgentEditor agent={custom} {...props} />);
  fireEvent.click(screen.getByRole("combobox", { name: "绑定电脑" }));
  fireEvent.click(screen.getByRole("option", { name: "剪辑工作站" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith(
      "/agents/agent-dialogue",
      expect.objectContaining({ computerId: "computer-1" }),
      "PATCH",
    ),
  );
  unmount();
  render(<AgentEditor agent={{ ...custom, computerId: computer.id }} {...props} />);
  expect(screen.getByRole("combobox", { name: "绑定电脑" }).textContent).toBe(
    "剪辑工作站",
  );
  fireEvent.click(screen.getByRole("combobox", { name: "绑定电脑" }));
  fireEvent.click(screen.getByRole("option", { name: "暂不绑定电脑" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith(
      "/agents/agent-dialogue",
      expect.objectContaining({ computerId: "" }),
      "PATCH",
    ),
  );
});

it("preserves an unavailable computer binding when saving unrelated Agent fields", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentEditor
      agent={{ ...custom, computerId: "temporarily-unavailable" }}
      providers={[]}
      computers={[]}
      canManageComputers
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  expect(screen.getByRole("combobox", { name: "绑定电脑" }).textContent).toBe(
    "原绑定电脑暂不可用",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate.mock.calls[0][1]).not.toHaveProperty("computerId");
});

it("saves editable role, color, prompt and enabled state together", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  const onClose = vi.fn();
  render(
    <AgentEditor
      agent={custom}
      providers={[]}
      mutate={mutate}
      onClose={onClose}
      notify={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "工作职责" }), {
    target: { value: "  剧情节奏  " },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "系统提示词" }), {
    target: { value: "  检查冲突与节奏。  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "蓝色" }));
  fireEvent.click(screen.getByRole("switch", { name: "允许此 Agent 加入制作组" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents/agent-dialogue",
      expect.objectContaining({
        role: "剧情节奏",
        systemPrompt: "检查冲突与节奏。",
        color: "#3b82f6",
        enabled: false,
      }),
      "PATCH",
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("retains a failed creation draft for correction and retry", async () => {
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Agent 名称已存在"))
    .mockResolvedValueOnce({});
  const onClose = vi.fn();
  render(
    <AgentEditor providers={[]} mutate={mutate} onClose={onClose} notify={vi.fn()} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Agent 名称" }), {
    target: { value: "对白顾问" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "工作职责" }), {
    target: { value: "对白润色" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "系统提示词" }), {
    target: { value: "保留人物语气。" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建 Agent" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Agent 名称已存在");
  expect(screen.getByRole("alert").closest(".agent-editor-footer")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox", { name: "系统提示词" }) as HTMLTextAreaElement).value,
  ).toBe("保留人物语气。");
  fireEvent.change(screen.getByRole("textbox", { name: "Agent 名称" }), {
    target: { value: "对白顾问二" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建 Agent" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(mutate).toHaveBeenLastCalledWith(
    "/agents",
    expect.objectContaining({ name: "对白顾问二", systemPrompt: "保留人物语气。" }),
    "POST",
  );
});

it("does not submit whitespace-only required fields or fields beyond the API limits", () => {
  const mutate = vi.fn();
  render(
    <AgentEditor
      agent={custom}
      providers={[]}
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  const save = screen.getByRole("button", { name: "保存配置" }) as HTMLButtonElement;
  const name = screen.getByRole("textbox", { name: "Agent 名称" }) as HTMLInputElement;
  const role = screen.getByRole("textbox", { name: "工作职责" }) as HTMLInputElement;
  const description = screen.getByRole("textbox", {
    name: /职责说明/,
  }) as HTMLTextAreaElement;
  const prompt = screen.getByRole("textbox", {
    name: "系统提示词",
  }) as HTMLTextAreaElement;
  expect(name.maxLength).toBe(80);
  expect(role.maxLength).toBe(80);
  expect(description.maxLength).toBe(1000);
  expect(prompt.maxLength).toBe(12000);
  fireEvent.change(role, { target: { value: "   " } });
  expect(save.disabled).toBe(false);
  fireEvent.submit(save.closest("form")!);
  expect(mutate).not.toHaveBeenCalled();
  expect(screen.getByText("请填写工作职责")).toBeTruthy();
  expect(role.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(role, { target: { value: "对白润色" } });
  fireEvent.change(name, { target: { value: "字".repeat(81) } });
  fireEvent.submit(save.closest("form")!);
  expect(mutate).not.toHaveBeenCalled();
  expect(screen.getByText("Agent 名称最多允许 80 个字符")).toBeTruthy();
  fireEvent.change(name, { target: { value: "字".repeat(80) } });
  fireEvent.change(description, { target: { value: "字".repeat(1000) } });
  fireEvent.change(prompt, { target: { value: "字".repeat(12000) } });
  expect(save.disabled).toBe(false);
});

it("protects unsaved role changes on cancel", () => {
  const onClose = vi.fn();
  render(
    <AgentEditor
      agent={custom}
      providers={[]}
      mutate={vi.fn()}
      onClose={onClose}
      notify={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "工作职责" }), {
    target: { value: "新的职责" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText("有尚未保存的修改")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(
    (screen.getByRole("textbox", { name: "工作职责" }) as HTMLInputElement).value,
  ).toBe("新的职责");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps the editor locked until a save request finishes", async () => {
  let finish!: () => void;
  const mutate = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onClose = vi.fn();
  render(
    <AgentEditor
      agent={custom}
      providers={[]}
      mutate={mutate}
      onClose={onClose}
      notify={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  expect(
    (screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "关闭弹窗" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("preserves disabled skill bindings and limits selection to eight", async () => {
  const skills: Skill[] = Array.from({ length: 9 }, (_, index) => ({
    id: `skill-${index}`,
    name: `skill-${index}`,
    description: "技能用途",
    instructions: "技能指令",
    enabled: index !== 0,
    version: 1,
    createdAt: "2026-10-13",
    updatedAt: "2026-10-13",
  }));
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
    skillIds: skills.slice(0, 8).map((skill) => skill.id),
  };
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentEditor
      agent={agent}
      providers={[]}
      skills={skills}
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: "绑定 skill-0（已停用）",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    (screen.getByRole("checkbox", { name: "绑定 skill-8" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "绑定 skill-1" }));
  expect(
    (screen.getByRole("checkbox", { name: "绑定 skill-8" }) as HTMLInputElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "绑定 skill-8" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents/writer",
      expect.objectContaining({
        skillIds: [
          "skill-0",
          "skill-2",
          "skill-3",
          "skill-4",
          "skill-5",
          "skill-6",
          "skill-7",
          "skill-8",
        ],
      }),
      "PATCH",
    ),
  );
});

it("keeps skill choices after a failed save and guards closing a changed binding", async () => {
  const skill: Skill = {
    id: "review",
    name: "review",
    description: "审阅剧本",
    instructions: "审阅指令",
    enabled: true,
    version: 1,
    createdAt: "2026-10-13",
    updatedAt: "2026-10-13",
  };
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
  const mutate = vi.fn().mockRejectedValue(new Error("暂时无法保存"));
  const onClose = vi.fn();
  render(
    <AgentEditor
      agent={agent}
      providers={[]}
      skills={[skill]}
      mutate={mutate}
      onClose={onClose}
      notify={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "绑定 review" }));
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "保存配置" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(
    (screen.getByRole("checkbox", { name: "绑定 review" }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有尚未保存的修改")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

it("omits unchanged skill bindings when editing other fields so unavailable legacy skills do not block maintenance", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentEditor
      agent={{ ...custom, skillIds: ["missing-skill"] }}
      providers={[]}
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "工作职责" }), {
    target: { value: "维护后的职责" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate.mock.calls[0][1]).not.toHaveProperty("skillIds");
  expect(mutate.mock.calls[0][1]).toHaveProperty("role", "维护后的职责");
});

it("can explicitly remove an unavailable skill binding", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <AgentEditor
      agent={{ ...custom, skillIds: ["missing-skill"] }}
      providers={[]}
      mutate={mutate}
      onClose={vi.fn()}
      notify={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "绑定 missing-skill（已停用）" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/agents/agent-dialogue",
      expect.objectContaining({ skillIds: [] }),
      "PATCH",
    ),
  );
});
