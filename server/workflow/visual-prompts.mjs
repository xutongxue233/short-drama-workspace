import { activeReference } from "./memory.mjs";
import { episodeDecisions, episodeMessages } from "./episode-scope.mjs";

export const VISUAL_PROMPT_VERSION = "visual-v4";

export const VISUAL_PROMPT_BUDGETS = Object.freeze({
  character: 7000,
  storyboard: 10000,
});

const VISUAL =
  /风格|画风|写实|二次元|漫画|真人|剪影|血腥|构图|镜头|视觉|色调|光线|背景|服装|衣|发型|面貌|肤色|道具|年龄|岁|手持|佩戴|禁止|不得|不能|不要|不画|别画|去掉|保留/;
const VISUAL_SUBJECT =
  /风格|画风|写实|二次元|漫画|真人|剪影|血腥|构图|画面|视觉|色调|光线|背景|服装|衣|发型|面貌|肤色|道具|年龄|岁|手持|佩戴|身形|妆容|表情|形制|材质|定妆/;
const HARD =
  /(?:\d+|[零一二三四五六七八九十百两]+)\s*岁|年龄|不得|禁止|不能|不要|不画|别画|不可|不出现|不携带|不持有|不添加|不提前|仅[有用带持]|只有|只[有用带持]|去掉|移除|必须|固定|始终/;
const OMITTED = "\n[只保留与画面相关的节选；未列出的内容不可自行补成剧情设定。]";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function activeAssets(project, type) {
  return (project.assets || []).filter(
    (asset) => (!type || asset.type === type) && activeReference(asset),
  );
}

function approvedScript(project) {
  const candidates = activeAssets(project, "script").filter((asset) =>
    asset.tags.includes("node:adaptation"),
  );
  const current = project.nodes?.find((node) => node.id === "adaptation")?.output;
  return (
    candidates.find((asset) => asset.content === current) ||
    candidates.toSorted((a, b) => (b.version || 0) - (a.version || 0))[0]
  );
}

