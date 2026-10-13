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

export function mentionedParticipant(content, participants, users) {
  const candidates = participants.flatMap((participant) => {
    const user = users.find((item) => item.id === participant.userId && !item.disabled);
    return user ? [user] : [];
  });
  for (const match of content.matchAll(/[@＠]/g)) {
    if (match.index > 0 && wordCharacter.test(content[match.index - 1])) continue;
    const rest = content.slice(match.index + 1);
    const user = candidates.find((candidate) =>
      [candidate.displayName, candidate.username].some(
        (name) =>
          name && rest.startsWith(name) && !wordCharacter.test(rest[name.length] || ""),
      ),
    );
    if (user) return user;
  }
  return undefined;
}
