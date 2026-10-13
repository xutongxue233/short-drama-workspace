# 映序 UI

项目自己的 React + TypeScript 组件库，无第三方 UI 框架依赖。组件已用于群聊工作台、资产编辑、Agent 中心和模型中心。

开发服务运行后访问 [组件预览](http://127.0.0.1:5173/ui)。预览中的交互只更新本地组件状态，不访问项目 API。

## 使用方式

在应用入口最后引入 `tokens.css`、`primitives.css`，组件从 `src/ui` 导入。`index.ts` 不隐式引入样式。

```tsx
import { Button, Field, Input } from "./ui";

<Field htmlFor="project-name" label="项目名称" hint="最多 80 个字">
  <Input maxLength={80} value={name} onChange={e => setName(e.target.value)} />
</Field>
<Button variant="primary" type="submit" loading={saving}>保存项目</Button>
```

## 源码组织

`index.ts` 是公开入口。实现按职责放在 `Button.tsx`（含 IconButton）、`Switch.tsx`、`Badge.tsx`、`Field.tsx`（含文本输入控件）、`Select.tsx`、`Dialog.tsx` 和 `EmptyState.tsx`。类名合并工具为 `cx.ts`；`primitives.tsx` 仅保留旧导入路径兼容。`primitives.css` 引入独立的 `select.css`，业务页面无需额外引入。

Field 及其控件共用内部上下文，Dialog 的层级、焦点、背景隔离和关闭确认作为一个完整模块维护。组件不能依赖业务 feature、API 或工作区状态；交互回归测试位于 `primitives.test.tsx`。

## 组件约定

| 组件             | 主要属性与行为                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button           | `variant`: primary / secondary / ghost / danger；`size`: sm / md；`loading` 保留内容尺寸并禁用重复提交；默认 `type="button"`，表单提交需明确声明 |
| IconButton       | 必填 `label` 同时用作无障碍名称和默认 title；支持 loading、size 和原生按钮属性                                                                   |
| Switch           | `checked`、`onCheckedChange`、`label`、`disabled`；原生按钮与 `role="switch"`，支持键盘操作                                                      |
| Badge            | `tone`: neutral / accent / success / warning / danger；状态需要同时提供文字                                                                      |
| Field            | `htmlFor`、`label`、`hint`、`error`、`optional`；自动向内部输入控件传递 id、aria-describedby、aria-invalid；外部布局决定字段间距                 |
| Input / Textarea | 支持 ref 和原生属性；统一普通、焦点、只读、禁用及无效状态                                                                                        |
| Select           | 自绘单选菜单，保持 `value/defaultValue`、`onChange` 与 `<option>` 接口；支持 `searchable`、`searchPlaceholder`、分组、原生表单校验和重置         |
| EmptyState       | `icon`、`title`、`description`、`action`；解释当前状态并提供下一步                                                                               |
| Dialog           | `title`、`description`、`onClose`、`wide`、`busy`、`dirty`、`initialFocusRef`；使用 portal，内容区独立滚动                                       |
| DialogClose      | 通过所在 Dialog 的统一关闭流程退出；编辑表单的取消按钮应使用此组件                                                                               |

## 下拉选择

```tsx
<Field htmlFor="generation-model" label="生成模型" hint="选择已开通的型号">
  <Select
    name="model"
    value={model}
    onChange={(event) => setModel(event.target.value)}
    searchable
    searchPlaceholder="搜索模型名称或 ID"
  >
    <optgroup label="图片生成">
      <option value="image-01">image-01</option>
    </optgroup>
  </Select>
</Field>
```

单选触发器和菜单均由组件库绘制，采用统一的颜色、圆角、选中标记与滚动样式。长标签在触发器中省略，在菜单中完整换行。长列表可启用搜索；搜索是本地过滤，不发网络请求。普通菜单支持方向键、Home / End、PageUp / PageDown、连续字符定位；Enter / 空格 / Tab 确认，Esc 取消当前导航。搜索模式下 Home / End 保留文本编辑行为，Ctrl + Home / End 跳到列表首尾。禁用选项与禁用分组会被键盘跳过。

菜单在最近的 Dialog 中挂载，并使用 Popover 顶层渲染避开滚动区域裁切；小视口自动限制宽度、向上展开，窗口和滚动位置变化会重新定位。焦点保留在触发器或搜索框中，选择后回到触发器；Esc 先关闭菜单，之后才能关闭弹窗。搜索展开时仅搜索框具有 combobox 角色，避免出现两个可访问组合框。

隐藏的原生 select 仅用于 `name` / `form` / `required` / `FormData` / 表单重置与标准 `onChange` 事件，不进入焦点顺序或无障碍树。`ref` 仍指向该原生表单元素，其 `focus()` 会聚焦到可见控件。`multiple` 或 `size > 1` 保留原生列表模式。

组件测试应模拟用户操作：`fireEvent.click(getByRole("combobox", { name }))`，然后 `fireEvent.click(getByRole("option", { name }))`；不要向触发按钮发送 `fireEvent.change`。选择器的键盘、表单、弹窗、搜索与窄屏边界回归测试位于 `Select.test.tsx`。

## 编辑弹窗

```tsx
<Dialog title="编辑资产" onClose={close} dirty={changed} busy={saving}>
  <form onSubmit={save}>
    <DialogBody>{/* 字段、提示与校验 */}</DialogBody>
    <DialogFooter>
      <DialogClose>取消</DialogClose>
      <Button type="submit" variant="primary" loading={saving}>
        保存
      </Button>
    </DialogFooter>
  </form>
</Dialog>
```

`dirty` 应与打开时的数据比较，初始默认值不算修改。取消、关闭按钮、Esc 和遮罩点击都会经过未保存确认；保存成功后可以直接关闭。`busy` 时禁用所有退出入口，并由调用方禁用编辑字段。

弹窗支持 Tab / Shift+Tab 循环、关闭后焦点恢复、输入法组合期间 Esc 保护、背景 inert、遮罩拖动保护。标题和操作区不参与正文滚动。嵌套弹窗仅最上层接收交互。组件样式支持窄屏、短屏及减少动画偏好。

## 视觉维护

色彩、圆角、间距、控件尺寸和动画时长集中在 `tokens.css`。状态色用于表达状态，强调色用于当前操作。页面只处理业务布局，避免再次定义整套按钮、表单或弹窗样式。业务样式需要覆盖组件时，用业务类与组件类共同限定，尤其是响应式隐藏规则。

现有页面使用专门的侧栏、群聊、时间线和资产卡片布局；基础交互控件从此目录复用。新增组件需在预览页展示普通、窄屏、禁用、加载、空状态和错误反馈中适用的状态。
