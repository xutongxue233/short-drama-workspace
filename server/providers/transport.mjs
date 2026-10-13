import { ProviderError } from "./errors.mjs";
import { redact } from "./config.mjs";

export const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

export function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function abortError(signal) {
  return new ProviderError(
    signal.reason?.name === "TimeoutError"
      ? "模型请求超时。请检查供应商任务状态后再重试，避免重复计费。"
      : "模型请求已停止。已提交的远端任务可能仍在执行，请到供应商侧查看。",
    408,
  );
}

export function upstreamError(data, key) {
  const detail =
    typeof data?.error === "string"
      ? data.error
      : (data?.error?.message ?? data?.message);
  return typeof detail === "string"
    ? redact(detail, key)
        // Strip control characters from untrusted upstream errors before presentation.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f]/g, " ")
        .slice(0, 400)
    : "";
}

export async function requestJson(
  url,
  { provider, signal, method = "GET", body, onDispatch },
) {
  if (signal.aborted) throw abortError(signal);
  const requestBody = body ? JSON.stringify(body) : undefined;
  onDispatch?.();
  let response;
  try {
    response = await fetch(url, {
      method,
      signal,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(provider.protocol === "anthropic"
          ? {
              "anthropic-version": "2023-06-01",
              ...(provider.apiKey ? { "x-api-key": provider.apiKey } : {}),
            }
          : provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
      },
      ...(body ? { body: requestBody } : {}),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ProviderError(
        "接口返回重定向。请直接配置最终地址，防止凭据被转发到其他服务。",
        502,
      );
    }
    const chunks = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ProviderError(
            "供应商响应超过 24 MiB，请让媒体接口返回文件 URL。",
            502,
          );
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError(
        response.ok
          ? "接口未返回有效 JSON，请检查接口地址和协议。"
          : `接口请求失败（HTTP ${response.status}），且未返回 JSON 错误信息。`,
        502,
      );
    }
    if (!response.ok) {
      const detail = upstreamError(data, provider.apiKey);
      throw new ProviderError(
        `接口请求失败（HTTP ${response.status}）${detail ? `：${detail}` : "，请检查密钥、模型权限及余额。"}`,
        502,
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new ProviderError("接口 JSON 响应必须是对象。", 502);
    return data;
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "无法连接模型服务，请检查接口地址、网络、证书和供应商服务状态。",
      502,
    );
  }
}
