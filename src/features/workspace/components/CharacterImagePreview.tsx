import type { Asset } from "../../../types";
import { Dialog, DialogBody, DialogClose, DialogFooter } from "../../../ui";
import { AssetMedia } from "../../assets/components/AssetMedia";

export function CharacterImagePreview({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={`角色大图 · ${asset.name}`}
      description={`v${asset.version} · 核对五官、完整身形与服装细节`}
      className="character-image-preview"
      wide
      onClose={onClose}
    >
      <DialogBody>
        <div className="character-preview-media">
          <AssetMedia key={`${asset.id}:${asset.version}:${asset.url}`} item={asset} />
        </div>
        {asset.characterDesign && (
          <details className="character-preview-design">
            <summary>查看基础外观设定</summary>
            <p>{asset.characterDesign.baseAppearance}</p>
          </details>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="secondary">关闭预览</DialogClose>
      </DialogFooter>
    </Dialog>
  );
}
