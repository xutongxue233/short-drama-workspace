import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Agent, Provider, Skill } from "../../types";
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
