import test from "node:test";
import assert from "node:assert/strict";
import { resolveCharacterIdentity } from "./workflow/character-identity.mjs";
import { parseCharacterPlan } from "./workflow/assets.mjs";

function fixture(content = "长生七岁，穿蓝布衣。") {
  return {
    chapters: [{ content }],
    assets: [],
    nodes: [],
  };
}

function asset(name, content, overrides = {}) {
  return {
    id: name,
    type: "character",
    name,
    content,
    description: "",
    locked: true,
    version: 1,
    tags: [],
    ...overrides,
  };
}

test("novel roles need no pre-existing character asset", () => {
  const project = fixture();
  const before = JSON.stringify(project);
  assert.deepEqual(resolveCharacterIdentity("长生", project), {
    name: "长生",
    aliases: [],
    source: "novel",
    sourceLabel: "原著角色",
  });
  assert.equal(JSON.stringify(project), before);
});

test("explicitly approved adaptation may introduce a new character", () => {
  const project = fixture();
  project.assets.push(
    asset("首集", "林医生来到长生家中。", {
      type: "script",
      tags: ["node:adaptation"],
    }),
  );
  const result = resolveCharacterIdentity("林医生", project);
  assert.equal(result.name, "林医生");
  assert.equal(result.source, "adaptation");
  assert.match(result.sourceLabel, /改编新增/);
});

test("drafts, historical scripts, other asset types and model evidence cannot authorize identities", () => {
  for (const overrides of [
    { type: "script", tags: ["node:adaptation"], locked: false },
    { type: "script", tags: ["node:adaptation", "历史版本"] },
    { type: "script", tags: ["node:adaptation", "待更新"] },
    { type: "script", tags: [] },
    { type: "storyboard" },
    { type: "character", locked: false },
    { type: "character", tags: ["历史版本"] },
    { type: "character", tags: ["待更新"] },
  ]) {
    const project = fixture();
    project.assets.push(asset("虚构甲", "虚构甲出场。", overrides));
    project.sourceEvidence = "虚构甲";
    assert.throws(
      () => resolveCharacterIdentity("虚构甲", project),
      /编剧补充人物依据/,
    );
  }
});

test("only the current approved adaptation version can introduce identities", () => {
  const project = fixture();
  project.assets.push(
    asset("旧批准稿", "旧角色出场。", {
      type: "script",
      tags: ["node:adaptation"],
      version: 1,
    }),
    asset("新批准稿", "新角色出场。", {
      type: "script",
      tags: ["node:adaptation"],
      version: 2,
    }),
  );
  assert.throws(() => resolveCharacterIdentity("旧角色", project));
  assert.equal(resolveCharacterIdentity("新角色", project).source, "adaptation");
  project.nodes = [{ id: "adaptation", output: "旧角色出场。" }];
  assert.equal(resolveCharacterIdentity("旧角色", project).source, "adaptation");
  assert.throws(() => resolveCharacterIdentity("新角色", project));
});

const ADDRESSED = "“李半山，你……你到底是造了什么孽啊！”奶奶浑身颤抖的盯着爷爷质问道。";

test("quoted address binds the grandfather's name in either bracket order", () => {
  for (const name of ["爷爷（李半山）", "李半山(爷爷)", " 爷爷（ 李半山 ） "]) {
    const result = resolveCharacterIdentity(name, fixture(ADDRESSED));
    assert.equal(result.name, "李半山");
    assert.equal(result.source, "novel");
    assert.ok(result.aliases.includes("爷爷"));
  }
});

test("a real name retains its proven kinship alias for script visual constraints", () => {
  const result = resolveCharacterIdentity("李半山", fixture(ADDRESSED));
  assert.ok(result.aliases.includes("爷爷"));
});

