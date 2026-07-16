import { logInfo } from "../../lib/common";
import { getGithubRunContext } from "../../lib/github-context";
import { appendJobSummary } from "../../lib/summary";

export async function runK8sPostJobHook(): Promise<void> {
  await appendJobSummary({
    correlationId: process.env.RUNNER_NAME || "",
    environment: "ARC",
    includeTimeRange: false,
  });
  logInfo("Kubernetes post-hook completed successfully");
}
