import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./seed.mjs";
import {
  buildVideoShotRequest,
  buildMediaInventory,
  buildDeliveryStoryboard,
} from "./workflow/video-shot.mjs";

function fixture(content) {
  const project = createProject({ name: "逐镜生成", style: "二次元动画" });
  project.productionBrief = {
    aspectRatio: "16:9",
    durationSeconds: 90,
    style: "二次元动画",
  };
  project.visualStyleGuide = "细线稿、低饱和土色";
  const character = (id, name) => ({
    id,
    name,
    type: "character",
    version: 2,
    locked: true,
    url: `https://example.test/${id}.png`,
    content: `${name}角色卡`,
    tags: ["node:characters"],
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance: `${name}中性基础外观`,
      sceneStates: [],
    },
  });
  project.assets = [
    character("asset-lead", "长生"),
    character("asset-other", "父亲"),
    {
      id: "asset-board",
      name: "本集分镜",
      type: "storyboard",
      version: 2,
      locked: true,
      tags: ["node:storyboard"],
      content:
        content ||
        "| 镜号 | 起止秒数 | 时长 | 画面 | 出镜人物 | 对白 | 音效 | 运镜 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 01 | 0–6秒 | 6秒 | 长生站在门口推开木门 | 长生（asset-lead / v2） | 谁在里面？ | 门轴吱嘎 | 缓慢推进 |\n| 02 | 6–14秒 | 8秒 | 父亲躲在窗后 LATER_PLOT | 父亲（asset-other / v2） | 无 | 风声 | 固定 |",
    },
  ];
  project.nodes.find((node) => node.id === "storyboard").output =
    project.assets[2].content;
  project.chapters = [{ title: "原文", content: "ENTIRE_NOVEL_SHOULD_NOT_BE_SENT" }];
  return project;
}

test("video request selects one approved shot, its duration, ratio and on-screen references", () => {
  const result = buildVideoShotRequest(fixture());
  assert.deepEqual(result.videoOptions, { duration: 6, ratio: "16:9" });
  assert.equal(result.shot.id, "01");
  assert.equal(result.shot.storyboardVersion, 2);
  assert.deepEqual(
    result.references.map((ref) => ref.id),
    ["asset-lead"],
  );
  assert.match(result.prompt, /谁在里面.*门轴吱嘎/su);
  assert.match(result.prompt, /细线稿、低饱和土色/);
  assert.match(result.prompt, /图片1＝长生/);
  assert.doesNotMatch(result.prompt, /LATER_PLOT|ENTIRE_NOVEL|父亲/);
  assert.equal(result.references[0].content, "长生中性基础外观");
});

test("explicit black title shots marked for postproduction may precede the first generated shot", () => {
  const project = fixture(
    "| 镜号 | 时间 | 时长 | 画面 | 制作方式 | 出镜人物 |\n|---|---|---|---|---|---|\n|01|0–2|2|全黑字幕卡|后期制作|无|\n|02|2–8|6|长生推门|Seedance生成|长生（asset-lead-v2）|\n|03|8–15|7|父亲转身|Seedance生成|父亲|",
  );
  const result = buildVideoShotRequest(project);
  assert.equal(result.shot.id, "02");
  assert.equal(result.shot.skippedShots[0].id, "01");
  assert.equal(result.videoOptions.duration, 6);
  assert.deepEqual(
    result.references.map((ref) => ref.id),
    ["asset-lead"],
  );
  assert.doesNotMatch(result.prompt, /全黑字幕卡/);
});

test("visual short shots are never skipped or silently lengthened", () => {
  const project = fixture();
  project.assets[2].content = project.assets[2].content.replace(
    "0–6秒 | 6秒",
    "0–2秒 | 2秒",
  );
  const result = buildVideoShotRequest(project);
  assert.equal(result.shot.id, "01");
  assert.equal(result.videoOptions.duration, 2);
});

test("postproduction black intros remain accounted for across separate scene tables", () => {
  const project = fixture(
    "### 序章\n| 镜号 | 时间 | 时长 | 画面 | 制作方式 |\n|---|---|---|---|---|\n|01|0–3|3|全黑字幕卡|后期制作|\n\n### 第一场\n| 镜号 | 时间 | 时长 | 画面 | 出镜人物 |\n|---|---|---|---|---|\n|02|3–7|4|长生推门|长生（asset-lead / v2）|",
  );
  const result = buildVideoShotRequest(project);
  assert.equal(result.shot.id, "02");
  assert.equal(result.shot.startSeconds, 3);
  assert.equal(result.videoOptions.duration, 4);
  assert.deepEqual(
    result.shot.skippedShots.map((shot) => shot.id),
    ["01"],
  );
  assert.deepEqual(
    result.references.map((ref) => ref.id),
    ["asset-lead"],
  );
});

