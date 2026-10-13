import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { activeReference, remember } from "./workflow/memory.mjs";

async function fixture(
  t,
  {
    names = ["林晚", "陈渡"],
    lockedText = false,
    enabled = true,
    materials,
    planResults,
  } = {},
) {
  const calls = {
    plans: 0,
    planPrompts: [],
    imagesAtPlanning: [],
    images: [],
    webhooks: [],
    failImages: new Set(),
  };
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/webhook") {
      calls.webhooks.push(input);
      const character = input.references.find(
        (reference) => reference.type === "character",
      );
      res.end(
        JSON.stringify({
          url: `https://example.test/generated-${calls.webhooks.length}.${input.kind === "video" ? "mp4" : "png"}`,
          ...(input.kind === "image"
            ? {
                text: [
                  "## 第一集逐镜分镜 · 30 秒 · 16:9",
                  "| 镜号 | 起止秒数 | 时长 | 画面 | 出镜人物 | 角色资产 | 对白 | 运镜 |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- |",
                  `| 01 | 0–6秒 | 6秒 | 林晚站在旧邮局窗前，缓慢拆开信封 | 林晚 | ${character.id} / v${character.version} | 这是什么？ | 手部特写，缓慢推进 |`,
                  "| 02 | 6–14秒 | 8秒 | 门外陈渡抬手敲门 LATER_SHOT_ONLY | 陈渡 | 后续角色待制作 | 开门。 | 固定中景 |",
                  "| 03 | 14–22秒 | 8秒 | 林晚收起信封，走向房门 | 林晚 | 林晚 | 无 | 跟拍 |",
                  "| 04 | 22–30秒 | 8秒 | 林晚打开门，脚步停住 | 林晚 | 林晚 | 你怎么来了？ | 缓慢推近 |",
                ].join("\n"),
              }
            : {}),
        }),
      );
      return;
    }
    if (req.url.endsWith("chat/completions")) {
      calls.plans++;
      calls.planPrompts.push(input.messages.at(-1).content);
      calls.imagesAtPlanning.push(calls.images.length);
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  planResults?.[Math.min(calls.plans - 1, planResults.length - 1)] ??
                  JSON.stringify({
                    characters: names.map((name) => ({
                      name,
                      description: "原文角色",
                      appearance: "青衣黑发，外观为设计提案",
                      sourceEvidence: "林晚在旧邮局见到陈渡。",
                    })),
                  }),
              },
            },
          ],
        }),
      );
      return;
    }
    calls.images.push(input);
    if (calls.failImages.has(calls.images.length)) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "isolated image failure" }));
      return;
    }
    res.end(
      JSON.stringify({
        data: [{ url: `https://example.test/image-${calls.images.length}.png` }],
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const state = createSeedState();
  const project = createProject({
    name: "角色检查点测试",
    style: "二次元动画",
  });
  project.chapters = [
    { id: "one", title: "第一章", content: "林晚在旧邮局见到陈渡。" },
  ];
  for (const node of project.nodes)
    if (node.id !== "characters") {
      node.status = "completed";
      node.output = "已确认产物";
    }
  if (lockedText)
    project.assets.push({
      id: "locked-text",
      name: "林晚",
      type: "character",
      description: "原文角色",
      content: "已批准的文字标准：黑发、蓝色风衣。",
      locked: true,
      version: 1,
      createdAt: "",
      tags: ["node:characters"],
    });
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  state.projects = [project];
  state.providers = [
    {
      id: "text",
      kind: "text",
      protocol: "openai",
      enabled: true,
      model: "mock-text",
      baseUrl,
    },
    {
      id: "image",
      kind: "image",
      protocol: "openai",
      enabled,
      model: "mock-image",
      baseUrl,
    },
  ];
  state.agents.find((agent) => agent.id === "writer").providerId = "text";
  state.agents.find((agent) => agent.id === "character").providerId = "image";
  const checkpoints = [];
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      checkpoints.push(JSON.stringify(project));
    },
    materials,
  });
  t.after(async () => {
    workflow.close();
    await new Promise((resolve) => {
      upstream.close(resolve);
      upstream.closeAllConnections();
    });
  });
  async function run(options) {
    workflow.start(project, options);
    await workflow.jobs.get(project.id)?.promise;
  }
  return {
    state,
    project,
    workflow,
    calls,
    checkpoints,
    run,
    baseUrl,
    node: project.nodes.find((node) => node.id === "characters"),
  };
}

test("upgrading an approved text character generates an image draft and replaces the standard only after approval", async (t) => {
  const fx = await fixture(t, { names: ["林晚"], lockedText: true });
  const old = fx.project.assets[0];
  const before = JSON.stringify(old);
  await fx.run();
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(JSON.stringify(old), before);
  const draft = fx.project.assets.find((asset) => asset.url);
  assert.equal(draft.locked, false);
  assert.equal(draft.version, 2);
  assert.equal(draft.content, old.content);
  assert.match(fx.calls.images[0].prompt, /已批准的文字标准：黑发、蓝色风衣/);
  assert.deepEqual(
    fx.project.assets.filter(activeReference).map((asset) => asset.id),
    [old.id],
  );
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.ok(old.tags.includes("历史版本"));
  assert.equal(draft.locked, true);
  assert.deepEqual(
    fx.project.assets.filter(activeReference).map((asset) => asset.id),
    [draft.id],
  );
  assert.equal(fx.node.characterGeneration, undefined);
});

