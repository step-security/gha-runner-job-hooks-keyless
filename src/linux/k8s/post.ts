import { logInfo } from "../../lib/common";
import { getGithubRunContext } from "../../lib/github-context";
import { appendJobSummary } from "../../lib/summary";
import { resolveK8sScopedOwner } from "./scope";

export async function runK8sPostJobHook(): Promise<void> {
  const scopedOwner = resolveK8sScopedOwner(getGithubRunContext().owner);
  if (scopedOwner === null) {
    logInfo("Kubernetes post-hook skipped the job summary");
    return;
  }

  await appendJobSummary({
    correlationId: process.env.RUNNER_NAME || "",
    environment: "ARC",
    includeTimeRange: false,
    owner: scopedOwner,
  });
  logInfo("Kubernetes post-hook completed successfully");
}
