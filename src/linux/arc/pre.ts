import {
  logInfo,
  requireEchoCommand,
  runCommand,
  sleep,
} from "../../lib/common";
import { toBase64Utf8 } from "../../lib/encoding";
import { getGithubRunContext } from "../../lib/github-context";
import {
  fetchWorkflowPolicyCheck,
  fetchWorkflowPolicyStatus,
} from "../../lib/policy";

const RuntimeConfig = {
  ...getGithubRunContext(),
  correlationId: process.env.RUNNER_NAME || "",
};

async function checkPolicyStatus(
  owner: string,
  repo: string,
  correlationId: string,
): Promise<"APPLIED" | "NOT_APPLIED" | "SLEEP"> {
  return fetchWorkflowPolicyStatus({ owner, repo, correlationId });
}

async function waitForPolicy(
  owner: string,
  repo: string,
  correlationId: string,
): Promise<void> {
  const maxPollTimeSeconds = 10;
  const pollIntervalMs = 1000;

  logInfo("Egress policy is 'block', waiting for policy to be applied...");

  const startTime = Date.now();

  while (true) {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);

    if (elapsedSeconds >= maxPollTimeSeconds) {
      logInfo(
        `Timeout waiting for policy status after ${elapsedSeconds}s, continuing...`,
      );
      break;
    }

    const status = await checkPolicyStatus(owner, repo, correlationId);

    switch (status) {
      case "APPLIED":
        logInfo("Policy applied successfully, continuing execution");
        return;
      case "NOT_APPLIED":
        logInfo(
          `Policy not yet applied, polling... (${elapsedSeconds}s/${maxPollTimeSeconds}s)`,
        );
        await sleep(pollIntervalMs);
        break;
      case "SLEEP":
      default:
        logInfo("Received SLEEP status, falling back to sleep 10");
        await sleep(10_000);
        return;
    }
  }
}

export async function runArcPreJobHook(): Promise<void> {
  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  const { hasPolicy, shouldSleep } = await fetchWorkflowPolicyCheck({
    owner: RuntimeConfig.owner,
    repo: RuntimeConfig.repo,
    workflow: RuntimeConfig.workflow,
    runId: RuntimeConfig.runId,
    correlationId: RuntimeConfig.correlationId,
  });
  const echoCommand = requireEchoCommand();

  logInfo(`echo command: ${echoCommand}`);

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");

    const stringToEncode = `${RuntimeConfig.githubRepository}/${RuntimeConfig.workflow}/${RuntimeConfig.runId}/${RuntimeConfig.job}`;
    const encodedString = toBase64Utf8(stringToEncode);
    runCommand(echoCommand, [`step_policy_prejob_${encodedString}`], {
      silent: true,
    });

    if (shouldSleep) {
      await waitForPolicy(
        RuntimeConfig.owner,
        RuntimeConfig.repo,
        RuntimeConfig.correlationId,
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}
