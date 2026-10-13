import { ProviderError } from "../providers/errors.mjs";
import { publicProvider, providerInput } from "../providers/config.mjs";
import { testProvider } from "../providers/health.mjs";
import { generate } from "../providers/generate.mjs";
import { discoverModels, modelListInput } from "../providers/models.mjs";
import { bodyObject, textInput } from "../http/validation.mjs";
import { HttpError } from "../http/errors.mjs";
import { assertProjectAccess } from "../auth/authorization.mjs";
import { characterImageTestInput } from "../services/character-image-test.mjs";
import { beginProjectTask } from "../services/project-tasks.mjs";

export function mountProviderRoutes(
  app,
  { getState, save, findProject, materials, chat },
) {
  const imageTests = new Map();
  const modelQueries = new Set();
  let closed = false;
  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.destroyed) return;
      res.status(error instanceof ProviderError ? error.status : 500).json({
        error:
          error instanceof ProviderError
            ? error.message
            : "模型配置保存失败，请检查本地数据目录是否可写。",
      });
    }
  };
  const find = (id) => {
    const provider = getState().providers.find((item) => item.id === id);
    if (!provider) throw new ProviderError("未找到此模型服务。", 404);
    return provider;
  };
  app.get(
    "/api/providers",
    wrap(async (_req, res) => res.json(getState().providers.map(publicProvider))),
  );
  app.post(
    "/api/providers/models",
    wrap(async (req, res) => {
      if (closed) throw new ProviderError("本地服务正在关闭。", 503);
      const input = req.body;
      const existing = input?.providerId ? find(input.providerId) : undefined;
      const provider = modelListInput(input, existing);
      const controller = new AbortController();
      modelQueries.add(controller);
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);
      try {
        const result = await discoverModels(provider, controller.signal);
        if (!res.destroyed) res.json(result);
      } finally {
        res.off("close", onClose);
        modelQueries.delete(controller);
      }
    }),
  );
  app.post(
    "/api/providers",
    wrap(async (req, res) => {
      const provider = providerInput(req.body);
      const state = getState();
      state.providers.push(provider);
      try {
        await save();
      } catch (error) {
        state.providers.splice(state.providers.indexOf(provider), 1);
        throw error;
      }
      res.status(201).json(publicProvider(provider));
    }),
  );
  app.patch(
    "/api/providers/:id",
    wrap(async (req, res) => {
      const existing = find(req.params.id);
      const updated = providerInput(req.body, existing);
      const providers = getState().providers;
      const index = providers.indexOf(existing);
      providers[index] = updated;
      try {
        await save();
      } catch (error) {
        providers[index] = existing;
        throw error;
      }
      res.json(publicProvider(updated));
    }),
  );
  app.delete(
    "/api/providers/:id",
    wrap(async (req, res) => {
      const existing = find(req.params.id);
      const state = getState();
      const index = state.providers.indexOf(existing);
      const agents = (state.agents ?? []).filter(
        (agent) => agent.providerId === existing.id,
      );
      state.providers.splice(index, 1);
      for (const agent of agents) agent.providerId = "";
      try {
        await save();
      } catch (error) {
        state.providers.splice(index, 0, existing);
        for (const agent of agents) agent.providerId = existing.id;
        throw error;
      }
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/providers/:id/test",
    wrap(async (req, res) => {
      const provider = find(req.params.id);
      const started = Date.now();
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);
      try {
        const message = await testProvider(provider, controller.signal);
        res.json({ ok: true, message, latencyMs: Date.now() - started });
      } catch (error) {
        res.json({
          ok: false,
          message:
            error instanceof ProviderError
              ? error.message
              : "连接测试失败，请检查接口配置。",
          latencyMs: Date.now() - started,
        });
      } finally {
        res.off("close", onClose);
      }
    }),
  );
  // Unlike the read-only connection check, this explicit endpoint creates one image.
  // The model override is scoped to this request; saved bindings are not changed.
  app.post("/api/providers/:id/image-test", async (req, res) => {
    const input = bodyObject(req);
    const projectId = textInput(input.projectId, "素材所属项目", {
      max: 100,
      required: true,
    });
    const model = textInput(input.model, "测试模型", { max: 200, required: true });
    const provider = find(req.params.id);
    const project = findProject(projectId);
    assertProjectAccess(project, req.auth.user, "editor");
    if (provider.kind !== "image")
      throw new ProviderError("生图测试仅支持图片模型接口。", 400);
    if (closed) throw new ProviderError("本地服务正在关闭。", 503);
    if (
      project.running ||
      project.chatPending ||
      chat?.getPending(projectId) ||
      imageTests.has(projectId)
    )
      throw new ProviderError("此项目已有运行任务，请等待完成后再测试。", 409);
    const { prompt, references, character } = characterImageTestInput(
      project,
      provider,
      input,
    );
    const controller = new AbortController();
    const releaseTask = beginProjectTask(project, "image-test");
    imageTests.set(projectId, controller);
    const started = Date.now();
    let generated = false;
    try {
      const result = await generate({
        provider,
        model,
        kind: "image",
        prompt,
        references: references.length
          ? await materials.references(references, "image")
          : [],
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!result.url) throw new ProviderError("测试没有返回有效图片。", 502);
      generated = true;
      const material = await materials.capture(
        project,
        {
          url: result.url,
          name: character
            ? `${character.name} · ${model} 参考生图测试`
            : `${model} · 生图测试`,
          type: "image",
          nodeId: "model-test",
          providerId: provider.id,
          model,
          prompt,
          referenceAssets: references,
        },
        controller.signal,
      );
      if (!res.destroyed)
        res.json({
          ok: material.status === "local",
          generated: true,
          savedLocally: material.status === "local",
          message:
            material.status === "local"
              ? "图片已生成并保存到项目素材库。"
              : "图片已生成，但本地保存失败；请在素材库重试下载，不要重复生成。",
          model,
          material,
          latencyMs: Date.now() - started,
        });
    } catch (error) {
      if (!res.destroyed)
        res
          .status(
            error instanceof ProviderError || error instanceof HttpError
              ? error.status
              : 500,
          )
          .json({
            ok: false,
            generated,
            savedLocally: false,
            model,
            error: generated
              ? "图片已生成，但素材记录保存失败。请在素材库检查并重试保存，避免重复生图。"
              : error instanceof ProviderError || error instanceof HttpError
                ? error.message
                : "生图测试已中断或保存失败。",
            latencyMs: Date.now() - started,
          });
    } finally {
      imageTests.delete(projectId);
      releaseTask();
    }
  });
  return {
    close() {
      closed = true;
      for (const controller of modelQueries) controller.abort();
      modelQueries.clear();
      for (const controller of imageTests.values()) controller.abort();
      imageTests.clear();
    },
  };
}