test("locked role names take precedence in both normalization directions", () => {
  for (const lockedName of ["爷爷", "李半山", "爷爷（李半山）"]) {
    const project = fixture(ADDRESSED);
    project.assets.push(asset(lockedName, "沿用已批准角色外观。"));
    const result = resolveCharacterIdentity("李半山（爷爷）", project);
    assert.equal(result.name, lockedName);
    assert.equal(result.source, "locked");
  }
});

test("an explicit relationship in a locked role card is sufficient", () => {
  const project = fixture();
  project.assets.push(asset("爷爷", "爷爷本名：李半山。"));
  assert.equal(resolveCharacterIdentity("李半山", project).name, "爷爷");
  assert.equal(resolveCharacterIdentity("爷爷（李半山）", project).name, "爷爷");
});

test("a role merely mentioned by a locked card does not borrow that identity", () => {
  const project = fixture();
  project.assets.push(asset("爷爷", "爷爷带李半山见朋友。"));
  assert.throws(() => resolveCharacterIdentity("李半山", project), /编剧补充人物依据/);
});

test("known kinship words cannot smuggle in an unsupported full name", () => {
  assert.throws(
    () => resolveCharacterIdentity("爷爷（虚构甲）", fixture(ADDRESSED)),
    /同一人物依据/,
  );
});

test("co-occurrence is not evidence that two characters are one", () => {
  for (const text of [
    "爷爷带李半山见朋友。",
    "爷爷站在门口。李半山走进来。",
    "爷爷是李半山的父亲。",
    "李半山是爷爷的朋友。",
    "“李半山，你先走。”奶奶看着爷爷，随后对李半山说道。",
  ])
    assert.throws(
      () => resolveCharacterIdentity("爷爷（李半山）", fixture(text)),
      /同一人物依据/,
    );
});

test("distinct proper names require an explicit alias statement", () => {
  assert.throws(
    () => resolveCharacterIdentity("张三（陈四）", fixture("张三和陈四见面。")),
    /同一人物依据/,
  );
  assert.throws(
    () => resolveCharacterIdentity("张三（陈四）", fixture("张三（陈四）走进房间。")),
    /同一人物依据/,
  );
  const result = resolveCharacterIdentity("张三（陈四）", fixture("张三又名陈四。"));
  assert.equal(result.name, "张三");
  assert.ok(result.aliases.includes("陈四"));
});

test("safe age suffixes are removed without inventing another alias", () => {
  assert.deepEqual(resolveCharacterIdentity("长生（７岁）", fixture()), {
    name: "长生",
    aliases: [],
    source: "novel",
    sourceLabel: "原著角色",
  });
  assert.throws(() => resolveCharacterIdentity("长生（李半山）", fixture()));
});

test("approved adaptation identity bindings are marked as adaptation additions", () => {
  const project = fixture();
  project.assets.push(
    asset("批准剧本", "医生名叫林青。医生穿白色外套。", {
      type: "script",
      tags: ["node:adaptation"],
    }),
  );
  assert.deepEqual(resolveCharacterIdentity("医生（林青）", project), {
    name: "林青",
    aliases: ["医生", "医生(林青)"],
    source: "adaptation",
    sourceLabel: "改编新增角色（已批准剧本）",
  });
});

test("an adaptation clarifying a novel character does not label that character as newly added", () => {
  const project = fixture("李半山站在门口。");
  project.assets.push(
    asset("批准稿", "爷爷名叫李半山。", {
      type: "script",
      tags: ["node:adaptation"],
    }),
  );
  assert.equal(resolveCharacterIdentity("爷爷（李半山）", project).source, "novel");
});

test("missing roles report a creative evidence issue without blaming provider settings", () => {
  assert.throws(
    () => resolveCharacterIdentity("未知甲", fixture()),
    (error) => {
      assert.match(error.message, /批准新增角色/);
      assert.doesNotMatch(error.message, /模型接入|API|接口配置/);
      return true;
    },
  );
});