function managedMaterials({ failDownloads = false } = {}) {
  const referenceCalls = [];
  return {
    referenceCalls,
    async capture(project, input) {
      project.materials ||= [];
      const id = `material-${project.materials.length + 1}`;
      const material = {
        ...input,
        id,
        sourceUrl: input.url,
        url: failDownloads ? input.url : `/api/media/${id}/file`,
        status: failDownloads ? "failed" : "ready",
        ...(failDownloads ? { error: "下载超时，原始结果已保留" } : {}),
      };
      project.materials.push(material);
      return material;
    },
    async references(refs, kind) {
      referenceCalls.push({ refs, kind });
      return refs.map((ref) => ({
        ...ref,
        url: ref.url?.startsWith("/api/media/")
          ? kind === "text"
            ? undefined
            : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
          : ref.url,
      }));
    },
  };
}

test("character revisions keep every generated material even when the unlocked asset is replaced", async (t) => {
  const materials = managedMaterials();
  const fx = await fixture(t, { names: ["林晚"], materials });
  await fx.run();
  const first = structuredClone(fx.project.materials[0]);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "revise",
    feedback: "换成侧面构图",
  });
  await fx.workflow.jobs.get(fx.project.id).promise;
  assert.equal(fx.project.assets.length, 1);
  assert.equal(fx.project.materials.length, 2);
  assert.deepEqual(fx.project.materials[0], first);
  assert.equal(fx.project.assets[0].materialId, "material-2");
  assert.equal(fx.project.assets[0].url, "/api/media/material-2/file");
  assert.equal(first.assetId, fx.project.assets[0].id);
  assert.equal(first.providerId, "image");
  assert.equal(first.model, "mock-image");
  assert.equal(first.nodeId, "characters");
  assert.match(first.prompt.slice(0, 100), /「林晚」/);
});

function archiveUncertainImage(project, workflow) {
  const image = project.nodes
    .find((node) => node.id === "characters")
    .characterGeneration.images.find((item) => item.status === "submitted");
  workflow.archiveImageTask(project, {
    captureId: image.captureId,
    acknowledgement: "new-image-may-charge",
  });
}

test("partial character failures retain the downloaded material and retry only explicitly archived missing roles", async (t) => {
  const fx = await fixture(t, { materials: managedMaterials() });
  fx.calls.failImages.add(2);
  await fx.run();
  assert.equal(fx.project.materials.length, 1);
  assert.equal(fx.project.assets[0].url, "/api/media/material-1/file");
  assert.ok(
    fx.checkpoints.some((checkpoint) => JSON.parse(checkpoint).materials?.[0]?.assetId),
  );
  archiveUncertainImage(fx.project, fx.workflow);
  await fx.run();
  assert.equal(fx.calls.images.length, 3);
  assert.equal(fx.project.materials.length, 2);
  assert.equal(
    fx.project.assets.find((asset) => asset.name === "林晚").materialId,
    "material-1",
  );
});

test("download failures remain discoverable without losing the generated role or rerunning it", async (t) => {
  const fx = await fixture(t, {
    names: ["林晚"],
    materials: managedMaterials({ failDownloads: true }),
  });
  await fx.run();
  assert.equal(fx.node.status, "waiting");
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.materials[0].status, "failed");
  assert.match(fx.project.materials[0].error, /下载超时/);
  assert.equal(fx.project.assets[0].url, fx.project.materials[0].sourceUrl);
  assert.equal(fx.project.assets[0].materialId, fx.project.materials[0].id);
  assert.equal(fx.calls.images.length, 1);
});

test("stopping during media capture preserves the material without applying an obsolete character draft", async (t) => {
  const materials = managedMaterials();
  const capture = materials.capture;
  let fx;
  materials.capture = async (project, input) => {
    const material = await capture(project, input);
    fx.workflow.stop(project);
    return material;
  };
  fx = await fixture(t, { names: ["林晚"], materials });
  await fx.run();
  assert.equal(fx.project.materials.length, 1);
  assert.equal(fx.project.materials[0].url, "/api/media/material-1/file");
  assert.equal(fx.project.assets.length, 0);
  assert.equal(fx.node.status, "pending");
  assert.equal(fx.project.approval, null);
});

