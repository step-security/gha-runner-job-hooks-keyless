import * as fs from "fs";

const { createHash } = require("crypto") as typeof import("crypto");

import { downloadFile, logInfo, logWarning } from "./common";

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

function computeSha256(filePath: string): string {
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
  for (const downloadUrl of [
    asset.primary_download_url,
    asset.fallback_download_url,
  ]) {
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
