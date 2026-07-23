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

  logInfo(
    `Summary action=fetch url=${summaryUrl.toString()} environment=${params.environment} correlation_id=${params.correlationId}`,
  );

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl);
    if (String(statusCode) === "200" && body) {
      if (!RuntimeConfig.stepSummaryPath) {
        logWarning(
          "Summary action=write status=skipped reason=missing-step-summary-path",
        );
        return;
      }

      fs.appendFileSync(RuntimeConfig.stepSummaryPath, body, "utf8");
      logInfo("Summary action=write status=completed");
      return;
    }

    logWarning(
      `Summary action=fetch status=failed http_status=${statusCode} has_body=${body ? "true" : "false"}`,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    logWarning(`Summary action=fetch status=error error=${message}`);
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
