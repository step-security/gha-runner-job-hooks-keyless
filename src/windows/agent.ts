import * as fs from "fs";
import * as path from "path";

import {
  AgentFiles,
  AgentRuntimeConfig,
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

const WindowsAgentReleaseBaseUrl = `${Urls.stepSecurityApi}/harden-runner-agent/github/win/single/releases`;

export function ensureWindowsAgentRoot(): void {
  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    fs.mkdirSync(AgentRuntimeConfig.windowsRoot, { recursive: true });
  }
}

async function fetchWindowsAgentRelease(): Promise<AgentRelease> {
  const releaseUrl =
    WindowsAgentReleaseConfig.windowsAgentVersion === "latest"
      ? `${WindowsAgentReleaseBaseUrl}/latest`
      : `${WindowsAgentReleaseBaseUrl}/${encodeURIComponent(WindowsAgentReleaseConfig.windowsAgentVersion)}`;

  const { statusCode, body } = await getWithRetry(new URL(releaseUrl), {
    Accept: "application/json",
    "User-Agent": "stepsecurity-jobhooks",
  });

  if (String(statusCode) !== "200") {
    throw new Error(`Failed to fetch Windows agent release: status ${statusCode}`);
  }

  const release = JSON.parse(body) as AgentRelease;
  if (!release.tag || !Array.isArray(release.assets)) {
    throw new Error("Windows agent release response is missing expected fields");
  }

  return release;
}

function selectWindowsAgentAsset(
  release: AgentRelease,
): AgentReleaseAsset | null {
  return (
    release.assets.find(
      (asset) => asset.asset_name.includes("windows_amd64.tar.gz"),
    ) || null
  );
}

async function downloadWindowsAgent(
  asset: AgentReleaseAsset,
  archivePath: string,
): Promise<void> {
  if (!(await downloadReleaseAsset(asset, archivePath))) {
    throw new Error(`Failed to download Windows agent asset ${asset.asset_name}`);
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(): number | null {
  if (!fs.existsSync(AgentFiles.windows.agentPid)) {
    return null;
  }

  const pid = Number.parseInt(
    fs.readFileSync(AgentFiles.windows.agentPid, "utf8").trim(),
    10,
  );
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function removePidFile(): void {
  if (fs.existsSync(AgentFiles.windows.agentPid)) {
    fs.unlinkSync(AgentFiles.windows.agentPid);
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

  if (fs.existsSync(AgentFiles.windows.agentBinary)) {
    logInfo(
      `Windows agent already installed at ${AgentFiles.windows.agentBinary}; skipping reinstall`,
    );
    return;
  }

  const archivePath = path.join(
    AgentRuntimeConfig.windowsRoot,
    "windows-agent.tar.gz",
  );
  const extractPath = path.join(AgentRuntimeConfig.windowsRoot, "extract");

  const release = await fetchWindowsAgentRelease();
  const asset = selectWindowsAgentAsset(release);
  if (!asset) {
    throw new Error(`No matching Windows agent release asset found for ${release.tag}`);
  }
  await downloadWindowsAgent(asset, archivePath);
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
  fs.rmSync(extractPath, { recursive: true, force: true });
  removeIfExists(archivePath);
}

export async function startWindowsAgentProcess(): Promise<void> {
  const existingPid = readPidFile();
  if (existingPid && processExists(existingPid)) {
    process.kill(existingPid, "SIGKILL");
  }
  removePidFile();

  for (const filePath of [
    AgentFiles.windows.agentStatus,
    AgentFiles.windows.agentDone,
    AgentFiles.windows.agentLog,
    AgentFiles.windows.agentPid,
    AgentFiles.windows.postEvent,
  ]) {
    removeIfExists(filePath);
  }

  const logStream = fs.openSync(AgentFiles.windows.agentLog, "a");
  const childProcess =
    require("child_process") as typeof import("child_process");
  const agentProcess = childProcess.spawn(AgentFiles.windows.agentBinary, [], {
    cwd: AgentRuntimeConfig.windowsRoot,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: false,
    shell: false,
  });
  agentProcess.unref();

  fs.writeFileSync(AgentFiles.windows.agentPid, `${agentProcess.pid}\n`, "utf8");
  logInfo(`Windows agent process started with PID: ${agentProcess.pid}`);

  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.windows.agentStatus),
    30,
    300,
  );

  if (!matched) {
    logWarning("Windows agent initialization timed out");
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
  const pid = readPidFile();
  if (!pid) {
    logWarning("Windows agent PID file not found");
    return;
  }

  if (!processExists(pid)) {
    logInfo("Windows agent process is not running");
    removePidFile();
    return;
  }

  process.kill(pid, "SIGINT");
  const { matched } = await waitForCondition(() => !processExists(pid), 10, 1000);
  if (!matched && processExists(pid)) {
    logWarning("Windows agent graceful shutdown timed out; forcing termination");
    process.kill(pid, "SIGKILL");
    await waitForCondition(() => !processExists(pid), 3, 1000);
  }

  removePidFile();
}

export async function waitForWindowsDoneFile(): Promise<void> {
  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.windows.agentDone),
    10,
    1000,
  );

  if (!matched) {
    logWarning("Timed out waiting for Windows agent done.json");
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
