import { setTimeout as sleep } from "node:timers/promises";
import { ProviderError } from "../errors.mjs";
import { requestJson, abortError, upstreamError } from "../transport.mjs";
import { validatePolling, mediaUrl, imageDataUrl, outputText } from "../media.mjs";
import { assertMinimaxSuccess, minimaxEndpoint } from "../minimax.mjs";
import {
  MINIMAX_H3_MODELS,
  minimaxImageInput,
  minimaxVideoInput,
} from "./minimax-input.mjs";

function taskId(value, provider, label = "任务 ID") {
  // A numeric int64 can lose precision in JSON; insist on the documented string.
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(value) ||
    (provider.apiKey && value.includes(provider.apiKey))
  )
    throw new ProviderError(
      `MiniMax 未返回有效的${label}，无法取回生成结果；请先在供应商侧检查已提交的任务。`,
      502,
    );
  return value;
}

async function imageResult(options) {
  const { provider, signal, metadata, onDispatch } = options;
  const body = minimaxImageInput(options);
  const data = await requestJson(minimaxEndpoint(provider, "image_generation"), {
    provider,
    signal,
    method: "POST",
    body,
    onDispatch,
  });
  assertMinimaxSuccess(data, provider);
  const remote = data.data?.image_urls?.[0];
  const encoded = data.data?.image_base64?.[0];
  const url = remote
    ? mediaUrl(remote, provider)
    : encoded
      ? imageDataUrl(encoded)
      : undefined;
  if (!url)
    throw new ProviderError(
      "MiniMax 图片接口没有返回有效的 data.image_urls 或 image_base64，节点不会标记为已生成。",
      502,
    );
  return { text: "图片已生成。", url, metadata };
}

async function completedLegacy(result, options) {
  const { provider, signal, metadata } = options;
  const id = taskId(result.file_id, provider, "文件 ID");
  const url = new URL(minimaxEndpoint(provider, "files/retrieve"));
  url.searchParams.set("file_id", id);
  const file = await requestJson(url.href, { provider, signal });
  assertMinimaxSuccess(file, provider);
  return {
    text: "视频已生成。",
    url: mediaUrl(file.file?.download_url, provider),
    metadata,
  };
}

function completedH3(task, options) {
  const { provider, metadata, videoOptions } = options;
  if (task.error)
    throw new ProviderError(
      `MiniMax 视频生成失败：${upstreamError(task, provider.apiKey) || "供应商未返回错误详情。"}`,
      502,
    );
  if (
    videoOptions &&
    ((task.duration != null && task.duration !== videoOptions.duration) ||
      (videoOptions.ratio !== "adaptive" &&
        task.ratio != null &&
        task.ratio !== videoOptions.ratio))
  )
    throw new ProviderError(
      "MiniMax 返回的时长或画幅与已批准分镜不一致，请在供应商侧核对结果；不会标记为已完成。",
      502,
    );
  return { text: "视频已生成。", url: mediaUrl(task.content?.url, provider), metadata };
}

// v1: create → query (file_id) → retrieve (download_url).
// v2: create → query (task.content.url). Never mix their response contracts.
export async function generateMinimax(options) {
  if (options.kind === "image") return imageResult(options);
  const {
    provider,
    signal,
    activeModel,
    metadata,
    onDispatch,
    onTaskCreated,
    resumeTaskId,
    maxPolls,
    pollIntervalMs,
  } = options;
  validatePolling(maxPolls, pollIntervalMs);
  const body = minimaxVideoInput(options);
  const h3 = MINIMAX_H3_MODELS.has(activeModel);
  const version = h3 ? "v2" : "v1";
  const resuming = resumeTaskId !== undefined;
  let id;
  if (resuming) id = taskId(resumeTaskId, provider, "恢复任务 ID");
  else {
    const created = await requestJson(
      minimaxEndpoint(provider, "video_generation", version),
      {
        provider,
        signal,
        method: "POST",
        body,
        onDispatch,
      },
    );
    assertMinimaxSuccess(created, provider);
    id = taskId(created.task_id, provider);
  }
  metadata.jobId = outputText(id, provider.apiKey);
  const url = new URL(
    minimaxEndpoint(
      provider,
      h3
        ? `query/video_generation/${encodeURIComponent(id)}`
        : "query/video_generation",
      version,
    ),
  );
  if (!h3) url.searchParams.set("task_id", id);
  try {
    if (!resuming && onTaskCreated) {
      try {
        // Persist the billable task before polling; callback failures must retain its ID.
        await onTaskCreated({ id, model: activeModel, protocol: "minimax" });
      } catch {
        throw new ProviderError(
          "MiniMax 远端任务已创建，但本地任务记录保存失败。请先恢复该任务，避免重复提交。",
          500,
        );
      }
    }
    for (let poll = 0; poll < maxPolls; poll++) {
      if (!resuming || poll > 0) await sleep(pollIntervalMs, undefined, { signal });
      const result = await requestJson(url.href, {
        provider,
        signal,
        ...(resuming && poll === 0 ? { onDispatch } : {}),
      });
      assertMinimaxSuccess(result, provider);
      const task = h3 ? result.task : result;
      if (!task || typeof task !== "object")
        throw new ProviderError("MiniMax 查询未返回有效任务，已停止轮询。", 502);
      const returnedId = h3 ? task.id : task.task_id;
      if (returnedId != null && returnedId !== id)
        throw new ProviderError(
          "MiniMax 查询返回了不同的任务 ID，已停止取回结果。",
          502,
        );
      if (h3 && task.model != null && task.model !== activeModel)
        throw new ProviderError(
          "MiniMax 查询返回的模型与当前任务配置不一致，已停止取回结果。",
          502,
        );
      const status = task.status;
      if (status === (h3 ? "succeeded" : "Success"))
        return h3 ? completedH3(task, options) : await completedLegacy(result, options);
      if ((h3 ? ["failed", "cancelled"] : ["Fail"]).includes(status)) {
        const failure = new ProviderError(
          `MiniMax 视频任务失败或已取消：${upstreamError(task, provider.apiKey) || "请在供应商侧查看失败原因。"}`,
          502,
        );
        // Only explicit provider terminal states permit a fresh billable request.
        Object.assign(failure, { terminalTask: true, taskId: id, taskStatus: status });
        throw failure;
      }
      if (
        !(
          h3 ? ["queued", "running"] : ["Preparing", "Queueing", "Processing"]
        ).includes(status)
      )
        throw new ProviderError("MiniMax 返回未知任务状态，已停止轮询。", 502);
    }
    throw new ProviderError(
      "远端任务仍未完成，已停止轮询。请先在供应商侧查询结果，避免重复提交。",
      408,
    );
  } catch (error) {
    const failure = signal.aborted ? abortError(signal) : error;
    if (failure instanceof ProviderError) {
      const wrapped = new ProviderError(
        `${failure.message} 远端任务 ID：${metadata.jobId}`,
        failure.status,
      );
      if (failure.terminalTask === true)
        Object.assign(wrapped, {
          terminalTask: true,
          taskId: failure.taskId,
          taskStatus: failure.taskStatus,
        });
      throw wrapped;
    }
    throw failure;
  }
}
