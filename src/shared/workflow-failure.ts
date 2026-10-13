export function failureAdvice(error: string) {
  if (/基础外观|基础设计|镜头状态|characterDesign|sceneStates/.test(error))
    return "角色基础设计需要调整：五官、发型、服装和配色各选一个明确方案；逆光、现形、受伤等剧情状态单独放入 sceneStates，不混入基础外观。重试时团队会重新整理设计并校验一次。只需本集已提供的原文，无需上传整本小说，也无需修改模型接口配置。";
  if (
    /角色「[^」]+」(?:未在已提供原文或锁定资产中出现|尚未出现在原著、已批准剧本或有效锁定角色中|的称谓与姓名缺少明确的同一人物依据)|角色规划.*(?:姓名|来源|依据)|角色.*(?:姓名|称谓).*校验/.test(
      error,
    )
  )
    return "角色名单需要核对来源。只需提供本集小说片段，无需上传完整小说。请检查角色姓名、称谓与已导入章节、当前已批准剧本或有效角色资产是否一致。来源不明时，请编剧补充人物依据，或通过剧本审批确认新增角色，再重试当前节点。有依据但尚无资产的角色会自动创建设定，无需手动新建；姓名未交代时沿用称谓，后续章节可继续补充。";
  if (/角色规划/.test(error))
    return "角色规划结果未通过校验。重试时系统会先按本集出场内容整理名单，并在校验失败时自动纠正一次。若仍无法完成，请根据错误详情核对人物称谓或出场描述。只需提供本集小说片段，无需上传完整小说；尚无资产的角色会自动创建设定。";
  if (
    /未开通|未激活|ModelNotOpen|not.{0,20}(?:activated|enabled|opened)|activate.{0,20}model|open.{0,20}model/i.test(
      error,
    )
  )
    return "模型尚未开通或当前账号无调用权限。请在供应商控制台开通对应模型，或在模型接入中填写已开通的模型 ID，再重试当前节点。";
  if (
    /模型.*不存在|model.{0,30}(?:not found|not exist)|InvalidModel|NotFound/i.test(
      error,
    )
  )
    return "模型或接口未找到。请核对供应商提供的模型 ID 和接口地址后重试。";
  return "当前节点未完成。请展开错误详情查看具体原因，处理后重试当前节点。";
}

export function failureSummary(error: string) {
  const advice = failureAdvice(error);
  if (advice.startsWith("角色基础设计")) return "角色基础外观与剧情状态需分开整理。";
  if (advice.startsWith("角色名单")) return "本集角色名单需要核对人物来源。";
  if (advice.startsWith("角色规划")) return "角色规划未通过校验，请查看记录后重试。";
  if (advice.startsWith("模型尚未开通")) return "模型未开通或账号无调用权限。";
  if (advice.startsWith("模型或接口")) return "模型或接口未找到，请核对配置。";
  return "节点未完成，请查看记录中的具体原因。";
}
