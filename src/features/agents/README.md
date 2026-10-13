# Agent 管理模块

外部页面从 `features/agents` 导入 `AgentCenter`。此模块管理全局创作成员的配置；项目内邀请与运行状态由工作区负责。

- `AgentCenter.tsx`：搜索、启用筛选、项目参与计数与编辑入口。
- `AgentCard.tsx`：纯展示组件，通过回调通知启停与编辑操作。
- `AgentEditor.tsx`：职责、系统提示词、服务绑定及模型覆盖的编辑表单。
- `agentIcons.ts`：成员职责图标映射。
- `agents.css`：成员页面样式；通用管理布局复用 `components/settings/settings.css`。

`state` 和 `mutate` 由应用壳传入，不在此模块建立第二份全局工作区状态。模型能力显示名称来自模型模块的公开导出，避免复制同一套名称。保存失败保留表单草稿，由应用壳统一显示请求错误。
