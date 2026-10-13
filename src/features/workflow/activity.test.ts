import { describe, expect, it } from "vitest";
import { filterActivity, type ActivityEntry } from "./activity";

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
