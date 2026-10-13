import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Agent, Mutate } from "../../types";
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from "../../ui";
import type { SettingsProps } from "../../components/settings/types";

export function DeleteAgentDialog({
  agent,
  projectCount,
  mutate,
  notify,
  onClose,
}: {
  agent: Agent;
  projectCount: number;
  mutate: Mutate;
  notify: SettingsProps["notify"];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(`/agents/${agent.id}`, undefined, "DELETE");
      notify(`${agent.name} 已删除`);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      className="settings-dialog"
      title={`删除 ${agent.name}`}
      description="删除后无法恢复该成员的配置。"
      busy={busy}
      onClose={onClose}
    >
      <DialogBody className="agent-delete-body">
        <p>
          只有未被项目或历史记录使用的自定义成员可以删除。如需保留记录，请取消并停用成员。
        </p>
        {projectCount > 0 && <p>当前参与 {projectCount} 个项目，建议使用停用功能。</p>}
        {error && (
          <p className="agent-form-error" role="alert">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={busy}>取消</DialogClose>
        <Button variant="danger" loading={busy} onClick={() => void remove()}>
          <Trash2 size={15} />
          确认删除
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
