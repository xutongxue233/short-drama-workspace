import { transactionalRoute } from "../state-transaction.mjs";
import { HttpError } from "../http/errors.mjs";
import { bodyObject } from "../http/validation.mjs";
import { now, uid } from "../seed.mjs";
import { exportSkillMarkdown, parseSkillMarkdown, skillInput } from "../skills.mjs";

function assertVersion(input, skill) {
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new HttpError(400, "请提供正在编辑的 Skill 版本。");
  if (input.version !== skill.version)
    throw new HttpError(409, "此 Skill 已被修改，请刷新后查看最新版本再保存。");
}

export function mountSkillsRoutes(app, { getState, save }) {
  const find = (id) => {
    const skill = (getState().skills || []).find((item) => item.id === id);
    if (!skill) throw new HttpError(404, "Skill 不存在");
    return skill;
  };
  const uniqueName = (name, id) => {
    if ((getState().skills || []).some((item) => item.name === name && item.id !== id))
      throw new HttpError(409, "Skill 名称已存在，请使用不同名称。");
  };
  app.get("/api/skills", (_req, res) => res.json(getState().skills || []));
  app.post("/api/skills/parse", (req, res) =>
    res.json(parseSkillMarkdown(bodyObject(req).markdown)),
  );
  app.get("/api/skills/:id/export", (req, res) =>
    res.json(exportSkillMarkdown(find(req.params.id))),
  );
  app.post(
    "/api/skills",
    transactionalRoute(getState, (req, res) => {
      const input = skillInput(bodyObject(req));
      uniqueName(input.name);
      const timestamp = now();
      const skill = {
        ...input,
        id: uid("skill"),
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const state = getState();
      state.skills ??= [];
      state.skills.push(skill);
      save();
      res.status(201).json(skill);
    }),
  );
  app.patch(
    "/api/skills/:id",
    transactionalRoute(getState, (req, res) => {
      const skill = find(req.params.id);
      const input = bodyObject(req);
      assertVersion(input, skill);
      const patch = skillInput(input, skill);
      uniqueName(patch.name ?? skill.name, skill.id);
      Object.assign(skill, patch, { version: skill.version + 1, updatedAt: now() });
      save();
      res.json(skill);
    }),
  );
  app.delete(
    "/api/skills/:id",
    transactionalRoute(getState, (req, res) => {
      const skill = find(req.params.id);
      assertVersion(bodyObject(req), skill);
      const state = getState();
      state.skills.splice(state.skills.indexOf(skill), 1);
      for (const agent of state.agents)
        if (agent.skillIds?.includes(skill.id))
          agent.skillIds = agent.skillIds.filter((id) => id !== skill.id);
      save();
      res.json({ ok: true });
    }),
  );
}
