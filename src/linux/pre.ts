import { logInfo } from "../lib/common";
import {
  buildAgentJsonForCurrentJob,
  ensureLatestBravoLinuxAgent,
  startAgentProcess,
} from "./agent";
import { runArcPreJobHook } from "./arc/pre";
import { detectLinuxRuntimeMode } from "./runtime";

export async function runLinuxPreJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "arc") {
    logInfo("Running ARC pre-hook");
    await runArcPreJobHook();
    return;
  }

  logInfo("Running Linux agent pre-hook");
  logInfo("Checking for policy from policy store...");
  await buildAgentJsonForCurrentJob();
  await ensureLatestBravoLinuxAgent();
  await startAgentProcess();
  logInfo("Completed successfully");
}
