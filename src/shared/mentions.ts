import type { Agent } from "../types";

type MentionAgent = Pick<Agent, "id" | "name"> & Partial<Pick<Agent, "role">>;
export interface MentionPart {
  text: string;
  agentId?: string;
}
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

const isWord = (value: string | undefined) => !!value && /[a-z0-9_]/i.test(value);

/** Keep unknown names and email addresses as ordinary text. */
export function splitMentions(
  text: string,
  agents: readonly MentionAgent[],
): MentionPart[] {
  const names = [...agents]
    .filter((agent) => agent.name)
    .sort((a, b) => b.name.length - a.name.length);
  const parts: MentionPart[] = [];
  let plainStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!"@＠".includes(text[index]) || isWord(text[index - 1])) continue;
    const agent = names.find(
      (item) =>
        text.startsWith(item.name, index + 1) &&
        !isWord(text[index + 1 + item.name.length]),
    );
    if (!agent) continue;
    if (index > plainStart) parts.push({ text: text.slice(plainStart, index) });
    const end = index + agent.name.length + 1;
    parts.push({ text: text.slice(index, end), agentId: agent.id });
    index = end - 1;
    plainStart = end;
  }
  if (plainStart < text.length) parts.push({ text: text.slice(plainStart) });
  return parts;
}

/** The query ends at the caret, so selecting a suggestion preserves following text. */
export function findMentionQuery(
  text: string,
  caret: number,
  agents: readonly MentionAgent[] = [],
): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = Math.max(before.lastIndexOf("@"), before.lastIndexOf("＠"));
  if (start < 0 || isWord(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (
    query.length > 80 ||
    /[\n\r@＠，。！？、；：,!?;:]/.test(query) ||
    /\s$/.test(query)
  )
    return null;
  // Once the author has left the mention, ordinary message text must not reopen
  // the popup. Spaces are only useful while completing a known name or role.
  if (
    /\s/.test(query) &&
    !agents.some((agent) =>
      [agent.name, agent.role].some((value) =>
        value?.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
      ),
    )
  )
    return null;
  return { start, end: caret, query };
}