test("section-format storyboard supports explicit first-shot timings and only its content", () => {
  const result = buildVideoShotRequest(
    fixture(
      "### 镜头01（00:00–00:05）\n时长：5秒\n画面：长生推开木门\n人物：长生\n对白：谁在里面？\n运镜：缓慢推进\n### 镜头02（00:05–00:12）\n画面：父亲转身 LATER_PLOT",
    ),
  );
  assert.equal(result.videoOptions.duration, 5);
  assert.match(result.prompt, /长生推开木门/);
  assert.doesNotMatch(result.prompt, /LATER_PLOT|父亲/);
});

test("unapproved, malformed and inconsistent storyboards stop before any video request", () => {
  for (const content of [
    "全片九十秒，长生发现异常。",
    "| 镜号 | 时长 | 画面 |\n|---|---|---|\n|01|待定|长生推门|",
    "| 镜号 | 起止秒数 | 时长 | 画面 |\n|---|---|---|---|\n|01|0–6|5|长生推门|",
    "| 镜号 | 时长 | 画面 |\n|---|---|---|\n|02|5|长生推门|",
  ])
    assert.throws(
      () => buildVideoShotRequest(fixture(content)),
      /首镜|首镜|首镜|镜头01/u,
    );
  const project = fixture();
  project.assets[2].locked = false;
  assert.throws(() => buildVideoShotRequest(project), /已批准的当前分镜/);
});

test("stale or missing character references are rejected and unrelated cast never exhausts reference slots", () => {
  const project = fixture();
  project.assets[2].content = project.assets[2].content.replace(
    "asset-lead / v2",
    "asset-lead / v1",
  );
  assert.throws(() => buildVideoShotRequest(project), /当前锁定版本为 v2/);
  project.assets[2].content = project.assets[2].content.replace(
    "asset-lead / v1",
    "asset-missing / v2",
  );
  assert.throws(() => buildVideoShotRequest(project), /已过期或不存在/);
  const missingImage = fixture();
  delete missingImage.assets[0].url;
  assert.throws(() => buildVideoShotRequest(missingImage), /没有已确认参考图片/);
  const largeCast = fixture();
  for (let index = 0; index < 15; index++)
    largeCast.assets.push({
      ...largeCast.assets[1],
      id: `asset-extra-${index}`,
      name: `未出镜人物${index}`,
    });
  assert.equal(buildVideoShotRequest(largeCast).references.length, 1);
});

test("voice-only characters do not become face references when the shot declares another on-screen subject", () => {
  const project = fixture();
  project.assets[2].content = project.assets[2].content.replace(
    "谁在里面？",
    "父亲画外音：进来。",
  );
  const result = buildVideoShotRequest(project);
  assert.match(result.prompt, /父亲画外音/);
  assert.deepEqual(
    result.references.map((ref) => ref.name),
    ["长生"],
  );
});

test("real storyboard separates a postproduction black title shot and an audio-only grandfather in shot two", () => {
  const project = fixture(
    "| 镜号 | 起止 | 时长 | 景别 | 画面·动作 | 出镜人物 · 资产ID/版本 | 对白（汉字数） | 音效 | 运镜 | 转场 |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | 00:00–00:03 | 3s | 黑场 | 全黑无图像，后期叠字卡（可选） | 不出镜；旁白声线为长生（无形象） | 旁白「我出生那天，是个死胎。」 | 啼哭 | 无 | 烛光渐显 |\n| 2 | 00:03–00:07 | 4s | 特写 | 一圈晃动烛火；障布上映出形状不明的模糊黑影 | 父亲 asset-other / v2（**仅画外音**，不出现可辨身体） | 父亲（画外）「谁也不能动他。」 | 夜风 | 缓慢横移 | 硬切 |\n\n> 镜1 为**后期制作**（纯黑＋字幕），不调用 Seedance 2.0。镜2 为 Seedance 镜头。",
  );
  project.visualStyleGuide +=
    "；基础图使用浅灰纯色背景、正面全身、中性表情，不画逆光剪影。";
  const result = buildVideoShotRequest(project);
  assert.equal(result.shot.id, "02");
  assert.equal(result.videoOptions.duration, 4);
  assert.equal(result.references.length, 0);
  assert.equal(result.shot.voiceOnlyCharacters.length, 1);
  assert.match(result.prompt, /不增加人脸或身体/);
  assert.match(result.prompt, /只用于角色设定图，不适用于本镜/);
  assert.match(result.prompt, /晃动烛火/);
  assert.doesNotMatch(result.prompt, /我出生那天/);
});

