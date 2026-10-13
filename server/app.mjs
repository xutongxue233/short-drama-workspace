import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createStore } from "./store.mjs";
import { readConfig } from "./config.mjs";
import { HttpError } from "./http/errors.mjs";
import { localOnly, requireJsonBody, errorHandler } from "./http/middleware.mjs";
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

/** Application composition has no listener or process signal side effects. */
export function createApp({
  config = readConfig(),
  store = createStore({ filename: config.databaseFile }),
} = {}) {
  const app = express();
  const { getState, save } = store;
  const materials = createMaterialService({ getState, save, dataDir: config.dataDir });
  const workflow = createWorkflow({ getState, save, materials });
  const chat = createChatService({ getState, save, workflow, materials });
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
  };
  app.disable("x-powered-by");
  app.use(localOnly);
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
  mountQueryRoutes(app, dependencies);
  mountProjectsRoutes(app, dependencies);
  mountWorkflowRoutes(app, dependencies);
  mountMemoryRoutes(app, dependencies);
  mountAssetsRoutes(app, dependencies);
  mountAgentsRoutes(app, dependencies);
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
    materials,
    config,
    close() {
      if (closed) return;
      closed = true;
      const errors = [];
      for (const resource of [chat, workflow, providerRoutes, materials, store]) {
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
