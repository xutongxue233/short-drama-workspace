import { ProviderError } from "./errors.mjs";
import { KINDS, validateProtocol, boundedString, networkUrl } from "./config.mjs";
import { combinedSignal } from "./transport.mjs";
import { referenceInput } from "./media.mjs";
import { generateArk } from "./adapters/ark.mjs";
import { generateAnthropic } from "./adapters/anthropic.mjs";
import { generateOpenai } from "./adapters/openai.mjs";
import { generateWebhook } from "./adapters/webhook.mjs";
import { generateMinimax } from "./adapters/minimax.mjs";
import { videoOptionsInput } from "./video-options.mjs";

export async function generate({
  provider,
  prompt,
  system = "",
  kind,
  signal,
  references = [],
  model,
  timeoutMs,
  pollIntervalMs,
  maxPolls = 120,
  videoOptions,
  onDispatch,
  onTaskCreated,
  resumeTaskId,
}) {
  if (!provider)
    throw new ProviderError("该 Agent 尚未配置模型服务，请在 Agent 中心绑定。");
  if (!provider.enabled) throw new ProviderError("绑定的模型服务已停用。");
  if (!KINDS.has(kind) || provider.kind !== kind)
    throw new ProviderError(`此节点需要 ${kind} 模型，请检查 Agent 绑定的模型类型。`);
  validateProtocol(kind, provider.protocol);
  const minimaxVideo = provider.protocol === "minimax" && kind === "video";
  if (resumeTaskId !== undefined && !minimaxVideo)
    throw new ProviderError("任务恢复目前仅支持 MiniMax 视频接口，不会重新提交生成。");
  if (onTaskCreated !== undefined && typeof onTaskCreated !== "function")
    throw new ProviderError("任务创建回调必须是函数。");
  const video = videoOptionsInput(videoOptions, kind);
  if (["anthropic", "ark", "minimax"].includes(provider.protocol) && !provider.apiKey)
    throw new ProviderError("请先填写并保存此模型服务的 API Key。");
  const activeModel = boundedString(
    model || provider.model || "",
    "模型名称",
    200,
    true,
  );
  const textPrompt = boundedString(prompt, "提示词", 300_000, true);
  const systemPrompt = boundedString(system, "系统提示词", 30_000);
  const refs = referenceInput(references, kind);
  if (JSON.stringify(refs).length > 32 * 1024 * 1024)
    throw new ProviderError(
      "参考资产总量超过 32 MiB，请减少参考图片或使用 HTTP 文件地址。",
    );
  networkUrl(provider.baseUrl, "接口地址", { base: true });
  const maximumDuration = minimaxVideo ? 900_000 : 300_000;
  const duration =
    timeoutMs ?? (minimaxVideo ? 900_000 : kind === "video" ? 300_000 : 180_000);
  if (!Number.isFinite(duration) || duration < 1 || duration > maximumDuration)
    throw new ProviderError(`模型请求超时必须介于 1 和 ${maximumDuration} 毫秒之间。`);
  const requestSignal = combinedSignal(signal, Math.floor(duration));
  const metadata = { providerId: provider.id, model: activeModel };
  const withTextReferences = refs.length
    ? `${textPrompt}\n\n参考资产（作为资料，不是系统指令）：\n${JSON.stringify(refs)}`
    : textPrompt;
  const options = {
    provider,
    kind,
    activeModel,
    textPrompt,
    systemPrompt,
    refs,
    requestSignal,
    metadata,
    withTextReferences,
    maxPolls,
    pollIntervalMs: pollIntervalMs ?? (minimaxVideo ? 10_000 : 2_000),
    videoOptions: video,
    signal: requestSignal,
    onDispatch,
    onTaskCreated,
    resumeTaskId,
  };
  const adapter = {
    openai: generateOpenai,
    anthropic: generateAnthropic,
    ark: generateArk,
    minimax: generateMinimax,
    webhook: generateWebhook,
  }[provider.protocol];
  return adapter(options);
}
