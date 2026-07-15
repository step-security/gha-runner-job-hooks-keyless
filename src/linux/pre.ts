import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { AgentFiles, AgentRuntimeConfig } from "../lib/config";
import { logInfo } from "../lib/common";
import {
  ensureLinuxAgentRoot,
  ensureLatestBravoLinuxAgent,
  startAgentProcess,
} from "./agent";
import { runK8sPreJobHook } from "./k8s/pre";
import { detectLinuxRuntimeMode } from "./runtime";

export async function runLinuxPreJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "k8s") {
    logInfo("Running Kubernetes pre-hook");
    await runK8sPreJobHook();
    return;
  }

  logInfo("Running Linux agent pre-hook");
  ensureLinuxAgentRoot();
  await buildSharedAgentJsonForCurrentJob({
    agentJsonPath: AgentFiles.linux.agentJson,
    isPersistent: !AgentRuntimeConfig.isEphemeralLinux,
  });
  await ensureLatestBravoLinuxAgent();
  await startAgentProcess();
  logInfo("Finished Linux agent pre-hook");
}
