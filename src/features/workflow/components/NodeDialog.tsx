import { FileClock, GitBranch, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { TextContent } from "../../../components/TextContent";
import type { Action } from "../../../shared/contracts";
import { statusNames } from "../../../shared/labels";
import { projectPermissions } from "../../../shared/project-members";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Alert, Button, Dialog, DialogBody, DialogFooter } from "../../../ui";

export function NodeDialog({
  node,
  project,
  agents,
  busy,
  onAction,
  onClose,
  onActivity,
}: {
  node: WorkflowNode;
  project?: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onClose: () => void;
  onActivity?: () => void;
}) {
  const [rerunConfirm, setRerunConfirm] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState("");
  useEffect(() => {
    setRerunConfirm(false);
    setArchiveConfirm("");
  }, [node.id, project?.id]);
  const path = project ? `/projects/${project.id}` : "";
  const uncertainImages =
    node.characterGeneration?.images?.filter(
      (image) => image.status === "submitted" && !image.result?.url,
    ) ?? [];
  const taskId = node.videoGeneration?.taskId;
  const canEdit = project ? projectPermissions(project).canEdit : false;
  const canArchive = Boolean(
    canEdit &&
    project &&
    !project.running &&
    !project.backgroundTask &&
    !project.chatPending,
  );
  const archiveTask = async (kind: "image" | "video", id: string) => {
    if (!canArchive || busy) return;
    const key = `${kind}:${id}`;
    if (archiveConfirm !== key) {
      setArchiveConfirm(key);
      return;
    }
    const ok = await onAction(
      `${path}/${kind}-task/archive`,
      kind === "video"
        ? { taskId: id, acknowledgement: "archive-without-cancelling" }
        : { captureId: id, acknowledgement: "new-image-may-charge" },
      "旧请求已归档；需要重新制作时，请另行选择重试",
    );
    if (ok) setArchiveConfirm("");
  };
  const canRerun = !!(
    canEdit &&
    project &&
    node &&
    !project.running &&
    !project.backgroundTask &&
    !project.chatPending &&
    !uncertainImages.length &&
    !project.approval &&
    project.chapters.length &&
    project.nodes
      .slice(
        0,
        project.nodes.findIndex((item) => item.id === node.id),
      )
      .every((item) => item.status === "completed")
  );

  return (
    <Dialog
      title={node.name}
      description={`${statusNames[node.status]} · ${agents.find((a) => a.id === node.agentId)?.name || "创作团队"}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      wide
    >
      <DialogBody>
        <div className="node-detail">
          <p>{node.description}</p>
          {node.error && <Alert tone="danger">{node.error}</Alert>}
          {taskId && (
            <Alert tone="warning">
              <div>
                <p>待取回的视频任务：{taskId}</p>
                <p>
                  继续制作会尝试取回此任务。若供应商已无法取回，可核查后归档旧任务。
                </p>
                {archiveConfirm === `video:${taskId}` && (
                  <p>
                    归档将放弃工作台取回此任务并保留台账，不会取消供应商任务，远端可能继续计费。之后重新制作将提交新任务，可能再次计费。
                  </p>
                )}
                <Button
                  disabled={busy || !canArchive}
                  onClick={() => void archiveTask("video", taskId)}
                >
                  {archiveConfirm === `video:${taskId}`
                    ? "确认归档旧视频任务"
                    : "归档旧视频任务"}
                </Button>
              </div>
            </Alert>
          )}
          {uncertainImages.map((image) => (
            <Alert tone="warning" key={image.captureId}>
              <div>
                <p>图像请求结果待核查：{image.name}</p>
                <p>请先在供应商侧核查请求结果，再决定是否归档。</p>
                {archiveConfirm === `image:${image.captureId}` && (
                  <p>
                    归档不会取消远端请求；供应商可能已完成并计费。之后重试会重新发起图像请求，可能再次计费。旧记录将保留在台账中。
                  </p>
                )}
                <Button
                  disabled={busy || !canArchive}
                  onClick={() => void archiveTask("image", image.captureId)}
                >
                  {archiveConfirm === `image:${image.captureId}`
                    ? "确认归档图像请求"
                    : "归档图像请求"}{" "}
                  {image.name}
                </Button>
              </div>
            </Alert>
          ))}
          {node.output ? (
            <TextContent text={node.output} />
          ) : (
            <div className="empty-state compact">
              <GitBranch size={28} />
              <p>节点开始后，创作成果会记录在这里。</p>
            </div>
          )}
          {rerunConfirm && (
            <Alert tone="warning">
              <span>
                将从「{node.name}
                」重新执行，后续节点需要重新确认。已锁定资产继续作为创作标准。
                重新制作会调用已配置的模型服务。
              </span>
            </Alert>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        {onActivity && (
          <Button onClick={onActivity}>
            <FileClock size={15} />
            节点工作记录
          </Button>
        )}
        <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
          返回工作台
        </Button>
        {canRerun && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (!rerunConfirm) {
                setRerunConfirm(true);
                return;
              }
              void onAction(`${path}/run`, { nodeId: node.id }, "已开始重新制作").then(
                (ok) => {
                  if (ok) onClose();
                },
              );
            }}
          >
            <Play size={15} />
            {rerunConfirm ? "确认重新制作" : "从此节点重新制作"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
