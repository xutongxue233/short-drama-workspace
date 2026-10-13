import { ArrowRight } from "lucide-react";
import { Button, Dialog, DialogBody, DialogFooter } from "../../ui";

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="从小说，到你的第一部短剧"
      description="映序 · 本地创作工作台 0.1"
      onClose={() => onClose()}
    >
      <DialogBody>
        <div className="help-steps">
          {[
            [
              "导入本集原文",
              "新建项目，添加本集要改编的章节或片段。无需确定总集数，也无需上传整本小说。",
            ],
            [
              "和团队一起创作",
              "在群成员中邀请真人或 Bot，设置项目权限和可选分工。普通消息发到群聊，选择 Agent 时请求 AI 协作。拥有编辑权限后可启动制作。",
            ],
            [
              "在关键处做决定",
              "风格、剧本、角色和分镜会请求确认。你可以批准，也可以写下意见要求修改。",
            ],
            [
              "沉淀资产与记忆",
              "锁定角色设定、记录剧情事实，压缩阶段摘要。项目间的上下文相互独立。",
            ],
            [
              "接入你的模型",
              "管理员在模型接入中配置文字、图片和视频接口，并在 Agent 中心绑定模型。有项目编辑权限的成员可以使用已配置的模型开始制作。",
            ],
            [
              "复用创作技能",
              "管理员在技能库维护创作方法、导入或导出 SKILL.md，并管理 Agent 的技能绑定。有项目编辑权限的成员可在聊天中选择技能或输入 $技能名调用；普通群聊成员可以参与讨论。",
            ],
          ].map(([title, content], i) => (
            <div key={title}>
              <span>{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{content}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={() => onClose()}>
          开始创作
          <ArrowRight size={15} />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