test("delivery inventory includes unlocked actual videos and their download failure without claiming a finished film", () => {
  const project = fixture();
  project.assets.push({
    id: "video-first",
    type: "video",
    name: "镜头01",
    version: 1,
    locked: false,
    tags: ["node:video"],
    url: "https://example.test/shot01.mp4",
    materialId: "material-first",
  });
  project.materials = [
    {
      id: "material-first",
      assetId: "video-first",
      status: "failed",
      error: "下载超时，远程链接保留",
    },
  ];
  const inventory = buildMediaInventory(project);
  assert.match(inventory, /video-first|shot01\.mp4/);
  assert.match(inventory, /尚未人工验收/);
  assert.match(inventory, /"storageStatus": "failed"/);
  assert.match(inventory, /下载超时，远程链接保留/);
  assert.match(inventory, /单个镜头不等于整集成片/);
});

test("delivery inventory prioritizes the declared material version and never substitutes an older capture", () => {
  const project = fixture();
  const asset = project.assets[0];
  asset.materialId = "material-v2";
  asset.url = "/api/media/material-v2/file";
  project.materials = [
    {
      id: "material-v1",
      assetId: asset.id,
      status: "failed",
      url: "https://example.test/v1.png",
      error: "old failure",
    },
    { id: "material-v2", assetId: asset.id, status: "local", url: asset.url },
  ];
  const rows = () => JSON.parse(buildMediaInventory(project).split("：\n")[1]);
  assert.equal(rows()[0].materialId, "material-v2");
  assert.equal(rows()[0].storageStatus, "local");
  assert.equal(rows()[0].storageError, undefined);
  project.materials.pop();
  assert.equal(rows()[0].materialId, "material-v2");
  assert.equal(rows()[0].storageStatus, "素材记录缺失");
  assert.match(rows()[0].storageError, /不能改用其他版本/);
  delete asset.materialId;
  assert.equal(
    rows()[0].materialId,
    null,
    "a different remote URL is not evidence of the same version",
  );
  project.materials.push({
    id: "material-exact",
    assetId: asset.id,
    status: "local",
    url: asset.url,
  });
  assert.equal(rows()[0].materialId, "material-exact");
  project.materials = [{ id: "legacy-only", assetId: asset.id, status: "local" }];
  assert.equal(rows()[0].materialId, "legacy-only");
  project.materials.push({
    id: "legacy-ambiguous",
    assetId: asset.id,
    status: "local",
  });
  assert.equal(rows()[0].materialId, null);
});

test("delivery receives complete current locked storyboard and rejects oversized content without truncation", () => {
  const content = `## 逐镜全文\n${"中段镜头说明。".repeat(1200)}\n|18|86–90秒|4秒|末镜唯一标记：脖颈处斑块|`;
  const project = fixture(content);
  const result = buildDeliveryStoryboard(project);
  assert.ok(result.endsWith(content));
  assert.match(result, /asset-board \/ v2/);
  project.assets[2].content = "x".repeat(30001);
  assert.throws(() => buildDeliveryStoryboard(project), /不能截断/);
  project.assets[2].locked = false;
  assert.throws(() => buildDeliveryStoryboard(project), /已批准的当前分镜全文/);
});