// Sentence-sized fragments let a restriction at the end of a long card compete
// on relevance, instead of being lost to an arbitrary prefix slice.
function fragments(value) {
  return [
    ...new Set(
      text(value)
        .replace(/data:[^\s)]+/g, "[参考图片数据]")
        .replace(/https?:\/\/[^\s)]+/g, "[素材链接]")
        .split(/\n+|(?<=[。！？；])/u)
        .flatMap((part) => part.match(/[\s\S]{1,360}/gu) || [])
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function matches(value, names) {
  return names.some((name) => name && value.includes(name));
}

function subjectNames(character) {
  const names = [text(character.name)];
  const source = `${text(character.description)}\n${text(character.content)}`;
  for (const match of source.matchAll(/^已核实称谓：([^\n]+)$/gmu))
    names.push(match[1].trim());
  for (const match of source.matchAll(
    /(?:小名|乳名|昵称|又名|化名|别名|原名)\s*(?:为|是|叫|[:：])?\s*[“「]?([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z·]{0,11})/gu,
  ))
    names.push(match[1]);
  return [...new Set(names.filter(Boolean))];
}

function excerpt(value, budget, { names = [], visual = true, essential = false } = {}) {
  const parts = fragments(value);
  const whole = parts.join("\n");
  if (whole.length <= budget) return whole;
  const capacity = Math.max(0, budget - OMITTED.length);
  const ranked = parts.map((part, index) => ({
    part,
    index,
    hard: HARD.test(part),
    score:
      (HARD.test(part) ? 20 : 0) +
      (matches(part, names) ? 8 : 0) +
      (visual && VISUAL.test(part) ? 4 : 0) +
      (index === 0 || index === parts.length - 1 ? 2 : 0),
  }));
  const required = essential ? ranked.filter((item) => item.hard) : [];
  if (required.reduce((sum, item) => sum + item.part.length + 1, 0) > capacity)
    throw new Error(
      "角色图片的明确约束过长，无法完整传给图片模型。请精简角色设定中的重复约束后重试。",
    );
  const chosen = new Map(required.map((item) => [item.index, item]));
  let remaining =
    capacity - required.reduce((sum, item) => sum + item.part.length + 1, 0);
  for (const item of ranked.toSorted(
    (a, b) => b.score - a.score || a.index - b.index,
  )) {
    if (chosen.has(item.index) || item.part.length + 1 > remaining) continue;
    chosen.set(item.index, item);
    remaining -= item.part.length + 1;
  }
  return `${[...chosen.values()]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.part)
    .join("\n")}${OMITTED}`;
}

function related(value, names) {
  const parts = fragments(value);
  return parts.filter((part) => matches(part, names)).join("\n");
}

function visualFeedback(project, names = []) {
  const otherNames = activeAssets(project, "character")
    .flatMap(subjectNames)
    .filter((name) => !names.includes(name));
  const candidates = [
    ...episodeDecisions(project),
    ...episodeMessages(project)
      .filter((message) => message.agentId === "user" && message.type === "text")
      .slice(-8)
      .map((message) => message.content),
  ];
  // Feedback may combine a visual correction with writing/approval instructions.
  // Filter individual sentences by a visual subject, not a generic "不要" or
  // the routing label (for example "用户对「角色定妆」的返修要求").
  const sentences = candidates.flatMap((value) =>
    fragments(value).map((part) =>
      part
        .replace(/^用户对「[^」]+」的(?:返修要求|确认备注)[:：]\s*/u, "")
        .replace(/^用户反馈（交给[^）]+）[:：]\s*/u, "")
        .replace(/^[@＠][^\s，,:：]+[\s，,:：]*/u, ""),
    ),
  );
  return [...new Set(sentences)]
    .filter(
      (value) =>
        VISUAL_SUBJECT.test(value) &&
        (!names.length || matches(value, names) || !matches(value, otherNames)),
    )
    .slice(-4)
    .join("\n");
}

function projectVisuals(project) {
  const brief = project.productionBrief;
  return [
    `项目：${text(project.name)}。画面风格：${text(brief?.style) || text(project.style) || "按角色设定"}。`,
    brief?.episodeCount === 1
      ? `已确认制作参数：${brief.aspectRatio}，本集 ${brief.durationSeconds} 秒；只制作本次原文范围。`
      : "制作参数尚未确认；本次只按现有设定生成待确认图片。",
    "项目名仅用于归属，不根据标题想象角色、场景或道具。年龄、时代、身份、服装与道具以当前批准剧本和锁定设定为准；设定卡中无依据的外观是待确认设计，不能覆盖剧本事实。",
  ].join("\n");
}

const SCENE_PRESENTATION =
  /逆光|剪影|尸斑|尸变|全黑眼球|黑眼球|半脸遮挡|恐怖|惊恐|诡异|狰狞|血污|流血|血腥|现形|鬼脸|鬼化|门框|门后|门口|夜间状态|破损状态|戏剧光|剧情状态|本轮出场状态|动作姿态|奔跑|逃离|扑向|追逐|举符|贴符|音效|反应镜头/;
const OBJECT_SUBJECT = /神像|佛像|雕像|塑像|泥塑|木雕|石雕|牌位|器物|道具/;

function structuredDesign(character) {
  const design = character.characterDesign;
  return design?.version === 1 && text(design.baseAppearance) ? design : undefined;
}

// Legacy cards mix identity, costume and shot direction in free text. Keep their
// useful facts, but never promote a dramatic presentation into a baseline image.
function baselineFragments(value) {
  return fragments(value)
    .map((part) =>
      part
        .split(/(?<=[，,])/u)
        .filter((clause) => !SCENE_PRESENTATION.test(clause))
        .join(""),
    )
    .filter(Boolean)
    .join("\n");
}

function identityEvidence(character) {
  const identityLines = fragments(character.content).filter((part) =>
    /^(?:角色|已核实称谓|角色来源|身份与关系)[:：]/u.test(part),
  );
  return baselineFragments([text(character.description), ...identityLines].join("\n"));
}

function ageEvidence(value, names) {
  const ages = [];
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A shared scene can mention several ages. Only read an age directly tied
    // to this subject, never every age from a paragraph where they appear.
    const pattern = new RegExp(
      `${escapedName}[（(\\s]*(?:(?:今年|此时|现年|年龄|刚满|大约|约|只有|仅|才|已满|已经|是|为)[：:\\s]*)*` +
        "((?:\\d+|[零一二三四五六七八九十百两]+)\\s*岁(?:儿童|男孩|女孩|少年|少女)?)",
      "gu",
    );
    for (const match of text(value).matchAll(pattern)) ages.push(match[1]);
  }
  return [...new Set(ages)].join("、");
}

