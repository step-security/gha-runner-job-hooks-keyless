import { logInfo, logWarning } from "../lib/common";
import { AgentFiles } from "../lib/config";
import { readCorrelationIdFromAgentJson } from "../lib/files";
import { isAgentRunning } from "../lib/process";
import {
  appendLinuxSummary,
  cleanupLinuxJobArtifacts,
  printLinuxAgentLogs,
  stopAgentProcess,
} from "./agent";
import { runK8sPostJobHook } from "./k8s/post";
import { detectLinuxRuntimeMode } from "./runtime";

export async function runLinuxPostJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "k8s") {
    logInfo("Hook phase=post platform=linux runtime=k8s");
    await runK8sPostJobHook();
    return;
  }

  if (!isAgentRunning(AgentFiles.linux.agentPid)) {
    logWarning("Hook phase=post platform=linux runtime=vm status=skipped reason=missing-agent-pid");
    cleanupLinuxJobArtifacts();
    return;
  }

  logInfo("Hook phase=post platform=linux runtime=vm");
  const correlationId = readCorrelationIdFromAgentJson(
    AgentFiles.linux.agentJson,
  );
  if (correlationId) {
    logInfo(`Hook phase=post platform=linux runtime=vm correlation_id=${correlationId}`);
  }

  await stopAgentProcess();
  await appendLinuxSummary();
  printLinuxAgentLogs();
  cleanupLinuxJobArtifacts();
  logInfo("Hook phase=post platform=linux runtime=vm status=completed");
}
