import { Trash2 } from "lucide-react";
import { type Provider } from "../../types";
import { Alert, Button, Dialog, DialogBody, DialogFooter } from "../../ui";

export function DeleteProviderDialog({
  provider,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  provider: Provider;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      className="settings-dialog"
      title="删除模型服务"
      busy={busy}
      description={`将删除「${provider.name}」的接口配置与已保存密钥。`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <DialogBody className="settings-confirm-body">
        <p>已完成的作品和项目记录会保留。使用此服务的 Agent 需要重新选择模型服务。</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={() => {
            onConfirm();
          }}
          disabled={busy}
        >
          <Trash2 size={15} />
          删除服务
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