function baselineProjectVisuals(project) {
  const style = text(project.productionBrief?.style) || text(project.style);
  const guide = text(project.visualStyleGuide);
  return [
    `项目：${text(project.name)}。项目画风：${style || "按角色设定"}。`,
    guide && `项目统一视觉标准：${guide}`,
    /赛璐璐/.test(guide || style) &&
      "二维赛璐璐动画角色设计：清晰且线宽稳定的线稿，平涂色块，克制且边界清楚的有限层次阴影；保持简洁明确的色板。禁止照片质感、写实摄影、3D 渲染、厚涂笔触和复杂渐变。",
    project.productionBrief?.aspectRatio &&
      `项目成片画幅：${project.productionBrief.aspectRatio}；本次构图以完整展示单个基础角色为准。`,
    "项目名只用于归属，不根据标题补造造型。年龄、时代与身份遵守已确认事实；未说明的外观是待审核的设计提案。剧情中的特殊状态、恐怖表现和镜头光效留到分镜或状态变体，本次不绘制。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Only approved baseline portraits can condition a new baseline portrait. */
export function selectCharacterBaseReferences(project, character, references = []) {
  const names = subjectNames(character);
  return references.filter((reference) => {
    const asset = activeAssets(project, "character").find(
      (item) => item.id === reference.id,
    );
    return asset && names.includes(asset.name) && structuredDesign(asset);
  });
}

function finish(parts, limit) {
  const prompt = parts.filter(Boolean).join("\n\n");
  // Fail explicitly rather than silently slicing away a required restriction.
  if (prompt.length > limit)
    throw new Error("当前图片提示词超过预算，请精简视觉设定后重试。");
  return prompt;
}

/** A single-subject visual brief; never includes the full workflow/chat context. */
export function buildCharacterImagePrompt(
  project,
  character,
  { references = [], compact = false } = {},
) {
  const names = subjectNames(character);
  const design = structuredDesign(character);
  const object = design
    ? design.subjectType === "object"
    : OBJECT_SUBJECT.test(`${text(character.name)} ${text(character.description)}`);
  const script = approvedScript(project);
  const scriptEvidence = related(script?.content || "", names);
  const facts = related((project.memory?.facts || []).join("\n"), names);
  const card = `${text(character.description)}\n${text(character.content)}`;
  const locked = activeAssets(project, "character").find(
    (asset) => names.includes(asset.name) && structuredDesign(asset),
  );
  const sourceEvidence = script
    ? scriptEvidence
    : related(
        (project.chapters || []).map((chapter) => chapter.content).join("\n"),
        names,
      );
  const baselineCard = baselineFragments(card);
  const baselineSource = baselineFragments(sourceEvidence);
  const baselineFacts = baselineFragments(facts);
  const restrictions = fragments(`${baselineSource}\n${baselineFacts}\n${baselineCard}`)
    .filter((part) => HARD.test(part))
    .join("\n");
  const allowedReferences = selectCharacterBaseReferences(
    project,
    character,
    references,
  );
  const feedback = baselineFragments(visualFeedback(project, names));
  if (compact) {
    // Short-limit image APIs need fewer layout instructions, not truncated identities.
    // Keep all supplied baseline facts; the adapter rejects an overlong result.
    return [
      `绘制「${text(character.name)}」单主体基础定妆图。整张图片中主体只出现一次，居中独立展示。`,
      object
        ? "这是静物，保留形制材质，完整展示，不拟人化、不加人物。"
        : "唯一构图：一个人物、一个正面、从头到脚全身，自然站姿，双臂微分、手脚完整、五官发型服装清楚，中性表情。不要在旁边再画侧面、背面、第二个人或第二个视角。",
      "浅灰纯色背景，均匀照明。只画一种基础造型，不画剧情动作、剪影、尸变、血污、戏剧光、场景、三视图拼板、字幕、水印或未设定道具。",
      `画风：${text(project.productionBrief?.style) || text(project.style)}。${text(project.visualStyleGuide)}`,
      /赛璐璐/.test(`${project.visualStyleGuide || ""} ${project.style || ""}`) &&
        "清晰线稿、平涂、有限硬边阴影；不画照片、3D、厚涂或复杂渐变。",
      locked &&
        locked.characterDesign.baseAppearance !== design?.baseAppearance &&
        `锁定标准：${locked.characterDesign.baseAppearance}`,
      `基础外观：${design?.baseAppearance || baselineCard}`,
      !object &&
        "服装逐层对应上述设定：内衣与外衣的颜色、衣长、袖长、领型、开合结构不得互换，不增加新衣层。外穿坎肩或马甲若在设定中出现，必须是无袖外层，露出内层衣袖，不能改为长袖外套。",
      design && identityEvidence(character) && `身份：${identityEvidence(character)}`,
      ageEvidence(sourceEvidence, names) &&
        `来源年龄：${ageEvidence(sourceEvidence, names)}，不可更改。`,
      !design && restrictions && `明确约束：${restrictions}`,
      !design && baselineFacts && `事实：${baselineFacts}`,
      !design && feedback && `基础外观反馈：${feedback}`,
      allowedReferences.length
        ? "参考图为同名已批准基础图，逐项复现面貌、发型、身形及服装结构和配色，不能只取相似脸型后重新设计衣服；保持本次单人正面构图。"
        : "无同名已批准参考，按以上外观绘制，不借用其他角色。",
      "不改姓名、年龄，不合并其他关系人物，不补造后续装备。场景状态不覆盖基础面貌。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return finish(
    [
      `生成一张「${text(character.name)}」的单一主体定妆图，用作可复用的基础角色设计标准。画面只有这个主体的一种基础造型。`,
      object
        ? "非人物主体保持设定中的形制、材质和静物状态，不要拟人化为真人或补画其他人物。完整展示物体，结构与材质清楚，不添加人物的站姿、表情或肢体。"
        : "正面全身，自然站姿，双臂略微分开、双手可辨；完整展示头顶到双脚，四周留有余量。面部五官、发型轮廓、服装结构和身形比例清楚可辨，中性表情，视线平视。",
      "浅灰纯色背景，均匀工作室光，中性色调；不使用门框或叙事场景，不画剧情动作，不使用戏剧光、逆光、剪影、夸张透视或遮脸构图。不是海报、分镜、三视图拼板或文字设定卡，不画字幕、水印、说明文字，不拼接多个角度或状态。",
      baselineProjectVisuals(project),
      !design &&
        restrictions &&
        `不可擅改的当前主体约束（剧本事实优先于外观提案）：\n${excerpt(restrictions, 1500, { names, essential: true })}`,
      locked &&
        `同名角色的有效锁定基础标准：\n${excerpt(locked.characterDesign.baseAppearance, 750, { names, essential: true })}`,
      design
        ? `当前主体的基础外观（与场景状态分开，按这一套固定设计绘制）：\n${excerpt(design.baseAppearance, 2000, { names, essential: true })}`
        : `当前主体的身份与基础外观提案：\n${excerpt(baselineCard, 2000, { names, essential: true })}`,
      design &&
        identityEvidence(character) &&
        `当前主体的来源身份：\n${excerpt(identityEvidence(character), 500, { names })}`,
      design &&
        ageEvidence(sourceEvidence, names) &&
        `当前批准来源的年龄事实：${ageEvidence(sourceEvidence, names)}。不可改成其他年龄段。`,
      !design &&
        baselineSource &&
        `${script ? `当前已批准剧本 v${script.version} 中的基础身份与外观依据` : "尚无已批准剧本，仅供复核的原文基础身份依据"}（其他名字只说明关系；动作和出场状态不属于基础设计）：\n${excerpt(baselineSource, 750, { names })}`,
      !design &&
        baselineFacts &&
        `该主体的项目事实：\n${excerpt(baselineFacts, 300, { names, essential: true })}`,
      !design &&
        feedback &&
        `最近基础外观反馈（不改变本次标准站姿与布光）：\n${excerpt(feedback, 500, { names, essential: true })}`,
      allowedReferences.length
        ? `随请求附带的同名基础参考：${allowedReferences.map((reference) => reference.name).join("、")}。只沿用已确认的身份、面貌、发型、身形与服装；维持本次标准构图。`
        : "没有可用的已确认同名基础参考图；严格按当前基础外观绘制，不借用其他角色的面孔或历史剧情图的光效。",
      "本次只制作基础设计。场景状态单独保存，不能覆盖基础面貌。除基础外观明确列出的固有配饰外不添加剧情道具；不要根据后续剧情补造装备，不改名，不改变年龄段，不合并关系角色。最终图片仍需人工核对并批准，生成请求本身不代表形象已锁定。",
    ],
    VISUAL_PROMPT_BUDGETS.character,
  );
}

function firstEpisode(content) {
  const body = text(content);
  const match =
    /(?:^|\n)(#{1,4})\s*(?:第[一1]集|首集|本集).*?(?:完整剧本|剧本正文)[^\n]*\n/u.exec(
      body,
    );
  const section = match ? body.slice(match.index + match[0].length) : body;
  const boundary = match
    ? new RegExp(`\\n#{1,${match[1].length}}\\s+`, "u").exec(section)
    : /(?:^|\n)#{1,4}\s*第[二2]集/u.exec(section);
  return boundary ? section.slice(0, boundary.index) : section;
}

function storyExcerpt(content, budget) {
  if (content.length <= budget) return content;
  const scenes = content
    .split(
      /(?=(?:^|\n)#{1,6}\s*(?:场[景次]?\s*[0-9一二三四五六七八九十]|第[0-9一二三四五六七八九十]+场|镜头\s*[0-9一二三四五六七八九十]))/u,
    )
    .filter((scene) => scene.trim());
  if (scenes.length > 1) {
    const each = Math.floor((budget - OMITTED.length) / scenes.length);
    if (each >= 120)
      return scenes.map((scene) => excerpt(scene, each)).join("\n") + OMITTED;
  }
  const available = budget - OMITTED.length;
  return `${content.slice(0, Math.floor(available * 0.55))}\n${content.slice(-Math.floor(available * 0.45))}${OMITTED}`;
}

/** Image nodes receive a visual board brief, never writing-agent instructions. */
export function buildStoryboardImagePrompt(project) {
  const script = approvedScript(project);
  if (!script) throw new Error("分镜生图需要当前已批准剧本，请先确认剧本后再生成。");
  const story = firstEpisode(script.content);
  const characters = activeAssets(project, "character").filter((asset) =>
    matches(story, subjectNames(asset)),
  );
  const characterBudget = Math.max(
    100,
    Math.floor(1800 / Math.max(characters.length, 1)),
  );
  const board = activeAssets(project, "storyboard").at(-1);
  return finish(
    [
      "生成当前短剧本集的分镜画面板。沿批准剧本场次顺序分格，每格只画对应镜头的动作、空间和情绪，保留开场、转折与结尾因果；不是题材海报，也不是无关风景拼贴。不要生成文字表格、对白文字、水印或改写剧本。",
      projectVisuals(project),
      `当前已批准剧本 v${script.version} · 本集画面依据（只用这个版本）：\n${storyExcerpt(story, 5000)}`,
      characters.length &&
        `本集出场角色的有效锁定标准摘要，逐人保持脸型、年龄、服装和道具一致；同时对照随请求附带的同名参考图：\n${characters.map((asset) => `「${asset.name}」：${excerpt(asset.content, characterBudget, { names: subjectNames(asset) })}`).join("\n")}`,
      board &&
        `已批准分镜构图与运镜依据（不得覆盖批准剧本）：\n${excerpt(board.content, 900)}`,
      visualFeedback(project) &&
        `最近视觉反馈：\n${excerpt(visualFeedback(project), 750, { essential: true })}`,
      "各格人物、动作、地点和关键物件必须能对应到上述剧本，不添加未出场角色、未来剧情道具或无依据的年龄变化。剧本仅有声音、剪影或反应镜头时，按隐喻画面呈现，不替换为直接展示的事件。各格使用已确认画幅的构图与相同画风。",
    ],
    VISUAL_PROMPT_BUDGETS.storyboard,
  );
}
