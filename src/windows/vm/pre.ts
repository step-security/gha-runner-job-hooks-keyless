const { randomUUID } = require("crypto") as typeof import("crypto");

import { logInfo, logWarning } from "../../lib/common";
import { AgentFiles } from "../../lib/config";
import { toBase64Utf8 } from "../../lib/encoding";
import { getGithubRunContext } from "../../lib/github-context";
import { fetchWorkflowPolicyCheck } from "../../lib/policy";
import { emitWindowsHookSignal, getWindowsWorkflowPath } from "../utils";
import { waitForFile } from "../../lib/common";

const RuntimeConfig = {
  ...getGithubRunContext(),
  correlationId: randomUUID(),
};

export async function runWindowsVmPreJobHook(): Promise<void> {
  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");
  logInfo(
    `Generated job correlationId for self-hosted agent: ${RuntimeConfig.correlationId}`,
  );

  const workflow = getWindowsWorkflowPath();
  const { hasPolicy } = await fetchWorkflowPolicyCheck({
    owner: RuntimeConfig.owner,
    repo: RuntimeConfig.repo,
    workflow,
    runId: RuntimeConfig.runId,
    correlationId: RuntimeConfig.correlationId,
  });

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");
    const stringToEncode = `${RuntimeConfig.githubRepository}/${workflow}/${RuntimeConfig.runId}|${RuntimeConfig.correlationId}`;
    const encodedString = toBase64Utf8(stringToEncode);
    emitWindowsHookSignal(`step_policy_prejob_${encodedString}`);

    const readyFile = `${AgentFiles.windows.prejobReadyPrefix}${RuntimeConfig.correlationId}.json`;
    const done = await waitForFile(readyFile, 60);
    if (done) {
      try {
        require("fs").rmSync(readyFile, { force: true });
      } catch {
        // ignore
      }
      logInfo("policy enforced successfully");
    } else {
      logWarning(
        "Block mode policy enforcement timed out after 60s; continuing",
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}
