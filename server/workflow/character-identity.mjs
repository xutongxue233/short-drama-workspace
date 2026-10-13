import { activeReference } from "./memory.mjs";

const LABELS = {
  novel: "原著角色",
  adaptation: "改编新增角色（已批准剧本）",
  locked: "已锁定角色",
};
const TITLES = [
  "爷爷",
  "奶奶",
  "外公",
  "外婆",
  "父亲",
  "母亲",
  "爸爸",
  "妈妈",
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "丈夫",
  "妻子",
  "儿子",
  "女儿",
  "老道士",
  "小道士",
  "道士",
  "师父",
  "师傅",
  "师兄",
  "师姐",
  "师弟",
  "师妹",
  "村长",
  "邻居",
  "管家",
  "老师",
  "医生",
  "掌柜",
  "老板",
];
const TITLE_ALIASES = [
  ["父亲", "爸爸", "爹", "爸"],
  ["母亲", "妈妈", "娘", "妈"],
  ["爷爷", "祖父"],
  ["奶奶", "祖母"],
];
const COLLECTIVES = [
  "家人",
  "家属",
  "全家人",
  "父母",
  "爸妈",
  "村民",
  "群众",
  "路人",
  "保镖",
  "护卫",
  "侍卫",
  "士兵",
  "仆人",
  "随从",
  "同学",
  "记者",
  "医护人员",
  "恶霸",
];

