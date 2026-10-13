import { ProviderError } from "../errors.mjs";
import { endpoint } from "../config.mjs";
import { requestJson, upstreamError } from "../transport.mjs";
import { outputText } from "../media.mjs";

export async function generateAnthropic({
  provider,
  activeModel,
  systemPrompt,
  requestSignal,
  metadata,
  withTextReferences,
  onDispatch,
}) {
  // https://platform.claude.com/docs/en/api/messages/create
  const data = await requestJson(endpoint(provider, "messages"), {
    onDispatch,
    provider,
    signal: requestSignal,
    method: "POST",
    body: {
      model: activeModel,
      max_tokens: 8192,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: withTextReferences }],
    },
  });
  if (data.error)
    throw new ProviderError(
      upstreamError(data, provider.apiKey) || "Anthropic 返回错误。",
      502,
    );
  if (["max_tokens", "model_context_window_exceeded"].includes(data.stop_reason))
    throw new ProviderError(
      "Claude 输出因长度或上下文限制被截断，请缩短当前节点输入后重试。",
      502,
    );
  if (data.stop_reason === "refusal")
    throw new ProviderError("模型拒绝生成此内容，请调整创作要求后重试。", 502);
  if (!["end_turn", "stop_sequence"].includes(data.stop_reason))
    throw new ProviderError("Claude 未完成当前回复，节点不会标记为已完成。", 502);
  const raw = Array.isArray(data.content)
    ? data.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
    : "";
  if (raw.length > 100_000)
    throw new ProviderError(
      "Claude 输出超过当前节点的保存上限，请缩短创作范围后重试；未保存截断结果。",
      502,
    );
  const text = outputText(raw, provider.apiKey);
  if (!text) throw new ProviderError("Claude 没有返回可用的文字内容。", 502);
  return { text, metadata };
}
