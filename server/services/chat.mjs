import { HttpError } from "../http/errors.mjs";
import { textInput } from "../http/validation.mjs";
import {
  addMessage,
  remember,
  compressMemory,
  buildContext,
} from "../workflow/memory.mjs";
import { generate } from "../providers/generate.mjs";
import { redact } from "../providers/config.mjs";
import { mentionedAgent } from "./chat-mentions.mjs";
import { productionCommand } from "./chat-commands.mjs";
import { uid } from "../seed.mjs";
import { projectTask } from "./project-tasks.mjs";
import { stateTransaction } from "../state-transaction.mjs";
import { resolveSkills, formatSkillInstructions, skillUsage } from "../skills.mjs";

function requestedSkills(content, input, state) {
  const ids = input === undefined ? [] : input;
  if (!Array.isArray(ids)) throw new HttpError(400, "技能标识必须是数组");
  const names = content.matchAll(
    /(?<![\p{L}\p{N}_$\\])\$([a-z0-9]+(?:-[a-z0-9]+)*)(?![\p{L}\p{N}_-])/giu,
  );
  const selected = [...ids];
  for (const [, token] of names) {
    const name = token.toLowerCase();
    const skill = state.skills?.find((item) => item.name === name);
    // Ordinary currency amounts are not invocations; known numeric names are.
    if (!skill && /^\d+$/.test(name)) continue;
    if (!skill)
      throw new HttpError(400, `技能 $${token} 不存在，请在技能库确认名称后重试。`);
    selected.push(skill.id);
  }
  return [...new Set(selected)];
}

function replyFailure(error, providers) {
  let detail = String(error?.message || "请求失败");
  for (const provider of providers) detail = redact(detail, provider.apiKey);
  detail = detail.slice(0, 1000);
  const advice = /尚未配置|尚无可用|未绑定|已停用|API Key|模型名称|模型类型|协议/.test(
    detail,
  )
    ? "请在 Agent 中心检查该角色的文本模型绑定，并在模型中心启用对应服务、补全模型名称和 API Key；保存后可重试这条消息。"
    : "请检查模型服务的接口地址、网络、权限和余额；修复后可重试这条消息。";
  return `消息已保存，本次回复未完成：${detail}\n\n${advice}`;
}

