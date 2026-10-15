import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import { getWithRetry, logInfo, logWarning } from "./common";
import { ApiKeyConfig, ArtifactoryConfig } from "./config";
import {
  ArtifactoryConfigValues,
  isArtifactoryConfigured,
  searchArtifactsByProperties,
  toLogValue,
} from "./artifactory";
import { getGitHubEnv, GitHubEnv } from "./github-context";
import { runAwsEndpointPreflight } from "./preflight";

export interface FetchApiKeyOptions {
  roleArn: string;
  secretName: string;
  orgName: string;
  region?: string;
  keyField?: string;
}

export type HookConfig = {
  roleArn: string;
  region: string;
};

type SearchHookConfig = (
  config: ArtifactoryConfigValues,
  selectors: Record<string, string>,
) => Promise<Array<{ downloadUri?: string }>>;

type GetHookConfig = (
  url: string | URL,
  headers?: Record<string, string>,
) => Promise<{ statusCode: number; body: string }>;

export async function resolveApiKey(
  options: { owner?: string } = {},
): Promise<string> {
  const envApiKey = ApiKeyConfig.envApiKey;
  if (envApiKey) {
    logInfo("ApiKey source=environment");
    return envApiKey;
  }

  if (!options.owner) {
    logWarning(
      "ApiKey status=skipped source=secrets-manager reason=missing-owner",
    );
    return "";
  }

  const githubEnv = getGitHubEnv();
  const downloadUris = await resolveHookConfigUris();
  const secretName = getApiKeyName(
    githubEnv,
    options.owner,
    ApiKeyConfig.secretName,
  );
  logInfo(`ApiKey source=secrets-manager secret_name=${secretName}`);

  let lastError: unknown;
  for (const [index, downloadUri] of downloadUris.entries()) {
    const attempt = `${index + 1}/${downloadUris.length}`;
    logInfo(
      `HookConfig action=try attempt=${attempt} url=${toLogValue(downloadUri)}`,
    );
    try {
      const config = await downloadHookConfig(downloadUri);
      logInfo(`HookConfig status=resolved region=${config.region}`);
      await runAwsEndpointPreflight(config.region);
      return await fetchApiKeyFromSecret({
        ...config,
        secretName,
        orgName: options.owner,
        keyField: ApiKeyConfig.secretField,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`ApiKey status=failed attempt=${attempt} error=${message}`);
    }
  }
  throw lastError;
}

export async function fetchApiKeyFromSecret(
  opts: FetchApiKeyOptions,
): Promise<string> {
  const region = opts.region;
  const keyField = opts.keyField;

  const sts = new STSClient({ region });
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: opts.roleArn,
      RoleSessionName: `secret-read-${Date.now()}`,
      DurationSeconds: 900,
      Tags: [{ Key: "OrgName", Value: opts.orgName }],
    }),
  );

  if (!Credentials) {
    throw new Error(`assume-role returned no credentials for ${opts.roleArn}`);
  }

  const sm = new SecretsManagerClient({
    region,
    credentials: {
      accessKeyId: Credentials.AccessKeyId!,
      secretAccessKey: Credentials.SecretAccessKey!,
      sessionToken: Credentials.SessionToken!,
    },
  });

  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: opts.secretName }),
  );

  if (!SecretString) {
    throw new Error(`secret ${opts.secretName} has no SecretString`);
  }

  const parsed = JSON.parse(SecretString) as Record<string, unknown>;
  const value = keyField ? parsed[keyField] : undefined;

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `field "${keyField}" not found in secret ${opts.secretName}`,
    );
  }

  return value;
}

export function getApiKeyName(
  githubEnv: GitHubEnv,
  owner: string,
  template: string,
): string {
  return template
    .replace(/<github_env>/g, () => githubEnv)
    .replace(/<owner>/g, () => owner);
}

export async function resolveHookConfigUris(
  artifactoryConfig: ArtifactoryConfigValues = ArtifactoryConfig,
  search: SearchHookConfig = searchArtifactsByProperties,
): Promise<string[]> {
  if (!isArtifactoryConfigured(artifactoryConfig)) {
    throw new Error(
      "ApiKey status=config-invalid reason=missing-artifactory-config",
    );
  }

  const results = await search(artifactoryConfig, {
    "ss.serving": "true",
    "ss.gha-hook-config": "true",
  });
  if (results.length === 0) {
    throw new Error(
      `ApiKey status=config-invalid reason=unexpected-result-count count=${results.length}`,
    );
  }

  const downloadUris = results
    .map((result) => result.downloadUri?.trim() || "")
    .filter(Boolean);
  if (downloadUris.length === 0) {
    throw new Error(
      "ApiKey status=config-invalid reason=missing-download-uri",
    );
  }

  logInfo(`HookConfig status=found count=${downloadUris.length}`);
  return downloadUris;
}

export async function downloadHookConfig(
  downloadUri: string,
  get: GetHookConfig = getWithRetry,
): Promise<HookConfig> {
  const { statusCode, body } = await get(new URL(downloadUri), {
    "User-Agent": "stepsecurity-jobhooks",
  });
  if (statusCode !== 200) {
    throw new Error(
      `ApiKey status=config-invalid reason=config-download-failed http_status=${statusCode}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("ApiKey status=config-invalid reason=invalid-config-json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ApiKey status=config-invalid reason=invalid-config-json");
  }

  const values = parsed as Record<string, unknown>;
  return {
    region: readConfigField(values, "region"),
    roleArn: readConfigField(values, "roleArn"),
  };
}

function readConfigField(
  config: Record<string, unknown>,
  name: string,
): string {
  const value = config[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ApiKey status=config-invalid field=${name}`);
  }
  return value.trim();
}
