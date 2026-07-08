import * as fs from "fs";

const { randomUUID } = require("crypto") as typeof import("crypto");

import { resolveApiKey } from "../lib/api-key";
import {
  getWithRetry,
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../lib/common";
import { AgentFiles, AgentRuntimeConfig, Urls } from "../lib/config";
import { writeJsonFile } from "../lib/files";
import { getGithubRunContext } from "../lib/github-context";
import {
  fetchPolicyStoreConfig,
  PolicyStoreFetchResult,
  PolicyStoreConfig,
} from "../lib/policy";
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

type LinuxAgentConfig = {
  customer: string;
  repo: string;
  workflow: string;
  run_id: string;
  correlation_id: string;
  working_directory: string;
  runner_work_directory: string;
  api_url: string;
  telemetry_url: string;
  api_key: string;
  is_persistent: boolean;
  has_prejob_policy: boolean;
  allowed_endpoints: string;
  egress_policy: string;
  disable_telemetry: boolean;
  disable_sudo: boolean;
  disable_sudo_and_containers: boolean;
  disable_file_monitoring: boolean;
  private: boolean;
  is_github_hosted: boolean;
  one_time_key: string;
};

const RuntimeConfig = {
  ...getGithubRunContext(),
};

function getCurrentUid(): string {
  return String(typeof process.getuid === "function" ? process.getuid() : 0);
}

function getCurrentGid(): string {
  return String(typeof process.getgid === "function" ? process.getgid() : 0);
}

function ensureAgentRoot(): void {
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

export function readCorrelationIdFromAgentJson(): string {
  if (!fs.existsSync(AgentFiles.linux.agentJson)) {
    return "";
  }

  try {
    const agent = JSON.parse(
      fs.readFileSync(AgentFiles.linux.agentJson, "utf8"),
    ) as { correlation_id?: unknown };
    return typeof agent.correlation_id === "string" ? agent.correlation_id : "";
  } catch {
    return "";
  }
}

function createBaseAgentConfig(
  correlationId: string,
  apiKey: string,
): LinuxAgentConfig {
  const runnerWorkDirectory = process.env.GITHUB_WORKSPACE || "";
  return {
    customer: RuntimeConfig.owner,
    repo: RuntimeConfig.githubRepository,
    workflow: RuntimeConfig.workflow,
    run_id: RuntimeConfig.runId,
    correlation_id: correlationId,
    working_directory: runnerWorkDirectory,
    runner_work_directory: runnerWorkDirectory,
    api_url: Urls.stepSecurityApi,
    telemetry_url: Urls.stepSecurityTelemetry,
    api_key: apiKey,
    is_persistent: !AgentRuntimeConfig.isEphemeralLinux,
    has_prejob_policy: false,
    allowed_endpoints: "",
    egress_policy: "audit",
    disable_telemetry: false,
    disable_sudo: false,
    disable_sudo_and_containers: false,
    disable_file_monitoring: false,
    private: process.env.GITHUB_REPOSITORY_VISIBILITY === "private",
    is_github_hosted: false,
    one_time_key: "",
  };
}

async function loadPolicyConfig(
  correlationId: string,
  apiKey: string,
): Promise<{
  hasPolicy: boolean;
  config: PolicyStoreConfig | null;
  fetchStatus: PolicyStoreFetchResult["status"];
}> {
  if (!apiKey) {
    logWarning(
      "API key is not set; defaulting to audit mode without policy fetch",
    );
    return { hasPolicy: false, config: null, fetchStatus: "error" };
  }

  const result = await fetchPolicyStoreConfig({
    owner: RuntimeConfig.owner,
    repo: RuntimeConfig.repo,
    workflow: RuntimeConfig.workflow,
    runId: RuntimeConfig.runId,
    correlationId,
    apiKey,
  });

  if (result.status !== "found") {
    return { hasPolicy: false, config: null, fetchStatus: result.status };
  }

  return { hasPolicy: true, config: result.config, fetchStatus: result.status };
}

export async function buildAgentJsonForCurrentJob(): Promise<string> {
  const correlationId = randomUUID();
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  const apiKey = await resolveApiKey({ owner: RuntimeConfig.owner });
  const agentConfig = createBaseAgentConfig(correlationId, apiKey);
  const { hasPolicy, config, fetchStatus } = await loadPolicyConfig(
    correlationId,
    apiKey,
  );

  if (hasPolicy) {
    logInfo(`Policy found: ${config?.policyName || "unnamed"}`);
  } else if (fetchStatus === "not_found") {
    logInfo("No policy configured from policy store");
  } else {
    logWarning("Policy fetch failed; defaulting to audit mode");
  }

  if (config) {
    agentConfig.allowed_endpoints = config.allowedEndpoints;
    agentConfig.egress_policy = config.egressPolicy;
    agentConfig.disable_telemetry = config.disableTelemetry;
    agentConfig.disable_sudo = config.disableSudo;
    agentConfig.disable_sudo_and_containers = config.disableSudoAndContainers;
    agentConfig.disable_file_monitoring = config.disableFileMonitoring;
  }

  // agentConfig.has_prejob_policy = hasPolicy;

  ensureAgentRoot();
  writeJsonFile(
    AgentFiles.linux.agentJson,
    agentConfig as unknown as Record<string, unknown>,
  );

  return correlationId;
}

export async function ensureLatestBravoLinuxAgent(): Promise<void> {
  ensureAgentRoot();

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
    if (buildInfo.tag === release.tag_name) {
      return;
    }
  }

  const asset = selectAgentReleaseAsset(release);
  if (!asset) {
    logWarning(
      `No matching AgentBravo release asset found for ${release.tag_name} on ${process.arch}`,
    );
    return;
  }

  if (buildInfo) {
    logInfo(
      `Updating AgentBravo from ${buildInfo.tag || "unknown"} to ${release.tag_name}`,
    );
  } else {
    logInfo(`Installing AgentBravo ${release.tag_name}`);
  }

  const installed = downloadAndExtractReleaseAsset(
    asset,
    AgentRuntimeConfig.linuxRoot,
  );
  if (!installed) {
    throw new Error("Failed to install AgentBravo");
  }

  const chmodResult = runCommand("chmod", ["+x", AgentFiles.linux.agentBinary]);
  logCommandFailure(
    `Making ${AgentFiles.linux.agentBinary} executable`,
    chmodResult,
  );
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

function getStartTime(filePath: string): number {
  if (!filePath) {
    return 0;
  }

  try {
    const stats = fs.statSync(filePath);
    const birthtimeMs = Number(stats.birthtimeMs);
    if (!Number.isFinite(birthtimeMs) || birthtimeMs <= 0) {
      return 0;
    }
    return Math.floor(birthtimeMs / 1000);
  } catch {
    return 0;
  }
}

export async function appendLinuxSummary(): Promise<void> {
  const correlationId = readCorrelationIdFromAgentJson();
  const startTime = getStartTime(RuntimeConfig.eventPath);
  const endTime = Math.floor(Date.now() / 1000);
  const summaryUrl = `${Urls.stepSecurityApi}/github/${RuntimeConfig.githubRepository}/actions/runs/${RuntimeConfig.runId}/correlation/${correlationId}/job-markdown-summary?environment=SelfHostedVM&start_time=${startTime}&end_time=${endTime}`;

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl);
    if (String(statusCode) === "200" && body) {
      if (!RuntimeConfig.stepSummaryPath) {
        logWarning("GITHUB_STEP_SUMMARY is not set; skipping summary write");
        return;
      }

      fs.appendFileSync(RuntimeConfig.stepSummaryPath, body, "utf8");
      logInfo("Summary added to job output");
      return;
    }

    logWarning(
      `Failed to fetch summary (HTTP ${statusCode}) or no content available`,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    logWarning(`Failed to fetch summary: ${message}`);
  }
}
