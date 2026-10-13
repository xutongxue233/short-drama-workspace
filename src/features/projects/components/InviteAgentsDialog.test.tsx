import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { memberById, projectMembers } from "../../../shared/project-members";
import type { Agent, Project } from "../../../types";
import { InviteAgentsDialog } from "./InviteAgentsDialog";
import { ProjectHeader } from "./ProjectHeader";

const agents: Agent[] = ["producer", "writer", "director"].map((id, index) => ({
  id,
  name: ["总制片", "编剧", "分镜导演"][index],
  role: ["主控 Agent", "剧情改编", "镜头语言"][index],
  description: "负责本职创作工作",
  color: "#7160cf",
  enabled: index !== 2,
  providerId: "",
  model: "",
  systemPrompt: "",
}));
const project: Project = {
  id: "project",
  name: "借邪骨，我以鬼仙破阴阳",
  description: "",
  genre: "悬疑",
  style: "二次元动画",
  createdAt: "",
  updatedAt: "",
  members: ["producer", "producer", "missing", "user"],
  messages: [],
  chapters: [],
  assets: [],
  nodes: [],
  running: false,
  approval: null,
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
};

describe("project member roster", () => {
  it("counts the actual local participant and deduplicated known agents consistently", () => {
    const members = projectMembers(project, agents);
    expect(members.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "user", kind: "human" },
      { id: "producer", kind: "agent" },
    ]);
    expect(memberById("user", agents)?.name).toBe("历史用户");
    expect(memberById("producer", agents)?.role).toBe("制作统筹");
    expect(memberById("missing", agents)).toBeUndefined();
  });

  it("opens the roster from the header instead of leaving unexplained avatar icons", () => {
    const onInvite = vi.fn();
    render(
      <ProjectHeader
        project={project}
        agents={agents}
        tab="chat"
        inspectorOpen
        onTabChange={vi.fn()}
        onToggleInspector={vi.fn()}
        onInvite={onInvite}
        onEpisodes={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看群成员，2 位成员" }));
    expect(onInvite).toHaveBeenCalledOnce();
  });

  it("shows joined humans and agents equally, and opens each person's own records", () => {
    const onActivity = vi.fn();
    render(
      <InviteAgentsDialog
        project={project}
        agents={agents}
        busy={false}
        onAction={vi.fn()}
        onClose={vi.fn()}
        onActivity={onActivity}
      />,
    );
    const joined = screen.getByRole("region", { name: "已加入" });
    expect(within(joined).getAllByRole("listitem")).toHaveLength(2);
    expect(within(joined).queryByText("真人")).toBeNull();
    expect(within(joined).getByText("Agent")).toBeTruthy();
    expect(screen.getByText("1 位用户 · 1 位 Agent")).toBeTruthy();
    expect(screen.queryByText("项目负责人")).toBeNull();
    expect(screen.queryByText(/在线/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看 历史用户 的工作记录" }));
    expect(onActivity).toHaveBeenCalledWith("user");
    fireEvent.click(screen.getByRole("button", { name: "查看 总制片 的工作记录" }));
    expect(onActivity).toHaveBeenCalledWith("producer");
    expect(screen.queryByRole("button", { name: /邀请 总制片/ })).toBeNull();
  });

  it("only invites an available enabled agent and keeps disabled agents ineligible", () => {
    const onAction = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <InviteAgentsDialog
        project={project}
        agents={agents}
        busy={false}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    const disabled = screen.getByRole("button", { name: "分镜导演 未启用" });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(disabled);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "邀请 编剧 加入群聊" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(
      "/projects/project/invite",
      { agentId: "writer" },
      "编剧 已加入群聊",
    );
    rerender(
      <InviteAgentsDialog
        project={{ ...project, members: [...project.members, "writer"] }}
        agents={agents}
        busy={false}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "邀请 编剧 加入群聊" })).toBeNull();
    expect(screen.getByText("1 位用户 · 2 位 Agent")).toBeTruthy();
  });
});

describe("project participant management", () => {
  const participants: NonNullable<Project["participants"]> = [
    {
      userId: "owner",
      username: "owner",
      displayName: "小林",
      kind: "human",
      access: "owner",
    },
    {
      userId: "editor",
      username: "chen",
      displayName: "陈老师",
      kind: "human",
      access: "editor",
      jobTitle: "剪辑师",
    },
    {
      userId: "bot",
      username: "notify",
      displayName: "通知助手",
      kind: "bot",
      access: "member",
    },
  ];
  it("lets owners add an existing account with access independently from profession", async () => {
    const onAction = vi.fn().mockResolvedValue(true);
    render(
      <InviteAgentsDialog
        project={{ ...project, participants, currentUserAccess: "owner" }}
        agents={agents}
        busy={false}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "new.editor" },
    });
    fireEvent.change(screen.getByLabelText(/项目分工/), {
      target: { value: "剪辑师" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加到群聊" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/project/participants",
      { username: "new.editor", access: "member", jobTitle: "剪辑师" },
      "成员已加入群聊",
      "POST",
    );
  });
  it("lets owners edit permissions and explicitly confirm removing an account", async () => {
    const onAction = vi.fn().mockResolvedValue(true);
    render(
      <InviteAgentsDialog
        project={{ ...project, participants, currentUserAccess: "owner" }}
        agents={agents}
        busy={false}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "移除 小林" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改 陈老师 的权限" }));
    fireEvent.click(screen.getByRole("combobox", { name: "项目权限" }));
    fireEvent.click(screen.getByRole("option", { name: "只读" }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员设置" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/project/participants/editor",
      { access: "viewer", jobTitle: "剪辑师" },
      "成员设置已保存",
      "PATCH",
    );
  });
  it.each(["editor", "member", "viewer"] as const)(
    "does not give %s account management controls",
    (access) => {
      render(
        <InviteAgentsDialog
          project={{ ...project, participants, currentUserAccess: access }}
          agents={agents}
          busy={false}
          onAction={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText("陈老师")).toBeTruthy();
      expect(screen.getByText("剪辑师")).toBeTruthy();
      expect(screen.getByText("Bot")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "添加到群聊" })).toBeNull();
      expect(screen.queryByRole("button", { name: "修改 陈老师 的权限" })).toBeNull();
      if (access !== "editor")
        expect(screen.queryByRole("button", { name: "邀请 编剧 加入群聊" })).toBeNull();
    },
  );
});

it("validates a member username inline before sending an invitation", () => {
  const onAction = vi.fn();
  render(
    <InviteAgentsDialog
      project={{ ...project, currentUserAccess: "owner" }}
      agents={agents}
      busy={false}
      onAction={onAction}
      onClose={vi.fn()}
    />,
  );
  const username = screen.getByLabelText("用户名");
  fireEvent.change(username, { target: { value: "含空格的 用户名" } });
  fireEvent.click(screen.getByRole("button", { name: "添加到群聊" }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe(
    "用户名须为 3–64 位字母、数字、点、下划线或连字符。",
  );
  expect(document.activeElement).toBe(username);
});
