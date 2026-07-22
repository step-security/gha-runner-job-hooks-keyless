const http = require("http") as typeof import("http");
const https = require("https") as typeof import("https");

import { logInfo, logWarning } from "./common";
import { ApiKeyConfig, ArtifactoryConfig, Urls } from "./config";

const DefaultTimeoutMs = 5000;

export class EndpointPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointPreflightError";
  }
}

export class HookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookConfigurationError";
  }
}

type ConfiguredEndpointPreflightOptions = {
  requireVmApiKey?: boolean;
  stepSecurityApiOnly?: boolean;
};

export async function runConfiguredEndpointPreflight(
  options: ConfiguredEndpointPreflightOptions = {},
): Promise<void> {
  const configFailures = collectConfigFailures(options);
  const endpoints = collectConfiguredEndpoints(options);

  logInfo(
    `Endpoint preflight checking ${endpoints.length} configured endpoint(s)`,
  );

  const endpointFailures = (
    await Promise.all(
      endpoints.map(async (endpoint) => {
        try {
          await preflightEndpoint(endpoint.label, endpoint.url);
          return "";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }),
    )
  ).filter(Boolean);
  const failures = [...configFailures, ...endpointFailures];

  for (const failure of failures) {
    logWarning(failure);
  }

  if (options.requireVmApiKey && configFailures.length > 0) {
    throw new HookConfigurationError(configFailures.join("; "));
  }
}

function collectConfigFailures(
  options: ConfiguredEndpointPreflightOptions,
): string[] {
  const failures: string[] = [];

  if (
    options.requireVmApiKey &&
    !ApiKeyConfig.envApiKey.trim() &&
    !ApiKeyConfig.roleArn.trim()
  ) {
    failures.push(
      "STEP_API_KEY or STEP_API_KEY_ROLE_ARN must be set; skipping agent configuration and install",
    );
  }

  const artifactoryValues = [
    ArtifactoryConfig.base.trim(),
    ArtifactoryConfig.repo.trim(),
  ];
  const artifactoryValueCount = artifactoryValues.filter(Boolean).length;
  if (artifactoryValueCount > 0 && artifactoryValueCount < artifactoryValues.length) {
    failures.push(
      "STEP_ARTIFACTORY_BASE and STEP_ARTIFACTORY_REPO must be set together for Artifactory property-search mode",
    );
  }

  return failures;
}

function collectConfiguredEndpoints(
  options: ConfiguredEndpointPreflightOptions,
): Array<{ label: string; url: string }> {
  const endpoints: Array<{ label: string; url: string }> = [
    { label: "StepSecurity API", url: Urls.stepSecurityApi },
  ];

  if (options.stepSecurityApiOnly) {
    return dedupeEndpoints(endpoints);
  }

  endpoints.push({
    label: "StepSecurity telemetry API",
    url: Urls.stepSecurityTelemetry,
  });

  if (ArtifactoryConfig.base.trim()) {
    endpoints.push({
      label: "Artifactory base URL",
      url: ArtifactoryConfig.base,
    });
  }

  if (ApiKeyConfig.roleArn.trim()) {
    const region = ApiKeyConfig.secretRegion;
    endpoints.push(
      {
        label: "AWS STS regional endpoint",
        url: `https://sts.${region}.amazonaws.com/`,
      },
      {
        label: "AWS Secrets Manager regional endpoint",
        url: `https://secretsmanager.${region}.amazonaws.com/`,
      },
    );
  }

  return dedupeEndpoints(endpoints);
}

function dedupeEndpoints(
  endpoints: Array<{ label: string; url: string }>,
): Array<{ label: string; url: string }> {
  const seen = new Set<string>();
  const uniqueEndpoints: Array<{ label: string; url: string }> = [];

  for (const endpoint of endpoints) {
    const key = normalizeEndpointKey(endpoint.url);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueEndpoints.push(endpoint);
  }

  return uniqueEndpoints;
}

function normalizeEndpointKey(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function preflightEndpoint(
  label: string,
  url: string | URL,
): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = typeof url === "string" ? new URL(url) : url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EndpointPreflightError(
      `Configured endpoint is invalid: ${label} (${String(url)}). ${message}`,
    );
  }

  logInfo(`Preflight checking ${label}: ${parsedUrl.origin}`);

  try {
    await probeEndpoint(parsedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EndpointPreflightError(
      `Required endpoint is not reachable: ${label} (${parsedUrl.origin}). ${message}`,
    );
  }
}

function probeEndpoint(url: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "http:" ? http : https;
    const request = client.request(
      url,
      {
        method: "HEAD",
        timeout: DefaultTimeoutMs,
        headers: {
          "User-Agent": "stepsecurity-jobhooks",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve());
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`timed out after ${DefaultTimeoutMs}ms`));
    });

    request.on("error", (error: Error) => {
      reject(error);
    });

    request.end();
  });
}
