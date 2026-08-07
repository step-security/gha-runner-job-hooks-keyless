import * as path from "path";

import { AgentFiles, WindowsAgentServiceConfig } from "../lib/config";
import {
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../lib/common";
import {
  killLeftoverWindowsAgentProcess,
  resetWindowsJobArtifacts,
} from "./agent";

type WindowsServiceState =
  | "RUNNING"
  | "STOPPED"
  | "START_PENDING"
  | "STOP_PENDING"
  | "PAUSED"
  | "UNKNOWN";

// Win32 error codes returned by sc.exe as its exit code.
const ERROR_ACCESS_DENIED = 5;
const ERROR_SERVICE_ALREADY_RUNNING = 1056;
const ERROR_SERVICE_DOES_NOT_EXIST = 1060;
const ERROR_SERVICE_NOT_ACTIVE = 1062;

// Resolve sc.exe absolutely; PATH is not guaranteed on a runner.
const ScExe = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "sc.exe",
);

/**
 * A service has no working directory of its own (it starts in System32), so the
 * config path must be passed explicitly rather than resolved relative to cwd the
 * way process mode does. Inner quotes keep an agent root containing spaces intact.
 */
function serviceBinPath(): string {
  return `"${AgentFiles.windows.agentBinary}" --config "${AgentFiles.windows.agentJson}"`;
}

function runSc(
  args: readonly string[],
): ReturnType<typeof runCommand> {
  return runCommand(ScExe, args, { captureOutput: true });
}

export function windowsServiceExists(): boolean {
  const result = runSc(["query", WindowsAgentServiceConfig.name]);
  if (!result || result.status === null) {
    return false;
  }

  if (result.status === ERROR_SERVICE_DOES_NOT_EXIST) {
    return false;
  }

  if (result.status !== 0) {
    logWarning(
      `WindowsAgent service=query-failed name=${WindowsAgentServiceConfig.name} exit=${result.status}`,
    );
    return false;
  }

  return true;
}

export function queryWindowsServiceState(): WindowsServiceState | null {
  const result = runSc(["query", WindowsAgentServiceConfig.name]);
  if (!result || result.status !== 0) {
    return null;
  }

  // sc.exe prints e.g. "        STATE              : 4  RUNNING"
  const match = /^\s*STATE\s+:\s+\d+\s+(\S+)/m.exec(String(result.stdout || ""));
  if (!match) {
    return null;
  }

  const state = match[1].toUpperCase();
  switch (state) {
    case "RUNNING":
    case "STOPPED":
    case "START_PENDING":
    case "STOP_PENDING":
    case "PAUSED":
      return state;
    default:
      return "UNKNOWN";
  }
}

function createWindowsAgentService(): boolean {
  logInfo(`WindowsAgent service=create name=${WindowsAgentServiceConfig.name}`);

  // sc.exe requires the "key= value" split, so the key and its value are
  // separate argv entries. runCommand uses spawnSync without a shell.
  const result = runSc([
    "create",
    WindowsAgentServiceConfig.name,
    "binPath=",
    serviceBinPath(),
    "DisplayName=",
    WindowsAgentServiceConfig.displayName,
    "start=",
    "demand",
  ]);

  if (!result || result.status !== 0) {
    logCommandFailure(
      `WindowsAgent service=create name=${WindowsAgentServiceConfig.name}`,
      result,
    );
    if (result && result.status === ERROR_ACCESS_DENIED) {
      logWarning(
        "WindowsAgent service=create-denied reason=not-elevated",
      );
    }
    return false;
  }

  logCommandFailure(
    `WindowsAgent service=describe name=${WindowsAgentServiceConfig.name}`,
    runSc([
      "description",
      WindowsAgentServiceConfig.name,
      WindowsAgentServiceConfig.description,
    ]),
  );

  return true;
}

/**
 * Points an already-registered service at the current binary, args, and
 * demand-start. Idempotent, and cheaper than parsing `sc qc` output to decide
 * whether a manually provisioned service needs correcting.
 */
