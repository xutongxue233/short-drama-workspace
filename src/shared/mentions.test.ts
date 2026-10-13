import { describe, expect, it } from "vitest";
import { findMentionQuery, splitMentions } from "./mentions";

const agents = [
  { id: "producer", name: "总制片" },
  { id: "writer", name: "编剧" },
  { id: "senior-writer", name: "编剧指导" },
  { id: "director", name: "Director" },
];

describe("chat mention parsing", () => {
  it("preserves message text and identifies both mention symbols and longest names", () => {
    const text = "请@编剧指导看一下，＠总制片 决定。";
    const parts = splitMentions(text, agents);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.agentId)).toEqual([
      { text: "@编剧指导", agentId: "senior-writer" },
      { text: "＠总制片", agentId: "producer" },
    ]);
  });

  it("does not route email addresses, unknown names or ASCII name prefixes", () => {
    const text = "team@Director.test @DirectorTwo @陌生成员";
    expect(splitMentions(text, agents)).toEqual([{ text }]);
  });

  it("finds a query at the caret and allows search by a role or a name with spaces", () => {
    expect(findMentionQuery("请 @编 后续文本", 4)).toEqual({
      start: 2,
      end: 4,
      query: "编",
    });
    expect(
      findMentionQuery("＠Art D", 6, [{ id: "art", name: "Art Director" }]),
    ).toEqual({
      start: 0,
      end: 6,
      query: "Art D",
    });
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("closes the query on separators and ignores email syntax", () => {
    for (const text of ["hello@", "@总制片 ", "@总制片，", "@编\n剧", "没有提及"])
      expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it("does not reopen completed mentions when the author continues writing", () => {
    const text = "@编剧 请写第一集";
    expect(findMentionQuery(text, text.length, agents)).toBeNull();
    expect(
      findMentionQuery("@Art Director 请写", 17, [{ id: "art", name: "Art Director" }]),
    ).toBeNull();
  });
});
