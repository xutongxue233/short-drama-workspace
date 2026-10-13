import { ProviderError } from "./errors.mjs";
import { networkUrl } from "./config.mjs";
import { upstreamError } from "./transport.mjs";

// Both native API versions share the configured host (including proxy prefixes).
// Never take polling or file-retrieval endpoints from an upstream response.
export function minimaxEndpoint(provider, path, version = "v1") {
  const url = networkUrl(provider.baseUrl, "接口地址", { base: true });
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/v[12]$/, "");
  url.pathname = `${prefix}/${version}/${path}`;
  return url.href;
}

export function assertMinimaxSuccess(data, provider) {
  const status = data.base_resp;
  if (data.error || (status && status.status_code !== 0)) {
    const detail = upstreamError(
      data.error ? data : { message: status.status_msg },
      provider.apiKey,
    );
    const code = Number.isInteger(status?.status_code)
      ? `（${status.status_code}）`
      : "";
    throw new ProviderError(
      `MiniMax 请求失败${code}：${detail || "供应商未返回错误详情。"}`,
      502,
    );
  }
}
