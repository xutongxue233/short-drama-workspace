import { Link2, Zap } from "lucide-react";
import { type Provider } from "../../types";
import { Button, Dialog, DialogBody, DialogFooter } from "../../ui";
import { protocolTestDescriptions } from "./modelConfig";

export function TestProviderDialog({
  provider,
  onClose,
  onConfirm,
}: {
  provider: Provider;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      className="settings-dialog"
      title="测试模型连接"
      description={`检查「${provider.name}」的接口是否可用。`}
      onClose={onClose}
    >
      <DialogBody className="settings-confirm-body">
        <p>
          将使用已保存的认证信息，向配置地址发送连接检查请求。此次检查不会生成文字、图片或视频。
        </p>
        <div className="settings-test-target">
          <Link2 size={15} />
          <span>{provider.baseUrl}</span>
        </div>
        <p className="muted">{protocolTestDescriptions[provider.protocol]}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onConfirm();
          }}
        >
          <Zap size={15} />
          开始测试
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
