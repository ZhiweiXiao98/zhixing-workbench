import type { FactualSourceHealth } from "./codex-desktop-source.mjs";

export function readCodexCliHookHealth(options: {
  vault?: string;
  hooks?: unknown;
  codexExecutable?: string;
  now?: Date | string | number;
  staleAfterMs?: number;
}): Promise<FactualSourceHealth>;

export function factualHealth(value?: Partial<FactualSourceHealth>): FactualSourceHealth;
