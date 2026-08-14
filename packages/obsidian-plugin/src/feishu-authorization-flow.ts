import type { FeishuUserAuthorizationState } from "./feishu-cli-result";

export async function runFeishuAuthorizationFlow(input: {
  begin: () => Promise<void>;
  onWaiting: () => void;
  complete: () => Promise<void>;
  readState: () => Promise<FeishuUserAuthorizationState>;
}): Promise<FeishuUserAuthorizationState> {
  await input.begin();
  input.onWaiting();
  await input.complete();
  return input.readState();
}
