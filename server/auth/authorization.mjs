import { HttpError } from "../http/errors.mjs";

const LEVELS = { viewer: 1, member: 2, editor: 3, owner: 4 };

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    kind: user.kind,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
  };
}

export function projectAccess(project, user) {
  if (!user || user.disabled) return null;
  return project.participants?.find((item) => item.userId === user.id)?.access || null;
}

export function assertProjectAccess(project, user, minimum = "viewer") {
  const access = projectAccess(project, user);
  if (!access) throw new HttpError(404, "项目不存在或无权访问。");
  if (!(LEVELS[access] >= LEVELS[minimum]))
    throw new HttpError(403, "当前项目权限不足。");
  return access;
}

export function requireAdmin(req, _res, next) {
  if (req.auth.user.role !== "admin")
    throw new HttpError(403, "此操作需要管理员权限。");
  next();
}

export function publicParticipants(project, state) {
  return (project.participants || []).map((participant) => {
    const user = state.security?.users?.find((item) => item.id === participant.userId);
    return {
      userId: participant.userId,
      username: user?.username || "",
      displayName: user?.displayName || "已移除用户",
      kind: user?.kind || "human",
      access: participant.access,
      ...(participant.jobTitle ? { jobTitle: participant.jobTitle } : {}),
    };
  });
}

export function publicAgent(agent, user) {
  if (user?.role === "admin") return { ...agent };
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    color: agent.color,
    enabled: agent.enabled,
    skillIds: [...(agent.skillIds || [])],
    systemPrompt: "",
    providerId: "",
    model: "",
  };
}

export function publicSkill(skill, user) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: user?.role === "admin" ? skill.instructions : "",
    enabled: skill.enabled,
    version: skill.version,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

/** Resolve ownership before indirect IDs reach file or provider services. */
export function mountAuthorization(app, { getState, findProject }) {
  app.use("/api/providers", requireAdmin);
  app.use("/api/agents", requireAdmin);
  app.use("/api/computers", requireAdmin);
  app.use("/api/skills", (req, res, next) => {
    // The directory is available for chat selection; instruction export and
    // every configuration operation remain administrator-only.
    if (["GET", "HEAD"].includes(req.method) && !req.path.replace(/\/+$/, ""))
      return next();
    requireAdmin(req, res, next);
  });
  app.use("/api/users", requireAdmin);
  app.use("/api/audit", requireAdmin);
  app.use("/api/projects/:id", (req, _res, next) => {
    const project = findProject(req.params.id);
    const path = req.path.toLowerCase().replace(/\/+$/, "");
    const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const minimum = !write
      ? "viewer"
      : /^\/participants(?:\/|$)/.test(path)
        ? "owner"
        : path === "/messages"
          ? "member"
          : "editor";
    req.projectAccess = assertProjectAccess(project, req.auth.user, minimum);
    next();
  });
  app.use("/api/media/:materialId", (req, _res, next) => {
    const project = getState().projects.find((candidate) =>
      candidate.materials?.some((material) => material.id === req.params.materialId),
    );
    if (!project) throw new HttpError(404, "素材不存在。");
    assertProjectAccess(project, req.auth.user);
    next();
  });
}