test("approved local images reach storyboard and video models as media references and all results are retained", async (t) => {
  const materials = managedMaterials();
  const fx = await fixture(t, { names: ["林晚"], materials });
  fx.project.productionBrief = {
    episodeCount: 1,
    durationSeconds: 30,
    aspectRatio: "16:9",
    platform: "通用",
  };
  fx.project.assets.push({
    id: "approved-script",
    name: "第一集已批准剧本",
    type: "script",
    description: "当前已批准剧本",
    content: "林晚在旧邮局发现信件，开门看到陈渡，停下脚步。",
    version: 1,
    locked: true,
    tags: ["node:adaptation"],
  });
  await fx.run();
  for (const [agentId, kind] of [
    ["director", "image"],
    ["video", "video"],
  ]) {
    fx.state.providers.push({
      id: `webhook-${kind}`,
      kind,
      protocol: "webhook",
      enabled: true,
      model: `mock-${kind}`,
      baseUrl: `${fx.baseUrl}/webhook`,
    });
    fx.state.agents.find((agent) => agent.id === agentId).providerId =
      `webhook-${kind}`;
  }
  for (const id of ["storyboard", "video"])
    fx.project.nodes.find((node) => node.id === id).status = "pending";
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id).promise;
  assert.equal(fx.project.approval.kind, "storyboard");
  assert.equal(
    fx.calls.webhooks[0].references[0].url,
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  );
  assert.ok(!fx.calls.webhooks[0].prompt.includes("/api/media/"));
  assert.ok(!fx.calls.webhooks[0].prompt.includes("base64"));
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id).promise;
  assert.equal(
    fx.project.nodes.find((node) => node.id === "video").status,
    "completed",
  );
  const videoRequest = fx.calls.webhooks[1];
  assert.equal(videoRequest.duration, 6);
  assert.equal(videoRequest.ratio, "16:9");
  assert.match(videoRequest.prompt, /只生成已批准分镜中的镜头 01/);
  assert.match(videoRequest.prompt, /林晚站在旧邮局窗前，缓慢拆开信封/);
  assert.doesNotMatch(videoRequest.prompt, /LATER_SHOT_ONLY|门外陈渡|你怎么来了/);
  assert.equal(videoRequest.references.length, 1);
  assert.equal(videoRequest.references[0].name, "林晚");
  assert.ok(videoRequest.references[0].url.startsWith("data:image/"));
  assert.ok(videoRequest.references.every((ref) => ref.type === "character"));
  const shot = fx.project.assets.find((asset) => asset.type === "video").videoShot;
  assert.equal(shot.id, "01");
  assert.equal(shot.durationSeconds, 6);
  assert.deepEqual(
    fx.project.materials.map((material) => material.type),
    ["image", "image", "video"],
  );
  assert.ok(fx.project.materials.every((material) => material.assetId));
  assert.ok(materials.referenceCalls.some(({ kind }) => kind === "video"));
});

test("a later image failure checkpoints successful drafts and retries only the missing character", async (t) => {
  const fx = await fixture(t);
  fx.calls.failImages.add(2);
  await fx.run();
  assert.equal(fx.node.status, "failed");
  assert.equal(fx.project.approval, null);
  assert.equal(fx.project.assets.length, 1);
  const first = fx.project.assets[0];
  assert.equal(first.name, "林晚");
  assert.equal(first.url, "https://example.test/image-1.png");
  assert.equal(first.locked, false);
  assert.ok(
    fx.checkpoints.some((checkpoint) =>
      JSON.parse(checkpoint).assets.some((asset) => asset.url === first.url),
    ),
  );
  archiveUncertainImage(fx.project, fx.workflow);
  await fx.run({ nodeId: "characters" });
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 3);
  assert.equal(fx.node.status, "waiting");
  assert.equal(fx.project.assets.length, 2);
  assert.equal(fx.project.assets.find((asset) => asset.name === "林晚").url, first.url);
  assert.ok(fx.project.assets.every((asset) => !asset.locked));
});

test("serialized checkpoints resume successful images after a process restart", async (t) => {
  const fx = await fixture(t);
  fx.calls.failImages.add(2);
  await fx.run();
  const restored = JSON.parse(JSON.stringify(fx.state));
  const project = restored.projects[0];
  const workflow = createWorkflow({
    getState: () => restored,
    save() {},
  });
  t.after(workflow.close);
  archiveUncertainImage(project, workflow);
  workflow.start(project);
  await workflow.jobs.get(project.id).promise;
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 3);
  assert.equal(project.approval.kind, "character");
  assert.ok(project.assets.every((asset) => !asset.locked));
});

test("bare chat retry commands preserve checkpoints while new creative feedback invalidates them", async (t) => {
  const fx = await fixture(t);
  fx.calls.failImages.add(2);
  await fx.run();
  remember(fx.project, "用户反馈（交给总制片）：@总制片 继续制作。");
  await fx.run();
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 2);
  assert.match(fx.node.error, /不能自动重复生图/);
  archiveUncertainImage(fx.project, fx.workflow);
  await fx.run();
  assert.equal(fx.calls.images.length, 3);

  const other = await fixture(t);
  other.calls.failImages.add(2);
  await other.run();
  remember(other.project, "用户反馈（交给总制片）：继续制作，把林晚的服装改成黑色。");
  await other.run();
  assert.equal(other.calls.plans, 2);
  assert.equal(other.calls.images.length, 4);
  assert.match(other.calls.images[2].prompt, /把林晚的服装改成黑色/);
  assert.ok(
    other.project.assets
      .filter((asset) => !asset.tags.includes("待更新"))
      .every((asset) => asset.url !== "https://example.test/image-1.png"),
  );
});

test("explicit character revision clears the generation checkpoint and creates fresh unapproved images", async (t) => {
  const fx = await fixture(t, { names: ["林晚"], lockedText: true });
  await fx.run();
  const first = fx.project.assets.find((asset) => asset.url);
  const checkpoint = fx.node.characterGeneration.id;
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "revise",
    feedback: "保留标准，镜头改为侧面定妆",
  });
  await fx.workflow.jobs.get(fx.project.id).promise;
  assert.equal(fx.calls.plans, 2);
  assert.equal(fx.calls.images.length, 2);
  assert.notEqual(fx.node.characterGeneration.id, checkpoint);
  assert.ok(first.tags.includes("待更新"));
  assert.equal(
    fx.project.assets.find((asset) => asset.id === "locked-text").locked,
    true,
  );
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.assets.filter(activeReference).length, 1);
});

