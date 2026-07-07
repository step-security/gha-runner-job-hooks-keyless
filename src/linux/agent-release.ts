import * as fs from "fs";

const { createHash } = require("crypto") as typeof import("crypto");

import { getWithRetry, logCommandFailure, logInfo, logWarning, runCommand } from "../lib/common";

type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  digest?: string;
};

type GitHubRelease = {
  tag_name: string;
  assets: GitHubReleaseAsset[];
};

const AgentRelease = {
  persistentArtifactPrefix: "harden-runner-bravo",
  ephemeralArtifactPrefix: "harden-runner",
} as const;

const LatestAgentReleaseUrl =
  "https://api.github.com/repos/step-security/agent-ebpf/releases/latest";
const TaggedAgentReleaseBaseUrl =
  "https://api.github.com/repos/step-security/agent-ebpf/releases/tags";

function getAgentArch(): string {
  if (process.arch === "x64") {
    return "amd64";
  }

  if (process.arch === "arm64") {
    return "arm64";
  }

  return "";
}

function buildAgentArtifactName(
  tag: string,
  isPersistentAgent: boolean,
): string {
  const arch = getAgentArch();
  if (!arch) {
    logWarning(`Unsupported agent architecture: ${process.arch}`);
    return "";
  }

  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const prefix = isPersistentAgent
    ? AgentRelease.persistentArtifactPrefix
    : AgentRelease.ephemeralArtifactPrefix;

  return `${prefix}_${version}_linux_${arch}.tar.gz`;
}

export async function fetchAgentRelease(
  versionSelector: string,
): Promise<GitHubRelease | null> {
  const releaseUrl =
    versionSelector === "latest"
      ? LatestAgentReleaseUrl
      : `${TaggedAgentReleaseBaseUrl}/${encodeURIComponent(versionSelector)}`;

  try {
    const { statusCode, body } = await getWithRetry(
      new URL(releaseUrl),
      {
        Accept: "application/vnd.github+json",
        "User-Agent": "stepsecurity-jobhooks",
      },
    );

    if (String(statusCode) !== "200") {
      logWarning(
        `Failed to fetch agent release for ${versionSelector}: status ${statusCode}`,
      );
      return null;
    }

    const release = JSON.parse(body) as GitHubRelease;
    if (!release.tag_name || !Array.isArray(release.assets)) {
      logWarning("Agent release response is missing expected fields");
      return null;
    }

    return release;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(
      `Failed to fetch agent release for ${versionSelector}: ${message}`,
    );
    return null;
  }
}

export function selectAgentReleaseAsset(
  release: GitHubRelease,
  isPersistentAgent: boolean,
): GitHubReleaseAsset | null {
  const artifactName = buildAgentArtifactName(
    release.tag_name,
    isPersistentAgent,
  );
  if (!artifactName) {
    return null;
  }

  return release.assets.find((asset) => asset.name === artifactName) || null;
}

function downloadFile(url: string, destinationPath: string): boolean {
  const downloadResult = runCommand("curl", [
    "-fsSL",
    "-o",
    destinationPath,
    url,
  ]);
  logCommandFailure(`Downloading ${url}`, downloadResult);
  return Boolean(downloadResult && downloadResult.status === 0);
}

function computeSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function verifyReleaseAsset(
  archivePath: string,
  asset: GitHubReleaseAsset,
): boolean {
  if (!asset.digest || !asset.digest.startsWith("sha256:")) {
    logWarning(`Missing sha256 digest for ${asset.name}; skipping agent update`);
    return false;
  }

  const expectedDigest = asset.digest.slice("sha256:".length);
  const actualDigest = computeSha256(archivePath);
  if (actualDigest !== expectedDigest) {
    logWarning(
      `Checksum validation failed for ${asset.name}: expected ${expectedDigest}, got ${actualDigest}`,
    );
    return false;
  }

  logInfo(
    `Checksum validation succeeded for ${asset.name}: ${actualDigest}`,
  );
  return true;
}

function extractReleaseAsset(archivePath: string, destinationDir: string): boolean {
  const extractResult = runCommand("sudo", [
    "tar",
    "-xzf",
    archivePath,
    "-C",
    destinationDir,
  ]);
  logCommandFailure(`Extracting ${archivePath}`, extractResult);
  return Boolean(extractResult && extractResult.status === 0);
}

function cleanupArchive(archivePath: string): void {
  const cleanupResult = runCommand("rm", ["-f", archivePath], { silent: true });
  logCommandFailure(`Removing ${archivePath}`, cleanupResult);
}

export function downloadAndExtractReleaseAsset(
  asset: GitHubReleaseAsset,
  destinationDir: string,
): boolean {
  const archivePath = `/tmp/${asset.name}`;

  logInfo(`Downloading agent artifact from ${asset.browser_download_url}`);
  if (!downloadFile(asset.browser_download_url, archivePath)) {
    return false;
  }

  if (!verifyReleaseAsset(archivePath, asset)) {
    cleanupArchive(archivePath);
    return false;
  }

  logInfo(`Extracting ${asset.name} to ${destinationDir}`);
  if (!extractReleaseAsset(archivePath, destinationDir)) {
    cleanupArchive(archivePath);
    return false;
  }

  cleanupArchive(archivePath);
  return true;
}
