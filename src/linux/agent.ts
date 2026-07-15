import * as fs from "fs";

import {
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../lib/common";
import { AgentFiles, AgentRuntimeConfig, Urls } from "../lib/config";
import { readCorrelationIdFromAgentJson } from "../lib/files";
import { appendJobSummary } from "../lib/summary";
import {
  downloadAndExtractReleaseAsset,
  fetchAgentRelease,
  selectAgentReleaseAsset,
} from "./agent-release";

type AgentBuildInfo = {
  raw: string;
  name: string;
  branch: string;
  tag: string;
  commit: string;
};

export function ensureLinuxAgentRoot(): void {
  const mkdirResult = runCommand("sudo", [
    "mkdir",
    "-p",
    AgentRuntimeConfig.linuxRoot,
  ]);
  logCommandFailure(`Creating ${AgentRuntimeConfig.linuxRoot}`, mkdirResult);

  const chownResult = runCommand("sudo", [
    "chown",
    "-R",
    `${getCurrentUid()}:${getCurrentGid()}`,
    AgentRuntimeConfig.linuxRoot,
  ]);
  logCommandFailure(
    `Changing ownership for ${AgentRuntimeConfig.linuxRoot}`,
    chownResult,
  );
}

export async function ensureLatestBravoLinuxAgent(): Promise<void> {
  const buildInfo = detectAgentBuildInfo();
  if (buildInfo && AgentRuntimeConfig.disableLinuxAgentUpdate) {
    logInfo("Automatic agent update is disabled; skipping update check");
    return;
  }

  const release = await fetchAgentRelease(AgentRuntimeConfig.linuxAgentVersion);
  if (!release) {
    return;
  }

  if (buildInfo) {
    logInfo(
      `Detected agent build: ${buildInfo.name || "AgentBravo"} ${buildInfo.tag}`,
    );
    if (buildInfo.tag === release.tag) {
      return;
    }
  }

  const asset = selectAgentReleaseAsset(release);
  if (!asset) {
    logWarning(
      `No matching AgentBravo release asset found for ${release.tag} on ${process.arch}`,
    );
    return;
  }

  if (buildInfo) {
    logInfo(
      `Updating AgentBravo from ${buildInfo.tag || "unknown"} to ${release.tag}`,
    );
  } else {
    logInfo(`Installing AgentBravo ${release.tag}`);
  }

  const installed = await downloadAndExtractReleaseAsset(
    asset,
    AgentRuntimeConfig.linuxRoot,
  );
  if (!installed) {
    throw new Error("Failed to install AgentBravo");
  }

  const chmodResult = runCommand("sudo", [
    "chmod",
    "+x",
    AgentFiles.linux.agentBinary,
  ]);
  logCommandFailure(
    `Making ${AgentFiles.linux.agentBinary} executable`,
    chmodResult,
  );
}

function detectAgentBuildInfo(): AgentBuildInfo | null {
  if (!fs.existsSync(AgentFiles.linux.agentBinary)) {
    return null;
  }

  const result = runCommand(AgentFiles.linux.agentBinary, ["-b"], {
    captureOutput: true,
  });

  if (!result || result.status !== 0) {
    const details =
      result && result.error
        ? result.error.message
        : `exit code ${result ? result.status : "unknown"}`;
    logWarning(`Failed to detect agent build info: ${details}`);
    return null;
  }

  const output = String(result.stdout || "").trim();
  const buildInfoLine = output
    .split(/\r?\n/)
    .find((line: string) => line.includes("[buildInfo]"));
  if (!buildInfoLine) {
    logWarning("Failed to detect agent build info: missing [buildInfo] output");
    return null;
  }

  const info: AgentBuildInfo = {
    raw: buildInfoLine,
    name: "",
    branch: "",
    tag: "",
    commit: "",
  };

  for (const match of buildInfoLine.matchAll(/(\w+)=([^\s]+)/g)) {
    const [, key, value] = match;
    if (key in info) {
      info[key as keyof AgentBuildInfo] = value;
    }
  }

  return info;
}

function readPidFile(): number | null {
  if (!fs.existsSync(AgentFiles.linux.agentPid)) {
    return null;
  }

  const pid = Number.parseInt(
    fs.readFileSync(AgentFiles.linux.agentPid, "utf8").trim(),
    10,
  );
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePidFile(): void {
  if (fs.existsSync(AgentFiles.linux.agentPid)) {
    fs.unlinkSync(AgentFiles.linux.agentPid);
  }
}

export function killExistingAgentProcess(): void {
  const pid = readPidFile();
  if (!pid) {
    return;
  }

  if (!processExists(pid)) {
    removePidFile();
    return;
  }

  logInfo(`Killing existing agent process with SIGKILL: ${pid}`);
  process.kill(pid, "SIGKILL");
  removePidFile();
}

export async function startAgentProcess(): Promise<void> {
  killExistingAgentProcess();

  for (const filePath of [
    AgentFiles.linux.agentStatus,
    AgentFiles.linux.agentDone,
    AgentFiles.linux.agentLog,
    AgentFiles.linux.agentStdout,
  ]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  const logStream = fs.openSync(AgentFiles.linux.agentStdout, "a");
  const childProcess =
    require("child_process") as typeof import("child_process");
  const agentProcess = childProcess.spawn(
    "sudo",
    [AgentFiles.linux.agentBinary],
    {
      cwd: AgentRuntimeConfig.linuxRoot,
      detached: true,
      stdio: ["ignore", logStream, logStream],
    },
  );
  agentProcess.unref();

  fs.writeFileSync(AgentFiles.linux.agentPid, `${agentProcess.pid}\n`, "utf8");
  logInfo(`Agent process started with PID: ${agentProcess.pid}`);

  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.linux.agentStatus),
    30,
    300,
  );

  if (!matched) {
    logWarning("Agent initialization timed out");
    return;
  }

  logInfo("Agent initialized successfully");
}

export async function stopAgentProcess(): Promise<void> {
  const pid = readPidFile();
  if (!pid) {
    logWarning("agent.pid not found");
    return;
  }

  if (!processExists(pid)) {
    logInfo("Agent process is not running");
    removePidFile();
    return;
  }

  logInfo(`Sending SIGTERM to agent process: ${pid}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to send SIGTERM to agent process ${pid}: ${message}`);
    if (!processExists(pid)) {
      removePidFile();
    }
    return;
  }

  const { matched } = await waitForCondition(
    () => !processExists(pid),
    10,
    1000,
  );

  if (matched) {
    logInfo(`Agent process stopped gracefully: ${pid}`);
    removePidFile();
    return;
  }

  logWarning(
    "Timed out waiting for agent process to stop; force killing agent",
  );

  if (processExists(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`Failed to send SIGKILL to agent process ${pid}: ${message}`);
    }
  }

  const { matched: killed } = await waitForCondition(
    () => !processExists(pid),
    3,
    1000,
  );

  if (killed) {
    logInfo(`Agent process force stopped: ${pid}`);
  } else {
    logWarning(`Agent process is still running after SIGKILL: ${pid}`);
  }

  removePidFile();
}

