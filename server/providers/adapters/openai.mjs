import { ProviderError } from "../errors.mjs";
import { endpoint } from "../config.mjs";
import { requestJson } from "../transport.mjs";
import { outputText, mediaUrl, imageDataUrl } from "../media.mjs";
import { openaiImageInput } from "./openai-image.mjs";

export async function generateOpenai({
  provider,
  kind,
  activeModel,
  textPrompt,
  systemPrompt,
  refs,
  requestSignal,
  metadata,
  withTextReferences,
  onDispatch,
}) {
  if (kind === "video")
    throw new ProviderError("视频生成需要 Webhook 协议，请配置供应商适配接口。");
  if (kind === "text") {
    const data = await requestJson(endpoint(provider, "chat/completions"), {
      onDispatch,
      provider,
      signal: requestSignal,
      method: "POST",
      body: {
        model: activeModel,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: withTextReferences },
        ],
      },
    });
    const message = data.choices?.[0]?.message;
    const raw = Array.isArray(message?.content)
      ? message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : message?.content;
    const text = outputText(raw, provider.apiKey);
    if (!text)
      throw new ProviderError(
        message?.refusal
          ? "模型拒绝生成此内容，请调整创作要求后重试。"
          : "文字接口没有返回可用的 choices[0].message.content。",
        502,
      );
    if (data.choices?.[0]?.finish_reason === "length")
      throw new ProviderError(
        "模型输出因长度限制被截断，请缩短当前节点输入或调整供应商输出限制后重试。",
        502,
      );
    return { text, metadata };
  }
  const { prompt, images } = openaiImageInput({ textPrompt, systemPrompt, refs });
  const path = images.length ? "images/edits" : "images/generations";
  let data;
  try {
    data = await requestJson(endpoint(provider, path), {
      onDispatch,
      provider,
      signal: requestSignal,
      method: "POST",
      body: {
        model: activeModel,
        prompt,
        n: 1,
        ...(images.length ? { images } : {}),
      },
    });
  } catch (error) {
    if (images.length && error instanceof ProviderError && !requestSignal.aborted)
      throw new ProviderError(
        `参考图生图请求（images/edits）失败：${error.message}。请确认网关支持带图片输入的编辑接口；不会忽略参考图重新生成。`,
        error.status,
      );
    throw error;
  }
  const item = data.data?.[0];
  const url = item?.url
    ? mediaUrl(item.url, provider)
    : item?.b64_json
      ? imageDataUrl(item.b64_json)
      : null;
  if (!url)
    throw new ProviderError(
      "图片接口没有返回 data[0].url 或有效的 data[0].b64_json。",
      502,
    );
  return {
    text: outputText(item.revised_prompt, provider.apiKey) || "图片已生成。",
    url,
    metadata,
  };
}
