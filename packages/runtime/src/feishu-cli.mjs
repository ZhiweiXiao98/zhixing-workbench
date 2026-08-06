import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./run-cycle.mjs";
import { syncFeishu } from "./feishu-sync.mjs";

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const result = await syncFeishu({ vault: options.vault, force: Boolean(options.force) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "failed") process.exitCode = 1;
  else if (result.status === "partial") process.exitCode = 2;
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error instanceof Error ? error.message : error).slice(0, 300)}\n`);
    process.exitCode = 1;
  });
}
