import * as fs from "fs";

import { getWithRetry, logInfo, logWarning } from "./common";
import { Urls } from "./config";
import { getGithubRunContext } from "./github-context";

const RuntimeConfig = {
  ...getGithubRunContext(),
};

export async function appendJobSummary(params: {
  correlationId: string;
  environment: string;
  includeTimeRange?: boolean;
}): Promise<void> {
  if (!params.correlationId) {
    return;
  }

  const summaryUrl = new URL(
    `${Urls.stepSecurityApi}/github/${RuntimeConfig.githubRepository}/actions/runs/${RuntimeConfig.runId}/correlation/${params.correlationId}/job-markdown-summary`,
  );
  summaryUrl.searchParams.append("environment", params.environment);

  if (params.includeTimeRange !== false) {
    summaryUrl.searchParams.append(
      "start_time",
      String(getStartTime(RuntimeConfig.eventPath)),
    );
    summaryUrl.searchParams.append(
      "end_time",
      String(Math.floor(Date.now() / 1000)),
    );
  }

  logInfo(`Summary URL: ${summaryUrl.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl);
    if (String(statusCode) === "200" && body) {
      if (!RuntimeConfig.stepSummaryPath) {
        logWarning("GITHUB_STEP_SUMMARY is not set; skipping summary write");
        return;
      }

      fs.appendFileSync(RuntimeConfig.stepSummaryPath, body, "utf8");
      logInfo("Summary added to job output");
      return;
    }

    logWarning(
      `Failed to fetch summary (HTTP ${statusCode}) or no content available`,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    logWarning(`Failed to fetch summary: ${message}`);
  }
}

function getStartTime(filePath: string): number {
  if (!filePath) {
    return 0;
  }

  try {
    const stats = fs.statSync(filePath);
    const birthtimeMs = Number(stats.birthtimeMs);
    if (!Number.isFinite(birthtimeMs) || birthtimeMs <= 0) {
      return 0;
    }
    return Math.floor(birthtimeMs / 1000);
  } catch {
    return 0;
  }
}
