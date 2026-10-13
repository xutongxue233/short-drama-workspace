# 模型服务模块

外部页面从 `features/models` 导入 `ModelCenter`。模块维护模型服务的配置与连接检查，真正的模型调用由服务端负责。

| 文件                                                  | 职责                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `ModelCenter.tsx`                                     | 组合筛选、预设、服务列表与弹窗，不承担请求实现              |
| `useModelManagement.ts`                               | 启停、删除、连接检查及临时结果；统一调用上层提供的 `mutate` |
| `ProviderEditor.tsx`                                  | 服务表单、未保存判断、密钥输入与保存 payload                |
| `ProviderRow.tsx`                                     | 单条服务的展示与事件回调                                    |
| `ProviderPresetGallery.tsx`                           | 连接模板列表，不创建服务记录                                |
| `ModelCapabilityFilter.tsx`                           | 文本、图像、视频能力筛选与数量                              |
| `DeleteProviderDialog.tsx` / `TestProviderDialog.tsx` | 相应动作的说明与确认                                        |
| `modelConfig.ts`                                      | 能力名称、协议说明与协议能力约束                            |
| `providerPresets.ts`                                  | 可编辑的接口模板、推荐模型及官方文档链接                    |
| `styles/`                                             | 服务列表、能力筛选、预设和编辑器各自的样式                  |

新增服务商通常只需增加 `providerPresets.ts` 的模板。新增协议还需要更新 `modelConfig.ts`、共享 `Provider` 类型及服务端适配器；不能只改前端下拉框。

维护约束：

- 表单初始化默认值不算未保存修改；输入密钥、清除密钥或改变启用状态都算修改。
- 编辑已保存服务时，空密钥表示保留原密钥；只有 `clearApiKey` 明确请求删除。服务记录只返回 `hasKey`，不返回真实密钥。
- 选择新预设会清除当前密钥输入，并默认停用；保存预设不会触发生成。
- 连接测试须由用户确认，只调用 `/providers/:id/test`。修改服务后清除旧测试结果，避免展示过期结论。
- `mutate` 的错误由应用壳统一提示，局部操作只负责解除 busy 状态；不要叠加重复的错误 toast。
- 通用按钮、弹窗、输入框等从 `src/ui` 导入。管理页面共用控件和布局放在 `components/settings`；不要将具体服务商逻辑放进 UI 库。

`ModelPicker.tsx` 封装模型列表获取、来源说明、搜索选择与手动输入，两类配置表单共用。通过 `api.request` 调用只读 `POST /providers/models`，不经过会刷新工作区的保存操作。配置改变或关闭组件时取消查询，不沿用其他服务的目录。基础 `ui/Select` 只处理通用选项与可访问交互，不知道供应商或密钥。