function reconcileWindowsAgentService(): boolean {
  const result = runSc([
    "config",
    WindowsAgentServiceConfig.name,
    "binPath=",
    serviceBinPath(),
    "start=",
    "demand",
  ]);

  if (!result || result.status !== 0) {
    logCommandFailure(
      `WindowsAgent service=reconfigure name=${WindowsAgentServiceConfig.name}`,
      result,
    );
    return false;
  }

  return true;
}

async function startWindowsAgentService(): Promise<boolean> {
  logInfo(`WindowsAgent service=start name=${WindowsAgentServiceConfig.name}`);
  const result = runSc(["start", WindowsAgentServiceConfig.name]);

  if (
    !result ||
    (result.status !== 0 && result.status !== ERROR_SERVICE_ALREADY_RUNNING)
  ) {
    logCommandFailure(
      `WindowsAgent service=start name=${WindowsAgentServiceConfig.name}`,
      result,
    );
    if (result && result.status === ERROR_ACCESS_DENIED) {
      logWarning(
        "WindowsAgent service=start-denied reason=not-elevated",
      );
    }
    return false;
  }

  // sc.exe start returns as soon as the request is accepted, so wait for the
  // service control manager to report RUNNING.
  const { matched } = await waitForCondition(
    () => queryWindowsServiceState() === "RUNNING",
    30,
    1000,
  );

  if (!matched) {
    logWarning(
      `WindowsAgent service=start-timeout name=${WindowsAgentServiceConfig.name}`,
    );
    // The service may be stuck in START_PENDING with a partially initialized
    // agent. Stop it so the caller's process-mode fallback cannot end up
    // running a second agent alongside it.
    await stopWindowsAgentService();
    return false;
  }

  logInfo(`WindowsAgent service=running name=${WindowsAgentServiceConfig.name}`);
  return true;
}

export async function stopWindowsAgentService(): Promise<boolean> {
  logInfo(`WindowsAgent service=stop name=${WindowsAgentServiceConfig.name}`);
  const result = runSc(["stop", WindowsAgentServiceConfig.name]);

  if (result && result.status !== null) {
    if (
      result.status === ERROR_SERVICE_NOT_ACTIVE ||
      result.status === ERROR_SERVICE_DOES_NOT_EXIST
    ) {
      logInfo(`WindowsAgent service=not-running name=${WindowsAgentServiceConfig.name}`);
      return true;
    }

    if (result.status !== 0) {
      logCommandFailure(
        `WindowsAgent service=stop name=${WindowsAgentServiceConfig.name}`,
        result,
      );
      return false;
    }
  } else {
    logCommandFailure(
      `WindowsAgent service=stop name=${WindowsAgentServiceConfig.name}`,
      result,
    );
    return false;
  }

  const { matched } = await waitForCondition(() => {
    const state = queryWindowsServiceState();
    return state === "STOPPED" || state === null;
  }, 30, 1000);

  if (!matched) {
    logWarning(
      `WindowsAgent service=stop-timeout name=${WindowsAgentServiceConfig.name}`,
    );
    return false;
  }

  logInfo(`WindowsAgent service=stopped name=${WindowsAgentServiceConfig.name}`);
  return true;
}

/**
 * Called before agent.exe and config.json are written. A running service locks
 * agent.exe and may hold config.json open, so both files can only be replaced
 * once it is confirmed stopped.
 *
 * Returns true when it is safe to write those files.
 */
export async function stopWindowsAgentServiceIfRunning(): Promise<boolean> {
  if (!windowsServiceExists()) {
    return true;
  }

  const state = queryWindowsServiceState();
  if (state === "STOPPED") {
    return true;
  }

  return await stopWindowsAgentService();
}

/**
 * Called after agent.exe and config.json are in place. Returns false when the
 * service path is unavailable and the caller should fall back to process mode.
 */
export async function ensureAndStartWindowsAgentService(): Promise<boolean> {
  // A process-mode agent from a previous flag-off job would otherwise keep
  // running alongside the service.
  if (!killLeftoverWindowsAgentProcess()) {
    logWarning(
      "WindowsAgent service=blocked reason=leftover-process-running",
    );
    return false;
  }

  resetWindowsJobArtifacts();

  const ensured = windowsServiceExists()
    ? reconcileWindowsAgentService()
    : createWindowsAgentService();

  if (!ensured) {
    return false;
  }

  return await startWindowsAgentService();
}
