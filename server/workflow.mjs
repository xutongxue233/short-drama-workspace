import { generate } from "./providers/generate.mjs";
import { createHash, randomUUID } from "node:crypto";
import { now, uid } from "./seed.mjs";
import { HttpError } from "./http/errors.mjs";
import { redact } from "./providers/config.mjs";
import { briefDescription, confirmedBrief } from "./workflow/brief.mjs";
import {
  addMessage,
  remember,
  compressMemory,
  buildContext,
  activeReference,
} from "./workflow/memory.mjs";
import { upsertAsset, parseCharacterPlan } from "./workflow/assets.mjs";
import {
  buildCharacterPlanningPrompt,
  CHARACTER_PLANNING_VERSION,
  CHARACTER_PLANNING_REPAIRS,
} from "./workflow/character-planning.mjs";
import {
  buildCharacterImagePrompt,
  buildStoryboardImagePrompt,
  selectCharacterBaseReferences,
} from "./workflow/visual-prompts.mjs";
import {
  buildVideoShotRequest,
  buildMediaInventory,
  buildDeliveryStoryboard,
} from "./workflow/video-shot.mjs";
import {
  characterCheckpointKey,
  characterDraft,
  characterPilot,
  charactersForApproval,
  saveCharacterDraft,
  approveCharacterDrafts,
} from "./workflow/character-checkpoint.mjs";
import { createApproval, TASKS, OUTPUT_GUIDELINES } from "./workflow/templates.mjs";
import { workflowEvent, approvalEvent, recordNodeStart } from "./workflow/events.mjs";
import { projectTask } from "./services/project-tasks.mjs";
import { snapshotState, stateTransaction } from "./state-transaction.mjs";
export { HttpError } from "./http/errors.mjs";
export {
  addMessage,
  remember,
  compressMemory,
  buildContext,
} from "./workflow/memory.mjs";

