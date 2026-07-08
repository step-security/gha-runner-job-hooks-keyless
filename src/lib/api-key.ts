import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import { logInfo, logWarning } from "./common";
import { ApiKeyConfig } from "./config";

export interface FetchApiKeyOptions {
  roleArn: string;
  secretName: string;
  region?: string;
  keyField?: string;
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
      DurationSeconds: 3600,
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

export async function resolveApiKey(
  options: { owner?: string } = {},
): Promise<string> {
  const envApiKey = ApiKeyConfig.envApiKey;
  if (envApiKey) {
    logInfo("Using API key from environment");
    return envApiKey;
  }

  const roleArn = ApiKeyConfig.roleArn;
  const secretName =
    ApiKeyConfig.secretName ||
    (options.owner ? `stepsecurity/orgs/${options.owner}/vm-api-key` : "");
  if (!roleArn) {
    logWarning(
      "STEP_API_KEY_ROLE_ARN is not set; skipping AWS Secrets Manager API key lookup",
    );
    return "";
  }

  if (!secretName) {
    logWarning(
      "STEP_API_KEY_SECRET_NAME is not set and owner was not provided; skipping AWS Secrets Manager API key lookup",
    );
    return "";
  }

  logInfo(`Using API key from AWS Secrets Manager secret: ${secretName}`);
  return fetchApiKeyFromSecret({
    roleArn,
    secretName,
    region: ApiKeyConfig.secretRegion,
    keyField: ApiKeyConfig.secretField,
  });
}
