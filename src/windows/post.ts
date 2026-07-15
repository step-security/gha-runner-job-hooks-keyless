import * as fs from "fs";
import * as cp from "child_process";

import { logInfo } from "../lib/common";
import {
  AgentRuntimeConfig,
} from "../lib/config";
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

  const p = cp.spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "query user; exit $LASTEXITCODE",
    ],
    { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true },
  );
  p.unref();

  writeWindowsPostEvent();

  if (windowsAgentInstalled()) {
    await waitForWindowsDoneFile();
  }

  await stopWindowsAgentProcess();
  await appendWindowsSummary();
  printWindowsAgentLogs();
  cleanupWindowsJobArtifacts();
  logInfo("Finished Windows agent post-hook");
}
