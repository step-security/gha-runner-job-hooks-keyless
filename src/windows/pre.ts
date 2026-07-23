import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { logInfo } from "../lib/common";
import { AgentFiles } from "../lib/config";
import { runConfiguredEndpointPreflight } from "../lib/preflight";
import {
  ensureWindowsAgentRoot,
  installWindowsAgent,
  startWindowsAgentProcess,
} from "./agent";

export async function runWindowsPreJobHook(): Promise<void> {
  logInfo("Hook phase=pre platform=windows runtime=vm");
  if (process.arch === "arm64") {
    logInfo("Hook phase=pre platform=windows runtime=vm status=skipped reason=unsupported-arch arch=arm64");
    return;
  }
  await runConfiguredEndpointPreflight({ requireVmApiKey: true });
  ensureWindowsAgentRoot();
  await buildSharedAgentJsonForCurrentJob({
    agentJsonPath: AgentFiles.windows.agentJson,
    isPersistent: false,
    isGithubHosted: true,
    isDebug: false,
    egressPolicyAlwaysAudit: true,
  });
  await installWindowsAgent();
  await startWindowsAgentProcess();
  logInfo("Hook phase=pre platform=windows runtime=vm status=completed");
}
