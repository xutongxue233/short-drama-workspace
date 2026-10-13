export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The only frontend HTTP boundary. Credentials remain in the local API. */
export async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    )
      throw error;
    throw new ApiError(
      response.ok
        ? "服务返回了无效响应，请确认本地 API 已正常启动。"
        : `请求失败 (${response.status})，请检查本地 API 服务。`,
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `请求失败 (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return result as T;
}