function normalized(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function components(name) {
  const match = /^([^()]+)\(([^()]+)\)$/.exec(name);
  if (!match) return [name];
  const outside = match[1].trim();
  const inside = match[2].trim();
  // Age is descriptive metadata, never a second identity or an alias.
  if (/^(?:\d{1,3}|[一二三四五六七八九十百零两]{1,4})\s*岁$/.test(inside))
    return [outside];
  return [outside, inside];
}

function approvedScript(project) {
  const scripts = (project.assets || []).filter(
    (asset) =>
      asset.type === "script" &&
      activeReference(asset) &&
      asset.tags.includes("node:adaptation"),
  );
  const current = project.nodes?.find((node) => node.id === "adaptation")?.output;
  return (
    scripts.find((asset) => current && asset.content === current) ||
    scripts.toSorted((a, b) => (b.version || 0) - (a.version || 0))[0]
  );
}

function sources(project) {
  const locked = (project.assets || []).filter(
    (asset) => asset.type === "character" && activeReference(asset),
  );
  const script = approvedScript(project);
  return [
    ...locked.map((asset) => ({
      kind: "locked",
      asset,
      text: normalized(
        `${asset.name}\n${asset.description || ""}\n${asset.content || ""}`,
      ),
    })),
    ...(project.chapters || []).map((chapter) => ({
      kind: "novel",
      text: normalized(chapter.content),
    })),
    ...(script ? [{ kind: "adaptation", text: normalized(script.content) }] : []),
  ];
}

function explicitIdentity(text, first, second) {
  const end = '(?=$|[\\s，,。！？!?；;：:“”"「」()])';
  for (const [left, right] of [
    [first, second],
    [second, first],
  ]) {
    const a = escaped(left);
    const b = escaped(right);
    const predicate =
      "(?:本名|原名|真名|姓名|全名|名字|名叫|名为|叫做|又名|别名|化名|小名|乳名|昵称|就是|也就是|即|实为|叫|是)";
    if (
      new RegExp(
        `${a}\\s*[,，:：]?\\s*${predicate}\\s*(?:为|是|叫|[:：])?\\s*(?:我的|我们家的)?[“"「]?${b}${end}`,
        "u",
      ).test(text)
    )
      return true;
  }
  const title = TITLES.includes(first)
    ? first
    : TITLES.includes(second)
      ? second
      : null;
  if (!title) return false;
  const person = title === first ? second : first;
  const t = escaped(title);
  const p = escaped(person);
  // Apposition in the source is explicit; mere occurrence in the same paragraph is not.
  if (
    new RegExp(
      `(?:${t}\\(${p}\\)|${p}\\(${t}\\)|${t}${p}${end}|${p}${t}${end})`,
      "u",
    ).test(text)
  )
    return true;
  // A quoted name followed by narration identifying its addressee, e.g.
  // “李半山，你……！”奶奶盯着爷爷质问道。 Bound the narration, not the whole chapter.
  return new RegExp(
    `[“"「]${p}[,，][^”"」\\n]{0,120}[”"」][^。！？!?；;\\n]{0,60}(?:盯着|看着|对着|朝着|冲着|向)${t}(?:低声|大声|厉声|愤怒地|颤抖着|不解地|疑惑地)?(?:质问|问道|喊道|叫道|说道|吼道|骂道)`,
    "u",
  ).test(text);
}

function lockedMatch(entry, names) {
  if (!entry.asset) return false;
  const lockedName = normalized(entry.asset.name);
  const lockedParts = components(lockedName);
  const aliases = verifiedAliases(entry);
  return names.some(
    (name) =>
      name === lockedName ||
      lockedParts.includes(name) ||
      aliases.includes(name) ||
      explicitIdentity(entry.text, lockedName, name),
  );
}

function verifiedAliases(entry) {
  if (!entry.asset) return [];
  return [
    ...normalized(entry.asset.content).matchAll(/^已核实称谓\s*[:：]\s*([^\n]+)$/gmu),
  ].map((match) => match[1].trim());
}

function missing(name, relationship = false) {
  throw new Error(
    relationship
      ? `角色「${name}」的称谓与姓名缺少明确的同一人物依据，请让编剧补充人物关系，或先批准新增角色设定后重试。`
      : `角色「${name}」尚未出现在原著、已批准剧本或有效锁定角色中。请让编剧补充人物依据，或先批准新增角色后重试。`,
  );
}

function titleFamily(name) {
  return TITLE_ALIASES.find((aliases) => aliases.includes(name));
}

function familyMentions(text) {
  const expanded = text.replace(/父母|爸妈/g, "父亲、母亲");
  return TITLE_ALIASES.filter((aliases) =>
    aliases.some((alias) => hasNameEvidence(expanded, alias)),
  ).map(([title]) => title);
}

function hasNameEvidence(text, name) {
  // Single-character kinship words must be actual forms of address: “娘” in
  // “新娘/姑娘” and “妈” in “姑妈/舅妈” do not establish a mother character.
  const direct = /^[爹爸娘妈]$/.test(name)
    ? new RegExp(
        `(?:^|[^\\p{Script=Han}]|[我你他她俺咱亲的])${name}(?![子舅炮家惹])`,
        "u",
      ).test(text)
    : text.includes(name);
  if (direct) return true;
  const family = titleFamily(name);
  return Boolean(
    family && ["父亲", "母亲"].includes(family[0]) && /父母|爸妈/.test(text),
  );
}

function currentGroupMembers(group, project) {
  const text = normalized(approvedScript(project)?.content);
  if (!text || !/家人|家属|全家人|父母|爸妈/.test(group)) return [];
  // Only inspect scenes where the group actually appears. Other scenes and the
  // novel may contain relatives who are absent from this episode's group shot.
  const scenes = text.split(/(?=^#{2,6}\s*场\s*\d)/mu);
  const selected = scenes.filter((scene) =>
    new RegExp(`^[^\\n]*人物[^\\n]*(?:${escaped(group)}|家人|父母|爸妈)`, "mu").test(
      scene,
    ),
  );
  const excerpts = selected.length
    ? selected.map((scene) => scene.replace(/\n##\s[^\n]*[\s\S]*$/, ""))
    : text.split(/[。！？\n]/u).filter((line) => line.includes(group));
  return [...new Set(excerpts.flatMap(familyMentions))];
}

function collectiveName(name) {
  const plain = name.replace(/\((?:群体|群众|多人|剪影|现形后|背景)\)$/, "");
  const pair = /(父母|爸妈)(?:[甲乙丙丁戊己庚辛壬癸]|[1-9]\d?)(?:号)?$/.exec(plain);
  if (pair) return pair[1];
  const family = /(?:全家人|家人|家属|父母|爸妈)$/.exec(plain);
  if (family) return family[0];
  if (["村民", "群众", "医护人员"].includes(plain)) return plain;
  const plural = /^(?:众|一群|多名|多位|一众)(.+)$/.exec(plain);
  if (plural && COLLECTIVES.includes(plural[1])) return plural[1];
  return null;
}

function assertIndividual(name, project) {
  const group = collectiveName(name);
  if (!group) return;
  if (
    name === "村民" &&
    sources(project).some((entry) =>
      entry.asset
        ? normalized(entry.asset.name) === name
        : /(?:一|那|这)(?:名|位|个)\s*村民(?!们)/u.test(entry.text),
    )
  )
    return;
  const members = /^(父母|爸妈)$/.test(group)
    ? ["父亲", "母亲"]
    : currentGroupMembers(group, project);
  const suggestions = members.length
    ? members.join("、")
    : `${group}甲等有出场依据的无名个体（数量按当前集需求，不补编亲属关系或真名）`;
  throw new Error(
    `角色规划「${name}」是群体称谓，不能合成一个人的形象。请按当前集出场人物拆为${suggestions}，每人分别提供身份描述与不同的单人视觉设计；只在本集出现的成员需要建档，未知姓名暂用称谓。`,
  );
}

function provisionalIdentity(requested, evidence) {
  const slot = anonymousSlot(requested);
  if (!slot) return null;
  const { group, name } = slot;
  // A stable anonymous slot is backed by an actual group, never by a model's
  // sourceEvidence string. Its inferred identity stays a proposal until approval.
  if (requested === group) return null;
  const origin = evidence.find(
    (entry) => entry.kind !== "locked" && entry.text.includes(group),
  );
  if (!origin) return null;
  return {
    name,
    aliases: [],
    source: origin.kind,
    sourceLabel: `${LABELS[origin.kind]} · 无名个体（身份待补充）`,
    provisional: true,
    group,
  };
}

function anonymousSlot(requested) {
  const match =
    /^(?:无名|未具名|匿名)?(.+?)([甲乙丙丁戊己庚辛壬癸]|[1-9]\d?)?(?:号)?$/.exec(
      requested,
    );
  if (
    !match ||
    !COLLECTIVES.includes(match[1]) ||
    requested === match[1] ||
    /^(父母|爸妈)$/.test(match[1])
  )
    return null;
  return { group: match[1], name: `${match[1]}${match[2] || "甲"}` };
}

/** Resolve only source-backed identities; model-provided evidence is never consulted. */
export function resolveCharacterIdentity(rawName, project) {
  const requested = normalized(rawName);
  if (!requested || requested.length > 80)
    throw new Error("角色姓名为空或过长，请检查角色规划中的姓名。");
  assertIndividual(requested, project);
  const canonicalRequest = anonymousSlot(requested)?.name || requested;
  const names = components(canonicalRequest);
  if (names.some((name) => !name || /[()]/.test(name))) missing(requested, true);
  const evidence = sources(project);
  let identityEvidence;
  if (names.length === 2) {
    identityEvidence = evidence.find((entry) =>
      explicitIdentity(entry.text, names[0], names[1]),
    );
    // An already approved composite role name also explicitly binds its two parts.
    identityEvidence ||= evidence.find(
      (entry) => entry.asset && normalized(entry.asset.name) === requested,
    );
    identityEvidence ||= evidence.find(
      (entry) =>
        entry.asset &&
        names.every(
          (name) =>
            name === normalized(entry.asset.name) ||
            verifiedAliases(entry).includes(name),
        ),
    );
    if (!identityEvidence) missing(requested, true);
  }
  const equivalentTitles = names.length === 1 ? titleFamily(names[0]) || [] : [];
  const locked = evidence.find((entry) =>
    lockedMatch(entry, [...names, ...equivalentTitles]),
  );
  const direct = evidence.find(
    (entry) => entry.kind !== "locked" && hasNameEvidence(entry.text, names[0]),
  );
  const backedTitle =
    !direct &&
    equivalentTitles.find((title) =>
      evidence.some(
        (entry) => entry.kind !== "locked" && hasNameEvidence(entry.text, title),
      ),
    );
  const name = locked
    ? locked.asset.name.trim()
    : equivalentTitles[0] || names.find((part) => !TITLES.includes(part)) || names[0];
  const novel = evidence.find(
    (entry) => entry.kind === "novel" && hasNameEvidence(entry.text, normalized(name)),
  );
  const titleOrigin =
    backedTitle &&
    evidence.find(
      (entry) => entry.kind !== "locked" && hasNameEvidence(entry.text, backedTitle),
    );
  const origin = locked || novel || identityEvidence || direct || titleOrigin;
  if (!origin) {
    const provisional = provisionalIdentity(requested, evidence);
    if (provisional) return provisional;
    missing(requested);
  }
  const aliases = new Set(names);
  if (canonicalRequest !== requested) aliases.add(requested);
  for (const title of equivalentTitles)
    if (
      evidence.some(
        (entry) => entry.kind !== "locked" && hasNameEvidence(entry.text, title),
      )
    )
      aliases.add(title);
  if (names.length === 2) aliases.add(requested);
  // Preserve proven kinship/role names even when the planner returns only a real name.
  for (const title of TITLES)
    if (evidence.some((entry) => explicitIdentity(entry.text, normalized(name), title)))
      aliases.add(title);
  if (locked) {
    for (const part of components(normalized(locked.asset.name))) aliases.add(part);
    for (const alias of verifiedAliases(locked)) aliases.add(alias);
  }
  for (const alias of aliases)
    if (normalized(alias) === normalized(name)) aliases.delete(alias);
  return {
    name,
    aliases: [...aliases],
    source: origin.kind,
    sourceLabel: LABELS[origin.kind],
  };
}
