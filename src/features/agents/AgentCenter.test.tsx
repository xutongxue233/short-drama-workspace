import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Agent, WorkspaceState } from "../../types";
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
