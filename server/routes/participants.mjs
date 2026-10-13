import { HttpError } from "../http/errors.mjs";
import { bodyObject, textInput } from "../http/validation.mjs";
import { publicParticipants, projectAccess } from "../auth/authorization.mjs";
import { now } from "../seed.mjs";

function accessInput(value) {
  if (!["editor", "member", "viewer"].includes(value))
    throw new HttpError(400, "项目权限须为 editor、member 或 viewer。");
  return value;
}
function titleInput(value) {
  return textInput(value, "项目职务", { max: 80 });
}

export function mountParticipantRoutes(app, { getState, findProject, auth }) {
  const view = (project, user) => ({
    participants: publicParticipants(project, getState()),
    currentUserAccess: projectAccess(project, user),
  });
  app.post("/api/projects/:id/participants", (req, res) => {
    const project = findProject(req.params.id),
      input = bodyObject(req);
    const user = auth.security().users.find((item) =>
      input.userId
        ? item.id === input.userId
        : item.username ===
          String(input.username || "")
            .trim()
            .toLowerCase(),
    );
    if (!user || user.disabled)
      throw new HttpError(404, "账号不存在或已停用，请联系管理员创建账号。");
    if (project.participants.some((item) => item.userId === user.id))
      throw new HttpError(409, "该用户已在项目中。");
    const participant = {
      userId: user.id,
      access: accessInput(input.access ?? "member"),
      ...(input.jobTitle !== undefined ? { jobTitle: titleInput(input.jobTitle) } : {}),
    };
    auth.mutate(() => {
      project.participants.push(participant);
      project.updatedAt = now();
      auth.audit(
        "project.participant.added",
        req.auth.user,
        `${project.id}/${user.id}`,
      );
    });
    res.status(201).json(view(project, req.auth.user));
  });
  app.patch("/api/projects/:id/participants/:userId", (req, res) => {
    const project = findProject(req.params.id),
      input = bodyObject(req);
    const participant = project.participants.find(
      (item) => item.userId === req.params.userId,
    );
    if (!participant) throw new HttpError(404, "项目成员不存在。");
    if (participant.access === "owner")
      throw new HttpError(409, "项目拥有者权限不可修改。");
    const patch = {};
    if (input.access !== undefined) patch.access = accessInput(input.access);
    if (input.jobTitle !== undefined) patch.jobTitle = titleInput(input.jobTitle);
    auth.mutate(() => {
      Object.assign(participant, patch);
      project.updatedAt = now();
      auth.audit(
        "project.participant.updated",
        req.auth.user,
        `${project.id}/${participant.userId}`,
      );
    });
    res.json(view(project, req.auth.user));
  });
  app.delete("/api/projects/:id/participants/:userId", (req, res) => {
    const project = findProject(req.params.id);
    const participant = project.participants.find(
      (item) => item.userId === req.params.userId,
    );
    if (!participant) throw new HttpError(404, "项目成员不存在。");
    if (participant.access === "owner")
      throw new HttpError(409, "项目拥有者不可移除。");
    auth.mutate(() => {
      project.participants = project.participants.filter(
        (item) => item !== participant,
      );
      project.updatedAt = now();
      auth.audit(
        "project.participant.removed",
        req.auth.user,
        `${project.id}/${participant.userId}`,
      );
    });
    res.json(view(project, req.auth.user));
  });
}
