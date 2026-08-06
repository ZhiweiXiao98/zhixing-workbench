import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SessionTitle } from "../core/types";

interface SessionIndexLine {
  id?: unknown;
  thread_name?: unknown;
  updated_at?: unknown;
}

export interface SessionIndexSnapshot {
  available: boolean;
  titles: Map<string, SessionTitle>;
}

export async function loadSessionTitles(): Promise<SessionIndexSnapshot> {
  const filePath = path.join(homedir(), ".codex", "session_index.jsonl");
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { available: false, titles: new Map() };
  }

  const titles = new Map<string, SessionTitle>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const value = JSON.parse(line) as SessionIndexLine;
      if (typeof value.id !== "string" || typeof value.thread_name !== "string") {
        continue;
      }
      const candidate: SessionTitle = {
        id: value.id,
        title: value.thread_name.trim(),
        updatedAt: typeof value.updated_at === "string" ? value.updated_at : ""
      };
      const existing = titles.get(candidate.id);
      if (!existing || candidate.updatedAt >= existing.updatedAt) {
        titles.set(candidate.id, candidate);
      }
    } catch {
      // A concurrently appended final line can be incomplete. The next refresh retries it.
    }
  }
  return { available: true, titles };
}
