import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createStore } from "./store.mjs";
import { readConfig } from "./config.mjs";
import { HttpError } from "./http/errors.mjs";
import { localOnly, requireJsonBody, errorHandler } from "./http/middleware.mjs";
import { createWorkflow } from "./workflow.mjs";
import { workflowReadiness } from "./workflow/readiness.mjs";
import { createChatService } from "./services/chat.mjs";
import { createMaterialService } from "./services/materials.mjs";
import { publicProvider } from "./providers/config.mjs";
import { mountProjectsRoutes } from "./routes/projects.mjs";
import { mountWorkflowRoutes } from "./routes/workflow.mjs";
import { mountMemoryRoutes } from "./routes/memory.mjs";
import { mountAssetsRoutes } from "./routes/assets.mjs";
import { mountAgentsRoutes } from "./routes/agents.mjs";
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
  const dependencies = { getState, save, workflow, chat, materials, findProject };
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
  app.get("/api/state", (_req, res) => {
    const state = getState();
    res.json({
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        chatPending: chat.getPending(project.id),
        workflowIssues: workflowReadiness(project, state),
      })),
      providers: state.providers.map(publicProvider),
    });
  });
  mountProjectsRoutes(app, dependencies);
  mountWorkflowRoutes(app, dependencies);
  mountMemoryRoutes(app, dependencies);
  mountAssetsRoutes(app, dependencies);
  mountAgentsRoutes(app, dependencies);
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
      chat.close();
      workflow.close();
      providerRoutes.close();
      materials.close();
      store.close();
    },
  };
}
