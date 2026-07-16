import { randomUUID } from "crypto";

import { resolveApiKey } from "./api-key";
import { writeJsonFile } from "./files";
import { getGithubRunContext } from "./github-context";
import {
  fetchPolicyStoreConfig,
  PolicyStoreConfig,
  PolicyStoreFetchResult,
} from "./policy";
import { Urls } from "./config";
import { logInfo, logWarning } from "./common";

export type SharedAgentConfig = {
  customer: string;
  repo: string;
  workflow: string;
  run_id: string;
  correlation_id: string;
  working_directory: string;
  runner_work_directory: string;
  api_url: string;
  telemetry_url: string;
  api_key: string;
  is_persistent: boolean;
  has_prejob_policy: boolean;
  allowed_endpoints: string;
  egress_policy: string;
  disable_telemetry: boolean;
  disable_sudo: boolean;
  disable_sudo_and_containers: boolean;
  disable_file_monitoring: boolean;
  private: boolean;
  is_github_hosted: boolean;
  one_time_key: string;
  is_debug: boolean;
};

type BuildAgentConfigOptions = {
  agentJsonPath: string;
  isPersistent: boolean;
  isGithubHosted?: boolean;
  workingDirectory?: string;
  isDebug?: boolean;
  egressPolicyAlwaysAudit?: boolean;
};

const RuntimeConfig = {
  ...getGithubRunContext(),
};

function createBaseAgentConfig(
  correlationId: string,
  apiKey: string,
  options: BuildAgentConfigOptions,
): SharedAgentConfig {
  const runnerWorkDirectory =
    options.workingDirectory ?? process.env.GITHUB_WORKSPACE ?? "";

  return {
    customer: RuntimeConfig.owner,
    repo: RuntimeConfig.githubRepository,
    workflow: RuntimeConfig.workflow,
    run_id: RuntimeConfig.runId,
    correlation_id: correlationId,
    working_directory: runnerWorkDirectory,
    runner_work_directory: runnerWorkDirectory,
    api_url: Urls.stepSecurityApi,
    telemetry_url: Urls.stepSecurityTelemetry,
    api_key: apiKey,
    is_persistent: options.isPersistent,
    has_prejob_policy: false,
    allowed_endpoints: "",
    egress_policy: "audit",
    disable_telemetry: false,
    disable_sudo: false,
    disable_sudo_and_containers: false,
    disable_file_monitoring: false,
    private: process.env.GITHUB_REPOSITORY_VISIBILITY === "private",
    is_github_hosted: options.isGithubHosted || false,
    one_time_key: "",
    is_debug: options.isDebug || false,
  };
}

async function loadPolicyConfig(
  correlationId: string,
  apiKey: string,
): Promise<{
  hasPolicy: boolean;
  config: PolicyStoreConfig | null;
  fetchStatus: PolicyStoreFetchResult["status"];
}> {
  if (!apiKey) {
    logWarning(
      "API key is not set; defaulting to audit mode without policy fetch",
    );
    return { hasPolicy: false, config: null, fetchStatus: "error" };
  }

  const result = await fetchPolicyStoreConfig({
    owner: RuntimeConfig.owner,
    repo: RuntimeConfig.repo,
    workflow: RuntimeConfig.workflow,
    runId: RuntimeConfig.runId,
    correlationId,
    apiKey,
  });

  if (result.status !== "found") {
    return { hasPolicy: false, config: null, fetchStatus: result.status };
  }

  return { hasPolicy: true, config: result.config, fetchStatus: result.status };
}

export async function buildSharedAgentJsonForCurrentJob(
  options: BuildAgentConfigOptions,
): Promise<string> {
  const correlationId = randomUUID();
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  const apiKey = await resolveApiKey({ owner: RuntimeConfig.owner });
  if (apiKey) {
    logInfo("API key resolved successfully");
  } else {
    logWarning("API key could not be resolved");
  }
  const agentConfig = createBaseAgentConfig(correlationId, apiKey, options);
  logInfo("Checking for policy from policy store...");
  const { hasPolicy, config, fetchStatus } = await loadPolicyConfig(
    correlationId,
    apiKey,
  );

  if (hasPolicy) {
    logInfo(`Policy found: ${config?.policyName || "unnamed"}`);
  } else if (fetchStatus === "not_found") {
    logInfo("No policy configured from policy store");
  } else {
    logWarning("Policy fetch failed; defaulting to audit mode");
  }

  if (config) {
    agentConfig.allowed_endpoints = config.allowedEndpoints;
    agentConfig.egress_policy = config.egressPolicy;
    agentConfig.disable_telemetry = config.disableTelemetry;
    agentConfig.disable_sudo = config.disableSudo;
    agentConfig.disable_sudo_and_containers = config.disableSudoAndContainers;
    agentConfig.disable_file_monitoring = config.disableFileMonitoring;
  }

  if (options.egressPolicyAlwaysAudit) {
    logInfo("Overriding egress_policy to audit for this agent configuration");
    agentConfig.egress_policy = "audit";
  }

  writeJsonFile(
    options.agentJsonPath,
    agentConfig as unknown as Record<string, unknown>,
  );

  return correlationId;
}
