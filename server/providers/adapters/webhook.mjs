import { setTimeout as sleep } from "node:timers/promises";
import { ProviderError } from "../errors.mjs";
import { networkUrl } from "../config.mjs";
import { requestJson, abortError, upstreamError } from "../transport.mjs";
import { validatePolling, outputText, mediaUrl } from "../media.mjs";
const PENDING_STATUSES = new Set(["queued", "pending", "running", "processing"]);

export async function generateWebhook({
  provider,
  kind,
  activeModel,
  textPrompt,
  systemPrompt,
  refs,
  requestSignal,
  metadata,
  maxPolls,
  pollIntervalMs,
  videoOptions,
  onDispatch,
}) {
  validatePolling(maxPolls, pollIntervalMs);
  let result = await requestJson(provider.baseUrl, {
    onDispatch,
    provider,
    signal: requestSignal,
    method: "POST",
    body: {
      kind,
      model: activeModel,
      prompt: textPrompt,
      system: systemPrompt,
      references: refs,
      ...(videoOptions || {}),
    },
  });
  let polls = 0;
  let statusUrl;
  while (PENDING_STATUSES.has(result.status)) {
    if (result.jobId != null)
      metadata.jobId = outputText(String(result.jobId), provider.apiKey).slice(0, 200);
    if (!metadata.jobId)
      throw new ProviderError("异步接口必须返回 jobId，以便追踪远端任务。", 502);
    if (result.statusUrl != null) {
      let resolved;
      try {
        resolved = new URL(result.statusUrl, provider.baseUrl);
      } catch {
        throw new ProviderError("异步接口返回的 statusUrl 无效。", 502);
      }
      networkUrl(resolved.href, "轮询地址");
      if (resolved.origin !== new URL(provider.baseUrl).origin)
        throw new ProviderError(
          "异步接口的 statusUrl 必须与配置的接口同源，以保护 API Key。",
          502,
        );
      statusUrl = resolved.href;
    }
    if (!statusUrl)
      throw new ProviderError("异步接口必须返回 statusUrl 轮询地址。", 502);
    if (polls++ >= maxPolls)
      throw new ProviderError(
        `远端任务仍未完成（任务 ${metadata.jobId}），已停止轮询。请先在供应商侧查询结果，避免重复提交。`,
        408,
      );
    try {
      await sleep(pollIntervalMs, undefined, { signal: requestSignal });
      result = await requestJson(statusUrl, {
        provider,
        signal: requestSignal,
      });
    } catch (error) {
      const failure = requestSignal.aborted ? abortError(requestSignal) : error;
      if (failure instanceof ProviderError)
        throw new ProviderError(
          `${failure.message} 远端任务 ID：${metadata.jobId}`,
          failure.status,
        );
      throw failure;
    }
  }
  if (["failed", "error", "cancelled", "canceled"].includes(result.status)) {
    throw new ProviderError(
      `远端生成任务失败${upstreamError(result, provider.apiKey) ? `：${upstreamError(result, provider.apiKey)}` : "。"}`,
      502,
    );
  }
  if (result.status && !["completed", "succeeded", "success"].includes(result.status))
    throw new ProviderError("Webhook 返回未知任务状态，请检查适配接口。", 502);
  const text = outputText(result.text, provider.apiKey);
  if (kind === "text") {
    if (!text) throw new ProviderError("文字 Webhook 必须返回非空 text 字段。", 502);
    return { text, metadata };
  }
  return {
    text: text || `${kind === "image" ? "图片" : "视频"}已生成。`,
    url: mediaUrl(result.url, provider),
    metadata,
  };
}
