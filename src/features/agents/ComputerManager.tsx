import { useId, useState, type FormEvent } from "react";
import { Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import type { Agent, Computer } from "../../types";
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Form,
  IconButton,
  Input,
} from "../../ui";
import { computerPath, computerRequest } from "./computerApi";

export function ComputerManager({
  computers,
  agents,
  onClose,
  onChanged,
  onView,
}: {
  computers: Computer[];
  agents: Agent[];
  onClose: () => void;
  onChanged: () => void;
  onView: (computer: Computer) => void;
}) {
  const [editing, setEditing] = useState<Computer | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Computer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      await computerRequest(computerPath(deleting.id), undefined, "DELETE");
      setDeleting(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除电脑失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="管理电脑"
      description="为 Agent 连接工作电脑，再到 Agent 配置中完成绑定。只有管理员可查看和接管电脑。"
      onClose={onClose}
      busy={busy}
      wide
      className="computer-manager"
    >
      <DialogBody>
        <div className="computer-manager-heading">
          <span>{computers.length} 台电脑</span>
          <Button onClick={() => setEditing(null)} disabled={busy}>
            <Plus size={16} />
            添加电脑
          </Button>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="computer-list">
          {computers.map((computer) => {
            const bound = agents.filter((agent) => agent.computerId === computer.id);
            return (
              <div key={computer.id} className="computer-list-item">
                <Monitor size={22} />
                <div>
                  <strong>{computer.name}</strong>
                  <p>
                    {bound.length
                      ? bound.map((agent) => agent.name).join("、")
                      : "尚未绑定 Agent"}
                  </p>
                  <small>
                    {computer.control.mode === "human"
                      ? "人工接管中 · Agent 已暂停"
                      : "可查看或接管"}
                  </small>
                </div>
                <div className="computer-list-actions">
                  <Button size="sm" disabled={busy} onClick={() => onView(computer)}>
                    查看电脑
                  </Button>
                  <IconButton
                    label={`编辑 ${computer.name}`}
                    disabled={busy || computer.control.mode === "human"}
                    onClick={() => setEditing(computer)}
                  >
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    label={`删除 ${computer.name}`}
                    disabled={
                      busy || !!bound.length || computer.control.mode === "human"
                    }
                    title={bound.length ? "请先解除 Agent 绑定" : "删除电脑"}
                    onClick={() => {
                      setError("");
                      setDeleting(computer);
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
            );
          })}
          {!computers.length && (
            <div className="computer-empty">
              <Monitor size={32} />
              <p>添加一台电脑，让 Agent 与你在同一台电脑上协作。</p>
            </div>
          )}
        </div>
        {deleting && (
          <Alert tone="warning">
            <p>删除「{deleting.name}」的连接配置？电脑上的文件不会被删除。</p>
            <div className="computer-recovery-actions">
              <Button disabled={busy} onClick={() => setDeleting(null)}>
                取消删除
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                确认删除电脑
              </Button>
            </div>
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose>完成</DialogClose>
      </DialogFooter>
      {editing !== undefined && (
        <ComputerEditor
          key={editing?.id ?? "new"}
          computer={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            onChanged();
            setEditing(undefined);
          }}
        />
      )}
    </Dialog>
  );
}

function ComputerEditor({
  computer,
  onClose,
  onSaved,
}: {
  computer?: Computer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(computer?.name ?? "");
  const [endpoint, setEndpoint] = useState(computer?.endpoint ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (
      (!computer || token) &&
      (token.length < 32 || token.length > 4000 || /\s/.test(token))
    ) {
      setError("访问密钥须为 32–4000 个字符，且不能包含空白字符。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await computerRequest(
        computer ? computerPath(computer.id) : "/computers",
        {
          name: name.trim(),
          endpoint: endpoint.trim(),
          ...(!computer || token ? { token } : {}),
        },
        computer ? "PATCH" : "POST",
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存电脑配置失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={computer ? `编辑 ${computer.name}` : "添加电脑"}
      onClose={onClose}
      busy={busy}
      dirty={
        name !== (computer?.name ?? "") ||
        endpoint !== (computer?.endpoint ?? "") ||
        !!token
      }
      description="支持 Windows、macOS 和 Linux X11。在目标电脑启动连接服务，再填写地址与访问密钥；macOS 需授权屏幕录制和辅助功能。"
    >
      <Form onSubmit={save}>
        <DialogBody>
          <fieldset className="settings-form-fields" disabled={busy}>
            <Field label="电脑名称" htmlFor={`${id}-name`}>
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：剪辑工作站"
              />
            </Field>
            <Field
              label="连接地址"
              htmlFor={`${id}-endpoint`}
              hint="填写服务器能够访问的电脑连接服务地址。"
            >
              <Input
                type="url"
                required
                maxLength={2000}
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="http://127.0.0.1:8766"
              />
            </Field>
            <Field
              label="访问密钥"
              htmlFor={`${id}-token`}
              hint={
                computer?.hasToken
                  ? "已保存密钥。留空保留原密钥，填写新值可替换。"
                  : "使用目标电脑连接服务启动时设置的密钥，至少 32 个字符，不含空白字符。"
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                required={!computer?.hasToken}
                value={token}
                maxLength={4000}
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <DialogClose>取消</DialogClose>
          <Button variant="primary" type="submit" loading={busy}>
            保存电脑
          </Button>
        </DialogFooter>
      </Form>
    </Dialog>
  );
}
