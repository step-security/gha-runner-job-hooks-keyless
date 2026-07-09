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
  orgName: string;
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
      DurationSeconds: 900,
      Tags: [{ Key: "OrgName", Value: opts.orgName.toUpperCase() }],
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
  if (!roleArn) {
    logWarning(
      "STEP_API_KEY_ROLE_ARN is not set; skipping AWS Secrets Manager API key lookup",
    );
    return "";
  }

  if (!options.owner) {
    logWarning(
      "GitHub owner was not provided; skipping AWS Secrets Manager API key lookup because the OrgName session tag is required",
    );
    return "";
  }

  const secretName = ApiKeyConfig.secretName.replace(/<owner>/g, options.owner);

  logInfo(`Using API key from AWS Secrets Manager secret: ${secretName}`);
  return fetchApiKeyFromSecret({
    roleArn,
    secretName,
    orgName: options.owner,
    region: ApiKeyConfig.secretRegion,
    keyField: ApiKeyConfig.secretField,
  });
}
