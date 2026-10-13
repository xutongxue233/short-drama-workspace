import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./seed.mjs";
import { parseCharacterPlan } from "./workflow/assets.mjs";

function fixture() {
  const project = createProject({ name: "基础角色设计", style: "二次元动画" });
  project.chapters = [
    { id: "one", title: "本集", content: "长生看见父亲站在神像旁。" },
  ];
  return project;
}

function person(overrides = {}) {
  return {
    name: "长生",
    description: "本集主角，七岁男孩，见到家人现形。",
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance:
        "原文事实：七岁男孩。设计提案：偏圆小脸，圆眼黑色瞳孔，细眉、小鼻梁、薄唇；短黑发，前额三束碎发；身材瘦小；灰蓝棉布圆领上衣，深棕直筒裤，黑布鞋。右侧袖口一块方形灰补丁作为识别点。",
      sceneStates: [
        { name: "发现异常", description: "惊恐表情，站在门边，脸部仍清楚可辨。" },
      ],
      ...overrides,
    },
    sourceEvidence: "长生看见父亲站在神像旁。",
  };
}

function parse(character, project = fixture()) {
  return parseCharacterPlan(JSON.stringify({ characters: [character] }), project)[0];
}

test("structured planning retains a stable base design separately from the episode state", () => {
  const input = person();
  const result = parse(input);
  assert.deepEqual(result.characterDesign, input.characterDesign);
  assert.equal(result.appearance, input.characterDesign.baseAppearance);
  assert.match(result.content, /基础外观（来源未明确的细节属于待确认设计提案）/);
  assert.match(result.content, /镜头状态（不写入基础设定）/);
  assert.match(result.content, /发现异常：惊恐表情/);
  assert.doesNotMatch(result.characterDesign.baseAppearance, /惊恐|门边/);
});

test("episode-specific horror effects are allowed in scene states without blocking role creation", () => {
  const result = parse({
    ...person(),
    name: "父亲",
    characterDesign: {
      ...person().characterDesign,
      baseAppearance:
        "设计提案：四十岁男子，长方脸、浓直眉、清楚可见的深棕眼睛、宽鼻、短黑发；偏瘦体型；灰褐粗布对襟上衣，深灰裤子，黑布鞋。中性表情、均匀照明。",
      sceneStates: [
        { name: "现形", description: "逆光剪影，眼球全黑，只用于对应异常镜头。" },
      ],
    },
  });
  assert.match(result.characterDesign.sceneStates[0].description, /逆光剪影/);
  assert.doesNotMatch(result.appearance, /逆光|剪影|全黑/);
});

test("neutral object designs retain material and shape without being treated as a person", () => {
  const result = parse({
    ...person(),
    name: "神像",
    description: "庙内静物神像。",
    characterDesign: {
      version: 1,
      subjectType: "object",
      baseAppearance:
        "设计提案：木胎彩绘坐姿神像，上宽下窄的梯形底座，赭红主体、暗金纹饰，表面旧漆细裂；躯体比例固定，不拟人化。",
      sceneStates: [],
    },
  });
  assert.equal(result.characterDesign.subjectType, "object");
  assert.match(result.content, /主体类型：独立静物/);
  assert.match(result.content, /无；沿用中性基础形象/);
});

test("legacy appearance plans stay compatible without falsely acquiring the new design contract", () => {
  const result = parse({
    name: "长生",
    description: "本集主角",
    appearance: "旧版蓝衣男孩设定",
  });
  assert.equal(result.appearance, "旧版蓝衣男孩设定");
  assert.equal(result.characterDesign, undefined);
  assert.match(result.content, /视觉设计提案/);
});

test("invalid new contracts cannot silently fall back to a legacy appearance field", () => {
  for (const invalid of [
    null,
    { version: 2 },
    { ...person().characterDesign, subjectType: "group" },
    { ...person().characterDesign, baseAppearance: " " },
    { ...person().characterDesign, sceneStates: undefined },
    { ...person().characterDesign, sceneStates: [{ name: "现形" }] },
  ])
    assert.throws(
      () =>
        parse({ ...person(), characterDesign: invalid, appearance: "旧版可用描述" }),
      /基础设计格式不完整|镜头状态需要/,
    );
});

