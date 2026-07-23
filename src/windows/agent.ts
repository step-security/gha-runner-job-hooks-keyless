import * as fs from "fs";
import * as path from "path";

import {
  assetChecksumSha256,
  downloadArtifact,
  isArtifactoryConfigured,
  readCurrentSha256,
  resolveServingArtifactByProperties,
  writeCurrentSha256,
} from "../lib/artifactory";
import {
  AgentFiles,
  AgentRuntimeConfig,
  ArtifactoryConfig,
  Urls,
  WindowsAgentReleaseConfig,
} from "../lib/config";
import {
  printFileIfExists,
  readCorrelationIdFromAgentJson,
} from "../lib/files";
import { appendJobSummary } from "../lib/summary";
import {
  AgentRelease,
  AgentReleaseAsset,
  downloadReleaseAsset,
  verifyReleaseChecksum,
} from "../lib/agent-release";
import {
  getWithRetry,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../lib/common";
import {
  processExists,
  readPidFile,
  removePidFile,
  trySignalProcess,
} from "../lib/process";

const WindowsAgentReleaseBaseUrl = `${Urls.stepSecurityApi}/harden-runner-agent/github/win/single/releases`;

export function ensureWindowsAgentRoot(): void {
  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    fs.mkdirSync(AgentRuntimeConfig.windowsRoot, { recursive: true });
  }
}

