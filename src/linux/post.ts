import { logInfo } from "../lib/common";
import {
  appendLinuxSummary,
  cleanupLinuxJobArtifacts,
  printLinuxAgentLogs,
  readCorrelationIdFromAgentJson,
  stopAgentProcess,
} from "./agent";
import { runArcPostJobHook } from "./arc/post";
import { detectLinuxRuntimeMode } from "./runtime";

export async function runLinuxPostJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "arc") {
    logInfo("Running ARC post-hook");
    await runArcPostJobHook();
    return;
  }

  logInfo("Running Linux agent post-hook");
  const correlationId = readCorrelationIdFromAgentJson();
  if (correlationId) {
    logInfo(`Found correlation ID from agent.json: ${correlationId}`);
  }

  await stopAgentProcess();
  await appendLinuxSummary();
  printLinuxAgentLogs();
  cleanupLinuxJobArtifacts();
}
