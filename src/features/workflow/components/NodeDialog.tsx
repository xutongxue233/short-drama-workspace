import { FileClock, GitBranch, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { TextContent } from "../../../components/TextContent";
import type { Action } from "../../../shared/contracts";
import { statusNames } from "../../../shared/labels";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Button, Dialog, DialogBody, DialogFooter } from "../../../ui";

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
  useEffect(() => setRerunConfirm(false), [node.id, project?.id]);
  const path = project ? `/projects/${project.id}` : "";
  const canRerun = !!(
    project &&
    node &&
    !project.running &&
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
          {node.error && <div className="error-box">{node.error}</div>}
          {node.output ? (
            <TextContent text={node.output} />
          ) : (
            <div className="empty-state compact">
              <GitBranch size={28} />
              <p>节点开始后，创作成果会记录在这里。</p>
            </div>
          )}
          {rerunConfirm && (
            <div className="form-info">
              <GitBranch size={17} />
              <span>
                将从「{node.name}
                」重新执行，后续节点需要重新确认。已锁定资产继续作为创作标准。
                重新制作会调用已配置的模型服务。
              </span>
            </div>
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
