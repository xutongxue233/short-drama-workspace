import { describe, expect, it } from "vitest";
import { messageMember, projectMembers, projectPermissions } from "./project-members";
import type { Agent, Message, ProjectParticipant } from "../types";

const participants: ProjectParticipant[] = [
  {
    userId: "owner",
    username: "lin",
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
const agent = { id: "writer", name: "编剧", role: "改编", enabled: true } as Agent;
const baseMessage: Message = {
  id: "m",
  agentId: "user",
  content: "你好",
  type: "text",
  createdAt: "",
};

describe("project participant identities and capabilities", () => {
  it("does not invent a human owner for a legacy project", () => {
    expect(projectMembers({ members: ["writer"] }, [agent])).toEqual([
      expect.objectContaining({ id: "writer", kind: "agent" }),
    ]);
    expect(messageMember(baseMessage, {}, [agent])).toEqual(
      expect.objectContaining({ name: "历史用户", role: "", kind: "human" }),
    );
  });
  it("separates account kind, optional profession and access", () => {
    const roster = projectMembers(
      { members: ["writer", "writer"], participants },
      [agent],
      "owner",
    );
    expect(roster).toHaveLength(4);
    expect(roster[0]).toMatchObject({
      name: "小林",
      role: "",
      access: "owner",
      isSelf: true,
      kind: "human",
    });
    expect(roster[1]).toMatchObject({
      role: "剪辑师",
      access: "editor",
      isSelf: false,
      kind: "human",
    });
    expect(roster[2].kind).toBe("bot");
  });
  it("identifies the actual sender, including users who left the project", () => {
    const message = {
      ...baseMessage,
      sender: { id: "former", displayName: "曾经的成员", kind: "human" as const },
    };
    expect(messageMember(message, { participants }, [agent], "owner")).toMatchObject({
      name: "曾经的成员",
      isSelf: false,
      kind: "human",
    });
    expect(
      messageMember(
        { ...message, sender: { ...message.sender, id: "owner" } },
        { participants },
        [agent],
        "owner",
      ),
    ).toMatchObject({ name: "小林", isSelf: true });
  });
  it.each([
    ["owner", true, true, true],
    ["editor", true, true, false],
    ["member", false, true, false],
    ["viewer", false, false, false],
  ] as const)(
    "enforces %s capabilities",
    (access, canEdit, canChat, canManageMembers) => {
      expect(projectPermissions({ currentUserAccess: access })).toEqual({
        canEdit,
        canChat,
        canManageMembers,
      });
    },
  );
});
