import { describe, expect, it } from "vitest";
import type { Project } from "../../types";
import { buildActivityLog, filterActivity, type ActivityEntry } from "./activity";

const entry = (
  id: string,
  kind: ActivityEntry["kind"],
  scope?: ActivityEntry["scope"],
): ActivityEntry => ({
  id,
  kind,
  scope,
  agentId: "writer",
  relatedAgentIds: ["writer"],
  nodeId: "script",
  relatedNodeIds: ["script"],
  content: id,
  source: "message",
});

describe("activity scopes", () => {
  const entries = [
    entry("chat-start", "start", "chat"),
    entry("chat-result", "result", "chat"),
    entry("chat-error", "error", "chat"),
    entry("workflow-result", "result", "workflow"),
    entry("legacy-chat", "chat"),
    entry("legacy-result", "result"),
  ];
  it("excludes every explicit chat event from workflow while retaining legacy workflow entries", () => {
    expect(
      filterActivity(entries, { kind: "workflow" }).map((item) => item.id),
    ).toEqual(["workflow-result", "legacy-result"]);
  });
  it("includes chat starts, results and failures in the ordinary-chat filter", () => {
    expect(
      filterActivity(entries, {
        kind: "chat",
        agentId: "writer",
        nodeId: "script",
      }).map((item) => item.id),
    ).toEqual(["chat-start", "chat-result", "chat-error", "legacy-chat"]);
    expect(filterActivity(entries, { kind: "result" }).map((item) => item.id)).toEqual([
      "chat-result",
      "workflow-result",
      "legacy-result",
    ]);
  });
});

it("retains invitation ownership after the invited agent is renamed", () => {
  const project: Project = {
    id: "renamed-agent-history",
    name: "重命名记录",
    description: "",
    genre: "悬疑",
    style: "二次元动画",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    members: ["producer", "custom-dialogue"],
    nodes: [],
    assets: [],
    chapters: [],
    memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
    approval: null,
    running: false,
    messages: [
      {
        id: "invitation",
        agentId: "system",
        type: "system",
        content: "总制片邀请了 对白顾问 加入项目群",
        createdAt: "2026-10-13T00:00:00.000Z",
        event: {
          kind: "progress",
          phase: "member-invited",
          fromAgentId: "producer",
          toAgentId: "custom-dialogue",
        },
      },
    ],
  };
  const entries = buildActivityLog(project, [
    { id: "custom-dialogue", name: "台词顾问" },
    { id: "another-agent", name: "对白顾问" },
  ]);
  expect(
    filterActivity(entries, { agentId: "custom-dialogue", kind: "all" }).map(
      (item) => item.id,
    ),
  ).toEqual(["invitation"]);
  expect(entries[0].relatedAgentIds).toContain("producer");
  expect(entries[0].relatedAgentIds).not.toContain("another-agent");
  expect(entries[0].kind).toBe("system");
  expect(entries[0].content).toContain("对白顾问");
});