/** Owns per-project generation jobs; no HTTP response objects cross this boundary. */
export function createChatService({ getState, save, workflow, materials }) {
  const chatJobs = new Map();
  let closed = false;
  async function sendMessage(project, input, { signal } = {}) {
    if (closed) throw new HttpError(503, "本地服务正在关闭，请稍后重试。");
    if (projectTask(project))
      throw new HttpError(409, "图片测试仍在进行，请等待完成后发送消息。");
    if (chatJobs.has(project.id))
      throw new HttpError(409, "上一条 Agent 回复仍在生成，请等待后再发送。");

    const content = textInput(input.content, "消息", {
      max: 10000,
      required: true,
    });
    if (input.intent !== undefined && !["auto", "discussion"].includes(input.intent))
      throw new HttpError(400, "消息模式必须是 auto 或 discussion");
    const agentId =
      input.agentId === undefined
        ? (mentionedAgent(content, getState().agents, project.members)?.id ??
          "producer")
        : textInput(input.agentId, "Agent 标识", { max: 80, required: true });
    const agent = getState().agents.find((item) => item.id === agentId);
    if (!agent || !agent.enabled) throw new HttpError(400, "目标 Agent 不存在或未启用");
    const explicitSkillIds = requestedSkills(content, input.skillIds, getState());
    // Resolve and copy before saving the user's message or inviting a member.
    // Skill edits during an in-flight request affect only subsequent requests.
    const skills = resolveSkills(getState(), agent, explicitSkillIds);
    const command = explicitSkillIds.length
      ? null
      : productionCommand(content, agent, input.intent);
    const message = stateTransaction(project, () => {
      workflow.invite(project, agentId);
      const message = addMessage(project, "user", content, "text");
      remember(project, `用户反馈（交给${agent.name}）：${content}`);
      save();
      return message;
    });
    if (command) {
      let reply;
      try {
        if (command === "stop") {
          if (project.running) workflow.stop(project);
          reply =
            "制作已暂停。已完成的产物与确认结果保留，发送「继续制作」可从当前节点恢复。";
          if (project.approval) reply += "当前确认卡仍待你处理。";
        } else if (project.approval) {
          reply = `当前正在等待「${project.approval.title}」。请在下方确认卡选择并提交；确认后我会自动安排下一位 Agent，提出修改则会返修当前节点。`;
        } else if (project.running) {
          const node = project.nodes.find((item) => item.status === "running");
          reply = `团队正在执行「${node?.name || "制作节点"}」，这条要求已记入项目。完成后会自动推进，遇到需要你决定的事项会显示确认卡。`;
        } else if (!project.chapters.length) {
          reply =
            "已收到制作需求。请先通过输入框的「本集原文」导入小说章节或片段，再发送「开始制作」。我会依次协调原著拆解、编剧、审核、角色设计与分镜，在需要你决定时展示确认卡。";
        } else if (project.nodes.every((node) => node.status === "completed")) {
          reply =
            "本集制作流程已经验收。可在剧集档案中归档并创建下一集，再导入新的原文继续制作；如需修改本集，请在制作流程中选择需要返修的节点。流程验收不代表最终成片已经完成。";
        } else {
          const next = project.nodes.find((node) => node.status !== "completed");
          const started = addMessage(
            project,
            agentId,
            `已将这条创作要求交给制作流程，从「${next.name}」开始。总制片会邀请所需成员，节点完成后自动交接；关键选择通过确认卡提交。已有聊天提案作为参考，正式产物会保存到节点与资产中。`,
            "text",
          );
          started.replyTo = message.id;
          workflow.start(project);
          save();
          return message;
        }
        const response = addMessage(project, agentId, reply, "text");
        response.replyTo = message.id;
      } catch (error) {
        const response = addMessage(
          project,
          agentId,
          replyFailure(error, getState().providers),
          "error",
        );
        response.replyTo = message.id;
      }
      save();
      return message;
    }
    const controller = new AbortController();
    const runId = uid("discussion");
    chatJobs.set(project.id, {
      controller,
      runId,
      pending: { agentId, messageId: message.id, startedAt: message.createdAt },
    });
    try {
      const configured = getState().providers.find(
        (provider) => provider.id === agent.providerId,
      );
      const fallbackAgent =
        configured && configured.kind !== "text"
          ? ["producer", "writer"]
              .map((id) =>
                getState().agents.find((item) => item.id === id && item.enabled),
              )
              .find(
                (item) =>
                  item &&
                  getState().providers.some(
                    (provider) =>
                      provider.id === item.providerId &&
                      provider.kind === "text" &&
                      provider.enabled,
                  ),
              )
          : undefined;
      const provider =
        configured?.kind === "text"
          ? configured
          : getState().providers.find((item) => item.id === fallbackAgent?.providerId);
      if (!provider)
        throw new Error(
          "此角色尚无可用的文本对话接口，请配置该角色、总制片或编剧的文本服务。",
        );
      if (fallbackAgent) {
        addMessage(
          project,
          "system",
          `「${agent.name}」正在通过「${provider.name}」进行文字讨论，采用「${fallbackAgent.name}」的文本模型配置；此对话不会提交媒体生成任务。`,
          "system",
          undefined,
          { kind: "progress", scope: "chat", runId, toAgentId: agentId },
        );
        save();
      }
      const context = buildContext(project);
      const result = await generate({
        onDispatch() {
          const started = addMessage(
            project,
            agentId,
            `正在处理本条讨论消息，结合本集资料生成回复。`,
            "system",
            undefined,
            {
              kind: "start",
              scope: "chat",
              runId,
              ...(skills.length ? { skills: skillUsage(skills) } : {}),
            },
          );
          started.replyTo = message.id;
          save();
        },
        provider,
        kind: "text",
        model:
          configured?.kind === "text"
            ? agent.model || provider.model
            : fallbackAgent.model || provider.model,
        system: `${agent.systemPrompt}\n这是项目群的文字讨论。请直接回答当前用户，使用清晰的 Markdown 标题、列表和表格。本次提供的章节或片段仅用于制作一集，不预设或询问全剧集数，不推演未提供的后续原文。已配置的视觉风格与制作参数直接沿用，不重复提问。非阻塞的未知事项使用原文称呼或明确标注建议，不要要求用户一次回答一长串问题。不要执行审批或声称已推进工作流，不要声称生成了媒体。若用户讨论如何推进，告知可向总制片发送“开始制作”或“继续制作”，正式审批由系统确认卡处理。`,
        prompt: `${context.prompt}\n\n当前用户对「${agent.name}」的消息：\n${content}\n请根据本项目资料回答；明确区分原文事实、创作建议和未确认部分。${skills.length ? `\n\n${formatSkillInstructions(skills)}` : ""}`,
        references: materials
          ? await materials.references(context.references, "text")
          : context.references,
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
        timeoutMs: 90000,
      });
      if (closed) return message;
      const reply = addMessage(project, agentId, result.text, "text", undefined, {
        kind: "result",
        scope: "chat",
        runId,
        ...(skills.length ? { skills: skillUsage(skills) } : {}),
      });
      reply.replyTo = message.id;
    } catch (error) {
      if (closed) return message;
      const reply = addMessage(
        project,
        agentId,
        replyFailure(error, getState().providers),
        "error",
        undefined,
        { kind: "error", scope: "chat", runId },
      );
      reply.replyTo = message.id;
    } finally {
      chatJobs.delete(project.id);
    }
    if (project.messages.length - project.memory.compressedCount >= 30)
      compressMemory(project);
    if (!closed) save();
    return message;
  }
  return {
    sendMessage,
    getPending(projectId) {
      const pending = chatJobs.get(projectId)?.pending;
      return pending ? { ...pending } : null;
    },
    close() {
      if (closed) return;
      closed = true;
      const errors = [];
      for (const [projectId, { controller, runId, pending }] of chatJobs) {
        try {
          const project = getState().projects.find((item) => item.id === projectId);
          if (project) {
            const paused = addMessage(
              project,
              pending.agentId,
              "本地服务关闭，本条讨论回复已中断，原消息保留，可重新发送。",
              "system",
              undefined,
              { kind: "paused", scope: "chat", runId },
            );
            paused.replyTo = pending.messageId;
            save();
          }
        } catch (error) {
          errors.push(error);
        } finally {
          controller.abort();
        }
      }
      if (errors.length) throw new AggregateError(errors, "讨论检查点保存失败。");
    },
  };
}
