export const FEISHU_MODULES = Object.freeze({
  tasks: {
    label: "我的任务",
    reason: "读取分配给当前用户的任务及状态变化",
    scopes: ["task:task:read"]
  },
  calendar: {
    label: "日程",
    reason: "读取当前用户参加的日程",
    scopes: ["calendar:calendar.event:read"]
  },
  meetings: {
    label: "会议",
    reason: "查找当前用户参加过的会议和会议结果",
    scopes: ["vc:meeting.search:read", "vc:recording:read"]
  },
  minutes: {
    label: "会议纪要与妙记",
    reason: "读取有权访问的会议总结、待办、章节和决策",
    scopes: ["minutes:minutes.basic:read", "minutes:minutes.artifacts:read"]
  },
  documents: {
    label: "文档与知识库",
    reason: "发现当前用户创建或明显编辑过的文档与 Wiki",
    scopes: ["search:docs:read", "docs:document.content:read", "docx:document:readonly"]
  },
  base: {
    label: "多维表格",
    reason: "读取用户明确选择的 Base 视图和字段",
    scopes: ["base:record:read"]
  },
  approvals: {
    label: "审批结果",
    reason: "读取与当前用户有关的已办和已发起审批结果",
    scopes: ["approval:task:read", "approval:instance:read"]
  },
  messages: {
    label: "项目群消息",
    reason: "读取用户明确选择的项目群，并只保留工作相关消息",
    scopes: ["im:chat:read", "im:message:readonly"]
  }
});

export const FEISHU_MODULE_KEYS = Object.freeze(Object.keys(FEISHU_MODULES));

export function calculateFeishuPermissions(config = {}) {
  const enabled = FEISHU_MODULE_KEYS.filter((key) => Boolean(config.modules?.[key]));
  const scopes = [...new Set(enabled.flatMap((key) => FEISHU_MODULES[key].scopes))].sort();
  return {
    modules: enabled,
    scopes,
    reasons: enabled.map((key) => ({
      module: key,
      label: FEISHU_MODULES[key].label,
      reason: FEISHU_MODULES[key].reason,
      scopes: [...FEISHU_MODULES[key].scopes]
    }))
  };
}

export function authorizationArgs(config = {}) {
  const permissions = calculateFeishuPermissions(config);
  if (permissions.scopes.length === 0) {
    throw new Error("请至少选择一个飞书模块");
  }
  return ["auth", "login", "--scope", permissions.scopes.join(" "), "--no-wait", "--json"];
}
