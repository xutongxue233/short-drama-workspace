import { ProviderError } from "./errors.mjs";
import {
  KINDS,
  boundedString,
  endpoint,
  networkUrl,
  providerInput,
  redact,
} from "./config.mjs";
import { combinedSignal, requestJson } from "./transport.mjs";
import { assertMinimaxSuccess, minimaxEndpoint } from "./minimax.mjs";

const MAX_MODELS = 500;
const MAX_PAGES = 5;
// Official media references: platform.minimax.cn/docs/api-reference/
// image-generation-i2i and video-generation-v2-create.
const MINIMAX_MODELS = {
  image: ["image-01", "image-01-live"],
  video: ["MiniMax-H3", "MiniMax-H3-Max"],
};

function canonicalBase(value) {
  const url = networkUrl(value, "接口地址", { base: true });
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

// A draft may use an existing secret only for its original complete endpoint.
// Changing a path can redirect credentials just as changing a host can.
export function modelListInput(input, existing) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ProviderError("模型列表查询必须是 JSON 对象。");
  if (Object.hasOwn(input, "providerId"))
    boundedString(input.providerId, "模型服务 ID", 100, true);
  const suppliedKey = Object.hasOwn(input, "apiKey")
    ? boundedString(input.apiKey, "API Key", 8192)
    : "";
  const baseUrl = Object.hasOwn(input, "baseUrl")
    ? boundedString(input.baseUrl, "接口地址", 2048, true)
    : existing?.baseUrl;
  const protocol = input.protocol ?? existing?.protocol ?? "openai";
  if (
    existing?.apiKey &&
    !suppliedKey &&
    input.clearApiKey !== true &&
    (canonicalBase(baseUrl) !== canonicalBase(existing.baseUrl) ||
      protocol !== existing.protocol)
  )
    throw new ProviderError(
      "接口地址或协议已更改，请重新填写 API Key 后获取模型；已保存的密钥不会发送到新地址。",
    );
  return providerInput(
    {
      ...input,
      name: "模型列表查询",
      model: "",
      enabled: true,
    },
    existing,
  );
}

function minimaxPresets(provider, reason) {
  return {
    models: (MINIMAX_MODELS[provider.kind] ?? []).map((id) => ({
      id,
      name: id,
      kinds: [provider.kind],
    })),
    source: "preset",
    message: `${reason}以下为 MiniMax 官方文档预设，并非账户可用模型列表，未验证权限；也可手动填写模型 ID。`,
    truncated: false,
  };
}

function safeText(value, max, key) {
  if (typeof value !== "string") return "";
  return (
    redact(value, key)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, max)
  );
}

function modelKinds(model, protocol) {
  if (protocol === "anthropic") return ["text"];
  // These fields explicitly declare output capability. IDs are not a reliable
  // source: private gateways frequently use arbitrary aliases for their models.
  const declared = model.output_modalities ?? model.modalities?.output;
  if (!Array.isArray(declared)) return undefined;
  if (!declared.some((kind) => typeof kind === "string")) return undefined;
  const supported = [...new Set(declared.filter((kind) => KINDS.has(kind)))];
  return supported;
}

function normalizeModel(model, provider) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return null;
  if (
    typeof model.id !== "string" ||
    model.id.length > 200 ||
    (provider.apiKey && model.id.includes(provider.apiKey))
  )
    return null;
  const id = safeText(model.id, 200, provider.apiKey);
  if (!id) return null;
  const kinds = modelKinds(model, provider.protocol);
  if (kinds && !kinds.includes(provider.kind)) return null;
  return {
    id,
    name: safeText(model.display_name ?? model.name, 200, provider.apiKey) || id,
    ...(kinds ? { kinds } : {}),
  };
}

// Only documented read endpoints are called. Listing never creates media or
// modifies the saved provider, and does not establish generation entitlement.
export async function discoverModels(provider, signal, { timeoutMs = 12_000 } = {}) {
  if (["ark", "webhook"].includes(provider.protocol))
    return {
      models: [],
      source: "unsupported",
      message:
        provider.protocol === "ark"
          ? "方舟媒体协议暂无通用模型列表查询。请从官方预设选择，或填写控制台中的模型 ID / ep- 接入点 ID；尚未验证权限。"
          : "自定义 Webhook 没有统一的模型列表接口，请按服务方文档手动填写模型名称。",
      truncated: false,
    };
  if (provider.protocol === "minimax" && !provider.apiKey)
    return minimaxPresets(provider, "尚未填写 API Key，未向服务端查询。");
  if (provider.protocol === "anthropic" && !provider.apiKey)
    throw new ProviderError("请先填写 API Key 后获取 Anthropic 模型列表。");

  const combined = combinedSignal(signal, timeoutMs);
  const models = new Map();
  const seenCursors = new Set();
  let cursor;
  let truncated = false;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(
        provider.protocol === "minimax"
          ? minimaxEndpoint(provider, "models")
          : endpoint(provider, "models"),
      );
      if (provider.protocol === "anthropic") {
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("after_id", cursor);
      }
      const data = await requestJson(url.href, { provider, signal: combined });
      if (provider.protocol === "minimax") assertMinimaxSuccess(data, provider);
      if (!Array.isArray(data.data))
        throw new ProviderError(
          "模型列表接口未返回 data 数组，请检查接口协议与地址；仍可手动填写模型名称。",
          502,
        );
      for (const raw of data.data) {
        const model = normalizeModel(raw, provider);
        if (!model || models.has(model.id)) continue;
        if (models.size >= MAX_MODELS) {
          truncated = true;
          break;
        }
        models.set(model.id, model);
      }
      if (data.has_more !== true) break;
      if (provider.protocol !== "anthropic" || page === MAX_PAGES - 1) {
        truncated = true;
        break;
      }
      const next = data.last_id;
      if (
        typeof next !== "string" ||
        !next ||
        next.length > 200 ||
        seenCursors.has(next) ||
        models.size >= MAX_MODELS
      ) {
        truncated = true;
        break;
      }
      seenCursors.add(next);
      cursor = next;
    }
  } catch (error) {
    if (combined.aborted)
      throw new ProviderError(
        combined.reason?.name === "TimeoutError"
          ? "获取模型列表超时，请稍后重试；未执行生成。"
          : "模型列表查询已取消；未执行生成。",
        408,
      );
    if (provider.protocol === "minimax" && /HTTP (404|405|501)\b/.test(error.message))
      return minimaxPresets(provider, "此地址不支持模型列表查询。");
    throw error;
  }
  return {
    models: [...models.values()],
    source: "remote",
    message: [
      models.size
        ? `已从接口读取 ${models.size} 个模型。`
        : "接口返回的列表中没有可选择的模型。",
      "列表不代表已验证生成权限；未声明能力的模型保留显示，请按用途选择。",
      provider.protocol === "minimax"
        ? "MiniMax 列表可能不包含全部图像 / 视频模型，可选官方预设或手动填写。"
        : "缺少所需模型时仍可手动填写。",
      truncated ? "结果已达查询上限或分页不完整，仅展示已读取的模型。" : "",
    ]
      .filter(Boolean)
      .join(""),
    truncated,
  };
}
