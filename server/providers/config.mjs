import { randomUUID } from "node:crypto";
import { ProviderError } from "./errors.mjs";

export const KINDS = new Set(["text", "image", "video"]);
const PROTOCOLS = new Set(["openai", "webhook", "anthropic", "ark", "minimax"]);

export function validateProtocol(kind, protocol) {
  if (!PROTOCOLS.has(protocol))
    throw new ProviderError(
      "接口协议必须是 openai、anthropic、ark、minimax 或 webhook",
    );
  if (protocol === "openai" && kind === "video")
    throw new ProviderError("视频模型请使用火山方舟、MiniMax 或 Webhook 协议接入");
  if (protocol === "anthropic" && kind !== "text")
    throw new ProviderError("Anthropic Messages 协议仅支持文字模型");
  if (protocol === "ark" && kind === "text")
    throw new ProviderError(
      "火山方舟媒体协议仅支持图片和视频；文字模型请使用 OpenAI 兼容协议",
    );
  if (protocol === "minimax" && kind === "text")
    throw new ProviderError(
      "MiniMax 媒体协议仅支持图片和视频；文字模型请使用 OpenAI 兼容协议",
    );
}

export function redact(value, key) {
  const text = String(value ?? "");
  return key ? text.split(key).join("[密钥已隐藏]") : text;
}

export function boundedString(value, field, max, required = false) {
  if (typeof value !== "string") throw new ProviderError(`${field}必须是文本`);
  const text = value.trim();
  if (text.length > max) throw new ProviderError(`${field}不能超过 ${max} 个字符`);
  if (required && !text) throw new ProviderError(`请填写${field}`);
  return text;
}

export function networkUrl(value, field = "接口地址", { base = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError(`${field}必须是有效的 HTTP 或 HTTPS 地址`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new ProviderError(`${field}只支持不含内嵌凭据的 HTTP 或 HTTPS 地址`);
  }
  if (base && (url.search || url.hash))
    throw new ProviderError("接口地址不能含查询参数或锚点；请在 API Key 字段填写凭据");
  return url;
}

export function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    hasKey: Boolean(provider.apiKey),
  };
}

export function providerInput(input, existing) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ProviderError("模型配置必须是对象");
  const value = (key, fallback) =>
    Object.hasOwn(input, key) ? input[key] : (existing?.[key] ?? fallback);
  const kind = value("kind", "text");
  const protocol = value("protocol", "openai");
  if (!KINDS.has(kind)) throw new ProviderError("模型类型必须是 text、image 或 video");
  validateProtocol(kind, protocol);
  const name = boundedString(value("name", ""), "模型服务名称", 100, true);
  const baseUrl = boundedString(value("baseUrl", ""), "接口地址", 2048, true);
  networkUrl(baseUrl, "接口地址", { base: true });
  const model = boundedString(value("model", ""), "模型名称", 200);
  const enabled = value("enabled", true);
  if (typeof enabled !== "boolean") throw new ProviderError("启用状态必须是布尔值");
  if (Object.hasOwn(input, "clearApiKey") && typeof input.clearApiKey !== "boolean")
    throw new ProviderError("清除密钥标识必须是布尔值");
  let apiKey = existing?.apiKey ?? "";
  if (Object.hasOwn(input, "apiKey")) {
    const supplied = boundedString(input.apiKey, "API Key", 8192);
    if (/[\r\n]/.test(supplied)) throw new ProviderError("API Key 不能包含换行符");
    if (supplied) apiKey = supplied;
  }
  if (input.clearApiKey) apiKey = "";
  return {
    id: existing?.id ?? randomUUID(),
    name,
    kind,
    protocol,
    baseUrl,
    model,
    enabled,
    apiKey,
  };
}

export function endpoint(provider, path) {
  const url = networkUrl(provider.baseUrl, "接口地址", { base: true });
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}`;
  return url.href;
}
