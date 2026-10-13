import { transactionalRoute } from "../state-transaction.mjs";
import { createProject, uid, now } from "../seed.mjs";
import { HttpError } from "../http/errors.mjs";
import {
  bodyObject,
  textInput,
  validateProjectScope,
  projectGuard,
} from "../http/validation.mjs";
import { remember, addMessage, compressMemory } from "../workflow/memory.mjs";
import { beginNextEpisode } from "../services/episodes.mjs";
import { workflowEvent } from "../workflow/events.mjs";

export function mountProjectsRoutes(
  app,
  { getState, save, findProject, workflow, chat },
) {
  app.post(
    "/api/projects",
    transactionalRoute(getState, (req, res) => {
      const input = bodyObject(req);
      validateProjectScope(input);
      if (getState().projects.length >= 100)
        throw new HttpError(400, "本地工作台最多创建 100 个项目。");
      const project = createProject({
        name: textInput(input.name, "项目名称", { max: 80, required: true }),
        description:
          input.description === undefined
            ? ""
            : textInput(input.description, "项目简介", { max: 2000 }),
        genre:
          input.genre === undefined
            ? "悬疑"
            : textInput(input.genre, "题材", { max: 80 }),
        style:
          input.style === undefined
            ? "待确认"
            : textInput(input.style, "视觉风格", { max: 80 }),
      });
      getState().projects.unshift(project);
      save();
      res.status(201).json(project);
    }),
  );

  app.patch(
    "/api/projects/:id",
    transactionalRoute(getState, (req, res) => {
      const project = findProject(req.params.id);
      projectGuard(project);
      if (chat?.getPending(project.id))
        throw new HttpError(409, "上一条 Agent 回复仍在生成，请等待后再修改项目配置。");
      const input = bodyObject(req),
        patch = {};
      validateProjectScope(input);
      for (const [field, max] of [
        ["name", 80],
        ["description", 2000],
        ["genre", 80],
        ["style", 80],
        ["visualStyleGuide", 4000],
      ]) {
        if (input[field] !== undefined)
          patch[field] = textInput(input[field], field, {
            max,
            required: field === "name",
          });
      }
      const creativeChanged = ["description", "genre", "style"].some(
        (key) => patch[key] !== undefined && patch[key] !== project[key],
      );
      const styleChanged = patch.style !== undefined && patch.style !== project.style;
      const guideChanged =
        patch.visualStyleGuide !== undefined &&
        patch.visualStyleGuide !== (project.visualStyleGuide || "");
      Object.assign(project, patch, { updatedAt: now() });
      if (creativeChanged) {
        workflow.invalidateFrom(project, 0, {
          preserveCharacters: !styleChanged && !guideChanged,
        });
        remember(
          project,
          `项目配置已修改：${JSON.stringify(patch)}。需要重新核对所有创作节点。`,
        );
        addMessage(
          project,
          "system",
          `项目创作配置已更新，工作流已回到原著拆解。${styleChanged || guideChanged ? "视觉风格或统一视觉标准已改变，旧角色资产需重新定妆确认。" : "已锁定角色仍作为参考标准保留，请复核是否需要解锁。"}派生产物将重新生成，旧的确认版本会保留归档。`,
          "system",
          "analysis",
          workflowEvent(project, project.nodes[0], "revision_requested", {
            phase: "project-edited",
          }),
        );
      } else if (guideChanged) {
        workflow.invalidateFrom(
          project,
          project.nodes.findIndex((node) => node.id === "characters"),
          { preserveCharacters: false },
        );
        const change = project.visualStyleGuide
          ? `项目统一视觉标准已更新：${project.visualStyleGuide}`
          : "项目统一视觉标准已清除，重新沿用项目已选视觉风格";
        remember(project, `${change}。从角色定妆起重新制作与确认。`);
        addMessage(
          project,
          "system",
          `${project.visualStyleGuide ? "统一视觉标准已更新" : "统一视觉标准已清除"}，角色定妆及后续节点需要重新制作与确认。已批准的原著拆解、剧本和合规结果保留；旧角色和后续资产已标记待更新，旧确认卡已失效。`,
          "system",
          "characters",
          workflowEvent(
            project,
            project.nodes.find((node) => node.id === "characters"),
            "revision_requested",
            { phase: "visual-style-edited" },
          ),
        );
      }
      compressMemory(project);
      save();
      res.json(project);
    }),
  );

  app.post(
    "/api/projects/:id/episodes",
    transactionalRoute(getState, (req, res) => {
      const project = findProject(req.params.id);
      const input = bodyObject(req);
      const title =
        input.title === undefined
          ? ""
          : textInput(input.title, "单集标题", { max: 120 });
      beginNextEpisode(project, {
        title,
        chatPending: Boolean(chat?.getPending(project.id)),
      });
      save();
      res.status(201).json(project);
    }),
  );

  app.post(
    "/api/projects/:id/chapters",
    transactionalRoute(getState, (req, res) => {
      const project = findProject(req.params.id);
      projectGuard(project);
      if (chat?.getPending(project.id))
        throw new HttpError(409, "请等待当前讨论结束后再导入原文。");
      const input = bodyObject(req);
      if (project.chapters.length >= 100)
        throw new HttpError(400, "当前一集最多导入 100 章或片段。");
      const chapter = {
        id: uid("chapter"),
        title: textInput(input.title, "章节标题", { max: 120, required: true }),
        content: textInput(input.content, "小说内容", {
          max: 200000,
          required: true,
        }),
        createdAt: now(),
      };
      if (
        project.chapters.reduce((total, item) => total + item.content.length, 0) +
          chapter.content.length >
        2000000
      )
        throw new HttpError(400, "当前一集原文总量最多 200 万字。");
      project.chapters.push(chapter);
      workflow.invalidateFrom(project, 0);
      addMessage(
        project,
        "user",
        `导入小说「${chapter.title}」，共 ${chapter.content.length} 字。`,
        "text",
      );
      addMessage(
        project,
        "producer",
        "原文已保存到本项目。创作节点已等待重新拆解；模型每次只读取有上限的原文节选、项目摘要和锁定资产，完整原文仍保留，可随项目导出。",
        "system",
      );
      compressMemory(project);
      save();
      res.status(201).json(chapter);
    }),
  );

  app.get("/api/projects/:id/export", (req, res) => {
    const project = findProject(req.params.id);
    const bundle = {
      format: "frameflow-project-v1",
      exportedAt: now(),
      note: "本包包含当前集、历集只读档案、原文、聊天、工作流、审批、记忆、资产引用与素材索引，不包含 API 密钥或媒体文件。已下载媒体保存在工作台数据目录的 media 子目录，完整备份需同时保留数据库与该目录；仅有远程地址的素材仍可能失效。历史文字提案不代表已生成媒体。",
      project,
      agents: getState()
        .agents.filter((agent) => project.members.includes(agent.id))
        .map(({ providerId: _providerId, model: _model, ...agent }) => agent),
    };
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-${project.id}.json"; filename*=UTF-8''${encodeURIComponent(project.name)}.json`,
    );
    res.type("application/json").send(JSON.stringify(bundle, null, 2));
  });
}
