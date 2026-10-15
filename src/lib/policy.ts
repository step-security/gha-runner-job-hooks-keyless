import {
  getWithRetry,
  logError,
  logErrorAnnotation,
  logInfo,
  logWarning,
  terminateRunnerWorker,
} from "./common";
import { Urls } from "./config";
import { appendSummaryMarkdown } from "./summary";

export type WorkflowPolicyCheckResult = {
  hasPolicy: boolean;
  shouldSleep: boolean;
  runPolicyEvaluation: RunPolicyEvaluation | null;
};

export type WorkflowPolicyStatus = "APPLIED" | "NOT_APPLIED" | "SLEEP";
export type RunPolicyConclusion = "block" | "proceed";

export type RunPolicyEvaluation = {
  conclusion: RunPolicyConclusion;
  summaryMarkdown?: string;
  summaryLog?: string;
};

export type WorkflowPolicyCheckParams = {
  owner: string;
  repo: string;
  workflow: string;
  runId: string;
  correlationId: string;
  apiKey?: string;
};

export type PolicyStoreConfig = {
  policyName: string;
  allowedEndpoints: string;
  deniedEndpoints: string;
  disableSudo: boolean;
  disableSudoAndContainers: boolean;
  disableFileMonitoring: boolean;
  disableTelemetry: boolean;
  egressPolicy: string;
};

export type PolicyStoreFetchResult =
  | {
      status: "found";
      config: PolicyStoreConfig;
      runPolicyEvaluation: RunPolicyEvaluation | null;
    }
  | {
      status: "not_found" | "error";
      runPolicyEvaluation: RunPolicyEvaluation | null;
    };

type WorkflowPolicyCheckResponse = {
  has_policy?: unknown;
  should_sleep?: unknown;
  run_policy_evaluation?: unknown;
};

type PolicyStoreResponse = {
  policy_name?: unknown;
  allowed_endpoints?: unknown;
  denied_endpoints?: unknown;
  disable_sudo?: unknown;
  disable_sudo_and_containers?: unknown;
  disable_file_monitoring?: unknown;
  disable_telemetry?: unknown;
  egress_policy?: unknown;
  run_policy_evaluation?: unknown;
};

export async function fetchWorkflowPolicyCheck(
  params: WorkflowPolicyCheckParams,
): Promise<WorkflowPolicyCheckResult> {
  const url = new URL(
    `${Urls.stepSecurityApi}/github/${params.owner}/${params.repo}/actions/policies/workflow-check`,
  );
  url.searchParams.append("workflow", params.workflow);
  url.searchParams.append("run_id", params.runId);
  url.searchParams.append("correlationId", params.correlationId);
  url.searchParams.append("evaluate_run_policies", "true");

  logInfo(`Policy store request URL: ${url.toString()}`);

  try {
    const headers: Record<string, string> = {};
    if (params.apiKey && params.apiKey.length > 0) {
      headers.Authorization = `vm-api-key ${params.apiKey}`;
    }
    const { statusCode, body } = await getWithRetry(url, headers);
    if (String(statusCode) !== "200") {
      logError(`API call failed with status ${statusCode}`);
      logInfo(`Response: ${body}`);
      return { hasPolicy: false, shouldSleep: false, runPolicyEvaluation: null };
    }

    return parseWorkflowPolicyCheckResponse(body);
  } catch (error) {
    const status =
      error instanceof Error && error.message ? error.message : "unknown";
    logError(`API call failed with status ${status}`);
    logInfo("Response: ");
    return { hasPolicy: false, shouldSleep: false, runPolicyEvaluation: null };
  }
}