test("style changes invalidate partial image checkpoints and never reuse the previous style image", async (t) => {
  const fx = await fixture(t);
  fx.calls.failImages.add(2);
  await fx.run();
  fx.project.style = "国风动画";
  fx.workflow.invalidateFrom(fx.project, 3, { preserveCharacters: false });
  assert.equal(fx.node.characterGeneration, undefined);
  await fx.run();
  assert.equal(fx.calls.plans, 2);
  assert.equal(fx.calls.images.length, 4);
  assert.ok(
    fx.project.assets
      .filter((asset) => !asset.tags.includes("待更新"))
      .every((asset) => asset.url !== "https://example.test/image-1.png"),
  );
  assert.match(fx.calls.images[2].prompt, /国风动画/);
});

test("disabled character image services fail before issuing a paid planning request", async (t) => {
  const fx = await fixture(t, { enabled: false });
  await fx.run();
  assert.equal(fx.calls.plans, 0);
  assert.equal(fx.calls.images.length, 0);
  assert.equal(fx.node.status, "failed");
  assert.match(fx.node.error, /已停用/);
});

test("character image requests foreground the subject and exclude unrelated chat and other faces", async (t) => {
  const fx = await fixture(t, { names: ["林晚"] });
  fx.project.messages.push({
    id: "noise",
    agentId: "producer",
    type: "text",
    content: "无关的接口报错与旧聊天".repeat(4000),
    createdAt: "",
  });
  fx.project.assets.push({
    id: "other-face",
    type: "character",
    name: "陈渡",
    description: "陈渡的单独脸型",
    content: "另一个角色：银发西装，不能作为林晚的面孔。",
    locked: true,
    version: 1,
    tags: ["node:characters"],
    url: "https://example.test/other-character.png",
  });
  await fx.run();
  assert.equal(fx.node.status, "waiting");
  assert.equal(fx.calls.images.length, 1);
  const sent = fx.calls.images[0].prompt;
  assert.ok(sent.indexOf("林晚") < 500);
  assert.match(sent, /青衣黑发/);
  assert.match(sent, /二次元动画/);
  assert.doesNotMatch(sent, /无关的接口报错与旧聊天|银发西装|other-character\.png/);
  assert.ok(sent.length < 8000);
});

test("legacy image prompt checkpoints are not silently reused after the prompt pipeline changes", async (t) => {
  const fx = await fixture(t);
  fx.calls.failImages.add(2);
  await fx.run();
  const first = fx.project.assets[0];
  fx.node.characterGeneration.key = "legacy-prompt-version";
  await fx.run();
  assert.equal(fx.calls.plans, 2);
  assert.equal(fx.calls.images.length, 4);
  assert.notEqual(
    fx.project.assets.find((asset) => asset.name === "林晚").url,
    first.url,
  );
  assert.equal(fx.project.approval.kind, "character");
});

test("a sourced name with a kinship label creates one canonical character asset", async (t) => {
  const fx = await fixture(t, { names: ["爷爷（李半山）"] });
  fx.project.chapters[0].content =
    "“李半山，你到底是造了什么孽啊！”奶奶浑身颤抖地盯着爷爷质问道。";
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.project.assets.length, 1);
  assert.equal(fx.project.assets[0].name, "李半山");
  assert.match(fx.project.assets[0].content, /已核实称谓：爷爷/);
  assert.equal(fx.calls.images.length, 1);
  assert.match(fx.calls.images[0].prompt.slice(0, 200), /「李半山」/);
});

test("a canonical locked role is reused when the planner uses its sourced kinship label", async (t) => {
  const fx = await fixture(t, { names: ["爷爷（李半山）"] });
  fx.project.chapters[0].content = "我的爷爷名叫李半山。";
  fx.project.assets.push({
    id: "locked-grandfather",
    name: "李半山",
    type: "character",
    description: "主角的爷爷",
    content: "已核实称谓：爷爷\n深灰长袍，白发。",
    locked: true,
    version: 2,
    tags: ["node:characters"],
    url: "https://example.test/grandfather.png",
  });
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.calls.images.length, 0);
  assert.equal(fx.project.assets.length, 1);
  assert.equal(fx.project.assets[0].id, "locked-grandfather");
});

test("an approved adaptation character without an existing asset receives a sourced visual proposal", async (t) => {
  const fx = await fixture(t, { names: ["值班保安"] });
  fx.project.assets.push({
    id: "approved-cast-script",
    name: "当前剧本",
    type: "script",
    description: "已确认改编",
    content: "值班保安拦住林晚，要求登记姓名。这是为连接剧情增加的人物。",
    locked: true,
    version: 2,
    tags: ["node:adaptation"],
  });
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  const role = fx.project.assets.find((asset) => asset.type === "character");
  assert.equal(role.name, "值班保安");
  assert.match(role.content, /角色来源：.*改编/);
  assert.equal(role.locked, false);
  assert.equal(fx.calls.images.length, 1);
});

test("unapproved invented roles and duplicate canonical identities never reach image generation", async (t) => {
  const unknown = await fixture(t, { names: ["不存在的新角色"] });
  await unknown.run();
  assert.equal(unknown.node.status, "failed");
  assert.equal(unknown.calls.images.length, 0);
  assert.equal(unknown.calls.plans, 2);
  const duplicate = await fixture(t, { names: ["李半山", "爷爷（李半山）"] });
  duplicate.project.chapters[0].content = "我的爷爷名叫李半山。";
  await duplicate.run();
  assert.equal(duplicate.node.status, "failed");
  assert.match(duplicate.node.error, /同一人物|重复/);
  assert.equal(duplicate.calls.images.length, 0);
  assert.equal(duplicate.calls.plans, 2);
});