test("base references reject concrete scene-only effects and unresolved design alternatives", () => {
  for (const baseAppearance of [
    "老人站在逆光中，全身剪影。",
    "眼球全黑，脖子上可见尸斑。",
    "用手形成半脸遮挡。",
    "脸藏在阴影里。",
    "无尸斑但采用逆光剪影。",
    "蓝衣或灰衣，等待确认。",
    "发型待选，二选一。",
  ])
    assert.throws(
      () => parse(person({ baseAppearance })),
      /基础外观混入了镜头状态|基础外观包含备选方案/,
    );
});

test("clear negative restrictions and non-graphic permanent traits remain valid base design", () => {
  const baseAppearance =
    "设计提案：圆脸黑发，左眉一道愈合的浅色疤痕清楚可见；灰布上衣。不要逆光，没有尸斑，禁止剪影，不出现眼球全黑。不要纹身或面部遮挡；不使用摄影或3D质感。";
  const result = parse(person({ baseAppearance, sceneStates: [] }));
  assert.equal(result.appearance, baseAppearance);
});

test("negative clothing and prop lists are constraints rather than unresolved design alternatives", () => {
  for (const restriction of [
    "不佩戴帽子或首饰",
    "不持法器或武器",
    "无道袍或饰物",
    "不穿道袍或宗教服饰",
    "未携带法器或武器",
    "没有佩戴帽子或首饰",
    "禁止佩戴帽子或首饰",
    "禁止采用摄影或3D质感",
    "不再佩戴帽子或首饰",
    "不额外添加首饰或宗教符号",
    "避免出现尸斑",
    "不允许出现尸斑",
    "不可使用摄影或3D质感",
    "不要逆光或剪影",
  ]) {
    const baseAppearance = `设计提案：圆脸短黑发，灰蓝布衣。${restriction}。`;
    assert.equal(parse(person({ baseAppearance })).appearance, baseAppearance);
  }
});

test("negation cannot authorize alternatives or scene effects in a later clause", () => {
  for (const baseAppearance of [
    "无项链但蓝衣或灰衣",
    "不佩戴首饰，不过上衣红色或棕色",
    "无项链且蓝衣或灰衣",
    "无项链但是发型待选",
    "不持武器，同时胡须长短二选一",
    "不确定蓝色或灰色",
    "不能确定蓝色或灰色",
    "无胡须的男孩穿蓝衣或灰衣",
    "无胡须的男孩身穿蓝衣或灰衣",
    "无胡须的男孩选蓝衣或灰衣",
    "无明确要求，蓝衣或灰衣",
    "无项链但逆光剪影",
  ])
    assert.throws(
      () => parse(person({ baseAppearance })),
      /基础外观包含备选方案|基础外观混入了镜头状态/,
    );
});

test("design validation identifies a bounded offending excerpt for automatic repair", () => {
  for (const [baseAppearance, fragment] of [
    ["明确短黑发，蓝衣或灰衣。", "蓝衣或灰衣"],
    ["衣服细节".repeat(60) + "红色或蓝色" + "固定棉布".repeat(60), "红色或蓝色"],
    ["脸部清楚，但采用逆光剪影。", "采用逆光剪影"],
  ])
    assert.throws(
      () => parse(person({ baseAppearance })),
      (error) => {
        const excerpt = /命中片段：「([^」]*)」/u.exec(error.message)?.[1];
        assert.ok(excerpt?.includes(fragment), error.message);
        assert.ok(excerpt.length <= 160);
        return true;
      },
    );
});

test("structured cards still resolve the current episode identity and reject unsupported roles", () => {
  const project = fixture();
  project.chapters[0].content += " 爷爷名叫李半山。";
  const result = parse({ ...person(), name: "爷爷（李半山）" }, project);
  assert.equal(result.name, "李半山");
  assert.match(result.content, /已核实称谓：爷爷/);
  assert.throws(() => parse({ ...person(), name: "虚构将军" }), /尚未出现在/);
});
