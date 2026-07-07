const { randomUUID } = require("crypto") as typeof import("crypto");

import * as fs from "fs";

import {
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../../lib/common";
import { AgentFiles } from "../../lib/config";
import { toBase64Utf8 } from "../../lib/encoding";
import { printFileIfExists, updateJsonFile } from "../../lib/files";
import { getGithubRunContext } from "../../lib/github-context";
import { fetchWorkflowPolicyCheck } from "../../lib/policy";
import { emitWindowsHookSignal, getWindowsWorkflowPath, printWindowsAgentLog } from "../utils";

const RuntimeConfig = {
  ...getGithubRunContext(),
  correlationId: randomUUID(),
};

function updateAgentJson(): void {
  const updated = updateJsonFile(AgentFiles.windows.agentJson, (agent) => ({
    ...agent,
    correlation_id: RuntimeConfig.correlationId,
    repo: RuntimeConfig.githubRepository,
    run_id: RuntimeConfig.runId,
  }));
  if (!updated) {
    logWarning(`${AgentFiles.windows.agentJson} not found; skipping update`);
  }
}

async function waitForAgentStatus(): Promise<void> {
  logInfo("Waiting for agent to initialize...");
  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.windows.agentStatus),
    100,
    300,
  );

  if (!matched) {
    logWarning("Agent initialization timed out");
    printWindowsAgentLog(AgentFiles.windows.agentLog);
    return;
  }

  logInfo("Agent initialized successfully");
  printFileIfExists(AgentFiles.windows.agentStatus);
}

export async function runWindowsCustomVmPreJobHook(): Promise<void> {
  logInfo("PRE-JOB HOOK: Configuring agent for this job...");
  logInfo(`Step Security Job Correlation ID: ${RuntimeConfig.correlationId}`);

  updateAgentJson();

  logInfo("Starting agent service...");
  const startResult = runCommand(
    "sc.exe",
    ["start", AgentFiles.windows.agentService],
    {
      silent: true,
    },
  );
  logCommandFailure(`Starting ${AgentFiles.windows.agentService}`, startResult);

  await waitForAgentStatus();

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");
  const workflow = getWindowsWorkflowPath();
  const { hasPolicy } = await fetchWorkflowPolicyCheck({
    owner: RuntimeConfig.owner,
    repo: RuntimeConfig.repo,
    workflow,
    runId: RuntimeConfig.runId,
    correlationId: RuntimeConfig.correlationId,
  });

  const stringToEncode = `${RuntimeConfig.githubRepository}/${workflow}/${RuntimeConfig.runId}|${RuntimeConfig.correlationId}`;
  const encodedString = toBase64Utf8(stringToEncode);
  emitWindowsHookSignal(`step_policy_prejob_${encodedString}`);

  const readyFile = `${AgentFiles.windows.prejobReadyPrefix}${RuntimeConfig.correlationId}.json`;
  const done = await waitForCondition(() => fs.existsSync(readyFile), 60, 1000);
  if (done.matched) {
    try {
      fs.rmSync(readyFile, { force: true });
    } catch {
      // ignore
    }
  }

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");
    if (done.matched) {
      logInfo("policy enforced successfully");
    } else {
      logWarning(
        "Policy enforcement confirmation timed out after 60s; continuing",
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}
