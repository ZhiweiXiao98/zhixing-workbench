import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

interface CapturedPair {
  user: { content: string; messageId: string };
  assistant: { content: string; messageId: string };
  turnId: string;
}

describe("ChatGPT 网页扩展真实 DOM 采集", () => {
  it("从 ChatGPT 对话节点提取一组完整问答与代码内容", async () => {
    const window = new Window({ url: "https://chatgpt.com/c/fictional-dom-conversation" });
    window.document.body.innerHTML = `
      <main>
        <article data-testid="conversation-turn-user-001">
          <div data-message-author-role="user" data-message-id="user-001">
            <div class="whitespace-pre-wrap">请定位安装失败，并保留我的个人笔记。</div>
          </div>
        </article>
        <article data-testid="conversation-turn-assistant-001">
          <div data-message-author-role="assistant" data-message-id="assistant-001">
            <div class="markdown prose">
              <p>问题定位完成，安装器会先备份再替换。</p>
              <pre><code>npm run test</code></pre>
            </div>
          </div>
        </article>
      </main>`;

    const context = vm.createContext({ URL });
    const source = await readFile(path.resolve("..", "browser-extension", "capture-core.js"), "utf8");
    vm.runInContext(source, context);
    const core = (context as unknown as {
      ChatGPTCaptureCore: { scanDocument(document: Document): CapturedPair[] };
    }).ChatGPTCaptureCore;

    const pairs = core.scanDocument(window.document as unknown as Document);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    if (!pair) throw new Error("未采集到对话问答");
    expect(pair.user.content).toBe("请定位安装失败，并保留我的个人笔记。");
    expect(pair.assistant.content).toContain("问题定位完成");
    expect(pair.assistant.content).toContain("npm run test");
    expect(pair.turnId).toBe("user-001--assistant-001");
  });
});
