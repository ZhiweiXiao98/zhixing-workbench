export interface FeishuBaseCandidate {
  baseToken: string;
  title: string;
  ownerName: string;
  url: string;
}

export interface FeishuBaseTable {
  id: string;
  name: string;
}

export interface FeishuBaseView {
  id: string;
  name: string;
  type: string;
}

export interface FeishuBaseSelection {
  selection_key: string;
  base_token: string;
  table_id: string;
  view_id: string;
  label: string;
  field_ids: string[];
}

export type FeishuBaseLookup =
  | { kind: "resolved"; selection: FeishuBaseSelection }
  | { kind: "candidates"; candidates: FeishuBaseCandidate[] };

export function isFeishuUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && /(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function parseBaseLookupPayload(payload: any): FeishuBaseLookup {
  const data = payload?.data ?? payload ?? {};
  const baseToken = identifier(data.base_token);
  const tableId = identifier(data.table_id || (data.block_type === "table" ? data.block_id : ""));
  const viewId = identifier(data.view_id);
  if (baseToken && tableId && viewId) {
    const baseTitle = display(data.title || "多维表格");
    const tableName = display(data.block_name || "数据表");
    const viewName = display(data.view_name || "所选视图");
    return { kind: "resolved", selection: createBaseSelection({
      baseToken,
      tableId,
      viewId,
      label: readableSelectionLabel(baseTitle, tableName, viewName)
    }) };
  }
  const candidates = (Array.isArray(data.candidates) ? data.candidates : [])
    .map((item: any) => ({
      baseToken: identifier(item?.base_token),
      title: display(item?.title || "未命名多维表格"),
      ownerName: display(item?.owner_name || ""),
      url: safeUrl(item?.url)
    }))
    .filter((item: FeishuBaseCandidate) => item.baseToken)
    .slice(0, 20);
  if (candidates.length === 0 && baseToken) {
    candidates.push({ baseToken, title: display(data.title || "多维表格"), ownerName: "", url: "" });
  }
  return { kind: "candidates", candidates };
}

export function parseBaseTablesPayload(payload: any): FeishuBaseTable[] {
  const data = payload?.data ?? payload ?? {};
  return (Array.isArray(data.blocks) ? data.blocks : [])
    .filter((item: any) => item?.type === "table")
    .map((item: any) => ({ id: identifier(item?.id), name: display(item?.name || "未命名数据表") }))
    .filter((item: FeishuBaseTable) => item.id)
    .slice(0, 100);
}

export function parseRecentBasesPayload(payload: any): FeishuBaseCandidate[] {
  const data = payload?.data ?? payload ?? {};
  return (Array.isArray(data.results) ? data.results : [])
    .map((item: any) => {
      const meta = item?.result_meta ?? {};
      const iconToken = parseIconToken(meta.icon_info);
      const url = safeUrl(meta.url);
      return {
        baseToken: identifier(iconToken || baseTokenFromUrl(url) || meta.base_token),
        title: display(stripMarkup(item?.title_highlighted || meta.title || "未命名多维表格")),
        ownerName: display(meta.owner_name || ""),
        url
      };
    })
    .filter((item: FeishuBaseCandidate) => item.baseToken)
    .slice(0, 20);
}

export function parseBaseViewsPayload(payload: any): FeishuBaseView[] {
  const data = payload?.data ?? payload ?? {};
  return (Array.isArray(data.views) ? data.views : [])
    .map((item: any) => ({ id: identifier(item?.id), name: display(item?.name || "未命名视图"), type: identifier(item?.type) }))
    .filter((item: FeishuBaseView) => item.id)
    .slice(0, 200);
}

export function createBaseSelection(input: {
  baseToken: string;
  tableId: string;
  viewId: string;
  label: string;
}): FeishuBaseSelection {
  const baseToken = identifier(input.baseToken);
  const tableId = identifier(input.tableId);
  const viewId = identifier(input.viewId);
  if (!baseToken || !tableId || !viewId) throw new Error("请选择完整的数据表和视图");
  return {
    selection_key: `${baseToken}:${tableId}:${viewId}`,
    base_token: baseToken,
    table_id: tableId,
    view_id: viewId,
    label: display(input.label || "已选 Base 视图"),
    field_ids: []
  };
}

export function readableSelectionLabel(base: string, table: string, view: string): string {
  return [base, table, view].map(display).filter(Boolean).join(" / ") || "已选 Base 视图";
}

function identifier(value: unknown): string {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}

function display(value: unknown): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}

function safeUrl(value: unknown): string {
  const result = String(value || "").trim();
  return isFeishuUrl(result) ? result : "";
}

function parseIconToken(value: unknown): string {
  try { return identifier(JSON.parse(String(value || "{}"))?.token); } catch { return ""; }
}

function baseTokenFromUrl(value: string): string {
  try {
    const match = new URL(value).pathname.match(/\/(?:base|app)\/([A-Za-z0-9._:-]+)/i);
    return identifier(match?.[1]);
  } catch { return ""; }
}

function stripMarkup(value: unknown): string {
  return String(value || "").replace(/<[^>]*>/g, "");
}
