import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.mjs";

// Backward-compatible factory export. Importing this module never opens a listener.
export { createApp } from "./app.mjs";

export function startServer(options) {
  const service = createApp(options);
  const { host, apiPort } = service.config;
  const server = service.app.listen(apiPort, host, () =>
    console.log(
      `Frameflow API ready at http://${host}:${apiPort} · SQLite checkpoints enabled`,
    ),
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    // Abort in-flight workflow and chat requests before draining HTTP connections.
    service.close();
    server.close();
  };
  server.once("error", (error) => {
    service.close();
    console.error("[workbench] Unable to start API:", error.message);
    process.exitCode = 1;
  });
  server.once("close", () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { ...service, server, shutdown };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    startServer();
  } catch (error) {
    console.error("[workbench]", error.message);
    process.exitCode = 1;
  }
}
