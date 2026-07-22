import {
  getWithRetry,
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
} from "../lib/common";
import {
  downloadArtifact,
  isArtifactoryConfigured,
  resolveServingArtifactByProperties,
} from "../lib/artifactory";
import { ArtifactoryConfig, Urls } from "../lib/config";
import {
  AgentRelease,
  AgentReleaseAsset,
  downloadReleaseAsset,
  verifyReleaseChecksum,
} from "../lib/agent-release";

const AgentReleaseArtifactPrefix = "harden-runner-bravo";

const AgentReleaseBaseUrl = `${Urls.stepSecurityApi}/harden-runner-agent/github/linux/single/releases`;

export async function fetchAgentRelease(
  versionSelector: string,
): Promise<AgentRelease | null> {


  
  if (isArtifactoryConfigured(ArtifactoryConfig)) {
    return fetchAgentReleaseFromArtifactory();
  }

  const releaseUrl =
    versionSelector === "latest"
      ? `${AgentReleaseBaseUrl}/latest`
      : `${AgentReleaseBaseUrl}/${encodeURIComponent(versionSelector)}`;

  try {
    const { statusCode, body } = await getWithRetry(new URL(releaseUrl), {
      Accept: "application/json",
      "User-Agent": "stepsecurity-jobhooks",
    });

    if (String(statusCode) !== "200") {
      logWarning(
        `Failed to fetch agent release for ${versionSelector}: status ${statusCode}`,
      );
      return null;
    }

    const release = JSON.parse(body) as AgentRelease;
    if (!release.tag || !Array.isArray(release.assets)) {
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

async function fetchAgentReleaseFromArtifactory(): Promise<AgentRelease | null> {
  const arch = getAgentArch();
  if (!arch) {
    logWarning(`Unsupported agent architecture: ${process.arch}`);
    return null;
  }

  try {
    const serving = await resolveServingArtifactByProperties(
      ArtifactoryConfig,
      {
        "ss.serving": "true",
        "ss.approved": "true",
        "ss.os": "linux",
        "ss.arch": arch,
      },
    );

    return {
      tag: serving.version,
      assets: [
        {
          asset_name: serving.name,
          checksum: `sha256:${serving.sha256}`,
          primary_download_url: serving.url,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to resolve Artifactory agent release: ${message}`);
    return null;
  }
}

export function selectAgentReleaseAsset(
  release: AgentRelease,
): AgentReleaseAsset | null {
  const artifactName = buildAgentArtifactName(release.tag);
  if (!artifactName) {
    return null;
  }

  return (
    release.assets.find((asset) => asset.asset_name === artifactName) || null
  );
}

function extractReleaseAsset(
  archivePath: string,
  destinationDir: string,
): boolean {
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

export async function downloadAndExtractReleaseAsset(
  asset: AgentReleaseAsset,
  releaseVersion: string,
  destinationDir: string,
): Promise<void> {
  const archivePath = `/tmp/${asset.asset_name}`;
  if (isArtifactoryConfigured(ArtifactoryConfig)) {
    const checksum = asset.checksum || "";
    const sha256 = checksum.startsWith("sha256:")
      ? checksum.slice("sha256:".length)
      : "";
    const downloaded = await downloadArtifact(
      {
        version: releaseVersion,
        name: asset.asset_name,
        sha256,
        url: asset.primary_download_url,
      },
      archivePath,
    );
    if (!downloaded) {
      throw new Error(`Failed to download ${asset.asset_name} from Artifactory`);
    }
  } else if (!(await downloadReleaseAsset(asset, archivePath))) {
    throw new Error(`Failed to download ${asset.asset_name}`);
  }

  if (
    !isArtifactoryConfigured(ArtifactoryConfig) &&
    !verifyReleaseChecksum(archivePath, asset)
  ) {
    cleanupArchive(archivePath);
    throw new Error(`Checksum validation failed for ${asset.asset_name}`);
  }

  logInfo(`Extracting ${asset.asset_name} to ${destinationDir}`);
  if (!extractReleaseAsset(archivePath, destinationDir)) {
    cleanupArchive(archivePath);
    throw new Error(`Failed to extract ${asset.asset_name} to ${destinationDir}`);
  }

  cleanupArchive(archivePath);
}

function buildAgentArtifactName(tag: string): string {
  const arch = getAgentArch();
  if (!arch) {
    logWarning(`Unsupported agent architecture: ${process.arch}`);
    return "";
  }

  const version = tag.startsWith("v") ? tag.slice(1) : tag;

  return `${AgentReleaseArtifactPrefix}_${version}_linux_${arch}.tar.gz`;
}

function getAgentArch(): string {
  if (process.arch === "x64") {
    return "amd64";
  }

  if (process.arch === "arm64") {
    return "arm64";
  }

  return "";
}
