# Agent 绑定电脑与人工接管

在「Agent 中心 → 管理电脑」登记电脑，然后在 Agent 编辑窗口选择「绑定电脑」。同一台电脑可以绑定多个 Agent；人工接管时，所有绑定到这台电脑的 Agent 都受同一把锁保护。电脑管理、画面查看和人工输入仅向工作台管理员开放。

电脑上需要运行本目录提供的连接端。它连接当前已登录的图形桌面，支持 Windows、macOS 和 Linux X11。当前显示主屏幕，提供鼠标单击、双击、右键、滚动、常用按键和文本粘贴。它不是完整的远程桌面软件，暂不提供音频、文件传输、拖拽或多显示器切换。

## 在被控电脑安装连接端

安装 Python 3.10 或更新版本，然后将 `scripts/computer-bridge` 目录复制到被控电脑，或在该电脑检出本项目。以下命令在项目根目录运行；macOS / Linux 可将 `python` 替换为 `python3`。

```sh
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m pip install -r scripts/computer-bridge/requirements.txt
.\.venv\Scripts\python.exe scripts/computer-bridge/bridge.py
```

macOS / Linux：

```sh
.venv/bin/python -m pip install -r scripts/computer-bridge/requirements.txt
.venv/bin/python scripts/computer-bridge/bridge.py
```

启动时会显示连接地址与随机连接密钥。在「管理电脑」中填写电脑名称、地址与密钥。连接端需要保持运行；Ctrl+C 停止共享。如果希望重启后继续使用同一个密钥，在启动前设置环境变量 `FRAMEFLOW_COMPUTER_TOKEN`，值至少包含 32 个字符且不能含空白。不要将密钥写入源码或提交到 Git。

| 系统    | 运行条件                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | 在已登录的桌面会话中运行。锁屏、UAC 安全桌面和更高权限窗口不保证可操作。                                                                                                                       |
| macOS   | 在「系统设置 → 隐私与安全性」为启动连接端的终端 / Python 授予「屏幕与系统音频录制」（旧系统名为「屏幕录制」）和「辅助功能」权限，必要时重新启动连接端。                                        |
| Linux   | 当前支持 X11 / Xorg 图形会话，需要有效的 `DISPLAY`。Debian / Ubuntu 可安装 `python3-venv python3-tk scrot xclip`。Wayland 会明确拒绝启动，请切换 Xorg 会话；无桌面的服务器需要先配置图形桌面。 |

连接端使用 [PyAutoGUI](https://pyautogui.readthedocs.io/en/latest/) 进行截图与输入，使用 [Pyperclip](https://pyperclip.readthedocs.io/en/latest/) 粘贴中文等 Unicode 文本。发送文本会更新被控电脑的剪贴板。将被控电脑的鼠标移到主屏角落可触发 PyAutoGUI 紧急停止；移开鼠标并检查权限后，结束接管再重新接管，以取得新的控制版本。

## 连接另一台电脑

地址由**工作台 API 服务器**访问，不是由浏览器访问。`127.0.0.1` 表示 API 服务器所在的电脑；其他电脑需要可信网络、隧道或 HTTPS。

推荐通过现有 SSH 隧道连接：在工作台服务器将本地端口转发至远端连接端的 `127.0.0.1:8766`，然后登记本地转发地址。连接端默认只监听回环地址。

也可使用 HTTPS 直接连接：

```sh
python scripts/computer-bridge/bridge.py --host 0.0.0.0 --port 8766 --cert computer-cert.pem --key computer-key.pem
```

使用与登记域名匹配、工作台服务器信任的证书。自建 CA 可通过 Node 的 `NODE_EXTRA_CA_CERTS` 配置；不要关闭 TLS 校验。直接登记地址例如 `https://computer.example.com:8766`。非回环 HTTP 地址会被工作台拒绝，连接端也拒绝没有 TLS 的外部监听。只向工作台服务器开放所需端口。

## 查看与接管

1. 点击 Agent 卡片上的「查看电脑」，打开只读实时画面。这不会暂停 Agent，也不会发送任何鼠标键盘输入。
2. 点击「接管电脑」。服务端先持久化人工锁并中止相关 Agent 的本地聊天 / 制作等待，然后与连接端确认控制切换。确认成功后才允许人工输入。
3. 接管期间，绑定 Agent 的新任务和电脑操作会被服务端拒绝。多个 Agent 共用电脑也不会绕过该限制。
4. 点击「结束接管」将电脑交还给 Agent。已有工作流保持在检查点，按项目中的「继续制作」恢复；不自动重复提交模型请求。

接管不是浏览器临时状态。关窗、断线、退出登录、工作台重启都会保留人工锁；重新打开后可以结束接管。其他管理员可以明确强制结束接管，恢复无人可释放的锁。连接失败时可能已经暂停 Agent，界面会提示异常；恢复连接后再次接管或结束接管即可。

暂停会取消本地请求和后续调度，但已提交给模型服务商的远端任务可能继续运行。接管前已经开始的一次鼠标 / 键盘输入会先完成，连接端确认切换后拒绝旧控制令牌。这套锁只覆盖经过本工作台与连接端的操作，无法暂停其他远控软件或独立脚本。

## Agent 自动操作的边界

绑定会建立电脑关系，并让现有聊天 / 制作流程遵守人工接管锁。当前内置 Agent 仍使用原有模型调用流程，绑定本身不会使文字模型自动获得视觉识别和电脑操作能力。

外部 Agent 执行器可以通过受认证保护的 `POST /api/agents/:id/computer/actions` 发送有限的桌面动作，复用相同的锁和输入校验。该入口遵循现有管理员会话与 CSRF 认证；不是公开接口，也不能执行任意 shell 命令。

动作示例：

```json
{ "type": "click", "x": 0.5, "y": 0.4, "button": "left" }
```

`x/y` 为画面上的归一化坐标（0–1）。另支持 `{ "type": "key", "key": "enter" }`、`{ "type": "text", "text": "你好" }`、`{ "type": "scroll", "delta": -3 }`。文本最多 4000 字符，滚动为 -10 至 10 的整数；按键限定为界面与连接端支持的常用按键。新接入执行器应通过工作台发送动作，不应绕过接管锁直接调用连接端。

## 验证

连接端协议测试使用假桌面，不会截图或操纵开发者电脑，也不需要安装图形依赖：

```sh
python -m unittest discover -s scripts/computer-bridge -p "test_*.py" -v
```

工作台接口、接管互斥、暂停与前端状态测试包含在 `npm test` 中。跨平台协议相同，但 macOS 权限、Linux 桌面组件以及实际画面 / 输入效果仍需在目标操作系统验证。
