import { describe, expect, it } from "vitest";
import { ARTIFACT_GRAPH_FILTER, updateGraphConfigText } from "../src/graph-filter";

describe("relationship graph denoise", () => {
  it("adds the managed artifact exclusion without replacing existing graph preferences", () => {
    const input = JSON.stringify({ search: "tag:#工作", showOrphans: true, repelStrength: 10 });
    const result = updateGraphConfigText(input, "enable");

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      search: `tag:#工作 ${ARTIFACT_GRAPH_FILTER}`,
      showOrphans: true,
      repelStrength: 10
    });
  });

  it("is idempotent and can restore visibility without disturbing other filters", () => {
    const first = updateGraphConfigText(JSON.stringify({ search: "path:wiki" }), "enable");
    const second = updateGraphConfigText(first.content, "enable");
    const restored = updateGraphConfigText(second.content, "disable");

    expect(second.content).toBe(first.content);
    expect(JSON.parse(restored.content).search).toBe("path:wiki");
  });

  it("refuses to overwrite malformed graph settings", () => {
    expect(updateGraphConfigText("{", "enable")).toMatchObject({ ok: false, content: "{" });
  });
});
