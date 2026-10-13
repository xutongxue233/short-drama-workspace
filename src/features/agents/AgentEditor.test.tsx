import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Agent, Provider } from "../../types";
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