test("invalid cast output is repaired once before any image requests and reports the correction", async (t) => {
  const invalid = JSON.stringify({
    characters: [{ name: "长生家人", description: "三位家人", appearance: "深色衣服" }],
  });
  const corrected = JSON.stringify({
    characters: ["父亲", "母亲", "奶奶"].map((name) => ({
      name,
      description: `长生的${name}`,
      appearance: `${name}的独立形象设计`,
      sourceEvidence: "父亲、母亲和奶奶的剪影站在门口。",
    })),
  });
  const fx = await fixture(t, { planResults: [invalid, corrected] });
  fx.project.chapters[0].content = "长生看见父亲、母亲和奶奶的剪影站在门口。";
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.calls.plans, 2);
  assert.deepEqual(fx.calls.imagesAtPlanning, [0, 0]);
  assert.equal(fx.calls.images.length, 3);
  assert.match(fx.calls.planPrompts[1], /唯一一次自动校正/);
  assert.match(fx.calls.planPrompts[1], /长生家人/);
  assert.deepEqual(
    fx.project.assets.map((asset) => asset.name),
    ["父亲", "母亲", "奶奶"],
  );
  assert.equal(
    fx.project.messages.filter((message) =>
      message.content.includes("自动校正最多一次"),
    ).length,
    1,
  );
  assert.ok(fx.node.characterGeneration.planningVersion);
});

test("malformed cast JSON exhausts one correction without persisting a plan or requesting images", async (t) => {
  const fx = await fixture(t, { planResults: ["not json"] });
  await fx.run();
  assert.equal(fx.node.status, "failed");
  assert.equal(fx.calls.plans, 2);
  assert.equal(fx.calls.images.length, 0);
  assert.equal(fx.node.characterGeneration, undefined);
  assert.match(fx.node.error, /有效 JSON/);
});

function baseDesignPlan(cast = ["林晚", "陈渡"]) {
  return JSON.stringify({
    characters: cast.map((entry) => {
      const { name, subjectType = "person" } =
        typeof entry === "string" ? { name: entry } : entry;
      return {
        name,
        description: subjectType === "object" ? "本集出现的独立静物" : "原文角色",
        sourceEvidence: "林晚在旧邮局见到陈渡和神像。",
        characterDesign: {
          version: 1,
          subjectType,
          baseAppearance:
            subjectType === "object"
              ? "设计提案：灰色石质坐像，窄肩长袍，底座为正方形，额头刻有圆形纹饰。"
              : "设计提案：二十岁，椭圆脸，黑色短直发，深棕眼睛，清晰平眉，匀称身形，固定穿灰蓝色长衫和棕色布鞋。",
          sceneStates:
            subjectType === "object"
              ? []
              : [
                  {
                    name: "门口逆光",
                    description: "仅门口镜头使用逆光，保留基础五官和服装。",
                  },
                ],
        },
      };
    }),
  });
}

test("modern character production reviews the first person before generating the remaining cast and locks only at final approval", async (t) => {
  const fx = await fixture(t, {
    planResults: [
      baseDesignPlan([{ name: "神像", subjectType: "object" }, "林晚", "陈渡"]),
    ],
  });
  fx.project.chapters[0].content = "林晚在旧邮局见到陈渡和神像。";
  fx.project.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块";
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.project.approval.phase, "character-pilot");
  assert.equal(fx.node.characterGeneration.stage, "pilot");
  assert.equal(fx.node.characterGeneration.pilotName, "林晚");
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.assets.length, 1);
  const pilot = fx.project.assets[0];
  const generationId = fx.node.characterGeneration.id;
  assert.equal(pilot.name, "林晚");
  assert.equal(pilot.characterDesign.version, 1);
  assert.equal(pilot.locked, false);
  assert.ok(pilot.tags.includes(`generation:${generationId}`));
  assert.match(fx.calls.images[0].prompt, /二维赛璐璐/);

  const pilotApprovalId = fx.project.approval.id;
  const handoffsBeforePilotApproval = fx.project.messages.filter(
    (message) => message.event?.kind === "handoff",
  ).length;
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.notEqual(fx.node.status, "completed");
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 3);
  assert.equal(fx.node.characterGeneration.id, generationId);
  assert.equal(fx.node.characterGeneration.stage, "batch");
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.approval.phase, undefined);
  assert.equal(fx.project.assets.find((asset) => asset.name === "林晚").url, pilot.url);
  assert.ok(fx.project.assets.every((asset) => !asset.locked));
  assert.equal(fx.project.assets.length, 3);
  assert.equal(
    fx.project.messages.filter((message) => message.event?.kind === "handoff").length,
    handoffsBeforePilotApproval,
  );
  const pilotAcceptance = fx.project.messages.find(
    (message) =>
      message.event?.kind === "approved" &&
      message.event.approvalId === pilotApprovalId,
  );
  assert.equal(pilotAcceptance.nodeId, "characters");
  assert.equal(pilotAcceptance.event.phase, "character-pilot");
  assert.equal(
    fx.project.messages.filter(
      (message) => message.nodeId === "characters" && message.event?.kind === "start",
    ).length,
    2,
  );

  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(fx.node.status, "completed");
  assert.equal(fx.node.characterGeneration, undefined);
  assert.equal(fx.project.approval, null);
  assert.ok(fx.project.assets.every((asset) => asset.locked));
  assert.equal(fx.calls.images.length, 3);
});

