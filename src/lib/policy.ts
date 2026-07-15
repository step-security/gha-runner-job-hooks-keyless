import { getWithRetry, logError, logInfo } from "./common";
import { Urls } from "./config";

export type WorkflowPolicyCheckResult = {
  hasPolicy: boolean;
  shouldSleep: boolean;
};

export type WorkflowPolicyStatus = "APPLIED" | "NOT_APPLIED" | "SLEEP";

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
  disableSudo: boolean;
  disableSudoAndContainers: boolean;
  disableFileMonitoring: boolean;
  disableTelemetry: boolean;
  egressPolicy: string;
};

export type PolicyStoreFetchResult =
  | { status: "found"; config: PolicyStoreConfig }
  | { status: "not_found" }
  | { status: "error" };

type PolicyStoreResponse = {
  policy_name?: unknown;
  allowed_endpoints?: unknown;
  disable_sudo?: unknown;
  disable_sudo_and_containers?: unknown;
  disable_file_monitoring?: unknown;
  disable_telemetry?: unknown;
  egress_policy?: unknown;
};

function parseBooleanField(body: string, fieldName: string): boolean {
  try {
    const response = JSON.parse(body) as Record<string, unknown>;
    return response[fieldName] === true;
  } catch {
    return false;
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

export async function fetchWorkflowPolicyCheck(
  params: WorkflowPolicyCheckParams,
): Promise<WorkflowPolicyCheckResult> {
  const url = new URL(
    `${Urls.stepSecurityApi}/github/${params.owner}/${params.repo}/actions/policies/workflow-check`,
  );
  url.searchParams.append("workflow", params.workflow);
  url.searchParams.append("run_id", params.runId);
  url.searchParams.append("correlationId", params.correlationId);

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
      return { hasPolicy: false, shouldSleep: false };
    }

    return {
      hasPolicy: parseBooleanField(body, "has_policy"),
      shouldSleep: parseBooleanField(body, "should_sleep"),
    };
  } catch (error) {
    const status =
      error instanceof Error && error.message ? error.message : "unknown";
    logError(`API call failed with status ${status}`);
    logInfo("Response: ");
    return { hasPolicy: false, shouldSleep: false };
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
    return { status: "error" };
  }

  const url = new URL(
    `${Urls.stepSecurityApi}/github/${params.owner}/${params.repo}/actions/policies/workflow-policy`,
  );
  url.searchParams.append("workflow", params.workflow);
  url.searchParams.append("run_id", params.runId);
  url.searchParams.append("correlationId", params.correlationId);

  logInfo(`Policy fetch URL: ${url.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(url, {
      Authorization: `vm-api-key ${params.apiKey}`,
    });

    if (String(statusCode) === "404") {
      return { status: "not_found" };
    }

    if (String(statusCode) !== "200") {
      logError(`Policy fetch failed with status ${statusCode}`);
      logInfo(`Response: ${body}`);
      return { status: "error" };
    }

    const config = parsePolicyStoreConfig(body);
    if (!config) {
      return { status: "not_found" };
    }

    return {
      status: "found",
      config,
    };
  } catch (error) {
    const status =
      error instanceof Error && error.message ? error.message : "unknown";
    logError(`Policy fetch failed with status ${status}`);
    logInfo("Response: ");
    return { status: "error" };
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

function parsePolicyStoreConfig(body: string): PolicyStoreConfig | null {
  const response = JSON.parse(body) as PolicyStoreResponse;
  const policyName =
    typeof response.policy_name === "string" ? response.policy_name.trim() : "";

  if (!policyName) {
    return null;
  }

  const allowedEndpoints = Array.isArray(response.allowed_endpoints)
    ? response.allowed_endpoints
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";

  return {
    policyName,
    allowedEndpoints,
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
