import { describe, expect, it } from "vitest";
import {
  createBaseSelection,
  isFeishuUrl,
  parseBaseLookupPayload,
  parseBaseTablesPayload,
  parseBaseViewsPayload,
  parseRecentBasesPayload
} from "../src/feishu-base-picker";

describe("飞书 Base 选择器", () => {
  it("接受知识库和 Base 链接，拒绝其他网址", () => {
    expect(isFeishuUrl("https://example.feishu.cn/wiki/wiki_token?table=tbl_one&view=vew_one")).toBe(true);
    expect(isFeishuUrl("https://example.larksuite.com/base/base_token")).toBe(true);
    expect(isFeishuUrl("https://example.com/base/base_token")).toBe(false);
  });

  it("把知识库链接解析结果直接变成可保存的视图", () => {
    const result = parseBaseLookupPayload({ data: {
      base_token: "base_one",
      block_id: "tbl_one",
      block_name: "任务表",
      block_type: "table",
      table_id: "tbl_one",
      title: "项目任务",
      view_id: "vew_one"
    } });
    expect(result).toEqual({ kind: "resolved", selection: {
      selection_key: "base_one:tbl_one:vew_one",
      base_token: "base_one",
      table_id: "tbl_one",
      view_id: "vew_one",
      label: "项目任务 / 任务表 / 所选视图",
      field_ids: []
    } });
  });

  it("名称搜索结果保留为候选项供用户选择", () => {
    const result = parseBaseLookupPayload({ data: { candidates: [
      { base_token: "base_one", title: "项目任务", owner_name: "测试用户", url: "https://example.feishu.cn/wiki/wiki_one" },
      { base_token: "", title: "无效项" }
    ] } });
    expect(result).toEqual({ kind: "candidates", candidates: [{
      baseToken: "base_one",
      title: "项目任务",
      ownerName: "测试用户",
      url: "https://example.feishu.cn/wiki/wiki_one"
    }] });
  });

  it("只保留真实数据表和视图", () => {
    expect(parseBaseTablesPayload({ data: { blocks: [
      { id: "tbl_one", name: "任务表", type: "table" },
      { id: "dash_one", name: "仪表盘", type: "dashboard" }
    ] } })).toEqual([{ id: "tbl_one", name: "任务表" }]);
    expect(parseBaseViewsPayload({ data: { views: [
      { id: "vew_one", name: "默认视图", type: "grid" }
    ] } })).toEqual([{ id: "vew_one", name: "默认视图", type: "grid" }]);
  });

  it("把最近使用的知识库 Base 和普通 Base 变成可选项", () => {
    const candidates = parseRecentBasesPayload({ data: { results: [
      { title_highlighted: "<em>项目</em>任务", result_meta: {
        icon_info: JSON.stringify({ token: "base_from_wiki" }), owner_name: "测试用户",
        url: "https://example.feishu.cn/wiki/wiki_one"
      } },
      { title_highlighted: "需求管理", result_meta: {
        owner_name: "测试用户", url: "https://example.feishu.cn/base/base_from_url"
      } }
    ] } });
    expect(candidates.map((item) => [item.baseToken, item.title])).toEqual([
      ["base_from_wiki", "项目任务"],
      ["base_from_url", "需求管理"]
    ]);
  });

  it("不允许缺少数据表或视图的选择", () => {
    expect(() => createBaseSelection({ baseToken: "base_one", tableId: "", viewId: "vew_one", label: "测试" }))
      .toThrow("请选择完整的数据表和视图");
  });
});