async function fetchWindowsAgentRelease(): Promise<AgentRelease | null> {
  const releaseUrl =
    WindowsAgentReleaseConfig.windowsAgentVersion === "latest"
      ? `${WindowsAgentReleaseBaseUrl}/latest`
      : `${WindowsAgentReleaseBaseUrl}/${encodeURIComponent(WindowsAgentReleaseConfig.windowsAgentVersion)}`;

  try {
    const { statusCode, body } = await getWithRetry(new URL(releaseUrl), {
      Accept: "application/json",
      "User-Agent": "stepsecurity-jobhooks",
    });

    if (String(statusCode) !== "200") {
      throw new Error(
        `Failed to fetch Windows agent release: status ${statusCode}`,
      );
    }

    const release = JSON.parse(body) as AgentRelease;
    if (!release.tag || !Array.isArray(release.assets)) {
      throw new Error(
        "Windows agent release response is missing expected fields",
      );
    }

    return release;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to fetch Windows agent release: ${message}`);
    return null;
  }
}

async function fetchWindowsAgentReleaseFromArtifactory(): Promise<AgentRelease | null> {
  try {
    const serving = await resolveServingArtifactByProperties(
      ArtifactoryConfig,
      {
        "ss.serving": "true",
        "ss.os": "windows",
        "ss.arch": "amd64",
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

function selectWindowsAgentAsset(
  release: AgentRelease,
): AgentReleaseAsset | null {
  return (
    release.assets.find((asset) =>
      asset.asset_name.includes("windows_amd64.tar.gz"),
    ) || null
  );
}

async function downloadWindowsAgent(
  asset: AgentReleaseAsset,
  releaseVersion: string,
  archivePath: string,
): Promise<void> {
  if (isArtifactoryConfigured(ArtifactoryConfig)) {
    const downloaded = await downloadArtifact(
      {
        version: releaseVersion,
        name: asset.asset_name,
        sha256: assetChecksumSha256(asset.checksum),
        url: asset.primary_download_url,
      },
      archivePath,
    );
    if (!downloaded) {
      throw new Error(
        `Failed to download Windows agent asset ${asset.asset_name}`,
      );
    }
    return;
  }

  if (!(await downloadReleaseAsset(asset, archivePath))) {
    throw new Error(
      `Failed to download Windows agent asset ${asset.asset_name}`,
    );
  }
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function extractTarball(archivePath: string, destinationDir: string): void {
  const result = runCommand("tar", ["-xzf", archivePath, "-C", destinationDir]);
  if (!result || result.status !== 0) {
    throw new Error(`Failed to extract Windows agent archive: ${archivePath}`);
  }
}

export async function installWindowsAgent(): Promise<void> {
  if (process.arch === "arm64") {
    throw new Error("Windows arm64 runners are not supported");
  }

  const archivePath = path.join(
    AgentRuntimeConfig.windowsRoot,
    "windows-agent.tar.gz",
  );
  const extractPath = path.join(AgentRuntimeConfig.windowsRoot, "extract");

  const useArtifactory = isArtifactoryConfigured(ArtifactoryConfig);
  const release = useArtifactory
    ? await fetchWindowsAgentReleaseFromArtifactory()
    : await fetchWindowsAgentRelease();
  if (!release) {
    logUnavailableWindowsReleaseWarning(useArtifactory);
    return;
  }

  const asset = selectWindowsAgentAsset(release);
  if (!asset) {
    throw new Error(
      `No matching Windows agent release asset found for ${release.tag}`,
    );
  }

  const expectedSha256 = assetChecksumSha256(asset.checksum);
  if (useArtifactory) {
    const currentSha256 = readCurrentSha256(AgentFiles.windows.currentSha256);
    if (
      expectedSha256 &&
      currentSha256 === expectedSha256 &&
      fs.existsSync(AgentFiles.windows.agentBinary)
    ) {
      logInfo(
        `WindowsAgent status=already-serving version=${release.tag || "unknown"} sha256=${expectedSha256}`,
      );
      return;
    }
  } else if (fs.existsSync(AgentFiles.windows.agentBinary)) {
    logInfo(
      `WindowsAgent status=already-installed binary=${AgentFiles.windows.agentBinary}`,
    );
    return;
  }

  await downloadWindowsAgent(asset, release.tag, archivePath);
  if (!verifyReleaseChecksum(archivePath, asset)) {
    throw new Error(`Checksum validation failed for ${asset.asset_name}`);
  }

  fs.mkdirSync(extractPath, { recursive: true });
  extractTarball(archivePath, extractPath);

  const extractedAgentPath = path.join(extractPath, "agent.exe");
  if (!fs.existsSync(extractedAgentPath)) {
    throw new Error(`agent.exe not found at ${extractedAgentPath}`);
  }

  fs.copyFileSync(extractedAgentPath, AgentFiles.windows.agentBinary);
  if (expectedSha256) {
    writeCurrentSha256(AgentFiles.windows.currentSha256, expectedSha256);
  }
  fs.rmSync(extractPath, { recursive: true, force: true });
  removeIfExists(archivePath);
}

function logUnavailableWindowsReleaseWarning(useArtifactory: boolean): void {
  const resolvedFrom = useArtifactory
    ? "Artifactory-served agent"
    : "release API";

  if (fs.existsSync(AgentFiles.windows.agentBinary)) {
    logWarning(
      `Unable to resolve the current ${resolvedFrom}; continuing with existing agent binary at ${AgentFiles.windows.agentBinary}`,
    );
    return;
  }

  logWarning(
    `Unable to resolve the current ${resolvedFrom} and no existing agent binary is available at ${AgentFiles.windows.agentBinary}`,
  );
}

export async function startWindowsAgentProcess(): Promise<void> {
  const existingPid = readPidFile(AgentFiles.windows.agentPid);
  if (existingPid && processExists(existingPid)) {
    const message = trySignalProcess(existingPid, "SIGKILL");
    if (message) {
      logWarning(
        `WindowsAgent process=signal-failed signal=SIGKILL pid=${existingPid} error=${message}`,
      );
      if (processExists(existingPid)) {
        return;
      }
    }
  }
  removePidFile(AgentFiles.windows.agentPid);

  for (const filePath of [
    AgentFiles.windows.agentStatus,
    AgentFiles.windows.agentDone,
    AgentFiles.windows.agentLog,
    AgentFiles.windows.agentPid,
    AgentFiles.windows.postEvent,
  ]) {
    removeIfExists(filePath);
  }

  if (!fs.existsSync(AgentFiles.windows.agentBinary)) {
    throw new Error(
      `Agent binary is missing: ${AgentFiles.windows.agentBinary}`,
    );
  }

  const logStream = fs.openSync(AgentFiles.windows.agentLog, "a");
  const childProcess =
    require("child_process") as typeof import("child_process");
  const agentProcess = childProcess.spawn(AgentFiles.windows.agentBinary, [], {
    cwd: AgentRuntimeConfig.windowsRoot,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
    shell: false,
  });
  agentProcess.unref();

  fs.writeFileSync(
    AgentFiles.windows.agentPid,
    `${agentProcess.pid}\n`,
    "utf8",
  );
  logInfo(`WindowsAgent process=started pid=${agentProcess.pid}`);

  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.windows.agentStatus),
    30,
    300,
  );

  if (!matched) {
    logWarning("WindowsAgent process=init status=timeout");
    printFileIfExists(AgentFiles.windows.agentLog, {
      groupTitle: "[StepSecurity] Windows HardenRunner logs",
    });
    return;
  }

  const status = fs.readFileSync(AgentFiles.windows.agentStatus, "utf8");
  process.stdout.write(status);
  if (!status.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

export async function stopWindowsAgentProcess(): Promise<void> {
  const pid = readPidFile(AgentFiles.windows.agentPid);
  if (!pid) {
    logWarning("WindowsAgent process=stop status=pid-not-found");
    return;
  }

  if (!processExists(pid)) {
    logInfo(`WindowsAgent process=stop status=not-running pid=${pid}`);
    removePidFile(AgentFiles.windows.agentPid);
    return;
  }

  logInfo(`WindowsAgent process=stop signal=SIGINT pid=${pid}`);
  {
    const message = trySignalProcess(pid, "SIGINT");
    if (message) {
      logWarning(
        `WindowsAgent process=signal-failed signal=SIGINT pid=${pid} error=${message}`,
      );
      if (!processExists(pid)) {
        removePidFile(AgentFiles.windows.agentPid);
      }
      return;
    }
  }

  const { matched } = await waitForCondition(
    () => !processExists(pid),
    10,
    1000,
  );
  if (matched) {
    logInfo(`WindowsAgent process=stopped mode=graceful pid=${pid}`);
    removePidFile(AgentFiles.windows.agentPid);
    return;
  }

  logWarning("WindowsAgent process=stop status=timeout next_signal=SIGKILL");

  if (processExists(pid)) {
    const message = trySignalProcess(pid, "SIGKILL");
    if (message) {
      logWarning(
        `WindowsAgent process=signal-failed signal=SIGKILL pid=${pid} error=${message}`,
      );
    }
  }

  const { matched: killed } = await waitForCondition(
    () => !processExists(pid),
    3,
    1000,
  );
  if (killed || !processExists(pid)) {
    logInfo(`WindowsAgent process=stopped mode=forced pid=${pid}`);
    removePidFile(AgentFiles.windows.agentPid);
    return;
  }

  logWarning(`WindowsAgent process=stop status=still-running pid=${pid}`);
}

export async function waitForWindowsDoneFile(): Promise<void> {
  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.windows.agentDone),
    10,
    1000,
  );

  if (!matched) {
    logWarning("WindowsAgent wait=done-file status=timeout");
  }
}

export function writeWindowsPostEvent(): void {
  fs.writeFileSync(
    AgentFiles.windows.postEvent,
    JSON.stringify({ event: "post" }),
    "utf8",
  );
}

export function windowsPostEventExists(): boolean {
  return fs.existsSync(AgentFiles.windows.postEvent);
}

export function windowsAgentInstalled(): boolean {
  return fs.existsSync(AgentFiles.windows.agentBinary);
}

export function printWindowsAgentLogs(): void {
  printFileIfExists(AgentFiles.windows.agentLog, {
    groupTitle: "[StepSecurity] Windows HardenRunner logs",
  });
}

export function cleanupWindowsJobArtifacts(): void {
  for (const filePath of [
    AgentFiles.windows.agentJson,
    AgentFiles.windows.agentPid,
    AgentFiles.windows.agentStatus,
    AgentFiles.windows.agentDone,
    AgentFiles.windows.agentLog,
    AgentFiles.windows.postEvent,
  ]) {
    removeIfExists(filePath);
  }
}

export async function appendWindowsSummary(): Promise<void> {
  const correlationId = readCorrelationIdFromAgentJson(
    AgentFiles.windows.agentJson,
  );
  await appendJobSummary({
    correlationId,
    environment: "SelfHostedVM",
  });
}
