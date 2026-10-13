/** Only direct instructions to the coordinator can control production. */
export function productionCommand(content, agent, intent = "auto") {
  if (intent === "discussion" || agent.id !== "producer") return null;
  let text = content.trim();
  for (const prefix of [`@${agent.name}`, `＠${agent.name}`, agent.name]) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).replace(/^[\s，,:：]+/, "");
      break;
    }
  }
  // Quotes, questions and negations are discussion, never execution requests.
  if (
    text.length > 300 ||
    /[\n\r「」“”"`？?]/.test(text) ||
    /不要|不用|不必|暂不|先不|无需|别再|别开始|怎么|如何|是否|能否|为什么|比如|例如|举例|如果|需要什么|是什么意思|有什么|的方法|步骤是什么|能不能|可以吗/.test(
      text,
    )
  )
    return null;
  text = text.replace(/^(?:(?:请|麻烦|帮我|帮忙|先|现在|立即)[\s，,]*)+/, "");
  if (/^(?:暂停|停止)(?:制作|创作|工作流|流程)?[吧。！!\s]*$/.test(text)) return "stop";
  if (
    /^(?:继续|开始|启动|恢复|接着|推进)(?:制作|创作|工作流|流程|下一步|下一节点)?[吧。！!\s]*$/.test(
      text,
    )
  )
    return "start";
  if (
    /^(?:(?:开始|继续|接着)[\s，,]*)?(?:创作|制作|生成|改编)(?:第?[一二三四五六七八九十两\d]+集|一部|短剧|这部|这个项目|本项目)/.test(
      text,
    )
  )
    return "start";
  return null;
}