export function createWorkflow({ getState, save, materials }) {
  const jobs = new Map();
  function failureDetail(error) {
    let detail = String(error?.message || "本地检查点写入失败");
    for (const provider of getState().providers)
      detail = redact(detail, provider.apiKey);
    return detail.slice(0, 600);
  }
  function persistenceFailure(project, error) {
    project.persistenceError = `本地检查点保存失败：${failureDetail(error)}。本次产物仍保留在内存中，请修复存储后重试保存，暂勿关闭服务或重复生成。`;
    addMessage(project, "system", project.persistenceError, "error");
  }
  const mediaReferences = (references, kind) =>
    materials ? materials.references(references, kind) : references;

  async function captureMedia(
    project,
    node,
    agent,
    provider,
    result,
    prompt,
    signal,
    name,
    references = [],
    videoShot,
    captureId,
  ) {
    if (!materials || !result.url) return result;
    const material = await materials.capture(
      project,
      {
        url: result.url,
        name,
        type: provider.kind,
        nodeId: node.id,
        providerId: provider.id,
        model: agent.model || provider.model,
        prompt,
        referenceAssets: references,
        ...(result.metadata?.jobId ? { providerTaskId: result.metadata.jobId } : {}),
        ...(videoShot ? { videoShot } : {}),
        ...(captureId ? { captureId } : {}),
      },
      signal,
    );
    return { ...result, url: material.url, materialId: material.id };
  }

  function linkMaterial(project, asset) {
    if (!asset?.materialId) return;
    const material = project.materials?.find((item) => item.id === asset.materialId);
    if (material) material.assetId = asset.id;
  }
  function agentFor(node) {
    const agent = getState().agents.find((item) => item.id === node.agentId);
    if (!agent || !agent.enabled)
      throw new Error(
        `负责「${node.name}」的 Agent 未启用，请在 Agent 中心启用后重试。`,
      );
    return agent;
  }
  function characterSetup(project, agent, provider) {
    const planner =
      provider.kind === "text"
        ? agent
        : getState().agents.find((item) => item.id === "writer");
    const textProvider =
      provider.kind === "text"
        ? provider
        : getState().providers.find((item) => item.id === planner?.providerId);
    if (!planner?.enabled || textProvider?.kind !== "text" || !textProvider.enabled)
      throw new Error(
        "角色定妆需要编剧绑定一个启用的文本接口，用于从原著提取角色设定。",
      );
    return {
      planner,
      textProvider,
      key: characterCheckpointKey(
        project,
        agent,
        provider,
        planner,
        textProvider,
        TASKS.characters,
      ),
    };
  }
  function invite(project, agentId) {
    const agent = getState().agents.find((item) => item.id === agentId);
    if (!agent) throw new HttpError(404, "Agent 不存在");
    if (!agent.enabled) throw new HttpError(409, "请先在 Agent 中心启用此 Agent");
    if (!project.members.includes(agentId)) {
      project.members.push(agentId);
      addMessage(
        project,
        "system",
        `总制片邀请了 ${agent.name} 加入项目群`,
        "system",
        undefined,
        {
          kind: "progress",
          phase: "member-invited",
          fromAgentId: "producer",
          toAgentId: agentId,
        },
      );
    }
    return agent;
  }

  function invalidateFrom(project, index, { preserveCharacters = true } = {}) {
    const nodeIds = new Set(project.nodes.slice(index).map((node) => node.id));
    for (const node of project.nodes.slice(index)) {
      node.status = "pending";
      node.output = "";
      delete node.error;
      delete node.startedAt;
      delete node.completedAt;
      if (node.characterGeneration?.images?.length)
        node.imageTaskHistory = [
          ...(node.imageTaskHistory || []),
          ...node.characterGeneration.images.map((image) => ({
            ...image,
            generationId: node.characterGeneration.id,
            archivedAt: now(),
            reason: "creative-input-changed",
          })),
        ];
      delete node.characterGeneration;
      delete node.videoShotId;
    }
    // Preserve locked references and prior artifacts for audit; mark outputs requiring regeneration.
    for (const asset of project.assets) {
      if (
        asset.tags.includes("历史版本") ||
        (preserveCharacters &&
          asset.locked &&
          ["character", "scene"].includes(asset.type))
      )
        continue;
      if (
        asset.tags.some(
          (tag) => tag.startsWith("node:") && nodeIds.has(tag.slice(5)),
        ) ||
        (!preserveCharacters && asset.type === "character")
      )
        asset.tags = [...new Set([...asset.tags, "待更新"])];
    }
    if (project.approval && nodeIds.has(project.approval.nodeId))
      project.approval = null;
  }

  function recordArtifacts(project, node, output, result) {
    const base = {
      description: `${node.name}产物 · ${project.style}`,
      content: output,
      tags: [node.name],
    };
    if (node.id === "adaptation")
      upsertAsset(project, node.id, {
        ...base,
        name: "短剧改编提案",
        type: "script",
      });
    if (result?.characters && !result.charactersStored) {
      for (const character of result.characters)
        upsertAsset(project, node.id, {
          ...base,
          ...character,
          type: "character",
          tags: ["角色定妆", "待确认"],
        });
    }
    if (node.id === "storyboard")
      linkMaterial(
        project,
        upsertAsset(project, node.id, {
          ...base,
          name: "本集分镜",
          type: "storyboard",
          ...(result?.url ? { url: result.url } : {}),
          ...(result?.materialId ? { materialId: result.materialId } : {}),
        }),
      );
    if (node.id === "video")
      linkMaterial(
        project,
        upsertAsset(project, node.id, {
          ...base,
          name: result?.videoShot
            ? `本集 · 镜头 ${result.videoShot.id}`
            : "本集 · 首个生成镜头",
          type: "video",
          ...(result?.url ? { url: result.url } : {}),
          ...(result?.materialId ? { materialId: result.materialId } : {}),
          ...(result?.videoShot ? { videoShot: result.videoShot } : {}),
          tags: ["镜头素材"],
        }),
      );
    if (node.id === "delivery")
      upsertAsset(project, node.id, {
        ...base,
        name: "制作交付清单",
        type: "script",
        tags: ["交付", "剪辑计划"],
      });
  }

  async function produce(project, node, signal, onStart, { shotId } = {}) {
    const agent = agentFor(node);
    const provider = getState().providers.find((item) => item.id === agent.providerId);
    if (!provider)
      throw new Error(`「${agent.name}」尚未分配模型接口，请在 Agent 中心选择接口。`);
    const allowed =
      node.id === "characters" || node.id === "storyboard"
        ? ["text", "image"]
        : node.id === "video"
          ? ["video"]
          : ["text"];
    if (!allowed.includes(provider.kind))
      throw new Error(
        `「${node.name}」需要 ${allowed.join("/")} 类型接口，当前绑定为 ${provider.kind}。`,
      );
    if (!provider.enabled)
      throw new Error(`「${agent.name}」绑定的模型服务已停用，请先启用后重试。`);
    const context = buildContext(project);
    const prompt = `${context.prompt}\n\n当前任务：${TASKS[node.id]}${node.id === "delivery" ? `\n\n${buildMediaInventory(project)}\n\n${buildDeliveryStoryboard(project)}` : ""}`;
    if (node.id === "characters") {
      const { planner, textProvider, key } = characterSetup(project, agent, provider);
      if (node.characterGeneration?.key !== key) {
        let plan;
        let correction;
        for (let attempt = 0; attempt <= CHARACTER_PLANNING_REPAIRS; attempt++) {
          const planning = await generate({
            onDispatch() {
              onStart();
              addMessage(
                project,
                planner.id,
                `正在${attempt ? "校正" : "整理"}本集角色规划，供角色设计核对人物依据与固定外观。`,
                "system",
                node.id,
                workflowEvent(project, node, "progress", {
                  phase: "character-planning",
                  fromAgentId: planner.id,
                  toAgentId: agent.id,
                }),
              );
              save();
            },
            provider: textProvider,
            kind: "text",
            model: planner.model || textProvider.model,
            system: planner.systemPrompt,
            signal,
            prompt: buildCharacterPlanningPrompt(project, correction),
          });
          signal.throwIfAborted();
          try {
            plan = parseCharacterPlan(planning.text, project);
            if (
              project.visualStyleGuide?.trim() &&
              plan.some((character) => !character.characterDesign)
            )
              throw new Error(
                "已确认统一视觉标准，请为每个主体提供 characterDesign 基础设计与独立 sceneStates，不能退回旧版笼统外观描述。",
              );
            addMessage(
              project,
              planner.id,
              `本集角色规划已通过资料校验，共 ${plan.length} 个主体，角色设计将据此复用标准或生成定妆图。`,
              "system",
              node.id,
              workflowEvent(project, node, "progress", {
                phase: "character-plan-ready",
                fromAgentId: planner.id,
                toAgentId: agent.id,
              }),
            );
            save();
            break;
          } catch (error) {
            if (attempt === CHARACTER_PLANNING_REPAIRS) throw error;
            correction = { previous: planning.text, error: error.message };
            addMessage(
              project,
              agent.id,
              `角色规划需要校正：${error.message}\n\n正在依据本集资料修正角色清单与基础设定，无需上传完整小说。自动校正最多一次，通过校验后再开始生成图片。`,
              "system",
              node.id,
              workflowEvent(project, node, "progress"),
            );
            save();
          }
        }
        if (node.characterGeneration)
          for (const asset of project.assets)
            if (
              !asset.locked &&
              asset.tags.includes(`generation:${node.characterGeneration.id}`)
            )
              asset.tags = [...new Set([...asset.tags, "待更新"])];
        // The checkpoint must describe the exact standard used for generation,
        // including upgrades of approved structured text cards without images.
        plan = plan.map((character) => {
          const standard = project.assets.find(
            (asset) =>
              asset.type === "character" &&
              asset.name === character.name &&
              activeReference(asset) &&
              (!character.characterDesign || asset.characterDesign?.version === 1),
          );
          return standard
            ? {
                name: standard.name,
                description: standard.description,
                content: standard.content,
                ...(standard.characterDesign
                  ? { characterDesign: standard.characterDesign }
                  : {}),
              }
            : character;
        });
        const newDesigns =
          provider.kind === "image"
            ? plan.filter(
                (character) =>
                  character.characterDesign &&
                  !project.assets.some(
                    (asset) =>
                      asset.name === character.name &&
                      asset.type === "character" &&
                      asset.characterDesign?.version === 1 &&
                      asset.url &&
                      activeReference(asset),
                  ),
              )
            : [];
        const pilot =
          newDesigns.find(
            (character) => character.characterDesign.subjectType === "person",
          ) || newDesigns[0];
        node.characterGeneration = {
          id: uid("character-generation"),
          key,
          planningVersion: CHARACTER_PLANNING_VERSION,
          outputKind: provider.kind,
          plan,
          ...(pilot ? { stage: "pilot", pilotName: pilot.name } : {}),
        };
        save();
      }
      const checkpoint = node.characterGeneration;
      const characters = [];
      const currentPlan =
        checkpoint.stage === "pilot"
          ? checkpoint.plan.filter(
              (character) => character.name === checkpoint.pilotName,
            )
          : checkpoint.plan;
      for (const planned of currentPlan) {
        const existing = project.assets.find(
          (asset) =>
            asset.type === "character" &&
            asset.name === planned.name &&
            activeReference(asset),
        );
        const compatible =
          existing &&
          (!planned.characterDesign || existing.characterDesign?.version === 1);
        if (compatible && (provider.kind === "text" || existing.url)) {
          characters.push({
            name: existing.name,
            description: existing.description,
            content: existing.content,
            ...(existing.characterDesign
              ? { characterDesign: existing.characterDesign }
              : {}),
            ...(existing.url ? { url: existing.url } : {}),
          });
          continue;
        }
        const character = compatible
          ? {
              name: existing.name,
              description: existing.description,
              content: existing.content,
              ...(existing.characterDesign
                ? { characterDesign: existing.characterDesign }
                : {}),
            }
          : planned;
        const resumed = characterDraft(project, checkpoint, character);
        if (resumed && (provider.kind === "text" || resumed.url)) {
          characters.push({
            name: resumed.name,
            description: resumed.description,
            content: resumed.content,
            ...(resumed.characterDesign
              ? { characterDesign: resumed.characterDesign }
              : {}),
            ...(resumed.url ? { url: resumed.url } : {}),
          });
          continue;
        }
        if (provider.kind === "text") {
          saveCharacterDraft(project, checkpoint, character);
          save();
          characters.push(character);
          continue;
        }
        // Identity references belong to this subject only. Other cast members'
        // faces and scene images can otherwise leak into a standalone costume sheet.
        const characterReferences = selectCharacterBaseReferences(
          project,
          character,
          context.references,
        );
        if (
          provider.protocol === "minimax" &&
          character.characterDesign?.subjectType === "object" &&
          characterReferences.length
        )
          throw new Error(
            `MiniMax 图像参考只支持人物，不能用「${character.name}」的物体参考图生成。请为该节点选择支持物体参考的图片服务。`,
          );
        const characterPrompt = buildCharacterImagePrompt(project, character, {
          references: characterReferences,
          compact: provider.protocol === "minimax",
        });
        let image = checkpoint.images?.find(
          (item) =>
            item.name === character.name &&
            item.content === character.content &&
            item.status !== "failed",
        );
        if (image && !image.result?.url)
          throw new Error(
            `「${character.name}」的图片请求已派发但结果尚未保存，不能自动重复生图。请先核查供应商；如确认需要重新生成，在节点详情中明确归档该不确定请求，之后重试可能再次计费。`,
          );
        if (!image) {
          let result;
          try {
            result = await generate({
              onDispatch() {
                onStart();
                addMessage(
                  project,
                  agent.id,
                  `正在生成「${character.name}」的角色参考图。`,
                  "system",
                  node.id,
                  workflowEvent(project, node, "progress", {
                    phase: "character-image",
                  }),
                );
                image = {
                  name: character.name,
                  content: character.content,
                  captureId: `material-${randomUUID()}`,
                  providerId: provider.id,
                  model: agent.model || provider.model,
                  status: "submitted",
                  createdAt: now(),
                };
                (checkpoint.images ||= []).push(image);
                // A crash after dispatch must not turn into another paid POST.
                save();
              },
              provider,
              prompt: characterPrompt,
              system: agent.systemPrompt,
              model: agent.model || provider.model,
              kind: provider.kind,
              signal,
              references: await mediaReferences(characterReferences, provider.kind),
            });
            if (!result.url)
              throw new Error(
                `生图接口没有为「${character.name}」返回可用媒体 URL，请检查接口返回格式。`,
              );
          } catch (error) {
            // Once dispatched, a timeout, gateway error or invalid response does
            // not prove the provider stopped work. Keep the submitted record so
            // a later retry cannot silently incur a second generation charge.
            if (image)
              error.message +=
                " 本次图片请求的远端结果尚不确定；如需重新生成，请在节点详情明确归档该请求。";
            throw error;
          }
          image.result = result;
          image.status = "generated";
          // Persist the returned URL and stable capture ID before downloading.
          // On save failure, retain this result in memory for the next save/retry.
          save();
        }
        const result = image.result;
        const captured = await captureMedia(
          project,
          node,
          agent,
          provider,
          result,
          characterPrompt,
          signal,
          `${character.name} · 角色定妆`,
          characterReferences,
          undefined,
          image.captureId,
        );
        signal.throwIfAborted();
        const generated = {
          ...character,
          url: captured.url,
          ...(captured.materialId ? { materialId: captured.materialId } : {}),
        };
        linkMaterial(
          project,
          saveCharacterDraft(project, checkpoint, generated, existing),
        );
        addMessage(
          project,
          agent.id,
          `「${character.name}」角色参考图已保存到资产，等待本轮人工确认。`,
          "system",
          node.id,
          workflowEvent(project, node, "progress", { phase: "character-image-ready" }),
        );
        save();
        characters.push(generated);
      }
      onStart(false);
      return {
        text: `## ${checkpoint.stage === "pilot" ? "基础角色样板 · 待目视确认" : `角色${provider.kind === "image" ? "基础图" : "文字设定"}`}\n\n${checkpoint.stage === "pilot" ? `本集已规划 **${checkpoint.plan.length} 个主体**，先生成「${checkpoint.pilotName}」样板。请检查是否符合统一画风、面部和服装是否清楚。确认后再继续其余角色，当前仅为待审核的设计提案。` : `已整理 **${characters.length} 项角色资产**。请逐一核对身份、五官、完整身形与服装；基础图确认后再按镜头补充状态与视角。`}\n\n${characters.map((character) => `### ${character.name}\n\n${character.content}`).join("\n\n")}${provider.kind === "text" ? "\n\n> 当前角色 Agent 绑定文字接口，只生成了文字卡片；需要图片时请绑定图片接口。" : ""}`,
        characters,
        charactersStored: true,
      };
    }
    const videoRequest =
      provider.kind === "video" ? buildVideoShotRequest(project, { shotId }) : null;
    const generationPrompt = videoRequest
      ? videoRequest.prompt
      : provider.kind === "image" && node.id === "storyboard"
        ? buildStoryboardImagePrompt(project)
        : prompt;
    const generationReferences = videoRequest
      ? videoRequest.references
      : provider.kind === "image"
        ? context.references.filter((asset) =>
            ["character", "scene"].includes(asset.type),
          )
        : context.references;
    const activeModel = agent.model || provider.model;
    const requestKey = videoRequest
      ? createHash("sha256")
          .update(
            JSON.stringify({
              providerId: provider.id,
              baseUrl: provider.baseUrl,
              protocol: provider.protocol,
              model: activeModel,
              prompt: generationPrompt,
              system: agent.systemPrompt,
              references: generationReferences,
              videoOptions: videoRequest.videoOptions,
              storyboardId: videoRequest.shot.storyboardId,
              storyboardVersion: videoRequest.shot.storyboardVersion,
            }),
          )
          .digest("hex")
      : undefined;
    const priorTask = videoRequest ? node.videoGeneration : undefined;
    if (priorTask?.taskId && priorTask.requestKey !== requestKey)
      throw new Error(
        `已有视频任务 ${priorTask.taskId}（镜头 ${priorTask.shotId} / ${priorTask.model}）尚未取回。当前模型、分镜或参考资料已变化，已阻止重新提交以免重复计费；可恢复原配置取回任务，或在节点详情中明确归档并放弃取回旧任务后再制作新版本。归档不会取消供应商任务。`,
      );
    let result = await generate({
      onDispatch: onStart,
      provider,
      prompt: generationPrompt,
      system:
        provider.kind !== "text"
          ? agent.systemPrompt
          : `${agent.systemPrompt}\n\n${OUTPUT_GUIDELINES}`,
      model: activeModel,
      kind: provider.kind,
      signal,
      references: await mediaReferences(generationReferences, provider.kind),
      ...(videoRequest ? { videoOptions: videoRequest.videoOptions } : {}),
      ...(priorTask?.taskId ? { resumeTaskId: priorTask.taskId } : {}),
      ...(videoRequest && provider.protocol === "minimax"
        ? {
            onTaskCreated({ id }) {
              node.videoGeneration = {
                providerId: provider.id,
                baseUrl: provider.baseUrl,
                model: activeModel,
                shotId: videoRequest.shot.id,
                requestKey,
                taskId: id,
              };
              addMessage(
                project,
                node.agentId,
                `镜头 ${videoRequest.shot.id} 的 MiniMax 视频任务已提交（${activeModel}）。任务 ID：${id}。正在等待模型生成，完成后将自动保存素材；等待或恢复此任务不会重复提交。`,
                "system",
                node.id,
                workflowEvent(project, node, "progress", { phase: "video-task" }),
              );
              save();
            },
          }
        : {}),
    });
    if ((provider.kind === "image" || provider.kind === "video") && !result.url)
      throw new Error(
        "媒体接口未返回可用 URL，节点尚未完成。请检查接口返回格式后重试。",
      );
    if (provider.kind === "text" && !result.text?.trim())
      throw new Error("文本模型返回空结果，请检查模型和接口设置。");
    if (provider.kind === "image" || provider.kind === "video")
      result = await captureMedia(
        project,
        node,
        agent,
        provider,
        result,
        generationPrompt,
        signal,
        node.id === "storyboard"
          ? "本集分镜"
          : `本集 · 镜头 ${videoRequest.shot.id} · ${videoRequest.shot.durationSeconds} 秒`,
        generationReferences,
        videoRequest?.shot,
      );
    if (videoRequest) {
      const { shot } = videoRequest;
      return {
        ...result,
        videoShot: shot,
        text: `## ${shot.selection === "specified" ? "指定镜头" : "首个镜头"}素材已生成\n\n- 镜号：${shot.id}；分镜区间：${shot.startSeconds}–${shot.endSeconds} 秒；请求时长：${shot.durationSeconds} 秒；画幅：${videoRequest.videoOptions.ratio}。\n- 依据：${shot.storyboardId} / v${shot.storyboardVersion}。\n- 本镜参考：${videoRequest.references.map((asset) => `${asset.name} / v${asset.version}`).join("、") || "空镜或无可见人物，不附加角色参考图"}。\n${shot.skippedShots?.length ? `- 另有 ${shot.skippedShots.length} 个前置镜头明确安排为后期制作，未调用视频模型。\n` : ""}\n视频接口已返回媒体地址，保存状态见素材库。此片段尚未人工验收；其余镜头、配音及成片剪辑仍待制作，不能视为整集完成。`,
      };
    }
    return {
      ...result,
      text:
        result.text ||
        (provider.kind === "video"
          ? "视频服务返回了首个镜头素材，请在资产库预览。其余镜头及最终成片剪辑仍待制作。"
          : "生图服务返回了分镜视觉提案，请在资产库检查构图和连续性。"),
    };
  }

  async function runLoop(project, job) {
    const { controller } = job;
    try {
      for (const node of project.nodes) {
        if (controller.signal.aborted) return;
        if (node.status === "completed") continue;
        if (node.status === "waiting" || project.approval) break;
        job.current = { node, runId: uid("execution"), started: false };
        const agent = agentFor(node);
        invite(project, node.agentId);
        if (node.id === "analysis") {
          invite(project, "writer");
          invite(project, "director");
        }
        node.status = "running";
        delete node.error;
        delete node.startedAt;
        save();
        const result = await produce(
          project,
          node,
          controller.signal,
          (usesModel = true) => {
            if (job.current.started) return;
            controller.signal.throwIfAborted();
            if (jobs.get(project.id) !== job) throw new Error("本次节点执行已结束。");
            job.current.started = true;
            node.startedAt = now();
            recordNodeStart(project, node, job.current.runId, usesModel);
            if (node.id === "video")
              addMessage(
                project,
                node.agentId,
                node.videoGeneration?.taskId
                  ? `正在取回已有视频任务 ${node.videoGeneration.taskId}，本次不重新提交生成。`
                  : job.shotId
                    ? `本次仅制作已批准分镜的指定镜头 ${job.shotId}；不会自动批量生成其他镜头。`
                    : "本次仅制作已批准分镜的首个非后期镜头。",
                "system",
                node.id,
                workflowEvent(project, node, "progress", { phase: "video-shot" }),
              );
            save();
          },
          { shotId: job.shotId },
        );
        if (controller.signal.aborted || jobs.get(project.id) !== job) return;
        node.output = String(result.text).slice(0, 150000);
        recordArtifacts(project, node, node.output, result);
        if (node.id === "video") delete node.videoGeneration;
        addMessage(
          project,
          agent.id,
          node.output,
          "result",
          node.id,
          workflowEvent(project, node, "result", { runId: job.current.runId }),
        );
        project.approval = createApproval(project, node);
        if (project.approval) {
          node.status = "waiting";
          addMessage(
            project,
            "producer",
            `@你 ${project.approval.title}。${project.approval.description}`,
            "approval",
            node.id,
            approvalEvent(project, node, "approval_requested", project.approval),
          );
        } else {
          node.status = "completed";
          node.completedAt = now();
          addMessage(
            project,
            agent.id,
            `「${node.name}」执行完成，产物已保存；本节点无独立人工确认。`,
            "system",
            node.id,
            workflowEvent(project, node, "completed"),
          );
        }
        compressMemory(project);
        save();
        if (project.approval) break;
      }
    } catch (error) {
      if (!controller.signal.aborted && jobs.get(project.id) === job) {
        const node =
          job.current?.node ||
          project.nodes.find((item) => item.status === "running") ||
          project.nodes.find((item) => item.status === "pending");
        if (node) {
          node.status = "failed";
          let detail = String(error.message || "节点执行失败");
          for (const provider of getState().providers)
            detail = redact(detail, provider.apiKey);
          if (
            node.id === "video" &&
            error.terminalTask === true &&
            error.taskId === node.videoGeneration?.taskId &&
            ["failed", "cancelled", "Fail"].includes(error.taskStatus)
          ) {
            node.videoTaskHistory ||= [];
            node.videoTaskHistory.push({
              ...node.videoGeneration,
              status: error.taskStatus,
              failedAt: now(),
              error: detail.slice(0, 1200),
            });
            delete node.videoGeneration;
            detail = `${detail.slice(0, 950)}\n\n该远端任务已明确失败或取消，任务记录已保留。再次点击「重试节点」将提交一个新任务；不会自动重试生成。`;
          }
          node.error = detail.slice(0, 1200);
        }
        addMessage(
          project,
          node?.agentId || "producer",
          `### 制作暂停\n\n${node?.error || "节点执行失败"}\n\n已保留完成的节点、确认决策和锁定资产。修正模型配置或问题后，点击「重试节点」从当前检查点继续。`,
          "error",
          node?.id,
          workflowEvent(project, node, "error", { runId: job.current?.runId }),
        );
      }
    } finally {
      if (jobs.get(project.id) === job) {
        project.running = false;
        project.updatedAt = now();
        jobs.delete(project.id);
        try {
          save();
        } catch (error) {
          persistenceFailure(project, error);
        }
      }
    }
  }

  function start(project, { nodeId, shotId } = {}) {
    if (projectTask(project))
      throw new HttpError(
        409,
        "此项目已有模型测试或其他任务，请等待完成后再开始制作。",
      );
    if (project.running || jobs.has(project.id))
      throw new HttpError(409, "项目正在运行，请等待或先暂停。");
    if (!project.chapters.length)
      throw new HttpError(400, "请先导入至少一章小说原文。");
    if (project.approval) throw new HttpError(409, "有待确认事项，请先完成当前审批。");
    const target = nodeId
      ? project.nodes.find((node) => node.id === nodeId)
      : project.nodes.find((node) => node.status !== "completed");
    const selectedShotId =
      shotId ??
      (target?.id === "video"
        ? (target.videoShotId ?? target.videoGeneration?.shotId)
        : undefined);
    let videoShotId;
    if (selectedShotId !== undefined) {
      if (target?.id !== "video")
        throw new HttpError(400, "指定镜号仅适用于当前视频制作节点。");
      if (
        project.nodes
          .slice(0, project.nodes.indexOf(target))
          .some((node) => node.status !== "completed")
      )
        throw new HttpError(409, "请先完成并确认前置节点。");
      try {
        videoShotId = buildVideoShotRequest(project, { shotId: selectedShotId }).shot
          .id;
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      if (
        target.videoGeneration?.taskId &&
        target.videoGeneration.shotId !== videoShotId
      )
        throw new HttpError(
          409,
          `已有镜头 ${target.videoGeneration.shotId} 的视频任务 ${target.videoGeneration.taskId} 尚未取回，请先取回该任务再制作其他镜头。`,
        );
    }
    const restore = snapshotState(project);
    const job = { controller: new AbortController(), shotId: videoShotId };
    try {
      if (nodeId) {
        const target = project.nodes.findIndex((node) => node.id === nodeId);
        if (target < 0) throw new HttpError(404, "工作流节点不存在");
        if (project.nodes.slice(0, target).some((node) => node.status !== "completed"))
          throw new HttpError(409, "请先完成并确认前置节点。");
        const current = project.nodes[target];
        const resumeCharacters =
          current.id === "characters" &&
          ["failed", "pending"].includes(current.status) &&
          current.characterGeneration;
        const resumeVideo = current.id === "video" && current.videoGeneration?.taskId;
        invalidateFrom(project, resumeCharacters || resumeVideo ? target + 1 : target);
      }
      if (project.nodes.every((node) => node.status === "completed"))
        throw new HttpError(409, "本轮工作流已完成，可选择一个节点重新制作。");
      const next = project.nodes.find((node) => node.status !== "completed");
      if (next.status === "failed") {
        next.status = "pending";
        delete next.error;
      }
      if (next.id === "video" && videoShotId) next.videoShotId = videoShotId;
      project.running = true;
      jobs.set(project.id, job);
      delete project.persistenceError;
      compressMemory(project);
      save();
    } catch (error) {
      if (jobs.get(project.id) === job) jobs.delete(project.id);
      restore();
      throw error;
    }
    // Every detached job owns a rejection handler, including errors from cleanup.
    job.promise = runLoop(project, job).catch((error) => {
      if (jobs.get(project.id) === job) {
        jobs.delete(project.id);
        project.running = false;
      }
      persistenceFailure(project, error);
    });
    return project;
  }

  function stop(project) {
    const job = jobs.get(project.id);
    const activeNode =
      job?.current?.node || project.nodes.find((node) => node.status === "running");
    job?.controller.abort();
    jobs.delete(project.id);
    for (const node of project.nodes)
      if (node.status === "running") {
        node.status = "pending";
        node.error = "已暂停，可从此检查点继续。";
      }
    project.running = false;
    addMessage(
      project,
      "system",
      `已暂停制作。已完成的节点、确认决策和锁定资产已保存。本地已停止等待，远端生成任务可能仍在运行；重试前请检查供应商任务状态，避免重复提交。`,
      "system",
      activeNode?.id,
      workflowEvent(
        project,
        activeNode,
        "paused",
        job?.current ? { runId: job.current.runId } : {},
      ),
    );
    save();
    return project;
  }

  function archiveVideoTask(project, { taskId, acknowledgement }) {
    if (project.running || jobs.has(project.id) || projectTask(project))
      throw new HttpError(409, "请先暂停当前制作，再归档旧视频任务。");
    if (acknowledgement !== "archive-without-cancelling")
      throw new HttpError(
        400,
        "请明确确认：放弃取回旧任务不会取消供应商任务，后续生成可能再次计费。",
      );
    const node = project.nodes.find((item) => item.id === "video");
    if (!node?.videoGeneration?.taskId || node.videoGeneration.taskId !== taskId)
      throw new HttpError(409, "视频任务已变化，请刷新后核对需要归档的任务 ID。");
    const restore = snapshotState(project);
    node.videoTaskHistory = [
      ...(node.videoTaskHistory || []),
      { ...node.videoGeneration, status: "abandoned", archivedAt: now() },
    ];
    delete node.videoGeneration;
    delete node.videoShotId;
    node.status = "pending";
    delete node.error;
    addMessage(
      project,
      "system",
      `已归档视频任务 ${taskId} 并放弃在工作台继续取回。任务记录已保留，供应商任务未被取消，仍可能继续运行和计费。尚未提交新生成请求；再次运行视频节点将创建新任务。`,
      "system",
      node.id,
      workflowEvent(project, node, "progress", { phase: "video-task-archived" }),
    );
    try {
      // Archive and release the active task in one durable checkpoint.
      save();
    } catch (error) {
      restore();
      throw error;
    }
    return project;
  }

  function archiveImageTask(project, { captureId, acknowledgement }) {
    if (project.running || jobs.has(project.id) || projectTask(project))
      throw new HttpError(409, "请先暂停并等待当前任务结束，再归档图片请求。");
    if (acknowledgement !== "new-image-may-charge")
      throw new HttpError(
        400,
        "请明确确认：归档不会取消供应商请求，后续重新生成可能再次计费。",
      );
    const node = project.nodes.find((item) => item.id === "characters");
    const checkpoint = node?.characterGeneration;
    const image = checkpoint?.images?.find((item) => item.captureId === captureId);
    if (!image || image.status !== "submitted" || image.result?.url)
      throw new HttpError(409, "此图片请求已变化或已有可恢复结果，请刷新后再操作。");
    const restore = snapshotState(project);
    node.imageTaskHistory = [
      ...(node.imageTaskHistory || []),
      { ...image, status: "abandoned", archivedAt: now(), generationId: checkpoint.id },
    ];
    checkpoint.images = checkpoint.images.filter((item) => item !== image);
    node.status = "pending";
    delete node.error;
    addMessage(
      project,
      "system",
      `已归档「${image.name}」结果不确定的图片请求 ${captureId}。供应商请求未被取消，仍可能计费；记录已保留，尚未重新生图。再次运行角色节点可能产生新的图片费用。`,
      "system",
      node.id,
      workflowEvent(project, node, "progress", { phase: "image-task-archived" }),
    );
    try {
      save();
    } catch (error) {
      restore();
      throw error;
    }
    return project;
  }

  function approve(project, input) {
    if (projectTask(project))
      throw new HttpError(409, "项目已有模型测试或其他任务，请等待结束后再确认。");
    const shouldStart = stateTransaction(project, () => commitApproval(project, input));
    if (shouldStart) {
      try {
        start(project);
      } catch (error) {
        // Approval is already durable. Report the separate startup failure as
        // part of that successful response so clients do not resubmit approval.
        project.persistenceError = `本次确认已保存，但后续制作未能启动：${failureDetail(error)}。请修正问题后继续制作，无需重复确认。`;
        addMessage(project, "system", project.persistenceError, "error");
      }
    }
    return project;
  }

  function commitApproval(project, { approvalId, decision, feedback, value, answers }) {
    if (project.running) throw new HttpError(409, "当前节点仍在运行，请稍后确认。");
    const approval = project.approval;
    if (!approval || approval.id !== approvalId)
      throw new HttpError(409, "确认事项已更新，请刷新后再操作。");
    const node = project.nodes.find((item) => item.id === approval.nodeId);
    if (decision === "approve" && approval.phase === "character-pilot") {
      if (feedback?.trim())
        throw new HttpError(
          400,
          "如需调整样板或其余角色的画风与外观，请选择「修改样板」提交要求，再审核新样板。",
        );
      const checkpoint = node.characterGeneration;
      const pilot = characterPilot(project, checkpoint);
      if (checkpoint?.stage !== "pilot" || !pilot)
        throw new HttpError(
          409,
          "当前样板图片或基础设定已变化，请修改样板并重新生成后确认。",
        );
      const agent = agentFor(node);
      const provider = getState().providers.find(
        (item) => item.id === agent.providerId,
      );
      if (!provider?.enabled || provider.kind !== "image")
        throw new HttpError(
          409,
          "角色图片接口已变更或停用，请修正配置后重新审核样板。",
        );
      if (characterSetup(project, agent, provider).key !== checkpoint.key)
        throw new HttpError(
          409,
          "样板的创作依据或模型配置已变化，请修改样板并重新生成后确认。",
        );
      checkpoint.stage = "batch";
      pilot.tags = [...new Set([...pilot.tags, "样板已确认"])];
      remember(
        project,
        `角色样板已确认：${pilot.name} / v${pilot.version}，采用当前统一画风继续本集角色基础图；全部角色仍需逐一审核。${feedback ? `备注：${feedback}` : ""}`,
      );
      // This acceptance is part of the same generation, not a new creative brief.
      checkpoint.key = characterSetup(project, agent, provider).key;
      node.status = "pending";
      project.approval = null;
      addMessage(
        project,
        "user",
        `采用「${pilot.name}」角色样板，继续制作其余角色。${feedback || ""}`,
        "text",
        node.id,
        approvalEvent(project, node, "approved", approval),
      );
      compressMemory(project);
      save();
      return true;
    }
    let characterApprovalAssets;
    if (
      decision === "approve" &&
      approval.kind === "character" &&
      node.characterGeneration
    ) {
      const checkpoint = node.characterGeneration;
      const agent = agentFor(node);
      const provider = getState().providers.find(
        (item) => item.id === agent.providerId,
      );
      if (
        !provider?.enabled ||
        !["image", "text"].includes(provider.kind) ||
        (checkpoint.outputKind && checkpoint.outputKind !== provider.kind)
      )
        throw new HttpError(
          409,
          "角色接口已变更或停用，请修正配置后重新审核本轮角色。",
        );
      if (characterSetup(project, agent, provider).key !== checkpoint.key)
        throw new HttpError(
          409,
          "角色的创作依据或模型配置已变化，请重新生成并审核本轮角色。",
        );
      // Validate the entire plan before remembering feedback, locking assets,
      // archiving standards, or advancing any downstream node.
      characterApprovalAssets = charactersForApproval(
        project,
        checkpoint,
        checkpoint.outputKind || provider.kind,
      );
    }
    if (decision === "approve" && approval.kind === "style") {
      const { style: selected, productionBrief } = confirmedBrief(
        project,
        answers,
        value,
      );
      if (
        project.style !== selected &&
        project.assets.some(
          (asset) => asset.type === "character" && activeReference(asset),
        )
      )
        invalidateFrom(
          project,
          project.nodes.findIndex((item) => item.id === "characters"),
          { preserveCharacters: false },
        );
      project.style = selected;
      project.productionBrief = productionBrief;
      remember(
        project,
        `视觉风格已确认：${selected}，全部角色、分镜与视频提示词必须遵循。`,
      );
      remember(
        project,
        `本集制作方案已确认：${briefDescription(project)}。仅根据本次提供的章节或片段创作一集，不预设全剧集数；未提供的后续原文不得补作既定剧情。`,
      );
    }
    if (feedback)
      remember(
        project,
        `用户对「${node.name}」的${decision === "revise" ? "返修要求" : "确认备注"}：${feedback}`,
      );
    if (decision === "revise") {
      addMessage(
        project,
        "user",
        `请返修「${node.name}」${feedback ? `：${feedback}` : "，重新给出可确认的方案。"}`,
        "text",
        node.id,
        approvalEvent(project, node, "revision_requested", approval),
      );
      invalidateFrom(project, project.nodes.indexOf(node));
      compressMemory(project);
      save();
      return true;
    }
    if (["script", "character", "storyboard"].includes(approval.kind)) {
      if (approval.kind === "character")
        approveCharacterDrafts(project, characterApprovalAssets);
      const type =
        approval.kind === "character"
          ? "character"
          : approval.kind === "script"
            ? "script"
            : "storyboard";
      const approvalAssets =
        characterApprovalAssets ||
        project.assets.filter(
          (item) =>
            item.type === type &&
            !item.tags.includes("历史版本") &&
            !item.tags.includes("待更新") &&
            (approval.kind !== "script" || item.tags.includes("node:adaptation")),
        );
      for (const asset of approvalAssets) {
        asset.locked = true;
        asset.tags = asset.tags.filter(
          (tag) => tag !== "待确认" && tag !== "设计草案" && tag !== "待更新",
        );
        remember(
          project,
          `锁定资产：${asset.name}（${asset.id} / v${asset.version}），后续生成保持一致。`,
        );
      }
    }
    addMessage(
      project,
      "user",
      `已确认「${node.name}」${approval.kind === "style" ? `，${project.style}；本轮 ${briefDescription(project)}` : ""}${feedback ? `。${feedback}` : "。"}`,
      "text",
      node.id,
      approvalEvent(project, node, "approved", approval),
    );
    remember(project, `人工确认：${node.name}。`);
    node.status = "completed";
    node.completedAt = now();
    delete node.characterGeneration;
    project.approval = null;
    compressMemory(project);
    const shouldStart = project.nodes.some((item) => item.status !== "completed");
    if (!shouldStart) {
      addMessage(
        project,
        "producer",
        "本轮制作资料包已确认，可在项目菜单导出。请按交付清单核对真实媒体和剩余制作事项。",
        "result",
        node.id,
        approvalEvent(project, node, "completed", approval),
      );
    }
    save();
    return shouldStart;
  }

  function reviewEditedAsset(project, asset, previous = asset) {
    const tag = asset.tags.find((value) => value.startsWith("node:"));
    const owner = project.nodes.find((node) => node.id === tag?.slice(5));
    if (!owner || !["waiting", "completed"].includes(owner.status)) return;
    const checkpoint = owner.characterGeneration;
    if (asset.type === "character" && checkpoint) {
      const agent = getState().agents.find((item) => item.id === owner.agentId);
      const provider = getState().providers.find(
        (item) => item.id === agent?.providerId,
      );
      // Manual text changes are the new proposal being reviewed. Images still
      // need regeneration; never refresh an image checkpoint around an edit.
      if (
        provider?.enabled &&
        provider.kind === "text" &&
        (!checkpoint.outputKind || checkpoint.outputKind === "text") &&
        !asset.url &&
        !asset.characterDesign &&
        checkpoint.plan.some((planned) => planned.name === previous.name)
      ) {
        checkpoint.plan = checkpoint.plan.map((planned) =>
          planned.name === previous.name
            ? {
                ...planned,
                name: asset.name,
                description: asset.description,
                content: asset.content,
              }
            : planned,
        );
        checkpoint.key = characterSetup(project, agent, provider).key;
      }
    }
    owner.output =
      asset.type === "character"
        ? `【人工修改后的角色提案】\n${project.assets
            .filter(
              (item) =>
                item.type === "character" &&
                !item.tags.includes("历史版本") &&
                !item.tags.includes("待更新"),
            )
            .map(
              (item) =>
                `${item.name} / v${item.version}\n${item.description}\n${item.content}`,
            )
            .join("\n\n")}`
        : asset.content;
    const review = createApproval(project, owner);
    if (!review) return;
    owner.status = "waiting";
    delete owner.completedAt;
    project.approval = review;
    addMessage(
      project,
      "producer",
      `@你 「${asset.name}」已由人工修改，相关产物需要重新确认。`,
      "approval",
      owner.id,
      approvalEvent(project, owner, "approval_requested", review),
    );
  }

  return {
    start,
    stop,
    archiveVideoTask,
    archiveImageTask,
    approve,
    invite,
    invalidateFrom,
    reviewEditedAsset,
    jobs,
    close: () => {
      const failures = [];
      for (const project of getState().projects) {
        if (!jobs.has(project.id)) continue;
        try {
          stop(project);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "工作流关闭检查点保存失败");
    },
  };
}
