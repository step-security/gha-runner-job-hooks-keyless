import * as fs from "fs";
import * as path from "path";

import { downloadFile, getWithRetry, logInfo } from "./common";

export type ArtifactoryConfigValues = {
  base: string;
  repo: string;
};

export type ServingArtifact = {
  version: string;
  name: string;
  sha256: string;
  url: string;
};

type PropertySearchResult = {
  path?: string;
  properties?: Record<string, string[] | undefined>;
  downloadUri?: string;
  checksums?: {
    sha256?: string;
  };
};

type PropertySearchResponse = {
  results?: PropertySearchResult[];
};

export function isArtifactoryConfigured(
  config: ArtifactoryConfigValues,
): boolean {
  return Boolean(config.base.trim() && config.repo.trim());
}

export async function resolveServingArtifactByProperties(
  config: ArtifactoryConfigValues,
  selectors: Record<string, string>,
): Promise<ServingArtifact> {
  const results = await searchArtifactsByProperties(config, selectors);
  if (results.length !== 1) {
    throw new Error(
      `Expected exactly one Artifactory artifact for selectors ${JSON.stringify(selectors)}, found ${results.length}`,
    );
  }

  const result = results[0];
  const artifactPath = result.path || "";
  const name = path.posix.basename(artifactPath);
  const version = path.posix.basename(path.posix.dirname(artifactPath));
  const sha256 =
    result.checksums?.sha256 || result.properties?.["ss.sha256"]?.[0] || "";
  const downloadUri = result.downloadUri || "";

  if (!name || !version || !sha256 || !downloadUri) {
    throw new Error(
      `Artifactory result for selectors ${JSON.stringify(selectors)} is missing path, checksum, or downloadUri`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new Error(
      `Artifactory result for selectors ${JSON.stringify(selectors)} has invalid sha256: ${sha256}`,
    );
  }

  return {
    version,
    name,
    sha256: sha256.toLowerCase(),
    url: downloadUri,
  };
}

export async function searchArtifactsByProperties(
  config: ArtifactoryConfigValues,
  selectors: Record<string, string>,
): Promise<PropertySearchResult[]> {
  const normalizedConfig = {
    base: config.base.replace(/\/+$/, ""),
    repo: config.repo.replace(/^\/+|\/+$/g, ""),
  };
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(selectors)) {
    params.append(key, value);
  }
  params.append("repos", normalizedConfig.repo);

  const url = `${normalizedConfig.base}/api/search/prop?${params.toString()}`;
  logInfo(`Searching Artifactory properties at ${url}`);
  const { statusCode, body } = await getWithRetry(new URL(url), {
    "X-Result-Detail": "properties,info",
    "User-Agent": "stepsecurity-jobhooks",
  });

  if (String(statusCode) !== "200") {
    throw new Error(
      `Artifactory property search failed for selectors ${JSON.stringify(selectors)}: status ${statusCode}`,
    );
  }

  const parsed = JSON.parse(body) as PropertySearchResponse;
  return parsed.results || [];
}

export async function downloadArtifact(
  serving: ServingArtifact,
  destinationPath: string,
): Promise<boolean> {
  const destinationDir = path.dirname(destinationPath);
  fs.mkdirSync(destinationDir, { recursive: true });

  const tempPath = `${destinationPath}.tmp.${process.pid}`;
  logInfo(`Downloading Artifactory artifact ${serving.version}/${serving.name}`);

  try {
    if (!(await downloadFile(serving.url, tempPath))) {
      return false;
    }

    fs.renameSync(tempPath, destinationPath);
    return true;
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export function readCurrentSha256(markerPath: string): string {
  if (!fs.existsSync(markerPath)) {
    return "";
  }

  return fs.readFileSync(markerPath, "utf8").trim().toLowerCase();
}

export function writeCurrentSha256(markerPath: string, sha256: string): void {
  fs.writeFileSync(markerPath, `${sha256.toLowerCase()}\n`, "utf8");
}

export function assetChecksumSha256(checksum?: string): string {
  if (!checksum || !checksum.startsWith("sha256:")) {
    return "";
  }

  return checksum.slice("sha256:".length).toLowerCase();
}