test("an all-object modern cast still receives a single sample review before final asset approval", async (t) => {
  const fx = await fixture(t, {
    planResults: [baseDesignPlan([{ name: "神像", subjectType: "object" }])],
  });
  fx.project.chapters[0].content = "神像静静地坐在堂中。";
  await fx.run();
  assert.equal(fx.project.approval.phase, "character-pilot");
  assert.equal(fx.node.characterGeneration.pilotName, "神像");
  assert.equal(fx.project.assets[0].characterDesign.subjectType, "object");
  assert.equal(fx.calls.images.length, 1);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.approval.phase, undefined);
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.assets[0].locked, false);
});

test("missing modern pilot images cannot be approved or trigger remaining image requests", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  await fx.run();
  const approval = fx.project.approval;
  assert.equal(approval.phase, "character-pilot");
  delete fx.project.assets[0].url;
  assert.throws(
    () =>
      fx.workflow.approve(fx.project, {
        approvalId: approval.id,
        decision: "approve",
      }),
    (error) => [400, 409].includes(error.status),
  );
  assert.equal(fx.project.approval.id, approval.id);
  assert.equal(fx.node.status, "waiting");
  assert.equal(fx.node.characterGeneration.stage, "pilot");
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.running, false);
});

test("rejecting a modern pilot replans and regenerates only the sample while preserving every material", async (t) => {
  const fx = await fixture(t, {
    planResults: [baseDesignPlan()],
    materials: managedMaterials(),
  });
  await fx.run();
  const firstGeneration = fx.node.characterGeneration.id;
  const firstMaterial = structuredClone(fx.project.materials[0]);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "revise",
    feedback: "保留清晰线稿，降低服装饱和度，重新制作中性基础设定。",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.equal(fx.calls.plans, 2);
  assert.equal(fx.calls.images.length, 2);
  assert.notEqual(fx.node.characterGeneration.id, firstGeneration);
  assert.equal(fx.node.characterGeneration.stage, "pilot");
  assert.equal(fx.project.approval.phase, "character-pilot");
  assert.equal(fx.project.materials.length, 2);
  assert.deepEqual(fx.project.materials[0], firstMaterial);
  assert.deepEqual(
    fx.project.assets
      .filter(
        (asset) => !asset.tags.includes("历史版本") && !asset.tags.includes("待更新"),
      )
      .map((asset) => asset.name),
    ["林晚"],
  );
  assert.ok(fx.project.assets.every((asset) => !asset.locked));
});

test("a serialized pilot approval survives restart and a failed batch retries without repeating its accepted sample or plan", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  await fx.run();
  const restored = JSON.parse(JSON.stringify(fx.state));
  const project = restored.projects[0];
  const node = project.nodes.find((item) => item.id === "characters");
  const pilot = project.assets[0];
  const workflow = createWorkflow({
    getState: () => restored,
    save() {},
  });
  t.after(workflow.close);
  assert.equal(project.approval.phase, "character-pilot");
  fx.calls.failImages.add(2);
  workflow.approve(project, {
    approvalId: project.approval.id,
    decision: "approve",
  });
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(node.status, "failed");
  assert.equal(node.characterGeneration.stage, "batch");
  assert.equal(project.approval, null);
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 2);

  const resumedState = JSON.parse(JSON.stringify(restored));
  const resumedProject = resumedState.projects[0];
  const resumedWorkflow = createWorkflow({
    getState: () => resumedState,
    save() {},
  });
  t.after(resumedWorkflow.close);
  archiveUncertainImage(resumedProject, resumedWorkflow);
  resumedWorkflow.start(resumedProject, { nodeId: "characters" });
  await resumedWorkflow.jobs.get(resumedProject.id)?.promise;
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 3);
  assert.equal(resumedProject.approval.kind, "character");
  assert.equal(resumedProject.approval.phase, undefined);
  assert.equal(
    resumedProject.assets.find((asset) => asset.name === "林晚").url,
    pilot.url,
  );
  assert.ok(resumedProject.assets.every((asset) => !asset.locked));
});

test("a locked legacy scene image does not bypass modern baseline generation or get replaced before final acceptance", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan(["林晚"])] });
  const legacy = {
    id: "legacy-scene-character",
    name: "林晚",
    type: "character",
    description: "旧剧情形象",
    content: "角色：林晚\n剧情状态：门口逆光剪影，五官不可辨。",
    url: "https://example.test/legacy-silhouette.png",
    locked: true,
    version: 1,
    tags: ["node:characters"],
  };
  fx.project.assets.push(legacy);
  await fx.run();
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.approval.phase, "character-pilot");
  assert.equal(legacy.locked, true);
  assert.ok(!legacy.tags.includes("历史版本"));
  const draft = fx.project.assets.find((asset) => asset.id !== legacy.id);
  assert.equal(draft.characterDesign.version, 1);
  assert.equal(draft.locked, false);
  assert.notEqual(draft.url, legacy.url);
  assert.match(draft.content, /中性基础外观|基础外观|基础设定/);

  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.ok(!legacy.tags.includes("历史版本"));
  assert.equal(draft.locked, false);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.ok(legacy.tags.includes("历史版本"));
  assert.equal(draft.locked, true);
  assert.deepEqual(
    fx.project.assets.filter(activeReference).map((asset) => asset.id),
    [draft.id],
  );
});

