import { ProviderError } from "./errors.mjs";
import { networkUrl, boundedString, redact } from "./config.mjs";
import { MAX_RESPONSE_BYTES } from "./transport.mjs";

export function imageDataUrl(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new ProviderError("图片接口返回的 Base64 数据格式无效。", 502);
  const buffer = Buffer.from(encoded, "base64");
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mime = "image/png";
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    mime = "image/jpeg";
  else if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    mime = "image/webp";
  if (!mime)
    throw new ProviderError(
      "图片接口返回了无法识别的图片格式；支持 PNG、JPEG 和 WebP。",
      502,
    );
  return `data:${mime};base64,${encoded}`;
}

export function mediaUrl(value, provider) {
  if (typeof value !== "string" || !value.trim())
    throw new ProviderError("媒体接口没有返回可用的 url；节点不会标记为已生成。", 502);
  const url = networkUrl(value, "媒体地址");
  if (provider.apiKey && value.includes(provider.apiKey))
    throw new ProviderError(
      "媒体地址包含当前 API Key，已拒绝保存。请改用独立的文件访问地址。",
      502,
    );
  return url.href;
}

export function outputText(value, key) {
  return typeof value === "string" ? redact(value.trim(), key).slice(0, 100_000) : "";
}

export function referenceUrl(value, kind) {
  if (typeof value !== "string") throw new ProviderError("参考资产 url 必须是文本。");
  if (value.startsWith("data:")) {
    if (value.length > MAX_RESPONSE_BYTES)
      throw new ProviderError("单张参考图片超过 24 MiB，请使用 HTTP 文件地址。");
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
    if (!match || !imageDataUrl(match[2]).startsWith(`data:image/${match[1]};`))
      throw new ProviderError("参考资产的内嵌图片格式无效。");
    // Text-only APIs cannot interpret image bytes. Keep textual asset metadata in context.
    return kind === "text" ? undefined : value;
  }
  return boundedString(value, "参考资产 url", 4096);
}

export function referenceInput(references, kind) {
  if (!Array.isArray(references) || references.length > 100)
    throw new ProviderError("参考资产必须是数组，且不超过 100 项。");
  return references.map((reference) => {
    if (typeof reference === "string")
      return reference.startsWith("data:")
        ? (referenceUrl(reference, kind) ?? "内嵌参考图片（文字接口仅使用资产说明）")
        : boundedString(reference, "参考资产", 20_000);
    if (!reference || typeof reference !== "object" || Array.isArray(reference))
      throw new ProviderError("参考资产格式无效。");
    const result = {};
    for (const key of ["id", "name", "type", "description", "content"]) {
      if (reference[key] != null)
        result[key] = boundedString(reference[key], `参考资产 ${key}`, 20_000);
    }
    if (reference.url != null) {
      const url = referenceUrl(reference.url, kind);
      if (url !== undefined) result.url = url;
    }
    if (reference.version != null && Number.isFinite(reference.version))
      result.version = reference.version;
    if (reference.locked != null) result.locked = Boolean(reference.locked);
    return result;
  });
}

export function validatePolling(maxPolls, pollIntervalMs) {
  if (
    !Number.isInteger(maxPolls) ||
    maxPolls < 1 ||
    maxPolls > 120 ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 10_000
  )
    throw new ProviderError("异步任务轮询配置无效。");
}
