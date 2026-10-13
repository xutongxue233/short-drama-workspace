import { HttpError } from "../http/errors.mjs";
import { bodyObject, textInput, projectGuard } from "../http/validation.mjs";
import { addMessage, compressMemory } from "../workflow/memory.mjs";

export function mountMemoryRoutes(app, { save, findProject, workflow }) {
  app.post("/api/projects/:id/memory/compress", (req, res) => {
    const project = findProject(req.params.id);
    const memory = compressMemory(project);
    addMessage(
      project,
      "system",
      "项目结构化记忆已重新汇总：整理固定事实、近期决策、进度和锁定资产，未调用语义摘要模型。模型上下文只带入本项目资料和最近对话；完整聊天记录仍可追溯。",
      "system",
    );
    save();
    res.json(memory);
  });

  app.post("/api/projects/:id/memory/facts", (req, res) => {
    const project = findProject(req.params.id),
      input = bodyObject(req);
    projectGuard(project);
    const fact = textInput(input.fact, "固定事实", {
      max: 1000,
      required: true,
    });
    if (project.memory.facts.length >= 60)
      throw new HttpError(400, "固定事实最多 60 条，请合并精简后再添加。");
    if (!project.memory.facts.includes(fact)) {
      project.memory.facts.push(fact);
      workflow.invalidateFrom(project, 0);
    }
    addMessage(
      project,
      "system",
      `新增项目固定事实：${fact}。工作流已等待重新核对，锁定角色标准保留。`,
      "system",
    );
    compressMemory(project);
    save();
    res.status(201).json(project.memory);
  });
}
