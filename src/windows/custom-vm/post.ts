import * as fs from "fs";

import { getWithRetry, logCommandFailure, logInfo, logWarning, runCommand, waitForFile } from "../../lib/common";
import { AgentFiles, Urls } from "../../lib/config";
import { readJsonFile, writeJsonFile } from "../../lib/files";
import { getGithubRunContext } from "../../lib/github-context";
import { printWindowsAgentLog } from "../utils";

const RuntimeConfig = {
  ...getGithubRunContext(),
};

function readCorrelationId(): string {
  const agent = readJsonFile(AgentFiles.windows.agentJson) as { correlation_id?: unknown } | null;
  if (
    agent &&
    typeof agent.correlation_id === "string" &&
    agent.correlation_id.length > 0
  ) {
    return agent.correlation_id;
  }

  logWarning("Could not read correlation ID from agent.json");
  return process.env.COMPUTERNAME || "";
}

function resetAgentJson(correlationId: string): void {
  const agent = readJsonFile(AgentFiles.windows.agentJson);
  if (!agent) {
    return;
  }

  const updated = { ...agent };
  if (updated.correlation_id === correlationId) {
    updated.correlation_id = "PLACEHOLDER_CORRELATION_ID";
  }
  if (updated.repo === RuntimeConfig.githubRepository) {
    updated.repo = "PLACEHOLDER_REPO";
  }
  if (updated.run_id === RuntimeConfig.runId) {
    updated.run_id = "PLACEHOLDER_RUN_ID";
  }

  writeJsonFile(AgentFiles.windows.agentJson, updated);
}

async function appendSummary(correlationId: string): Promise<void> {
  const summaryUrl = `${Urls.stepSecurityApi}/github/${RuntimeConfig.githubRepository}/actions/runs/${RuntimeConfig.runId}/correlation/${correlationId}/job-markdown-summary?environment=WindowsGitHubHostedCustomVM`;

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl);
    if (String(statusCode) === "200" && body) {
      if (!RuntimeConfig.stepSummaryPath) {
        logWarning("GITHUB_STEP_SUMMARY is not set; skipping summary write");
        return;
      }

      fs.appendFileSync(RuntimeConfig.stepSummaryPath, body, "utf8");
      logInfo("Security summary added to job output");
      return;
    }

    logWarning("No summary content available");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to fetch security summary: ${message}`);
  }
}

export async function runWindowsCustomVmPostJobHook(): Promise<void> {
  logInfo("POST-JOB HOOK: Finalizing job monitoring...");

  const correlationId = readCorrelationId();

  runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "query user; exit $LASTEXITCODE"],
    { silent: true },
  );

  logInfo("Waiting for agent to finalize monitoring data...");
  const done = await waitForFile(AgentFiles.windows.agentDone, 10);
  if (!done) {
    logWarning("Timed out waiting for agent finalization");
  } else {
    logInfo("Agent finalization complete");
  }

  printWindowsAgentLog(AgentFiles.windows.agentLog);
  logInfo("Fetching security summary...");
  await appendSummary(correlationId);

  logInfo("Stopping agent service...");
  const stopResult = runCommand("sc.exe", ["stop", AgentFiles.windows.agentService], {
    silent: true,
  });
  logCommandFailure(`Stopping ${AgentFiles.windows.agentService}`, stopResult);

  resetAgentJson(correlationId);

  try {
    fs.rmSync(AgentFiles.windows.agentStatus, { force: true });
    fs.rmSync(AgentFiles.windows.agentDone, { force: true });
  } catch {
    // ignore
  }

  logInfo("POST-JOB HOOK: Completed successfully");
}
