import * as fs from "fs";

const { createHash } = require("crypto") as typeof import("crypto");

import { downloadFile, logInfo, logWarning } from "./common";
import { Urls } from "./config";

export type AgentReleaseAsset = {
  asset_name: string;
  checksum?: string;
  primary_download_url: string;
  fallback_download_url?: string;
};

export type AgentRelease = {
  tag: string;
  assets: AgentReleaseAsset[];
};

export function computeSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function verifyReleaseChecksum(
  archivePath: string,
  asset: AgentReleaseAsset,
): boolean {
  if (!asset.checksum || !asset.checksum.startsWith("sha256:")) {
    logWarning(`Missing sha256 digest for ${asset.asset_name}`);
    return false;
  }

  const expectedDigest = asset.checksum.slice("sha256:".length);
  const actualDigest = computeSha256(archivePath);
  if (actualDigest !== expectedDigest) {
    logWarning(
      `Checksum validation failed for ${asset.asset_name}: expected ${expectedDigest}, got ${actualDigest}`,
    );
    return false;
  }

  logInfo(`Checksum validation succeeded for ${asset.asset_name}: ${actualDigest}`);
  return true;
}

export async function downloadReleaseAsset(
  asset: AgentReleaseAsset,
  archivePath: string,
): Promise<boolean> {
  for (const downloadUrl of buildDownloadUrls(asset)) {
    if (!downloadUrl) {
      continue;
    }

    logInfo(`Downloading agent artifact from ${downloadUrl}`);
    const downloaded = await downloadFile(downloadUrl, archivePath, {
      Accept: "application/octet-stream",
      "User-Agent": "stepsecurity-jobhooks",
    });
    if (downloaded) {
      return true;
    }
  }

  return false;
}

function buildDownloadUrls(asset: AgentReleaseAsset): string[] {
  const artifactoryUrl = buildArtifactoryDownloadUrl(asset);
  if (artifactoryUrl) {
    return [artifactoryUrl];
  }

  const urls: string[] = [asset.primary_download_url];

  if (asset.fallback_download_url) {
    urls.push(asset.fallback_download_url);
  }

  return Array.from(new Set(urls));
}

function buildArtifactoryDownloadUrl(asset: AgentReleaseAsset): string {
  const baseUrl = Urls.agentArtifactoryUrl.trim();
  if (!baseUrl) {
    return "";
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/${asset.asset_name}`;
}
