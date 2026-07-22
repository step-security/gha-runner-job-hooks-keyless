import * as fs from "fs";
import * as cp from "child_process";

import { logInfo, logWarning } from "../lib/common";
import { AgentFiles, AgentRuntimeConfig } from "../lib/config";
import { isAgentRunning } from "../lib/process";
import {
  appendWindowsSummary,
  cleanupWindowsJobArtifacts,
  printWindowsAgentLogs,
  stopWindowsAgentProcess,
  waitForWindowsDoneFile,
  windowsAgentInstalled,
  windowsPostEventExists,
  writeWindowsPostEvent,
} from "./agent";

export async function runWindowsPostJobHook(): Promise<void> {
  logInfo("Running Windows agent post-hook");

  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    logInfo(
      `Windows cleanup: ${AgentRuntimeConfig.windowsRoot} not found; agent was not installed. Skipping.`,
    );
    return;
  }

  if (windowsPostEventExists()) {
    logInfo("Windows post step already executed, skipping");
    return;
  }

  if (process.arch === "arm64") {
    logInfo("Windows arm64 runners are not supported");
    return;
  }

  if (!isAgentRunning(AgentFiles.windows.agentPid)) {
    logWarning("Skipping summary because Windows agent PID file was not found");
    cleanupWindowsJobArtifacts();
    return;
  }

  logInfo("Sending query user command");
  const p = cp.spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "query user; exit $LASTEXITCODE",
    ],
    { stdio: "ignore", shell: false, windowsHide: true },
  );
  p.unref();

  logInfo("Writing post event json");
  writeWindowsPostEvent();

  if (windowsAgentInstalled()) {
    logInfo("Waiting for done file");
    await waitForWindowsDoneFile();
  }

  await stopWindowsAgentProcess();
  await appendWindowsSummary();
  printWindowsAgentLogs();
  cleanupWindowsJobArtifacts();
  logInfo("Finished Windows agent post-hook");
}
