import { randomUUID } from "crypto";

import { resolveApiKey } from "./api-key";
import { writeJsonFile } from "./files";
import {
  getGithubRunContext,
  getGitHubEnv,
  getScopedOwner,
  GitHubEnv,
} from "./github-context";
import {
  fetchPolicyStoreConfig,
  handleBlockedRunPolicyEvaluation,
  PolicyStoreConfig,
  PolicyStoreFetchResult,
} from "./policy";
import { ExplicitProxyConfig, GhesConfig, Urls } from "./config";
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
  denied_endpoints: string;
  egress_policy: string;
  disable_telemetry: boolean;
  disable_sudo: boolean;
  disable_sudo_and_containers: boolean;
  disable_file_monitoring: boolean;
  private: boolean;
  is_github_hosted: boolean;
  one_time_key: string;
  is_debug: boolean;
  is_ghes?: boolean;
  is_explicit_proxy?: boolean;
  explicit_proxy_endpoints?: string[];
};

export function parseExplicitProxyEndpoints(raw: string): string[] {
  const seen = new Set<string>();
  for (const entry of raw.split(/[\s,]+/)) {
    const value = entry.trim();
    if (value) {
      seen.add(value);
    }
  }
  return Array.from(seen);
}

// host:port of a proxy URL as found in HTTPS_PROXY / HTTP_PROXY. Accepts
// "http://host:port", "http://user:pass@host:port", and a bare "host:port".
// The port defaults from the scheme when the URL has none.
export function proxyEndpointFromUrl(raw: string | undefined): string {
  const value = (raw || "").trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    if (!url.hostname) {
      return "";
    }
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname}:${port}`;
  } catch {
    return "";
  }
}

// The proxies to tell the agent about: the explicit override if set,
// otherwise whatever the runner's proxy variables point at, deduplicated.
export function resolveExplicitProxyEndpoints(config: {
  endpoints: string;
  proxyUrls: readonly (string | undefined)[];
}): string[] {
  const explicit = parseExplicitProxyEndpoints(config.endpoints);
  if (explicit.length > 0) {
    return explicit;
  }
  const seen = new Set<string>();
  for (const url of config.proxyUrls) {
    const endpoint = proxyEndpointFromUrl(url);
    if (endpoint) {
      seen.add(endpoint);
    }
  }
  return Array.from(seen);
}

export type JobPolicy = {
  apiKey: string;
  correlationId: string;
  config: PolicyStoreConfig | null;
};

type BuildAgentConfigOptions = {
  agentJsonPath: string;
  isPersistent: boolean;
  isGithubHosted?: boolean;
  workingDirectory?: string;
  isDebug?: boolean;
  egressPolicyAlwaysAudit?: boolean;
  logJobDetails?: boolean;
};

const RuntimeConfig = {
  ...getGithubRunContext(),
};

export function getAgentIdentity(
  githubEnv: GitHubEnv,
  githubRepository: string,
  owner: string,
  repo: string,
  customer: string,
  scopedOwner: string,
): Pick<SharedAgentConfig, "customer" | "repo" | "is_ghes"> {
  if (githubEnv === "ghec") {
    return { customer: owner, repo: githubRepository };
  }

  return {
    customer: customer.trim(),
    repo: `${scopedOwner}/${repo}`,
    is_ghes: true,
  };
}

function createBaseAgentConfig(
  correlationId: string,
  apiKey: string,
  githubEnv: GitHubEnv,
  scopedOwner: string,
  options: BuildAgentConfigOptions,
): SharedAgentConfig {
  const runnerWorkDirectory =
    options.workingDirectory ?? process.env.GITHUB_WORKSPACE ?? "";

  return {
    ...getAgentIdentity(
      githubEnv,
      RuntimeConfig.githubRepository,
      RuntimeConfig.owner,
      RuntimeConfig.repo,
      GhesConfig.customer,
      scopedOwner,
    ),
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
    denied_endpoints: "",
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
  owner: string,
): Promise<{
  hasPolicy: boolean;
  config: PolicyStoreConfig | null;
  fetchStatus: PolicyStoreFetchResult["status"];
}> {
  if (!apiKey) {
    logWarning("Policy status=skipped reason=missing-api-key fallback=audit");
    return { hasPolicy: false, config: null, fetchStatus: "error" };
  }

  const result = await fetchPolicyStoreConfig({
    owner,
    repo: RuntimeConfig.repo,
    workflow: RuntimeConfig.workflow,
    runId: RuntimeConfig.runId,
    correlationId,
    apiKey,
  });
  handleBlockedRunPolicyEvaluation(result.runPolicyEvaluation);

  if (result.status !== "found") {
    return { hasPolicy: false, config: null, fetchStatus: result.status };
  }

  return { hasPolicy: true, config: result.config, fetchStatus: result.status };
}

// Cancels the job (via handleBlockedRunPolicyEvaluation) when the workflow run
// policy concludes block, so call it before any step that can return early.
export async function fetchJobPolicyForCurrentJob(): Promise<JobPolicy> {
  const githubEnv = getGitHubEnv();
  const scopedOwner = getScopedOwner(
    githubEnv,
    RuntimeConfig.owner,
    GhesConfig.customer,
    GhesConfig.serverName,
  );

  // API-key secret names and STS tags continue to use the raw GitHub owner.
  const apiKey = await resolveApiKey({ owner: RuntimeConfig.owner });
  if (apiKey) {
    logInfo("ApiKey status=resolved");
  } else {
    logWarning("ApiKey status=missing");
    throw new Error("ApiKey status=missing");
  }

  const correlationId = randomUUID();
  logInfo("Policy action=fetch source=policy-store");
  const { hasPolicy, config, fetchStatus } = await loadPolicyConfig(
    correlationId,
    apiKey,
    scopedOwner,
  );

  // marker log
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  if (hasPolicy) {
    logInfo(`Policy status=found name=${config?.policyName || "unnamed"}`);
  } else if (fetchStatus === "not_found") {
    logInfo("Policy status=not-found");
  } else {
    logWarning("Policy status=fetch-failed fallback=audit");
  }

  return { apiKey, correlationId, config };
}

export async function buildSharedAgentJsonForCurrentJob(
  options: BuildAgentConfigOptions,
  jobPolicy: JobPolicy,
): Promise<string> {
  const { apiKey, correlationId, config } = jobPolicy;
  const githubEnv = getGitHubEnv();
  const scopedOwner = getScopedOwner(
    githubEnv,
    RuntimeConfig.owner,
    GhesConfig.customer,
    GhesConfig.serverName,
  );
  const agentConfig = createBaseAgentConfig(
    correlationId,
    apiKey,
    githubEnv,
    scopedOwner,
    options,
  );

  if (config) {
    agentConfig.allowed_endpoints = config.allowedEndpoints;
    agentConfig.denied_endpoints = config.deniedEndpoints;
    agentConfig.egress_policy = config.egressPolicy;
    agentConfig.disable_telemetry = config.disableTelemetry;
    agentConfig.disable_sudo = config.disableSudo;
    agentConfig.disable_sudo_and_containers = config.disableSudoAndContainers;
    agentConfig.disable_file_monitoring = config.disableFileMonitoring;
  }

  if (options.egressPolicyAlwaysAudit) {
    logInfo("AgentConfig override=egress_policy value=audit");
    agentConfig.egress_policy = "audit";
  }

  const proxyEndpoints = resolveExplicitProxyEndpoints(ExplicitProxyConfig);
  if (proxyEndpoints.length > 0) {
    agentConfig.is_explicit_proxy = true;
    agentConfig.explicit_proxy_endpoints = proxyEndpoints;
    logInfo(`AgentConfig explicit_proxy_endpoints=${proxyEndpoints.join(",")}`);
  }

  writeJsonFile(
    options.agentJsonPath,
    agentConfig as unknown as Record<string, unknown>,
  );

  if (options.logJobDetails) {
    logInfo(`Step Security Job Correlation ID: ${agentConfig.correlation_id}`);
    logInfo(`EgressPolicy: ${agentConfig?.egress_policy || "audit"}`);
  }

  return correlationId;
}
