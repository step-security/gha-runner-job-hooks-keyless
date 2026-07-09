import { logInfo } from "../lib/common";
import {
  buildAgentJsonForCurrentJob,
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
  logInfo("Checking for policy from policy store...");
  await buildAgentJsonForCurrentJob();
  await ensureLatestBravoLinuxAgent();
  await startAgentProcess();
  logInfo("Completed successfully");
}