test("changing the style guide invalidates approval of an already generated pilot without launching the batch", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  fx.project.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块";
  await fx.run();
  const approval = fx.project.approval;
  fx.project.visualStyleGuide = "水彩动画：柔和笔触";
  assert.throws(
    () =>
      fx.workflow.approve(fx.project, {
        approvalId: approval.id,
        decision: "approve",
      }),
    (error) => error.status === 409,
  );
  assert.equal(fx.project.approval.id, approval.id);
  assert.equal(fx.node.characterGeneration.stage, "pilot");
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.project.running, false);
});

test("a complete cast of locked structured baseline images is reused without generating a redundant pilot", async (t) => {
  const plan = baseDesignPlan();
  const fx = await fixture(t, { planResults: [plan] });
  const standards = JSON.parse(plan).characters.map((character, index) => ({
    ...character,
    id: `baseline-${index}`,
    type: "character",
    content: `角色：${character.name}\n基础外观：${character.characterDesign.baseAppearance}`,
    url: `https://example.test/baseline-${index}.png`,
    locked: true,
    version: 1,
    tags: ["node:characters"],
  }));
  fx.project.assets.push(...standards);
  const before = JSON.stringify(standards);
  await fx.run();
  assert.equal(fx.node.status, "waiting", fx.node.error);
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.approval.phase, undefined);
  assert.equal(fx.calls.images.length, 0);
  assert.equal(fx.project.assets.length, standards.length);
  assert.equal(JSON.stringify(standards), before);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(fx.node.status, "completed");
  assert.equal(fx.calls.images.length, 0);
  assert.equal(JSON.stringify(standards), before);
});

test("pilot approval refuses creative feedback instead of silently generating an unchanged batch", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  await fx.run();
  const approval = fx.project.approval;
  assert.throws(
    () =>
      fx.workflow.approve(fx.project, {
        approvalId: approval.id,
        decision: "approve",
        feedback: "其余角色服装全部使用低饱和色彩。",
      }),
    (error) => error.status === 400 && error.message.includes("修改样板"),
  );
  assert.equal(fx.project.approval.id, approval.id);
  assert.equal(fx.node.characterGeneration.stage, "pilot");
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.project.running, false);
});

test("a locked structured text standard upgrades to an approvable image pilot using the exact confirmed design", async (t) => {
  const plan = baseDesignPlan(["林晚"]);
  const fx = await fixture(t, { planResults: [plan] });
  const standard = {
    id: "locked-structured-text",
    name: "林晚",
    type: "character",
    description: "已经人工确认的角色文字标准",
    content: "角色：林晚\n人工确认基础外观：黑色短发、墨绿色长外套、棕色布鞋。",
    characterDesign: {
      ...JSON.parse(plan).characters[0].characterDesign,
      baseAppearance: "二十岁，椭圆脸，黑色短发，墨绿色长外套，棕色布鞋。",
    },
    version: 2,
    locked: true,
    tags: ["node:characters"],
  };
  fx.project.assets.push(standard);
  const before = JSON.stringify(standard);
  await fx.run();
  assert.equal(fx.project.approval.phase, "character-pilot");
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.calls.plans, 1);
  const draft = fx.project.assets.find((asset) => asset.url);
  assert.equal(draft.content, standard.content);
  assert.equal(fx.node.characterGeneration.plan[0].content, standard.content);
  assert.deepEqual(draft.characterDesign, standard.characterDesign);
  assert.equal(JSON.stringify(standard), before);
  assert.match(fx.calls.images[0].prompt, /墨绿色长外套/);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.approval.phase, undefined);
  assert.equal(fx.calls.images.length, 1);
  assert.equal(fx.calls.plans, 1);
  assert.equal(draft.locked, false);
  assert.equal(JSON.stringify(standard), before);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(draft.locked, true);
  assert.ok(standard.tags.includes("历史版本"));
  assert.equal(fx.node.status, "completed");
});

async function finalCharacterReview(t) {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  await fx.run();
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.project.approval.phase, undefined);
  assert.equal(fx.node.characterGeneration.outputKind, "image");
  return fx;
}

test("final character review rejects an incomplete or changed batch without locking assets or starting downstream work", async (t) => {
  const invalidations = {
    "empty assets": (fx) => {
      fx.project.assets = [];
    },
    "missing planned character": (fx) => fx.project.assets.pop(),
    "missing image": (fx) => delete fx.project.assets[1].url,
    "blank image": (fx) => {
      fx.project.assets[1].url = "   ";
    },
    "stale draft": (fx) => fx.project.assets[1].tags.push("待更新"),
    "draft awaiting regeneration": (fx) => fx.project.assets[1].tags.push("待重新生成"),
    "archived draft": (fx) => fx.project.assets[1].tags.push("历史版本"),
    "another generation": (fx) => {
      fx.project.assets[1].tags = ["generation:previous"];
    },
    "changed text": (fx) => {
      fx.project.assets[1].content += "修改服装";
    },
    "missing modern contract": (fx) => delete fx.project.assets[1].characterDesign,
    "changed modern contract": (fx) => {
      fx.project.assets[1].characterDesign = {
        ...fx.project.assets[1].characterDesign,
        baseAppearance: "尚未生成的其他造型",
      };
    },
    "empty plan": (fx) => {
      fx.node.characterGeneration.plan = [];
    },
    "unapproved pilot stage": (fx) => {
      fx.node.characterGeneration.stage = "pilot";
    },
    "changed guide": (fx) => {
      fx.project.visualStyleGuide = "写实摄影";
    },
    "image binding changed to text": (fx) => {
      fx.state.agents.find((agent) => agent.id === "character").providerId = "text";
    },
  };
  for (const [name, invalidate] of Object.entries(invalidations))
    await t.test(name, async (t) => {
      const fx = await finalCharacterReview(t);
      fx.project.nodes.find((node) => node.id === "storyboard").status = "pending";
      invalidate(fx);
      const before = JSON.stringify(fx.project);
      const imageCount = fx.calls.images.length;
      assert.throws(
        () =>
          fx.workflow.approve(fx.project, {
            approvalId: fx.project.approval.id,
            decision: "approve",
            feedback: "审核备注不能在失败时被写入",
          }),
        (error) => [400, 409].includes(error.status),
      );
      assert.equal(JSON.stringify(fx.project), before);
      assert.equal(fx.workflow.jobs.has(fx.project.id), false);
      assert.equal(fx.calls.images.length, imageCount);
      assert.equal(fx.calls.webhooks.length, 0);
    });
});

