import { logInfo } from "../lib/common";
import { AgentFiles } from "../lib/config";
import { readCorrelationIdFromAgentJson } from "../lib/files";
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
    logInfo("Running Kubernetes post-hook");
    await runK8sPostJobHook();
    return;
  }

  logInfo("Running Linux agent post-hook");
  const correlationId = readCorrelationIdFromAgentJson(
    AgentFiles.linux.agentJson,
  );
  if (correlationId) {
    logInfo(`Found correlation ID from agent.json: ${correlationId}`);
  }

  await stopAgentProcess();
  await appendLinuxSummary();
  printLinuxAgentLogs();
  cleanupLinuxJobArtifacts();
  logInfo("Finished Linux agent post-hook");
}
