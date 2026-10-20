import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createStore } from "./store.mjs";
import { readConfig } from "./config.mjs";
import { HttpError } from "./http/errors.mjs";
import { requestBoundary, requireJsonBody, errorHandler } from "./http/middleware.mjs";
import { createAuthService } from "./auth/service.mjs";
import { mountAuthorization } from "./auth/authorization.mjs";
import { mountPublicAuthRoutes, mountPrivateAuthRoutes } from "./routes/auth.mjs";
import { mountParticipantRoutes } from "./routes/participants.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createChatService } from "./services/chat.mjs";
import { createMaterialService } from "./services/materials.mjs";
import { mountQueryRoutes } from "./routes/queries.mjs";
import { mountProjectsRoutes } from "./routes/projects.mjs";
import { mountWorkflowRoutes } from "./routes/workflow.mjs";
import { mountMemoryRoutes } from "./routes/memory.mjs";
import { mountAssetsRoutes } from "./routes/assets.mjs";
import { mountAgentsRoutes } from "./routes/agents.mjs";
import { mountSkillsRoutes } from "./routes/skills.mjs";
import { mountChatRoutes } from "./routes/chat.mjs";
import { mountProviderRoutes } from "./routes/providers.mjs";
import { mountMaterialsRoutes } from "./routes/materials.mjs";
import { createComputerService } from "./services/computers.mjs";
import { mountComputerRoutes } from "./routes/computers.mjs";

/** Application composition has no listener or process signal side effects. */
export function createApp({
  config = readConfig(),
  store = createStore({ filename: config.databaseFile }),
} = {}) {
  const app = express();
  // Forwarded addresses are authoritative only behind an explicitly trusted,
  // same-host proxy, which must overwrite client-supplied forwarding headers.
  app.set("trust proxy", config.trustProxy && config.publicOrigin ? "loopback" : false);
  const { getState } = store;
  const auth = createAuthService({ getState, save: store.save, config });
  const save = auth.saveWithAudit;
  const materials = createMaterialService({ getState, save, dataDir: config.dataDir });
  const computers = createComputerService({ getState, save });
  const workflow = createWorkflow({ getState, save, materials, computers });
  const chat = createChatService({ getState, save, workflow, materials, computers });
  computers.attachRunners({ workflow, chat });
  let closed = false;
  const findProject = (id) => {
    const project = getState().projects.find((item) => item.id === id);
    if (!project) throw new HttpError(404, "项目不存在");
    return project;
  };
  const dependencies = {
    store,
    getState,
    save,
    workflow,
    chat,
    materials,
    findProject,
    auth,
    config,
    computers,
  };
  app.disable("x-powered-by");
  app.use(requestBoundary(config));
  app.use(express.json({ limit: "4mb" }));
  // A request body may finish arriving after close() has released the store.
  // Check after parsing so queued requests cannot enter any business route.
  app.use("/api", (_req, res, next) => {
    if (closed)
      return res.status(503).json({ error: "本地服务正在关闭，请稍后重试。" });
    next();
  });
  app.use("/api", requireJsonBody);
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "frameflow-workbench", storage: "sqlite" }),
  );
  mountPublicAuthRoutes(app, dependencies);
  app.use("/api", auth.middleware);
  mountAuthorization(app, dependencies);
  mountPrivateAuthRoutes(app, dependencies);
  mountParticipantRoutes(app, dependencies);
  mountQueryRoutes(app, dependencies);
  mountProjectsRoutes(app, dependencies);
  mountWorkflowRoutes(app, dependencies);
  mountMemoryRoutes(app, dependencies);
  mountAssetsRoutes(app, dependencies);
  mountAgentsRoutes(app, dependencies);
  mountComputerRoutes(app, dependencies);
  mountSkillsRoutes(app, dependencies);
  mountChatRoutes(app, dependencies);
  const providerRoutes = mountProviderRoutes(app, dependencies);
  mountMaterialsRoutes(app, dependencies);
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  const indexFile = resolve(config.distDir, "index.html");
  if (existsSync(indexFile)) {
    app.use(express.static(config.distDir));
    app.get("/{*path}", (_req, res) => res.sendFile(indexFile));
  } else {
    app.get("/", (_req, res) =>
      res
        .type("text/plain")
        .send(
          "API is running. Use npm run dev for the web workspace, or npm run build then npm start.",
        ),
    );
  }
  app.use(errorHandler);
  return {
    app,
    store,
    workflow,
    computers,
    materials,
    config,
    close() {
      if (closed) return;
      closed = true;
      const errors = [];
      for (const resource of [
        computers,
        chat,
        workflow,
        providerRoutes,
        materials,
        store,
      ]) {
        try {
          resource.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "服务已关闭，但部分检查点未能保存。");
    },
  };
}