test("final character approval locks only the exact planned batch and leaves unrelated drafts and their standards untouched", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  const outsideStandard = {
    id: "outside-standard",
    type: "character",
    name: "后续章节角色",
    content: "后续章节已批准设定",
    locked: true,
    tags: ["node:characters"],
    version: 1,
  };
  fx.project.assets.push(outsideStandard);
  await fx.run();
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.workflow.jobs.get(fx.project.id)?.promise;
  const currentDrafts = fx.project.assets.filter((asset) => !asset.locked);
  const outsideDraft = {
    ...structuredClone(currentDrafts[0]),
    id: "outside-draft",
    name: outsideStandard.name,
    tags: ["node:characters", "待确认", "replaces:outside-standard"],
  };
  const previousDraft = {
    ...structuredClone(currentDrafts[1]),
    id: "previous-draft",
    tags: ["node:characters", "待确认", "generation:previous"],
  };
  fx.project.assets.push(outsideDraft, previousDraft);
  const untouched = JSON.stringify([outsideStandard, outsideDraft, previousDraft]);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(fx.node.status, "completed");
  assert.ok(currentDrafts.every((asset) => asset.locked));
  assert.equal(
    JSON.stringify([outsideStandard, outsideDraft, previousDraft]),
    untouched,
  );
});

test("a modern text-only cast remains approvable without image URLs", async (t) => {
  const fx = await fixture(t, { planResults: [baseDesignPlan()] });
  fx.state.agents.find((agent) => agent.id === "character").providerId = "text";
  await fx.run();
  assert.equal(fx.node.characterGeneration.outputKind, "text");
  assert.equal(fx.project.approval.phase, undefined);
  assert.ok(fx.project.assets.every((asset) => !asset.url));
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(fx.node.status, "completed");
  assert.ok(fx.project.assets.every((asset) => asset.locked));
  assert.equal(fx.calls.images.length, 0);
});

test("legacy mode flags cannot bypass real character planning and generation", async (t) => {
  const fx = await fixture(t);
  fx.project.mode = "demo";
  await fx.run();
  assert.equal(fx.node.characterGeneration.outputKind, "image");
  assert.equal(fx.project.approval.kind, "character");
  assert.equal(fx.calls.images.length, 2);
  assert.equal(fx.calls.plans, 1);
  assert.ok(fx.project.assets.every((asset) => !asset.locked));
});

test("manual edits to current text drafts update the reviewed plan and preserve final approval checks", async (t) => {
  const fx = await fixture(t, { names: ["林晚"] });
  fx.state.agents.find((agent) => agent.id === "character").providerId = "text";
  await fx.run();
  const asset = fx.project.assets[0];
  const previous = { ...asset };
  const oldApproval = fx.project.approval.id;
  const oldKey = fx.node.characterGeneration.key;
  asset.description = "人工指定灰色风衣";
  asset.content = "林晚：灰色风衣，黑色短发；人工修改的本集角色提案。";
  asset.version += 1;
  remember(fx.project, "人工修改资产标准：林晚改穿灰色风衣。");
  remember(fx.project, "解锁资产：林晚。");
  fx.workflow.reviewEditedAsset(fx.project, asset, previous);
  assert.notEqual(fx.project.approval.id, oldApproval);
  assert.notEqual(fx.node.characterGeneration.key, oldKey);
  assert.equal(fx.node.characterGeneration.plan[0].content, asset.content);
  assert.match(fx.node.output, /人工指定灰色风衣/);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  assert.equal(asset.locked, true);
  assert.equal(fx.node.status, "completed");
  assert.equal(fx.calls.plans, 1);
  assert.equal(fx.calls.images.length, 0);
});

test("older saved checkpoints infer image mode and retain the exact adopted locked text standard", async (t) => {
  const fx = await fixture(t, { names: ["林晚"], lockedText: true });
  await fx.run();
  delete fx.node.characterGeneration.outputKind;
  fx.node.characterGeneration.plan[0].content = "旧版规划中的未采用外观提案";
  const saved = JSON.parse(JSON.stringify(fx.state));
  const project = saved.projects[0];
  const workflow = createWorkflow({ getState: () => saved, save() {} });
  t.after(workflow.close);
  const original = project.assets.find((asset) => asset.id === "locked-text");
  const draft = project.assets.find((asset) => !asset.locked);
  workflow.approve(project, {
    approvalId: project.approval.id,
    decision: "approve",
  });
  assert.equal(
    project.nodes.find((node) => node.id === "characters").status,
    "completed",
  );
  assert.equal(draft.locked, true);
  assert.ok(original.tags.includes("历史版本"));
  assert.equal(fx.calls.images.length, 1);
});
