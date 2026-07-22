import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { AgentFiles, AgentRuntimeConfig } from "../lib/config";
import { logInfo } from "../lib/common";
import { runConfiguredEndpointPreflight } from "../lib/preflight";
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
    await runConfiguredEndpointPreflight();
    logInfo("Running Kubernetes pre-hook");
    await runK8sPreJobHook();
    return;
  }

  await runLinuxVmPreJobHook();
}

async function runLinuxVmPreJobHook(): Promise<void> {
  await runConfiguredEndpointPreflight({ requireVmApiKey: true });
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