test("current scene family groups request individual designs without borrowing absent relatives", () => {
  const project = fixture("爷爷本名李半山。母亲、父亲、奶奶照顾长生。");
  project.assets.push(
    asset(
      "批准稿",
      `## 第 1 集完整剧本
### 场1｜回忆
- **人物**：爷爷、长生
- **动作**：爷爷站在门边。
### 场5｜贴符
- **地点**：父母房间、奶奶房间
- **人物**：长生、熟睡的家人
- **对白**：奶奶梦呓「长生」。
### 场6｜逃离
- **人物**：长生、现形后的家人
- **动作**：三个轮廓站在门边。
## 不进入本集
爷爷回场，外公回家。`,
      { type: "script", tags: ["node:adaptation"] },
    ),
  );
  assert.throws(
    () => resolveCharacterIdentity("长生家人", project),
    (error) => {
      assert.match(error.message, /父亲、母亲、奶奶/);
      assert.match(error.message, /每人分别.*不同的单人视觉设计/);
      assert.doesNotMatch(error.message, /爷爷|外公/);
      return true;
    },
  );
});

test("partial chapters with parents need no full names or complete novel", () => {
  const project = fixture("长生为熟睡的父母贴符，随后逃离。");
  for (const name of ["父亲", "母亲"]) {
    const result = resolveCharacterIdentity(name, project);
    assert.equal(result.name, name);
    assert.equal(result.source, "novel");
  }
  assert.throws(() => resolveCharacterIdentity("父母", project), /父亲、母亲/);
  assert.throws(
    () => resolveCharacterIdentity("母亲（林婉）", project),
    /同一人物依据/,
  );
});

test("kinship synonyms reuse approved role cards across successive excerpts", () => {
  const project = fixture("长生听见爸爸在门外呼唤。");
  project.assets.push(asset("父亲", "已批准外观：布衣中年男人。"));
  assert.equal(resolveCharacterIdentity("爸爸", project).name, "父亲");
  assert.equal(resolveCharacterIdentity("爹", project).name, "父亲");
  project.chapters = [{ content: "母亲来到院中。" }];
  assert.equal(resolveCharacterIdentity("爸爸", project).source, "locked");
});

test("unnamed individual slots may be based on an evidenced crowd while identities stay provisional", () => {
  const project = fixture("几名村民来到院门口。");
  const result = resolveCharacterIdentity("无名村民甲", project);
  assert.equal(result.name, "村民甲");
  assert.equal(result.provisional, true);
  assert.equal(result.group, "村民");
  assert.match(result.sourceLabel, /身份待补充/);
  const plan = parseCharacterPlan(
    JSON.stringify({
      characters: [
        {
          name: "村民甲",
          description: "本集院门口的无名村民。",
          appearance: "暂定中年，灰布短衫，与村民乙不同脸。",
        },
      ],
    }),
    project,
  );
  assert.match(plan[0].content, /后续章节可补充/);
  assert.match(plan[0].content, /禁止把设计提案写成原著事实/);
  assert.throws(
    () => resolveCharacterIdentity("众村民", project),
    /不能合成一个人的形象/,
  );
  assert.throws(() => resolveCharacterIdentity("村民", project), /单人视觉设计/);
});

test("an unsupported real name cannot be authorized by an anonymous crowd or model evidence", () => {
  const project = fixture("几名村民来到院门口。");
  assert.throws(
    () => resolveCharacterIdentity("村民（王有财）", project),
    /同一人物依据/,
  );
  assert.throws(
    () => resolveCharacterIdentity("无名保镖甲", project),
    /编剧补充人物依据/,
  );
  assert.throws(
    () =>
      parseCharacterPlan(
        JSON.stringify({
          characters: [
            {
              name: "王有财",
              description: "村民",
              appearance: "中年人",
              sourceEvidence: "王有财是村民。",
            },
          ],
        }),
        project,
      ),
    /编剧补充人物依据/,
  );
});