test("delivery reports saved visual reference provenance instead of inferring it from storyboard voices", () => {
  const project = fixture();
  const savedShot = {
    id: "08",
    startSeconds: 39,
    endSeconds: 44,
    durationSeconds: 5,
    storyboardId: "asset-board",
    storyboardVersion: 2,
  };
  project.assets.push({
    id: "video-eight",
    name: "镜头08",
    type: "video",
    version: 1,
    locked: false,
    tags: ["node:video"],
    url: "/api/media/material-eight/file",
    materialId: "material-eight",
    videoShot: {
      ...savedShot,
      id: "stale-shot",
      characters: "长生；老道士（仅声音）",
      voiceOnlyCharacters: ["老道士"],
    },
  });
  project.materials = [
    {
      id: "material-eight",
      assetId: "video-eight",
      status: "local",
      url: "/api/media/material-eight/file",
      referenceAssets: [
        {
          id: "asset-lead",
          name: "长生",
          type: "character",
          version: 2,
          materialId: "material-lead",
          url: "data:image/png;base64,NOT_FOR_CONTEXT",
          content: "private verbose reference",
        },
      ],
      providerTaskId: "minimax-task-eight",
      videoShot: savedShot,
    },
  ];
  const rows = () => JSON.parse(buildMediaInventory(project).split("：\n")[1]);
  const video = rows().find((row) => row.assetId === "video-eight");
  assert.deepEqual(video.referenceAssets, [
    {
      id: "asset-lead",
      name: "长生",
      type: "character",
      version: 2,
      materialId: "material-lead",
    },
  ]);
  assert.equal(video.providerTaskId, "minimax-task-eight");
  assert.deepEqual(video.videoShot, savedShot);
  assert.equal(
    rows()[0].referenceAssets,
    null,
    "legacy material provenance is unknown, not an empty reference list",
  );
  assert.equal(rows()[0].providerTaskId, null);
  assert.match(buildMediaInventory(project), /声音角色不等于图像参考/);
  assert.doesNotMatch(JSON.stringify(video), /老道士|NOT_FOR_CONTEXT|private verbose/);
  project.materials[0].referenceAssets = [];
  assert.deepEqual(
    rows().find((row) => row.assetId === "video-eight").referenceAssets,
    [],
  );
  delete project.materials[0].referenceAssets;
  assert.equal(
    rows().find((row) => row.assetId === "video-eight").referenceAssets,
    null,
  );
});

test("a specified later shot is selected across scene tables with voice-only references excluded", () => {
  const project = fixture(
    "### 序章\n| 镜号 | 时间 | 时长 | 画面 | 制作方式 | 出镜人物 |\n|---|---|---|---|---|---|\n|01|0–3|3|全黑字幕卡|后期制作|无|\n|02|3–7|4|烛火晃动|模型生成|无|\n\n### 门缝\n| 镜号 | 时间 | 时长 | 画面 | 出镜人物 | 声音 |\n|---|---|---|---|---|---|\n|08|39–44|5|长生脸贴在门缝的光里，睫毛轻颤|长生 asset-lead / v2；父亲 asset-other / v2（仅声音）|父亲：正常吗？|\n|09|44–50|6|父亲转身 LATER_PLOT|父亲|无|",
  );
  const result = buildVideoShotRequest(project, { shotId: "8" });
  assert.equal(result.shot.id, "08");
  assert.equal(result.shot.selection, "specified");
  assert.equal(result.shot.startSeconds, 39);
  assert.deepEqual(result.videoOptions, { duration: 5, ratio: "16:9" });
  assert.deepEqual(
    result.references.map((ref) => ref.id),
    ["asset-lead"],
  );
  assert.match(result.prompt, /仅供声音来源.*父亲/);
  assert.doesNotMatch(result.prompt, /烛火晃动|LATER_PLOT/);
  assert.equal(buildVideoShotRequest(project).shot.id, "02");
});

test("specified shot selection rejects absent, malformed, postproduction and stale references before generation", () => {
  const project = fixture(
    "| 镜号 | 时间 | 时长 | 画面 | 制作方式 | 出镜人物 |\n|---|---|---|---|---|---|\n|01|0–3|3|全黑字幕卡|后期制作|无|\n|08|39–44|5|长生推门|模型生成|长生 asset-lead / v1|",
  );
  assert.throws(() => buildVideoShotRequest(project, { shotId: "01" }), /后期制作/);
  assert.throws(
    () => buildVideoShotRequest(project, { shotId: "07" }),
    /未找到镜头 07/,
  );
  assert.throws(
    () => buildVideoShotRequest(project, { shotId: "08" }),
    /当前锁定版本为 v2/,
  );
  for (const shotId of ["0", "-1", "1.5", "1x", "10000"])
    assert.throws(() => buildVideoShotRequest(project, { shotId }), /镜号必须/);
  const section = fixture(
    "### 镜头01（0–3）\n时长：3秒\n画面：全黑字幕卡\n制作方式：后期制作\n### 镜头08（39–44）\n时长：5秒\n画面：长生推门\n人物：长生",
  );
  assert.throws(() => buildVideoShotRequest(section, { shotId: "01" }), /后期制作/);
  assert.equal(buildVideoShotRequest(section, { shotId: "08" }).shot.id, "08");
});