export async function fetchPolicyStoreConfig(params: {
  owner: string;
  repo: string;
  workflow: string;
  runId: string;
  correlationId: string;
  apiKey: string;
}): Promise<PolicyStoreFetchResult> {
  if (!params.apiKey) {
    return { status: "error", runPolicyEvaluation: null };
  }

  const url = new URL(
    `${Urls.stepSecurityApi}/github/${params.owner}/${params.repo}/actions/policies/workflow-policy`,
  );
  url.searchParams.append("workflow", params.workflow);
  url.searchParams.append("run_id", params.runId);
  url.searchParams.append("correlationId", params.correlationId);
  url.searchParams.append("evaluate_run_policies", "true");

  logInfo(`Policy fetch URL: ${url.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(url, {
      Authorization: `vm-api-key ${params.apiKey}`,
    });
    const runPolicyEvaluation = parseRunPolicyEvaluationFromBody(body);

    if (String(statusCode) === "404") {
      return { status: "not_found", runPolicyEvaluation };
    }

    if (String(statusCode) !== "200") {
      logError(`Policy fetch failed with status ${statusCode}`);
      logInfo(`Response: ${body}`);
      return { status: "error", runPolicyEvaluation };
    }

    const config = parsePolicyStoreConfig(body);
    if (!config) {
      return { status: "not_found", runPolicyEvaluation };
    }

    return {
      status: "found",
      config,
      runPolicyEvaluation,
    };
  } catch (error) {
    const status =
      error instanceof Error && error.message ? error.message : "unknown";
    logError(`Policy fetch failed with status ${status}`);
    logInfo("Response: ");
    return { status: "error", runPolicyEvaluation: null };
  }
}

export async function fetchWorkflowPolicyStatus(params: {
  owner: string;
  repo: string;
  correlationId: string;
}): Promise<WorkflowPolicyStatus> {
  const url = new URL(
    `${Urls.stepSecurityApi}/github/${params.owner}/${params.repo}/actions/policies/workflow-policy/status`,
  );
  url.searchParams.append("correlation_id", params.correlationId);

  try {
    const { statusCode, body } = await getWithRetry(url);
    if (String(statusCode) !== "200") {
      return "SLEEP";
    }

    return parseStatusField(body);
  } catch {
    return "SLEEP";
  }
}

export function handleBlockedRunPolicyEvaluation(
  runPolicyEvaluation: RunPolicyEvaluation | null,
): void {
  if (runPolicyEvaluation?.conclusion !== "block") {
    return;
  }

  if (runPolicyEvaluation.summaryMarkdown) {
    appendSummaryMarkdown(runPolicyEvaluation.summaryMarkdown);
  }

  if (runPolicyEvaluation.summaryLog) {
    console.log(runPolicyEvaluation.summaryLog);
  }

  // Before terminateRunnerWorker(), which kills the worker reading this stdout.
  logErrorAnnotation(
    "StepSecurity workflow run policy",
    "Job cancelled: the workflow run policy concluded block.",
  );

  logWarning(
    "Workflow is being cancelled because workflow run policy concluded with block",
  );

  terminateRunnerWorker();
  process.exit(1);
}

function parseWorkflowPolicyCheckResponse(
  body: string,
): WorkflowPolicyCheckResult {
  try {
    const response = JSON.parse(body) as WorkflowPolicyCheckResponse;
    return {
      hasPolicy: response.has_policy === true,
      shouldSleep: response.should_sleep === true,
      runPolicyEvaluation: parseRunPolicyEvaluation(
        response.run_policy_evaluation,
      ),
    };
  } catch {
    return { hasPolicy: false, shouldSleep: false, runPolicyEvaluation: null };
  }
}

function parseStatusField(body: string): WorkflowPolicyStatus {
  try {
    const response = JSON.parse(body) as { status?: unknown };
    if (response.status === "APPLIED" || response.status === "NOT_APPLIED") {
      return response.status;
    }
  } catch {
    // ignore
  }

  return "SLEEP";
}

export function parsePolicyStoreConfig(body: string): PolicyStoreConfig | null {
  const response = JSON.parse(body) as PolicyStoreResponse;
  const policyName =
    typeof response.policy_name === "string" ? response.policy_name.trim() : "";

  if (!policyName) {
    return null;
  }

  return {
    policyName,
    allowedEndpoints: endpointArrayToString(response.allowed_endpoints),
    deniedEndpoints: endpointArrayToString(response.denied_endpoints),
    disableSudo: response.disable_sudo === true,
    disableSudoAndContainers: response.disable_sudo_and_containers === true,
    disableFileMonitoring: response.disable_file_monitoring === true,
    disableTelemetry: response.disable_telemetry === true,
    egressPolicy:
      typeof response.egress_policy === "string" &&
      response.egress_policy.length > 0
        ? response.egress_policy
        : "audit",
  };
}

function endpointArrayToString(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join(" ")
    : "";
}

function parseRunPolicyEvaluationFromBody(
  body: string,
): RunPolicyEvaluation | null {
  try {
    return parseRunPolicyEvaluation(
      (JSON.parse(body) as PolicyStoreResponse).run_policy_evaluation,
    );
  } catch {
    return null;
  }
}

export function parseRunPolicyEvaluation(
  value: unknown,
): RunPolicyEvaluation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (response.conclusion !== "block" && response.conclusion !== "proceed") {
    return null;
  }

  return {
    conclusion: response.conclusion,
    summaryMarkdown:
      typeof response.summary_markdown === "string" &&
      response.summary_markdown.length > 0
        ? response.summary_markdown
        : undefined,
    summaryLog:
      typeof response.summary_log === "string" && response.summary_log.length > 0
        ? response.summary_log
        : undefined,
  };
}
