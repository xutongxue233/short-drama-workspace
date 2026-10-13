import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { request } from "../../api";
import type { Skill, WorkspaceState } from "../../types";
import { SkillCenter } from "./SkillCenter";

vi.mock("../../api", () => ({ request: vi.fn() }));
afterEach(() => vi.mocked(request).mockReset());

const skill: Skill = {
  id: "skill-review",
  name: "review-drama",
  description: "检查剧本节奏",
  instructions: "阅读本集剧本并列出问题。",
  enabled: true,
  version: 3,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};
const state: WorkspaceState = {
  projects: [],
  providers: [],
  agents: [],
  skills: [skill],
};

it("opens an editable template without writing until save and guards its unsaved draft", async () => {
  const mutate = vi.fn().mockResolvedValue({});
  render(
    <SkillCenter state={{ ...state, skills: [] }} mutate={mutate} notify={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "从「短剧剧本审阅」模板开始" }));
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有尚未保存的修改")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  fireEvent.change(screen.getByLabelText("技能名称"), {
    target: { value: "review-script" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存技能" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mutate).toHaveBeenCalledWith(
    "/skills",
    expect.objectContaining({ name: "review-script", enabled: true }),
    "POST",
  );
});

it("preserves a failed edit and its original version across incoming snapshots", async () => {
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error("技能已更新，请重新打开编辑器。"))
    .mockResolvedValue({});
  const props = { mutate, notify: vi.fn() };
  const { rerender } = render(<SkillCenter state={state} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑技能 review-drama" }));
  fireEvent.change(screen.getByLabelText("技能指令"), {
    target: { value: "我的修改草稿" },
  });
  rerender(
    <SkillCenter
      state={{
        ...state,
        skills: [{ ...skill, version: 4, instructions: "别处更新的内容" }],
      }}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存技能" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("技能指令") as HTMLTextAreaElement).value).toBe(
    "我的修改草稿",
  );
  expect(mutate).toHaveBeenCalledWith(
    "/skills/skill-review",
    expect.objectContaining({ instructions: "我的修改草稿", version: 3 }),
    "PATCH",
  );
  expect(
    (screen.getByRole("button", { name: "保存技能" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有尚未保存的修改")).toBeTruthy();
});

it("waits for a toggle snapshot before opening the editor", async () => {
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
  const { rerender } = render(<SkillCenter state={state} {...props} />);
  fireEvent.click(screen.getByRole("switch", { name: "停用技能 review-drama" }));
  expect(
    (screen.getByRole("button", { name: "编辑技能 review-drama" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <SkillCenter
      state={{ ...state, skills: [{ ...skill, enabled: false, version: 4 }] }}
      {...props}
    />,
  );
  await act(async () => finish());
  fireEvent.click(screen.getByRole("button", { name: "编辑技能 review-drama" }));
  fireEvent.click(screen.getByRole("button", { name: "保存技能" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith(
      "/skills/skill-review",
      expect.objectContaining({ enabled: false, version: 4 }),
      "PATCH",
    ),
  );
});

it("parses imported markdown without creating a skill, then saves the reviewed values", async () => {
  const draft = {
    name: "imported-skill",
    description: "导入的用途",
    instructions: "导入的指令",
  };
  vi.mocked(request).mockResolvedValue(draft);
  const mutate = vi.fn().mockResolvedValue({});
  render(<SkillCenter state={state} mutate={mutate} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "导入 SKILL.md" }));
  fireEvent.change(screen.getByLabelText("SKILL.md 内容"), {
    target: {
      value: "---\nname: imported-skill\ndescription: 导入的用途\n---\n导入的指令",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "检查技能" }));
  await screen.findByRole("dialog", { name: "检查并保存技能" });
  expect(request).toHaveBeenCalledWith(
    "/skills/parse",
    expect.objectContaining({ markdown: expect.stringContaining("imported-skill") }),
  );
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("技能指令"), {
    target: { value: "检查后的指令" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存技能" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/skills",
      { ...draft, instructions: "检查后的指令", enabled: true },
      "POST",
    ),
  );
});

it("keeps malformed import text for correction without writing anything", async () => {
  vi.mocked(request).mockRejectedValue(new Error("SKILL.md 缺少 name"));
  const mutate = vi.fn();
  render(<SkillCenter state={state} mutate={mutate} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "导入 SKILL.md" }));
  fireEvent.change(screen.getByLabelText("SKILL.md 内容"), {
    target: { value: "格式有误的草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "检查技能" }));
  expect((await screen.findByRole("alert")).textContent).toBe("SKILL.md 缺少 name");
  expect((screen.getByLabelText("SKILL.md 内容") as HTMLTextAreaElement).value).toBe(
    "格式有误的草稿",
  );
  expect(mutate).not.toHaveBeenCalled();
});

it("requires a separate delete confirmation and preserves the dialog after a failed delete", async () => {
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error("技能已更新，请重新确认删除。"))
    .mockResolvedValue({});
  render(<SkillCenter state={state} mutate={mutate} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "删除技能 review-drama" }));
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除技能 review-drama" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByRole("alert");
  expect(mutate).toHaveBeenCalledWith("/skills/skill-review", { version: 3 }, "DELETE");
  expect(screen.getByRole("dialog", { name: "删除 review-drama？" })).toBeTruthy();
});

it("searches names and descriptions while filtering disabled skills", () => {
  render(
    <SkillCenter
      state={{
        ...state,
        skills: [
          skill,
          {
            ...skill,
            id: "other",
            name: "other-skill",
            description: "镜头构图",
            enabled: false,
          },
        ],
      }}
      mutate={vi.fn()}
      notify={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("搜索技能"), { target: { value: "镜头" } });
  expect(screen.getByRole("article", { name: "技能 other-skill" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "技能 review-drama" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "全部技能" }));
  expect(screen.getByText("没有找到匹配的技能")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
});
