import { activeReference } from "./memory.mjs";

const clean = (value) =>
  String(value || "")
    .replace(/\*\*|`/gu, "")
    .trim();
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/gu, "")
    .split(/(?<!\\)\|/u)
    .map(clean);
const RANGE =
  /(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\s*(?:秒|s)?\s*[-–—~～至]\s*(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\s*(?:秒|s)?/iu;

function seconds(value) {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function timing(rangeText, durationText, label = "首镜") {
  const range = RANGE.exec(clean(rangeText));
  const duration = /^(\d+(?:\.\d+)?)\s*(?:秒|s)?$/iu.exec(clean(durationText));
  const start = range ? seconds(range[1]) : 0;
  const end = range ? seconds(range[2]) : duration ? Number(duration[1]) : NaN;
  if (!Number.isFinite(end) || end <= start || start < 0)
    throw new Error(
      `${label}缺少可解析的起止秒数或时长。请在分镜中明确填写，例如 0–5 秒、时长 5 秒，再重新确认。`,
    );
  if (duration && Math.abs(Number(duration[1]) - (end - start)) > 0.001)
    throw new Error(`${label}起止秒数与标注时长不一致，请修正分镜后重新确认。`);
  return { startSeconds: start, endSeconds: end, durationSeconds: end - start };
}

function firstTableShot(content, requestedId) {
  const lines = content.split(/\r?\n/u);
  const skippedShots = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes("|")) continue;
    const headers = cells(lines[index]);
    const column = (pattern) => headers.findIndex((header) => pattern.test(header));
    const idColumn = column(/^(?:镜号|镜头(?:编号|号)?|编号|shot)$/iu);
    const frameColumn = column(/画面|视觉|内容|描述/u);
    if (idColumn < 0 || frameColumn < 0) continue;
    for (let row = index + 1; row < lines.length && lines[row].includes("|"); row++) {
      const values = cells(lines[row]);
      if (values.every((value) => /^[-: ]+$/u.test(value))) continue;
      const id = /^(?:镜头?|镜号|S|SH)?\s*0*(\d+)$/iu.exec(values[idColumn] || "");
      if (!id) continue;
      if (!requestedId && !skippedShots.length && Number(id[1]) !== 1)
        throw new Error(
          "批准分镜缺少镜头01，请补齐首镜或明确标注前置后期镜头后重新确认。",
        );
      const get = (pattern) =>
        headers
          .flatMap((header, col) =>
            pattern.test(header) && values[col] ? [values[col]] : [],
          )
          .join("；");
      const shotId = id[1].padStart(2, "0");
      const time = get(/起止|时间段|时间码|秒数|时间|^时段$/u);
      const postNote = new RegExp(
        `镜(?:头)?\\s*0*${Number(id[1])}\\s*(?:为|是|[:：])?[^\\n]{0,100}后期制作`,
        "u",
      ).test(clean(content));
      if (
        (/后期(?:制作|叠)/u.test(`${get(/制作|备注|类型/u)} ${values[frameColumn]}`) ||
          postNote) &&
        /^(?:纯黑|全黑|黑场|黑屏|仅字卡|仅字幕卡|静态字卡)/u.test(
          values[frameColumn],
        ) &&
        !/人影|露脸|可辨身体|渐显人物|人物出现/u.test(values[frameColumn])
      ) {
        if (requestedId === shotId)
          throw new Error(`镜头 ${shotId} 已明确安排为后期制作，不能提交视频模型。`);
        skippedShots.push({
          id: shotId,
          frame: values[frameColumn],
          reason: "分镜已明确标注后期制作",
        });
        continue;
      }
      if (requestedId && requestedId !== shotId) continue;
      return {
        id: shotId,
        skippedShots,
        ...timing(time, get(/^时长|持续/u), requestedId ? `镜头 ${shotId}` : "首镜"),
        frame: values[frameColumn],
        action: get(/动作/u),
        sound: get(/对白|声音|音效|台词|旁白/u),
        camera: get(/运镜|机位|镜头运动/u),
        shotSize: get(/景别/u),
        characters: get(/出镜|人物|角色/u),
        assetReferences: get(/资产|参考|引用/u),
      };
    }
  }
  return undefined;
}

function firstSectionShot(content, requestedId) {
  const lines = content.split(/\r?\n/u);
  const target = new RegExp(
    `^(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:镜头|镜号|镜)\\s*0*${Number(requestedId || 1)}(?:\\D|$)`,
    "u",
  );
  const start = lines.findIndex((line) => target.test(clean(line)));
  if (start < 0) return undefined;
  const next = lines.findIndex(
    (line, index) =>
      index > start && /^(?:#{1,6}\s*)?(?:镜头|镜号|镜)\s*\d+/u.test(clean(line)),
  );
  const block = lines.slice(start, next < 0 ? undefined : next).join("\n");
  const field = (label) => {
    const match = new RegExp(`^(?:[-*]\\s*)?(?:${label})\\s*[:：]\\s*(.+)$`, "mu").exec(
      block.split("\n").map(clean).join("\n"),
    );
    return match?.[1]?.trim() || "";
  };
  const frame = field("画面(?:与声音)?|画面描述|视觉内容|内容");
  if (
    requestedId &&
    /后期(?:制作|叠)/u.test(`${field("制作方式|制作|类型|备注")} ${frame}`) &&
    /^(?:纯黑|全黑|黑场|黑屏|仅字卡|仅字幕卡|静态字卡)/u.test(frame) &&
    !/人影|露脸|可辨身体|渐显人物|人物出现/u.test(frame)
  )
    throw new Error(`镜头 ${requestedId} 已明确安排为后期制作，不能提交视频模型。`);
  return {
    id: requestedId || "01",
    ...timing(
      field("起止秒数|起止时间|时间段|时间码|秒数|时间|时段") || clean(lines[start]),
      field("时长"),
      requestedId ? `镜头 ${requestedId}` : "首镜",
    ),
    frame,
    action: field("动作|人物动作"),
    sound: field("对白|声音|音效|台词|旁白|对白与音效"),
    camera: field("运镜|机位|镜头运动"),
    shotSize: field("景别"),
    characters: field("出镜角色|出镜人物|人物|角色"),
    assetReferences: field("角色资产|资产引用|参考资产|引用"),
  };
}

function aliases(asset) {
  return [
    asset.name,
    ...String(asset.content || "").matchAll(/^已核实称谓：([^\n]+)$/gmu),
  ]
    .map((value) => (typeof value === "string" ? value : value[1].trim()))
    .filter(Boolean);
}

function participantEntries(value) {
  return clean(value)
    .split(/[；;]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function voiceOnly(entry) {
  return (
    /仅画外音|仅声音|画外音|不出镜|无形象|不出现可辨身体|仅声|画外/u.test(entry) &&
    !/手部|手指入画|背影|身体入画/u.test(entry)
  );
}

function currentApprovedStoryboard(project) {
  const candidates = (project.assets || []).filter(
    (asset) =>
      asset.type === "storyboard" &&
      activeReference(asset) &&
      asset.tags.includes("node:storyboard"),
  );
  const output = project.nodes?.find((node) => node.id === "storyboard")?.output;
  return (
    candidates.find((asset) => asset.content === output) ||
    candidates.toSorted((a, b) => (b.version || 0) - (a.version || 0))[0]
  );
}

export function buildDeliveryStoryboard(project) {
  const board = currentApprovedStoryboard(project);
  if (!board?.content?.trim())
    throw new Error("制作交付需要已批准的当前分镜全文，请先确认逐镜分镜。");
  if (board.content.length > 30000)
    throw new Error(
      "当前分镜超过交付节点的 30000 字符上限，不能截断后生成交付清单；请先整理为保留全部镜号、时段与对白的完整分镜再确认。",
    );
  return `当前已批准分镜全文（${board.id} / v${board.version}）：\n以下全文是逐镜时间、对白及剪辑决定表的唯一分镜依据；不得用上方历史消息或摘要补写、合并镜号或改变时间。分镜计划不代表媒体已生成，制作状态以实际媒体台账为准。\n\n${board.content}`;
}

export function buildVideoShotRequest(project, { shotId } = {}) {
  if (shotId !== undefined && !/^(?:0*[1-9]\d{0,3})$/u.test(String(shotId)))
    throw new Error("镜号必须是 1–9999 的整数，例如 08。");
  const requestedId =
    shotId === undefined ? undefined : String(Number(shotId)).padStart(2, "0");
  const board = currentApprovedStoryboard(project);
  if (!board) throw new Error("视频制作需要已批准的当前分镜，请先确认逐镜分镜。");
  const shot =
    firstTableShot(board.content, requestedId) ||
    firstSectionShot(board.content, requestedId);
  if (!shot?.frame?.trim())
    throw new Error(
      requestedId
        ? `当前批准分镜中未找到镜头 ${requestedId} 的可解析画面、镜号和时间，请核对镜号。`
        : "当前批准分镜未提供可解析的首镜画面、镜号和时间。请以逐镜表格或“镜头01”分节补全，不能将整集剧情直接提交视频模型。",
    );
  const label = requestedId ? `镜头 ${shot.id}` : "首镜";
  const ratio = project.productionBrief?.aspectRatio;
  if (!ratio || ratio === "adaptive")
    throw new Error("视频制作缺少已确认画幅，请先确认本轮制作方案。");
  const visibleCharacters = participantEntries(shot.characters)
    .filter((entry) => !voiceOnly(entry))
    .join("；");
  const visibleAssetReferences = participantEntries(shot.assetReferences)
    .filter((entry) => !voiceOnly(entry))
    .join("；");
  shot.visibleCharacters = visibleCharacters;
  shot.voiceOnlyCharacters = participantEntries(shot.characters).filter(voiceOnly);
  const visual = [shot.frame, shot.action, shot.characters, shot.assetReferences].join(
    "\n",
  );
  const standards = (project.assets || []).filter(
    (asset) => ["character", "scene"].includes(asset.type) && activeReference(asset),
  );
  for (const id of (visual.match(/asset-[A-Za-z0-9-]+/gu) || []).map((value) =>
    value.replace(/-v\d+$/iu, ""),
  ))
    if (!standards.some((asset) => asset.id === id))
      throw new Error(
        `${label}引用资产「${id}」未锁定、已过期或不存在，请修正分镜引用后重新确认。`,
      );
  const selected = standards.filter((asset) => {
    const scope =
      asset.type === "character" && asset.characterDesign?.subjectType !== "object"
        ? shot.assetReferences
          ? visibleAssetReferences
          : shot.characters
            ? visibleCharacters
            : visual
        : visual;
    return (
      scope.includes(asset.id) || aliases(asset).some((name) => scope.includes(name))
    );
  });
  if (
    visibleCharacters &&
    !/^(?:无|无人|空镜|无人物|无角色|—|-)$/u.test(visibleCharacters) &&
    !selected.some((asset) => asset.type === "character")
  )
    throw new Error(
      `${label}出镜人物「${shot.characters}」尚未匹配到有效锁定角色，请在分镜中标明角色姓名、资产 ID 和版本。`,
    );
  for (const asset of selected) {
    if (!asset.url)
      throw new Error(
        `${label}角色或场景「${asset.name}」只有文字设定，没有已确认参考图片，请先生成并确认图片。`,
      );
    const version = new RegExp(
      `${asset.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^\n,，;；|]{0,20}?[-/／·\\s]v(\\d+)`,
      "iu",
    ).exec(visual);
    if (version && Number(version[1]) !== asset.version)
      throw new Error(
        `${label}引用「${asset.name}」v${version[1]}，当前锁定版本为 v${asset.version}，请重新确认分镜引用。`,
      );
  }
  const references = selected.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    version: asset.version,
    locked: true,
    url: asset.url,
    ...(asset.materialId ? { materialId: asset.materialId } : {}),
    content: asset.characterDesign?.baseAppearance || asset.content,
  }));
  const prompt = [
    `只生成已批准分镜中的镜头 ${shot.id}，时长 ${shot.durationSeconds} 秒，画幅 ${ratio}。本次仅制作这一镜，不混入其他场景、后续剧情或整集内容。`,
    `画风：${project.productionBrief?.style || project.style}。`,
    project.visualStyleGuide &&
      `基础角色设计背景资料（仅沿用共通画风与人物识别特征；其中浅灰/纯色背景、正面全身、中性表情、均匀照明、基础图不画逆光剪影等要求只用于角色设定图，不适用于本镜；视频环境、构图、动作、表情与光照必须服从下面的已批准分镜）：\n${project.visualStyleGuide}`,
    `画面：${shot.frame}`,
    shot.action && `动作：${shot.action}`,
    shot.shotSize && `景别：${shot.shotSize}`,
    shot.camera && `运镜：${shot.camera}`,
    `声音：${shot.sound || "本镜未明确声音安排；不擅自补写对白或旁白。"}`,
    visibleCharacters
      ? `出镜人物：${visibleCharacters}`
      : "出镜人物：当前分镜未安排可辨人物，不增加人脸或身体。",
    shot.voiceOnlyCharacters.length &&
      `仅供声音来源，不生成其形象：${shot.voiceOnlyCharacters.join("；")}`,
    references.length
      ? `本镜参考图对应关系：\n${references.map((ref, index) => `图片${index + 1}＝${ref.name}（${ref.id} / v${ref.version}）；只引用其已批准基础身份，本镜动作与状态按上述分镜。`).join("\n")}`
      : "本镜没有匹配的角色或场景参考图。仅制作上述画面，不自行增加人物。",
    "保持主体身份、五官、发型、服装和道具一致。参考图是身份依据，不是拼接画面；不要把设定图白底或其他镜头带入当前场景。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    prompt,
    references,
    videoOptions: { duration: shot.durationSeconds, ratio },
    shot: {
      ...shot,
      selection: requestedId ? "specified" : "first-generated",
      storyboardId: board.id,
      storyboardVersion: board.version,
    },
  };
}

export function buildMediaInventory(project) {
  const assets = (project.assets || []).filter(
    (asset) => asset.url && !asset.tags.includes("历史版本"),
  );
  const inventory = assets.map((asset) => {
    const materials = project.materials || [];
    // A declared material ID identifies a version; an older capture can share
    // the asset ID after regeneration and must never override that binding.
    const matchingAsset = materials.filter((item) => item.assetId === asset.id);
    const material = asset.materialId
      ? materials.find((item) => item.id === asset.materialId)
      : materials.find(
          (item) => item.url === asset.url || item.sourceUrl === asset.url,
        ) ||
        (matchingAsset.length === 1 &&
        !matchingAsset[0].url &&
        !matchingAsset[0].sourceUrl
          ? matchingAsset[0]
          : undefined);
    const missingDeclaredMaterial = Boolean(asset.materialId && !material);
    const videoShot = material?.videoShot || asset.videoShot;
    return {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      referenceStatus: asset.tags.includes("历史版本")
        ? "历史版本"
        : asset.tags.includes("待更新")
          ? "待更新"
          : asset.locked
            ? "已确认标准"
            : "尚未人工验收",
      url: asset.url.startsWith("data:") ? "内嵌媒体，见资产库" : asset.url,
      materialId: material?.id || asset.materialId || null,
      referenceAssets: Array.isArray(material?.referenceAssets)
        ? material.referenceAssets.map(({ id, name, type, version, materialId }) => ({
            id,
            name,
            type,
            version,
            ...(materialId ? { materialId } : {}),
          }))
        : null,
      providerTaskId: material?.providerTaskId || null,
      storageStatus:
        material?.status ||
        (missingDeclaredMaterial ? "素材记录缺失" : "仅记录远程地址，未验证下载"),
      ...(material?.error || missingDeclaredMaterial
        ? {
            storageError:
              material?.error || "资产声明的素材 ID 不存在，不能改用其他版本的素材。",
          }
        : {}),
      ...(videoShot
        ? {
            videoShot: Object.fromEntries(
              [
                "id",
                "startSeconds",
                "endSeconds",
                "durationSeconds",
                "storyboardId",
                "storyboardVersion",
              ]
                .filter((key) => videoShot[key] !== undefined)
                .map((key) => [key, videoShot[key]]),
            ),
          }
        : {}),
    };
  });
  return `实际媒体台账（直接来自已保存记录，不是创作提案；未人工验收不等于可交付，下载失败不得声称本地已保存，单个镜头不等于整集成片。referenceAssets 是实际提交的图像参考清单，只能按其记录报告，不能从分镜计划、人物栏、对白或画外音补入角色；声音角色不等于图像参考。referenceAssets 为 [] 表示明确未提交参考图，为 null 表示历史记录未知，不能推断为零或按分镜补全。providerTaskId 是已保存的供应商任务 ID；videoShot 是实际请求的镜号和时间参数，不是实测成片时长）：\n${JSON.stringify(inventory, null, 2)}`;
}