test("list-prefixed shot headings delimit all fields and preserve the requested later shot", () => {
  for (const marker of ["- ", "* ", "### - "]) {
    const project = fixture(
      `${marker}镜头01\n时间：0–5秒\n画面：空庭院\n人物：无\n${marker}镜头02\n时间：5–10秒\n画面：父亲转身\n人物：父亲\n声音：SECOND_SHOT_AUDIO\n运镜：SECOND_SHOT_CAMERA`,
    );
    const first = buildVideoShotRequest(project);
    assert.equal(first.shot.id, "01");
    assert.equal(first.shot.sound, "");
    assert.equal(first.shot.camera, "");
    assert.equal(first.references.length, 0);
    assert.doesNotMatch(first.prompt, /SECOND_SHOT|父亲/);
    assert.equal(
      buildVideoShotRequest(project, { shotId: "02" }).shot.sound,
      "SECOND_SHOT_AUDIO",
    );
  }
});

test("section-format default selection skips postproduction shots and explicit selection refuses them", () => {
  const project = fixture(
    "- 镜头01\n时间：0–2秒\n画面：黑场\n制作方式：后期制作\n人物：无\n- 镜头02\n时间：2–3秒\n画面：静态字卡\n制作方式：后期叠字\n人物：无\n- 镜头03\n时间：3–8秒\n画面：长生推门\n人物：长生",
  );
  const result = buildVideoShotRequest(project);
  assert.equal(result.shot.id, "03");
  assert.equal(result.videoOptions.duration, 5);
  assert.deepEqual(
    result.shot.skippedShots.map((shot) => shot.id),
    ["01", "02"],
  );
  assert.throws(() => buildVideoShotRequest(project, { shotId: "01" }), /后期制作/);
  assert.throws(() => buildVideoShotRequest(project, { shotId: "02" }), /后期制作/);
});

test("each visible character must have its own matching reference without name-ID conflicts", () => {
  const board = (characters, references) =>
    `|镜号|时间|画面|人物|资产引用|\n|---|---|---|---|---|\n|01|0–5秒|长生和父亲面对面|${characters}|${references}|`;
  for (const separator of ["；", "、", "，"]) {
    const characters = `长生${separator}父亲`;
    assert.throws(
      () => buildVideoShotRequest(fixture(board(characters, "asset-lead / v2"))),
      /遗漏出镜人物「父亲」/,
    );
    const result = buildVideoShotRequest(
      fixture(board(characters, "asset-lead / v2；asset-other / v2")),
    );
    assert.deepEqual(
      result.references.map((ref) => ref.name),
      ["长生", "父亲"],
    );
  }
  assert.throws(
    () => buildVideoShotRequest(fixture(board("长生；陌生甲", "asset-lead / v2"))),
    /陌生甲.*唯一匹配/,
  );
  assert.throws(
    () =>
      buildVideoShotRequest(
        fixture(board("长生（asset-other / v2）", "asset-other / v2")),
      ),
    /唯一匹配/,
  );
  assert.throws(
    () =>
      buildVideoShotRequest(
        fixture(board("长生", "asset-lead / v2；asset-other / v2")),
      ),
    /父亲.*未列为出镜人物/,
  );
});

test("missing participants require clarification while explicit empty and voice-only shots remain valid", () => {
  assert.throws(
    () => buildVideoShotRequest(fixture("## 镜头01\n时间：0–5秒\n画面：长生走进房间")),
    /缺少人物栏/,
  );
  assert.throws(
    () =>
      buildVideoShotRequest(
        fixture(
          "|镜号|时间|画面|资产引用|\n|---|---|---|---|\n|01|0–5秒|长生走进房间|asset-lead / v2|",
        ),
      ),
    /缺少人物栏/,
  );
  for (const characters of ["无", "父亲（仅声音，不出现可辨身体）"]) {
    const result = buildVideoShotRequest(
      fixture(`## 镜头01\n时间：0–5秒\n画面：空庭院\n人物：${characters}`),
    );
    assert.equal(result.references.length, 0);
  }
});

test("an explicit character ID disambiguates shared verified titles", () => {
  const project = fixture(
    "|镜号|时间|画面|人物|资产引用|\n|---|---|---|---|---|\n|01|0–5秒|父亲推门|父亲（asset-other / v2）|父亲（asset-other / v2）|",
  );
  project.assets[0].name = "李明";
  project.assets[0].content = "已核实称谓：父亲";
  project.assets[1].name = "张强";
  project.assets[1].content = "已核实称谓：父亲";
  assert.deepEqual(
    buildVideoShotRequest(project).references.map((asset) => asset.id),
    ["asset-other"],
  );
  project.assets[2].content = project.assets[2].content.replaceAll(
    "父亲（asset-other / v2）",
    "父亲",
  );
  assert.throws(() => buildVideoShotRequest(project), /唯一匹配/);
});
