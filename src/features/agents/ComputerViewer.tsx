import { useState, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, Eye, Hand, Monitor } from "lucide-react";
import type { Computer } from "../../types";
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Select,
  Textarea,
} from "../../ui";
import { useComputerSession } from "./useComputerSession";

const keys = [
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["escape", "Esc"],
  ["backspace", "退格"],
  ["delete", "删除"],
  ["space", "空格"],
  ["up", "↑"],
  ["down", "↓"],
  ["left", "←"],
  ["right", "→"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "Page Up"],
  ["pagedown", "Page Down"],
  ["ctrl+a", "Ctrl+A"],
  ["ctrl+c", "Ctrl+C"],
  ["ctrl+v", "Ctrl+V"],
  ["ctrl+x", "Ctrl+X"],
  ["ctrl+z", "Ctrl+Z"],
  ["alt+tab", "Alt+Tab"],
  ["meta+a", "⌘A"],
  ["meta+c", "⌘C"],
  ["meta+v", "⌘V"],
  ["meta+x", "⌘X"],
  ["meta+z", "⌘Z"],
] as const;

export function ComputerViewer({
  computer: initial,
  userId,
  onClose,
}: {
  computer: Computer;
  userId: string;
  onClose: () => void;
}) {
  const session = useComputerSession(initial, userId);
  const { computer, owned, canControl, online, busy } = session;
  const [text, setText] = useState("");
  const [button, setButton] = useState<"left" | "right" | "double">("left");
  const [recovering, setRecovering] = useState(false);
  const [released, setReleased] = useState(false);
  const human = computer.control.mode === "human";
  function click(event: MouseEvent<HTMLImageElement>, override?: "right") {
    if (!canControl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    void session.send({ type: "click", x, y, button: override ?? button });
  }
  async function release(force = false) {
    if (await session.release(force)) {
      setRecovering(false);
      setReleased(true);
    }
  }
  return (
    <Dialog
      className="computer-viewer"
      title={computer.name}
      description="查看画面不会影响 Agent。接管成功后，鼠标、按键和文字操作才会开启。"
      onClose={onClose}
      busy={busy}
      wide
    >
      <DialogBody className="computer-viewer-body">
        <div className={`computer-mode-strip ${human ? "is-human" : ""}`}>
          <span>
            {human ? <Hand size={19} /> : <Eye size={19} />}
            <strong>
              {owned
                ? "你正在接管"
                : human
                  ? `${computer.control.ownerName || "其他管理员"}正在接管`
                  : "仅查看"}
            </strong>
          </span>
          <span className={`computer-connection ${online ? "is-online" : ""}`}>
            <i />
            {busy ? "正在处理…" : online ? "画面已连接" : "等待电脑连接"}
          </span>
        </div>
        {human && (
          <Alert tone="warning">
            绑定此电脑的 Agent
            已暂停。关闭窗口或连接中断会保留接管状态；请主动结束接管，再到项目点击「继续」恢复任务。
          </Alert>
        )}
        {released && !human && (
          <Alert tone="success">
            已结束接管。需要恢复之前的任务时，请到项目点击「继续」；聊天任务请重新发送。
          </Alert>
        )}
        {session.error && <Alert tone="danger">{session.error}</Alert>}
        <div
          className={`computer-screen ${canControl ? "can-control" : ""}`}
          aria-label="电脑画面"
        >
          {session.screenUrl ? (
            <img
              src={session.screenUrl}
              alt={`${computer.name}的实时画面`}
              draggable={false}
              onError={session.imageFailed}
              onClick={click}
              onContextMenu={(event) => {
                if (!canControl) return;
                event.preventDefault();
                click(event, "right");
              }}
            />
          ) : (
            <div className="computer-screen-placeholder">
              <Monitor size={38} />
              <p>正在连接电脑画面…</p>
            </div>
          )}
          {!online && session.screenUrl && (
            <span className="computer-stale">画面已暂停 · 操作不可用</span>
          )}
        </div>
        <div className="computer-inputs" aria-label="远程操作">
          <div className="computer-pointer-controls">
            <Field label="鼠标操作" htmlFor="computer-pointer-mode">
              <Select
                id="computer-pointer-mode"
                value={button}
                disabled={!canControl}
                onChange={(event) => setButton(event.target.value as typeof button)}
              >
                <option value="left">单击</option>
                <option value="double">双击</option>
                <option value="right">右键</option>
              </Select>
            </Field>
            <Button
              size="sm"
              disabled={!canControl}
              onClick={() => void session.send({ type: "scroll", delta: 3 })}
            >
              <ArrowUp size={14} />
              向上滚动
            </Button>
            <Button
              size="sm"
              disabled={!canControl}
              onClick={() => void session.send({ type: "scroll", delta: -3 })}
            >
              <ArrowDown size={14} />
              向下滚动
            </Button>
            <span>
              {canControl
                ? "选择鼠标操作后，点击画面中的位置。"
                : "接管成功并连接画面后可操作。"}
            </span>
          </div>
          <div className="computer-keyboard" aria-label="发送按键">
            {keys.map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                disabled={!canControl}
                aria-label={`发送 ${label} 键`}
                onClick={() => void session.send({ type: "key", key })}
              >
                {label}
              </Button>
            ))}
          </div>
          <Field
            label="输入到电脑的文字"
            htmlFor="computer-text"
            hint={`${text.length} / 4000 字；先点击电脑中的输入框。发送会替换远程电脑的剪贴板内容。`}
          >
            <Textarea
              id="computer-text"
              value={text}
              maxLength={4000}
              rows={2}
              disabled={!canControl}
              onChange={(event) => setText(event.target.value)}
              placeholder="在此输入中文或多行文字…"
            />
          </Field>
          <Button
            disabled={!canControl || !text}
            onClick={async () => {
              if (text && (await session.send({ type: "text", text }))) setText("");
            }}
          >
            发送文字
          </Button>
        </div>
        {recovering && (
          <Alert tone="warning">
            <p>
              这会结束 {computer.control.ownerName || "其他管理员"}{" "}
              的接管并交还电脑。Agent 任务仍需手动继续。
            </p>
            <div className="computer-recovery-actions">
              <Button disabled={busy} onClick={() => setRecovering(false)}>
                取消
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void release(true)}
              >
                确认结束其他人的接管
              </Button>
            </div>
          </Alert>
        )}
      </DialogBody>
      <DialogFooter className="computer-viewer-footer">
        <span>{human ? "关闭窗口会保留接管状态" : "查看不会发送任何电脑操作"}</span>
        <DialogClose>关闭查看</DialogClose>
        {owned ? (
          <Button variant="primary" loading={busy} onClick={() => void release()}>
            结束接管
          </Button>
        ) : human ? (
          <Button
            variant="secondary"
            disabled={busy || recovering}
            onClick={() => setRecovering(true)}
          >
            结束其他人的接管
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!online || busy}
            loading={busy}
            onClick={async () => {
              setReleased(false);
              await session.takeover();
            }}
          >
            <Hand size={16} />
            接管电脑
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
