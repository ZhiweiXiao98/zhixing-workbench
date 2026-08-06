export const ARTIFACT_GRAPH_FILTER = '-path:"成果/知行台"';

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
  if (search.includes(ARTIFACT_GRAPH_FILTER)) {
    return search;
  }
  return [search, ARTIFACT_GRAPH_FILTER].filter(Boolean).join(" ");
}

function removeFilter(search: string): string {
  return search.split(ARTIFACT_GRAPH_FILTER).join(" ").replace(/\s+/g, " ").trim();
}
