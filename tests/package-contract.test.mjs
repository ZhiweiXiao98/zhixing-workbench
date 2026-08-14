import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("所有公开组件使用统一版本和作者", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const plugin = JSON.parse(await readFile("packages/obsidian-plugin/manifest.json", "utf8"));
  const extension = JSON.parse(await readFile("packages/browser-extension/manifest.json", "utf8"));
  const codex = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  assert.equal(plugin.version, root.version);
  assert.equal(extension.version, root.version);
  assert.equal(codex.version, root.version);
  assert.equal(plugin.author, "肖志伟");
  assert.equal(codex.author.name, "肖志伟");
});

test("浏览器扩展不携带固定密钥文件", async () => {
  const manifest = await readFile("packages/browser-extension/manifest.json", "utf8");
  const worker = await readFile("packages/browser-extension/service-worker.js", "utf8");
  assert.doesNotMatch(manifest, /config\.js/);
  assert.doesNotMatch(worker, /importScripts\s*\(/);
  assert.match(worker, /chrome\.storage\.local/);
});

test("Release 根目录安装入口调用同目录 scripts", async () => {
  const windows = await readFile("templates/install/安装知行台.cmd", "utf8");
  const unix = await readFile("templates/install/install-zhixing.sh", "utf8");
  assert.match(windows, /%~dp0scripts\\zhixing\.mjs/i);
  assert.doesNotMatch(windows, /\.\.\\\.\.\\scripts/i);
  assert.match(unix, /\$script_dir\/scripts\/zhixing\.mjs/);
  assert.doesNotMatch(unix, /\.\.\/\.\.\/scripts/);
});

test("更新器使用支持中文文件名的内置解压器", async () => {
  const updater = await readFile("scripts/zhixing.mjs", "utf8");
  const packager = await readFile("scripts/build-release.mjs", "utf8");
  assert.match(updater, /import \{ extractArchive \} from "\.\/release-archive\.mjs"/);
  assert.match(updater, /await extractArchive\(archive, extracted\)/);
  assert.doesNotMatch(updater, /execFileAsync\("tar"/);
  assert.match(packager, /"release-archive\.mjs"/);
});

test("Obsidian 提供稳定浏览器扩展目录入口", async () => {
  const service = await readFile("packages/obsidian-plugin/src/suite-service.ts", "utf8");
  const view = await readFile("packages/obsidian-plugin/src/view.ts", "utf8");
  assert.match(service, /browser_extension_root/);
  assert.match(service, /shell\.openPath\(target\)/);
  assert.match(view, /open-browser-extension-folder/);
});

test("CI 与 Release 只发布四端共同验证的同一候选资产", async () => {
  for (const target of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    const workflow = await readFile(target, "utf8");
    assert.equal(workflow.match(/npm run package:release/g)?.length, 1, `${target} 只能打包一次`);
    assert.match(workflow, /actions\/upload-artifact@v4/);
    assert.ok((workflow.match(/actions\/download-artifact@v4/g)?.length || 0) >= 1);
    assert.match(workflow, /needs: package-candidate/);
  }
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
  const publishJob = releaseWorkflow.slice(releaseWorkflow.indexOf("\n  release:"));
  assert.doesNotMatch(publishJob, /package:release|package:verify|npm run build/);
  assert.match(publishJob, /actions\/download-artifact@v4/);
});

test("浏览器采集核心识别已保存对话并按问答配对", async () => {
  const context = vm.createContext({ URL });
  vm.runInContext(await readFile("packages/browser-extension/capture-core.js", "utf8"), context);
  const core = context.ChatGPTCaptureCore;
  assert.equal(core.conversationIdFromUrl("https://chatgpt.com/c/fictional-conversation"), "fictional-conversation");
  const pairs = core.pairMessages([
    { role: "user", messageId: "u1", content: "问题" },
    { role: "assistant", messageId: "a1", content: "回答" },
    { role: "user", messageId: "u2", content: "还没有回答" }
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].turnId, "u1--a1");
});
