# 开发与维护

## 本地环境

使用 Node.js 22.13+ 和 npm 10+，`.node-version` 指定 Node 22 主版本。提交 `package-lock.json`，常规安装使用 `npm ci`，有意调整依赖时使用 `npm install` 并一并提交锁文件。

```sh
npm ci
npm run dev
```

默认前端 `http://127.0.0.1:5173`，API `http://127.0.0.1:3001`。配置项在 `.env.example`；只在需要修改默认值时复制为 `.env`。`npm run dev:api` 与 `npm run dev:web` 可分别启动。开发和生产 API 都通过 Node 原生环境文件支持读取 `.env`，无需额外 dotenv 依赖。已有进程环境变量优先。

使用真实模型持续制作时运行 `npm run workbench`：保留前端热更新，API 不监听文件变化，避免开发重载中断已提交的生成请求。修改后端后需等当前节点结束，再手动重启；不要同时运行 `dev` 和 `workbench`，两者使用相同端口。`npm run dev` 适合编码与隔离测试。

| 配置                 | 默认   | 约束                                 |
| -------------------- | ------ | ------------------------------------ |
| `API_PORT`           | `3001` | 1–65535 的整数                       |
| `WEB_PORT`           | `5173` | 仅开发前端端口，1–65535 的整数       |
| `WORKBENCH_DATA_DIR` | `data` | 相对路径基于项目根目录，支持绝对路径 |

统一使用 `.env`，避免 Vite 模式配置与 Node 配置不一致。模型密钥在界面配置，不要放进 `VITE_` 环境变量。测试不自动加载 `.env`，后端 fixture 注入内存或临时数据库。

## 日常命令

| 命令                         | 用途                                     |
| ---------------------------- | ---------------------------------------- |
| `npm run dev`                | 同时启动可热更新的前后端                 |
| `npm run workbench`          | 稳定运行 API，保留前端热更新，供真实制作 |
| `npm run format`             | 格式化受管理的源码、配置和文档           |
| `npm run format:check`       | 只检查格式                               |
| `npm run lint`               | JS / TS / React Hooks 检查，零警告通过   |
| `npm run typecheck`          | 检查浏览器代码与构建配置的类型           |
| `npm run check:architecture` | 检查本地导入路径、依赖环与分层约束       |
| `npm run test:web`           | 前端单次回归测试                         |
| `npm run test:web:watch`     | 前端测试监听                             |
| `npm run test:server`        | 后端 API / 工作流 / 模型适配 / 配置测试  |
| `npm test`                   | 前后端测试                               |
| `npm run build`              | 类型检查并生成 `dist/`                   |
| `npm start`                  | 单进程启动 API 并提供已构建页面          |
| `npm run check`              | 提交前完整检查；与 CI 一致               |

## 修改流程

1. 从 `docs/architecture.md` 找到所属模块，在对应功能目录修改。组件和业务状态保持各自职责；不要将逻辑重新堆回应用入口。
2. 复用 `src/ui` 控件；公共属性变化同步更新 `/ui` 预览与 UI 文档。样式入口有明确级联顺序，不随意调整导入先后。
3. 为容易回归的行为加测试：未保存内容、异步响应顺序、密钥保留或清除、资产版本、审批、取消和恢复。测试对外行为，避免只比对实现细节。
4. 执行 `npm run format` 与 `npm run check`。界面变化再检查桌面、320px 窄屏和短屏，自动化 DOM 测试不能替代视觉检查。

纯样式修改不要求复制一套组件测试；涉及接口或工作流的改动应补对应集成测试。前端测试与组件同目录（`*.test.tsx` / `*.test.ts`）；后端测试入口是 `server/*.test.mjs`，新后端测试文件放在该层以被默认命令发现。

## 数据与兼容

`data/`、`.env*`、构建产物、测试截图不进入版本控制，`.env.example` 保留。备份先停服务，再复制完整 `data` 目录。不要用生产数据库跑测试，也不要删数据库来绕过兼容性问题。

当前 SQLite schema 为 v1，版本记录位于 `PRAGMA user_version` 和 `schema_migrations`。`server/storage/schema.mjs` 定义实体表与索引，`codec.mjs` 保留字段和集合顺序，`persistence.mjs` 在事务中执行迁移及实体差异保存，`queries.mjs` 提供按项目的 SQL 分页读取。运行时仍整体加载工作区，`save()` 仍扫描全部实体后只写差异；不要将接口分页描述为服务端已实现惰性加载。

修改持久化结构时，先设计受支持旧版本到新版本的迁移与失败回滚测试，再调整版本号及加载流程。不得直接删除迁移快照、覆盖 `workspace_legacy_v0`，或把只读兼容视图 `workspace` 恢复成可写表；该视图用于拒绝旧版写入，不是当前状态的读取入口。schema v1 迁移保留 `normalized-project-storage-v1` 原始快照，结构变更和内容迁移在同一事务中提交。现有版本之外的数据库会拒绝打开，不应通过手工修改版本标记绕过检查。单纯修改 `seed.mjs` 只影响新数据库或新项目，不会自动升级既有记录。

新增查询须在 SQLite 中先限制 `project_id`，再筛选、排序和分页；生产代码不能退回整份工作区的数组查询。`GET /api/state` 无参数时仍兼容完整快照；精简快照的 `projects` 只含所选项目，跨项目导航和数量应读取 `projectSummaries`，不要把它当作完整 `Project`。同步维护 `src/types.ts`、参数校验与文档。存储回归入口为 `server/storage.test.mjs`，读取接口回归为 `server/read-api.test.mjs`；应覆盖旧记录保留、重复启动、失败重试、项目隔离、追加消息时的游标稳定性及密钥脱敏。

前端的 `App.tsx`、`SettingsViews.tsx`、`providerPresets.ts` 与后端 `providers.mjs` 等旧入口保留兼容导出。新代码使用业务模块的公开入口，不往兼容文件添加实现。

CI 文件已配置，实际远端结果以 GitHub Actions 运行记录为准。远程仓库为 [xutongxue233/short-drama-workspace](https://github.com/xutongxue233/short-drama-workspace)，默认分支为 `main`；提交前仍须在本机执行完整检查。
