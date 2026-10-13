import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
  "base64",
);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom0000isommp42"),
]);

function responseText(body, prompt) {
  if (prompt.includes('{"characters":[{"name":'))
    return JSON.stringify({
      characters: [
        {
          name: "林晚",
          description: "在旧邮局调查来信的主角",
          appearance: "成年女性，蓝色风衣与黑色短发为设计提案",
          sourceEvidence: "林晚在旧邮局",
        },
        {
          name: "陈渡",
          description: "在旧邮局与林晚见面的人",
          appearance: "成年男性，灰色长外套与黑色短发为设计提案",
          sourceEvidence: "陈渡",
        },
      ],
    });
  if (body.model === "fixture-director") {
    const duration = Number(/(?:本集|单集)\s*(\d+)\s*秒/u.exec(prompt)?.[1] || 90);
    return [
      `## 本集逐镜分镜 · ${duration} 秒`,
      "| 镜号 | 起止秒数 | 时长 | 画面 | 出镜人物 | 声音 | 运镜 | 制作方式 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 01 | 0–6秒 | 6秒 | 旧邮局信箱中的信封与明天日期特写 | 无 | 环境音 | 缓慢推进 | 模型生成 |",
      `| 02 | 6–${duration}秒 | ${duration - 6}秒 | 静态字卡：线索仍未解释 | 无 | 无 | 固定 | 后期制作 |`,
    ].join("\n");
  }
  const revision = prompt.includes("开场先展示失踪姐姐的信封")
    ? "\n已落实反馈：开场先展示失踪姐姐的信封。"
    : "";
  return `## 本地模型测试产物\n林晚在旧邮局见到陈渡，信封上的明天日期构成本集悬念。仅基于本次提供的原文制作当前一集。${revision}`;
}

/** Test-only loopback providers: production never imports this fixture. */
export async function createLocalModel(t, { delay = 0, respond } = {}) {
  const requests = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const prompt = body.messages?.at(-1)?.content || body.prompt || "";
    requests.push({ path: request.url, method: request.method, body, prompt });
    if (delay) await sleep(delay);
    if (response.destroyed) return;
    if (request.url === "/media/character.png" || request.url === "/media/shot.mp4") {
      const image = request.url.endsWith(".png");
      response.setHeader("Content-Type", image ? "image/png" : "video/mp4");
      response.end(image ? PNG : MP4);
      return;
    }
    response.setHeader("Content-Type", "application/json");
    const json = (value) => response.end(JSON.stringify(value));
    if (request.url === "/v1/chat/completions") {
      const content =
        (await respond?.({ body, prompt, path: request.url })) ??
        responseText(body, prompt);
      json({ choices: [{ message: { content }, finish_reason: "stop" }] });
      return;
    }
    if (request.url === "/images" || request.url === "/videos") {
      const image = request.url === "/images";
      json({
        url: `${baseUrl}/media/${image ? "character.png" : "shot.mp4"}`,
        text: image ? "本地测试角色图片" : "本地测试单镜头素材；尚非整集成片",
      });
      return;
    }
    response.statusCode = 404;
    json({ error: "Unknown test endpoint" });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.close(resolve);
        upstream.closeAllConnections();
      }),
  );
  function bind(state, { characterKind = "text" } = {}) {
    const providers = ["text", "image", "video"].map((kind) => ({
      id: `fixture-${kind}`,
      name: `Local test ${kind}`,
      kind,
      protocol: kind === "text" ? "openai" : "webhook",
      baseUrl: `${baseUrl}${kind === "text" ? "/v1" : `/${kind}s`}`,
      model: `fixture-${kind}`,
      apiKey: "isolated-model-fixture-key",
      enabled: true,
    }));
    state.providers.push(...providers);
    for (const agent of state.agents) {
      const kind =
        agent.id === "video"
          ? "video"
          : agent.id === "character"
            ? characterKind
            : "text";
      agent.providerId = `fixture-${kind}`;
      agent.model = `fixture-${agent.id}`;
    }
  }
  return { baseUrl, requests, bind };
}
