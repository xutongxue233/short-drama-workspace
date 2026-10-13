# 2026-10-13 OCR 审计修复

本轮对应 OCR 全量扫描后人工验证的 31 项问题（9 项 P1、22 项 P2）。审计原始记录及复现日志保存在本机 `output/ocr-audit-20261013/`；该目录不入库。修复前源码由 Git 基线提交保留。

## 修复与回归覆盖

| 审计编号 | 修复行为                                                                           | 主要回归入口                                                                 |
| -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 001、011 | 更换服务地址或协议必须重新填写或明确清除密钥；拒绝包含 URL 编码密钥的媒体地址      | `server/credential-boundaries.test.mjs`                                      |
| 002      | 仅完整、明确的制作指令可启动工作流，否定和讨论不触发制作                           | `server/chat.test.mjs`                                                       |
| 003      | 在读取、迁移和恢复数据前获得数据库实例独占权；进程崩溃自动释放                     | `server/persistence-safety.test.mjs`                                         |
| 004      | 图片返回后先保存结果与稳定素材 ID，再下载；暂停恢复复用结果                        | `server/workflow-audit.test.mjs`、`server/material-recovery.test.mjs`        |
| 005      | 不再因旧视频任务永久阻塞新版分镜；用户可明确归档旧任务，保留任务账本               | `server/workflow-audit.test.mjs`、工作流节点界面测试                         |
| 006、019 | 后台收尾保存失败被接住；启动保存失败恢复状态并释放运行槽位                         | `server/workflow-audit.test.mjs`                                             |
| 007      | 分镜读取当前集剧本，空正文或集号不符明确报错                                       | `server/visual-prompts.test.mjs`                                             |
| 008、027 | 合并重叠轮询，写操作等待新快照；新项目加载失败不会回退并修改旧项目                 | `src/app/useWorkspaceState.test.tsx`、`src/app/App.test.tsx`                 |
| 009      | 草稿同时保存文本和讨论模式，卸载后仍保持原语义                                     | `src/features/workspace/components/ChatComposer.test.tsx`                    |
| 010      | 任一关闭检查点保存失败仍继续取消其他任务并关闭存储                                 | `server/project-concurrency.test.mjs`、`server/workflow-audit.test.mjs`      |
| 012、013 | 旧格式角色图片编辑后必须重新生成；审核失败回滚整个修改                             | `server/character-asset-edit.test.mjs`、`server/persistence-safety.test.mjs` |
| 014      | 项目、章节、Agent、记忆和资产的同步修改在保存失败时恢复原状态及对象引用            | `server/persistence-safety.test.mjs`                                         |
| 015、016 | 讨论期间拒绝导入原文；图片测试纳入项目任务互斥，禁止中途跨集                       | `server/project-concurrency.test.mjs`                                        |
| 017、018 | 素材元数据保存失败保留已落盘文件，重启可恢复；删除回滚不替换其他下载任务持有的对象 | `server/material-recovery.test.mjs`                                          |
| 020、021 | 排除否定身份关系；不同姓名不能仅凭共同称谓合并                                     | `server/character-identity.test.mjs`                                         |
| 022      | 用真实消息顺序恢复设计反馈，最后一次修改生效                                       | `server/character-planning.test.mjs`                                         |
| 023–026  | 统一分节镜头边界，跳过后期镜头，逐人验证参考资产，缺人物栏时要求补全               | `server/video-shot.test.mjs`                                                 |
| 028      | Agent 开关保存期间禁止打开过时的编辑表单                                           | Agent 中心界面测试                                                           |
| 029      | 工作流日志按事件 scope 分类，不把聊天事件归入制作                                  | 工作流活动测试                                                               |
| 030      | 档案内跳转经过未保存内容确认，并在提交期间禁用                                     | `src/features/workflow/components/EpisodeArchiveDialog.test.tsx`             |
| 031      | 图片加载失败提供显式重试，加载成功后恢复审批                                       | 资产媒体及审批卡界面测试                                                     |

## 持久化和恢复约定

`store-ownership.mjs` 在数据库旁维护 `.owner` SQLite 文件，并在独立连接中保持排他事务。工作台数据库仍使用原有 WAL 与检查点事务。不要在实例运行中删除 `.owner` 文件；正常关闭及进程退出会由操作系统释放文件锁，无需删除文件来“解锁”。

`state-transaction.mjs` 只用于同步修改与同步保存。回滚恢复原对象图，避免后台下载持有的素材对象失去关联；不能把异步网络调用放进此事务。

素材 `captureId` 对应一份生成结果，`sourceHash` 用于校验恢复来源。相同 ID 不会创建重复记录；恢复先校验本地完整文件，再决定是否下载。Base64 仅在本地元数据成功提交后裁剪，保存失败保留源数据。

图片派发后尚未保存结果的检查点被视为不确定请求，不会静默再次调用模型。图片或视频任务的归档需要精确任务 ID 与明确确认；归档保留记录，不会取消供应商任务，也不会自动提交新的付费请求。恢复原任务与重新生成的费用边界在节点详情中说明。

## 验证方式

回归使用临时或内存数据库、本地模拟接口与合成图片，不接触正式项目数据或付费模型。提交前运行 `npm run format` 与 `npm run check`，后者包含格式、Lint、依赖边界、前后端测试、类型检查及生产构建。界面另检查桌面、320px 窄屏和短屏。
