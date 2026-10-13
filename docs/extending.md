# 扩展指南

## 增加常见模型预设

相同协议的新服务商，在 `src/features/models/providerPresets.ts` 增加模板即可：能力、协议、地址、模型名称、说明与官方文档链接。预设只是填表，不保存密钥，不自动启用或发起生成。协议能力约束位于 `modelConfig.ts`；前后端同时校验。

模型 ID 以供应商控制台为准，模板应保持可编辑。验证选择预设后地址与能力匹配、密钥草稿被清空，并且服务默认停用。运行 `npm run test:web` 和 `npm run build`。

## 增加一种模型协议

1. 在 `server/providers/adapters/` 新建适配器，参考已有适配器的参数与返回值。使用公共传输层、取消信号和媒体校验，避免自行实现第二套轮询、密钥脱敏或超时策略。
2. 在 `server/providers/generate.mjs` 注册协议；更新 `config.mjs` 的协议与能力校验，必要时在 `health.mjs` 实现只读连接检查。
3. 同步 `src/types.ts` 的协议类型、前端 `modelConfig.ts` 的能力限制与说明，按需添加预设。
4. 在 `server/*.test.mjs` 使用本地 HTTP 假服务覆盖请求格式、响应解析、失败、超时、取消、异步任务和参考资产；测试不能调用真实计费模型。

公共结果约定沿用现有 `text`、`url` 与任务元数据。保留显式模型绑定失败即报错的行为，不自动切换到其他服务。真实 API Key 只存在服务端，`publicProvider` 的返回值只带 `hasKey`。

## 增加 Agent 或制作节点

Agent 的默认资料位于 `server/seed.mjs`；制作节点列表是其中的 `NODE_DEFINITIONS`。新增节点同时定义负责的 Agent、输入上下文、输出资产、审批要求和对后续节点的失效影响。

节点任务与审批在 `server/workflow/templates.mjs`；调度、返修、恢复以及 `recordArtifacts` 产物记录在 `server/workflow.mjs`；资产版本更新和角色计划解析在 `server/workflow/assets.mjs`。需要新的资产类型时，同步前端 `Asset` 类型、显示标签、预览与筛选，以及服务端校验。

改默认资料不会自动更新已有数据库里的 Agent 或项目节点。为存量记录设计明确的迁移逻辑，并测试老检查点恢复；不要要求用户删除项目来获得新节点。

集成测试至少覆盖正常推进、人工确认、拒绝与返修、失败重试、暂停/关停、上游修改后下游失效，以及不同项目上下文隔离。

## 扩展技能

维护创作方法优先使用「技能库」和 `SKILL.md` 导入导出，不必修改 Agent 的整段系统提示词。技能文件格式沿用 [OpenAI 技能文档](https://learn.chatgpt.com/docs/build-skills) 的 `name`、`description` 与指令正文，Frameflow 只支持这一指令子集。导入时不执行脚本、不读取引用资源，额外元数据不会往返保留。

运行时统一使用 `server/skills.mjs` 的解析与快照 helper。增加文字执行路径时，同步传入有效绑定、记录实际版本，并将技能纳入依赖内容的检查点；不要改动媒体任务恢复标识。新代码通过 `src/features/skills/index.ts` 引用管理页。接口与旧数据回归位于 `server/skills.test.mjs`，运行时回归位于 `server/skill-runtime.test.mjs`。

## 增加工作台功能或 UI 控件

业务功能放在 `src/features/<domain>`，通过 `index.ts` 导出外部需要的入口。业务动作由上层注入，网络请求复用 `src/api.ts`；不要让通用控件调用 API。

基础控件放在 `src/ui`，同时补 `/ui` 预览、组件文档和适用的交互测试。优先复用 `Field` 的标签/错误关联、`Button` 的加载与禁用行为，以及 `Dialog` 的未保存保护与焦点管理。不要在业务页面重新定义同名弹窗或一整套按钮样式。

在模块样式中处理业务布局，最后检查 320px、390px、768px、桌面与短屏。提交前执行 `npm run check`。
