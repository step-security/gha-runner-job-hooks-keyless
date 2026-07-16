import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { logInfo } from "../lib/common";
import { AgentFiles } from "../lib/config";
import {
  ensureWindowsAgentRoot,
  installWindowsAgent,
  startWindowsAgentProcess,
} from "./agent";

export async function runWindowsPreJobHook(): Promise<void> {
  logInfo("Running Windows agent pre-hook");
  if (process.arch === "arm64") {
    logInfo("Windows arm64 runners are not supported");
    return;
  }
  ensureWindowsAgentRoot();
  await buildSharedAgentJsonForCurrentJob({
    agentJsonPath: AgentFiles.windows.agentJson,
    isPersistent: false,
    isGithubHosted: true,
    isDebug: true
  });
  await installWindowsAgent();
  await startWindowsAgentProcess();
  logInfo("Finished Windows agent pre-hook");
}
