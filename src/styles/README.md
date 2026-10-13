# 样式组织

`src/styles.css` 是工作台样式入口，仅保留有顺序的 `@import`。本轮拆分保留了原 CSS 的全部声明与级联顺序，没有改变选择器或断点。

- `base.css`：页面重置、基础排版及旧业务色彩别名；通用 UI 的正式 token 在 `src/ui/tokens.css`。
- `content.css`、`pages.css`、`forms.css`、`dialog-content.css`：多个功能共用的业务容器。
- `detail.css`：跨功能细节、状态及动效补充。新增规则优先就近进入其所属功能样式，避免继续集中堆积。
- `responsive/`：跨布局断点和容器查询，集中在基础规则之后加载。
- `src/app/styles/`：应用壳和全局反馈；`src/features/*/styles/`：对应功能的局部样式。

不要在组件内重复导入这些工作台样式，以免改变装配顺序。修改共享控件本身应编辑 `src/ui/primitives.css`；`main.tsx` 仍负责在业务样式后加载 UI token 与控件样式。新增视觉规则应复用已有 token 并通过窄屏、长文本与短视口检查。
