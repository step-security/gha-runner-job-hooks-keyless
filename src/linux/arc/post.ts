import { getWithRetry, logInfo, logWarning } from "../../lib/common";
import { Urls } from "../../lib/config";
import { getGithubRunContext } from "../../lib/github-context";

const RuntimeConfig = {
  ...getGithubRunContext(),
  correlationId: process.env.RUNNER_NAME || "",
};

export async function runArcPostJobHook(): Promise<void> {
  const summaryUrl = `${Urls.stepSecurityApi}/github/${RuntimeConfig.githubRepository}/actions/runs/${RuntimeConfig.runId}/correlation/${RuntimeConfig.correlationId}/job-markdown-summary?environment=ARC`;

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl);
    if (String(statusCode) === "200" && body) {
      if (!RuntimeConfig.stepSummaryPath) {
        logWarning("GITHUB_STEP_SUMMARY is not set; skipping summary write");
        return;
      }

      require("fs").appendFileSync(RuntimeConfig.stepSummaryPath, body, "utf8");
      logInfo("Summary added to job output");
    } else {
      logWarning(
        `Failed to fetch summary (HTTP ${statusCode}) or no content available`,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    logWarning(`Failed to fetch summary: ${message}`);
  }
}
