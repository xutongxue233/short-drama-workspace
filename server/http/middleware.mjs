const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const requestBoundary =
  (config = {}) =>
  (req, res, next) => {
    if (
      config.publicOrigin &&
      !req.socket.encrypted &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
    )
      return res
        .status(403)
        .json({ error: "外部访问需要 HTTPS；请将反向代理与服务部署在同一主机。" });
    // Only an explicitly configured public hostname may cross the loopback boundary.
    const publicHost = config.publicOrigin
      ? new URL(config.publicOrigin).hostname
      : null;
    if (
      !LOCAL_HOSTS.has(req.hostname.toLowerCase()) &&
      req.hostname.toLowerCase() !== publicHost
    )
      return res
        .status(403)
        .json({ error: "此工作台仅允许通过 localhost 或 127.0.0.1 访问。" });
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (
          !["http:", "https:"].includes(origin.protocol) ||
          (config.publicOrigin
            ? origin.origin !== config.publicOrigin
            : !LOCAL_HOSTS.has(origin.hostname.toLowerCase()) ||
              origin.host !== req.get("host"))
        )
          throw new Error();
      } catch {
        return res.status(403).json({ error: "不允许来自外部网站的访问。" });
      }
    }
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "不允许跨站访问。" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (config.publicOrigin)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (req.path.toLowerCase().startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  };

export const localOnly = requestBoundary();

export const requireJsonBody = (req, res, next) => {
  if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json"))
    return res.status(415).json({ error: "请使用 application/json 请求正文。" });
  next();
};

export const errorHandler = (error, _req, res, _next) => {
  const status =
    error.status ||
    (error.type === "entity.too.large"
      ? 413
      : error instanceof SyntaxError
        ? 400
        : 500);
  const message =
    status === 500
      ? "本地服务发生错误，请检查终端日志后重试。"
      : error.type === "entity.too.large"
        ? "请求正文超过大小限制。"
        : error instanceof SyntaxError
          ? "JSON 格式不正确。"
          : error.message;
  if (status === 500) console.error("[workbench]", error.name, error.message);
  res.status(status).json({ error: message });
};
