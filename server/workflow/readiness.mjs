/** Public, read-only configuration diagnostics; never select another provider. */
export function workflowReadiness(project, state) {
  return project.nodes
    .filter((node) => node.status !== "completed")
    .flatMap((node) => {
      const agent = state.agents.find((item) => item.id === node.agentId);
      const provider = state.providers.find((item) => item.id === agent?.providerId);
      const allowed = ["characters", "storyboard"].includes(node.id)
        ? ["text", "image"]
        : node.id === "video"
          ? ["video"]
          : ["text"];
      const problem = !agent?.enabled
        ? "Agent 尚未启用"
        : !provider
          ? "尚未绑定模型服务"
          : !provider.enabled
            ? `绑定的「${provider.name}」服务已停用`
            : !allowed.includes(provider.kind)
              ? `需要 ${allowed.join(" / ")} 接口，当前绑定为 ${provider.kind}`
              : !provider.model && !agent.model && provider.protocol !== "webhook"
                ? "尚未填写模型名称"
                : null;
      return problem
        ? [
            {
              nodeId: node.id,
              agentId: node.agentId,
              message: `「${agent?.name || node.agentId}」${problem}。请在 Agent 中心和模型接入中检查。`,
            },
          ]
        : [];
    });
}
