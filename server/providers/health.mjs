import { ProviderError } from "./errors.mjs";
import { validateProtocol, networkUrl, endpoint } from "./config.mjs";
import { requestJson, combinedSignal } from "./transport.mjs";
import { minimaxEndpoint, assertMinimaxSuccess } from "./minimax.mjs";

export async function testProvider(provider, signal) {
  validateProtocol(provider.kind, provider.protocol);
  if (["anthropic", "ark", "minimax"].includes(provider.protocol) && !provider.apiKey)
    throw new ProviderError("请先填写并保存此模型服务的 API Key；尚未执行连接测试。");
  networkUrl(provider.baseUrl, "接口地址", { base: true });
  if (provider.protocol === "minimax") {
    const data = await requestJson(minimaxEndpoint(provider, "models"), {
      provider,
      signal: combinedSignal(signal, 12_000),
    });
    assertMinimaxSuccess(data, provider);
    if (!Array.isArray(data.data))
      throw new ProviderError(
        "MiniMax 连接成功，但 /v1/models 未返回 data 数组，请检查接口地址。",
        502,
      );
    return "MiniMax 连接成功，已读取兼容模型列表；该列表可能不包含图片和视频模型。尚未执行生成，也未验证所选媒体模型的生成权限。";
  }
  if (provider.protocol === "ark") {
    // Ark documents this read-only endpoint. It does not prove model entitlement.
    const url = new URL(endpoint(provider, "contents/generations/tasks"));
    url.searchParams.set("page_size", "1");
    const result = await requestJson(url.href, {
      provider,
      signal: combinedSignal(signal, 12_000),
    });
    if (!Array.isArray(result.items))
      throw new ProviderError(
        "连接成功，但方舟任务列表未返回 items 数组。请检查协议与地址。尚未执行生成。",
      );
    return "方舟任务列表连接成功；尚未执行生成，也未验证所选模型的生成权限。";
  }
  const data = await requestJson(
    ["openai", "anthropic"].includes(provider.protocol)
      ? endpoint(provider, "models")
      : provider.baseUrl,
    { provider, signal: combinedSignal(signal, 12_000) },
  );
  if (["openai", "anthropic"].includes(provider.protocol)) {
    if (!Array.isArray(data.data))
      throw new ProviderError(
        "连接成功，但 /models 未返回 data 数组。请检查协议及地址。",
      );
    const available =
      !provider.model || data.data.some((model) => model?.id === provider.model);
    return available
      ? "连接成功，已读取模型列表；尚未执行生成。"
      : "连接成功，但模型列表未列出所填模型。请确认模型名称和权限；尚未执行生成。";
  }
  if (data.ok !== true && data.status !== "ok")
    throw new ProviderError(
      'Webhook 健康检查需返回 {"ok":true} 或 {"status":"ok"}；尚未执行生成。',
    );
  return "Webhook 连接成功，健康检查通过；尚未执行生成。";
}
