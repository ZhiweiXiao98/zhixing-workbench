export const ARTIFACT_GRAPH_FILTER = '-path:"成果/知行台"';
export const ARCHIVE_GRAPH_FILTER = '-path:"归档/知行台"';
const MANAGED_GRAPH_FILTERS = [ARTIFACT_GRAPH_FILTER, ARCHIVE_GRAPH_FILTER];

export interface GraphConfigUpdate {
  ok: boolean;
  changed: boolean;
  content: string;
  error?: string;
}

export function updateGraphConfigText(content: string, mode: "enable" | "disable"): GraphConfigUpdate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    return { ok: false, changed: false, content, error: "关系图配置不是有效 JSON，已拒绝覆盖" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, changed: false, content, error: "关系图配置结构无效，已拒绝覆盖" };
  }
  const config = parsed as Record<string, unknown>;
  const current = typeof config.search === "string" ? config.search.trim() : "";
  const search = mode === "enable" ? addFilter(current) : removeFilter(current);
  if (search === current && typeof config.search === "string") {
    return { ok: true, changed: false, content };
  }
  const updated = { ...config, search };
  return { ok: true, changed: true, content: `${JSON.stringify(updated, null, 2)}\n` };
}

function addFilter(search: string): string {
  return MANAGED_GRAPH_FILTERS.reduce((current, filter) =>
    current.includes(filter) ? current : [current, filter].filter(Boolean).join(" "), search);
}

function removeFilter(search: string): string {
  return MANAGED_GRAPH_FILTERS.reduce((current, filter) => current.split(filter).join(" "), search)
    .replace(/\s+/g, " ").trim();
}
