import { logErrorAnnotation, logWarning } from "../../lib/common";
import { GhesConfig } from "../../lib/config";
import { getGitHubEnv, getScopedOwner } from "../../lib/github-context";

// The owner the StepSecurity API knows this tenant by. On github.com it is the
// GitHub owner; on GHDR and GHES it is <customer>::<server_name>::<owner>, built
// from STEP_CUSTOMER and STEP_SERVER_NAME. Returns null, after reporting the
// problem, when those are required but missing: the raw owner would look up
// another tenant's namespace, so callers skip the request instead.
export function resolveK8sScopedOwner(owner: string): string | null {
  try {
    return getScopedOwner(
      getGitHubEnv(),
      owner,
      GhesConfig.customer,
      GhesConfig.serverName,
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : "unknown";
    logWarning(reason);
    logErrorAnnotation(
      "StepSecurity job hook configuration",
      "STEP_CUSTOMER and STEP_SERVER_NAME must be set on the runner for GitHub Enterprise Server and data residency. Policy Store was not consulted for this job.",
    );
    return null;
  }
}

// Decoded by the Harden-Runner daemon, which splits on "/" and reuses the first
// part as the owner for its own Policy Store fetch and status update.
export function buildPrejobPolicyPayload(params: {
  scopedOwner: string;
  repo: string;
  workflow: string;
  runId: string;
  job: string;
}): string {
  return `${params.scopedOwner}/${params.repo}/${params.workflow}/${params.runId}/${params.job}`;
}
