# 应用层

- `App.tsx` 只负责工作区导航、当前项目、对话框开关，以及组合功能模块。
- `useWorkspaceState.ts` 集中管理服务端快照、轮询、命令串行执行、请求错误和提示。卸载时取消快照请求；较旧响应不能覆盖新快照。
- `layout/` 是侧栏与顶栏。侧栏搜索等仅与布局有关的状态在组件内部维护。
- `components/` 放全应用通用的加载、帮助、提示反馈。

依赖方向是 `app → features → components / shared / ui`。功能组件通过属性接收数据和业务动作，不反向导入应用层。HTTP 请求统一经过 `src/api.ts`；新增业务请求不要在展示组件中直接调用 `fetch`。

`src/App.tsx` 是保留旧入口的兼容导出，新增应用逻辑放在本目录。业务状态字段以 `src/types.ts` 为准；跨功能 UI 契约位于 `src/shared/contracts.ts`。
