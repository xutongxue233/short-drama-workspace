import type { AssetSelection } from "../../shared/contracts";
import type { Project } from "../../types";
import { Badge } from "../../ui";
import { AssetGallery } from "./components/AssetGallery";

export function AssetLibrary({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (asset: AssetSelection) => void;
}) {
  const entries = projects.flatMap((project) =>
    project.assets.map((asset) => ({
      asset,
      projectId: project.id,
      projectName: project.name,
    })),
  );
  return (
    <div className="management-scroll">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CREATIVE LIBRARY</div>
          <h1>
            每一份灵感，都有归处<span className="heading-dot">.</span>
          </h1>
          <p>跨项目查看角色、场景与制作成果，守住故事的一致性。</p>
        </div>
        <Badge>{entries.length} 份资产</Badge>
      </div>
      <AssetGallery entries={entries} onOpen={onOpen} />
    </div>
  );
}
