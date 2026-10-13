const wordCharacter = /[A-Za-z0-9_]/;

/** Match the first enabled group member mentioned in prose, excluding emails. */
export function mentionedAgent(content, agents, members) {
  const candidates = agents
    .filter((agent) => agent.enabled && members.includes(agent.id) && agent.name)
    .toSorted((left, right) => right.name.length - left.name.length);
  for (const match of content.matchAll(/[@＠]/g)) {
    const start = match.index;
    if (start > 0 && wordCharacter.test(content[start - 1])) continue;
    const agent = candidates.find(
      (candidate) =>
        content.startsWith(candidate.name, start + 1) &&
        !wordCharacter.test(content[start + 1 + candidate.name.length] || ""),
    );
    if (agent) return agent;
  }
  return undefined;
}