test("anonymous slot normalization cannot create duplicate role cards", () => {
  const project = fixture("村民走进院中。");
  const characters = ["村民甲", "无名村民甲"].map((name) => ({
    name,
    description: "村民",
    appearance: "灰布衣",
  }));
  assert.throws(
    () => parseCharacterPlan(JSON.stringify({ characters }), project),
    /归一后重复/,
  );
});

test("cast planning accepts seven current assets without truncating a family at six", () => {
  const names = ["长生", "爷爷", "老道士", "父亲", "母亲", "奶奶", "神像"];
  const project = fixture(`${names.join("、")}出现在当前片段中。`);
  const characters = names.map((name) => ({
    name,
    description: "本集出场",
    appearance: "独立设计提案",
  }));
  const plan = parseCharacterPlan(JSON.stringify({ characters }), project);
  assert.equal(plan.length, 7);
  assert.deepEqual(
    plan.map(({ name }) => name),
    names,
  );
  assert.throws(
    () =>
      parseCharacterPlan(
        JSON.stringify({ characters: Array(13).fill(characters[0]) }),
        project,
      ),
    /1 至 12/,
  );
});

test("single-character kinship aliases do not treat brides or aunts as mothers", () => {
  for (const content of [
    "新娘穿红衣走进院门。",
    "姑娘走进院门。",
    "姑妈在院中。",
    "舅妈穿灰衣。",
    "娘子看向长生。",
  ]) {
    assert.throws(
      () => resolveCharacterIdentity("母亲", fixture(content)),
      /编剧补充人物依据/,
    );
    assert.throws(
      () => resolveCharacterIdentity("妈", fixture(content)),
      /编剧补充人物依据/,
    );
  }
  for (const content of [
    "我娘端来一碗饭。",
    "娘走进院门。",
    "“娘，你回来啦。”长生叫道。",
    "他的妈站在门外。",
  ]) {
    assert.equal(resolveCharacterIdentity("母亲", fixture(content)).name, "母亲");
  }
});

test("saved verified aliases reuse the canonical locked role after original evidence leaves context", () => {
  const project = fixture("爷爷站在门外。");
  project.assets.push(asset("李半山", "角色：李半山\n已核实称谓：爷爷\n白发灰袍。"));
  for (const name of ["爷爷", "李半山", "爷爷（李半山）"]) {
    const identity = resolveCharacterIdentity(name, project);
    assert.equal(identity.name, "李半山");
    assert.equal(identity.source, "locked");
    assert.ok(identity.aliases.includes("爷爷"));
  }
  const unrelated = fixture("长生站在门外。");
  unrelated.assets.push(asset("李半山", "李半山去找爷爷。"));
  assert.throws(() => resolveCharacterIdentity("爷爷", unrelated), /编剧补充人物依据/);
});

test("anonymous labels normalize before looking for locked roles from previous episodes", () => {
  const project = fixture("长生走进院中。");
  project.assets.push(asset("村民甲", "已批准外观：中年、灰布衣。"));
  for (const name of ["无名村民甲", "匿名村民甲", "未具名村民甲"]) {
    const identity = resolveCharacterIdentity(name, project);
    assert.equal(identity.name, "村民甲");
    assert.equal(identity.source, "locked");
  }
});

test("numbering a pair cannot bypass individual character planning", () => {
  const project = fixture("长生的父母站门口。");
  for (const name of ["父母甲", "无名父母甲", "爸妈1", "父母2号"]) {
    assert.throws(() => resolveCharacterIdentity(name, project), /拆为父亲、母亲/);
  }
});

test("a generic villager title may describe an explicitly individual character", () => {
  for (const content of [
    "一名村民走过来。",
    "那位村民抬起头。",
    "这个村民挥了挥手。",
  ]) {
    assert.equal(resolveCharacterIdentity("村民", fixture(content)).name, "村民");
  }
  assert.throws(
    () => resolveCharacterIdentity("村民", fixture("村民们走进院中。")),
    /群体称谓/,
  );
});