export function printLinuxAgentLogs(): void {
  if (fs.existsSync(AgentFiles.linux.agentLog)) {
    console.log("::group::[StepSecurity] HardenRunner logs");
    const agentLog = fs.readFileSync(AgentFiles.linux.agentLog, "utf8");
    process.stdout.write(agentLog);
    if (!agentLog.endsWith("\n")) {
      process.stdout.write("\n");
    }
    console.log("::endgroup::");
  }

  if (fs.existsSync(AgentFiles.linux.agentStdout)) {
    console.log("::group::[StepSecurity] HardenRunner stdout");
    const agentStdout = fs.readFileSync(AgentFiles.linux.agentStdout, "utf8");
    process.stdout.write(agentStdout);
    if (!agentStdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
    console.log("::endgroup::");
  }
}

export function cleanupLinuxJobArtifacts(): void {
  const cleanupResult = runCommand("sudo", [
    "rm",
    "-f",
    AgentFiles.linux.agentJson,
    AgentFiles.linux.agentPid,
    AgentFiles.linux.agentStatus,
    AgentFiles.linux.agentDone,
    AgentFiles.linux.agentLog,
    AgentFiles.linux.agentStdout,
  ]);
  logCommandFailure("Removing Linux agent job artifacts", cleanupResult);
}

export async function appendLinuxSummary(): Promise<void> {
  const correlationId = readCorrelationIdFromAgentJson(
    AgentFiles.linux.agentJson,
  );
  await appendJobSummary({
    correlationId,
    environment: "SelfHostedVM",
  });
}

function getCurrentUid(): string {
  return String(typeof process.getuid === "function" ? process.getuid() : 0);
}

function getCurrentGid(): string {
  return String(typeof process.getgid === "function" ? process.getgid() : 0);
}
