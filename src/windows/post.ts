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
  logInfo("Hook phase=post platform=windows runtime=vm");

  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    logInfo(
      `Hook phase=post platform=windows runtime=vm status=skipped reason=missing-agent-root path=${AgentRuntimeConfig.windowsRoot}`,
    );
    return;
  }

  if (windowsPostEventExists()) {
    logInfo("Hook phase=post platform=windows runtime=vm status=skipped reason=already-executed");
    return;
  }

  if (process.arch === "arm64") {
    logInfo("Hook phase=post platform=windows runtime=vm status=skipped reason=unsupported-arch arch=arm64");
    return;
  }

  if (!isAgentRunning(AgentFiles.windows.agentPid)) {
    logWarning("Hook phase=post platform=windows runtime=vm status=skipped reason=missing-agent-pid");
    cleanupWindowsJobArtifacts();
    return;
  }

  logInfo("Hook phase=post platform=windows runtime=vm action=query-user");
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

  logInfo("Hook phase=post platform=windows runtime=vm action=write-post-event");
  writeWindowsPostEvent();

  if (windowsAgentInstalled()) {
    logInfo("Hook phase=post platform=windows runtime=vm action=wait-done-file");
    await waitForWindowsDoneFile();
  }

  await stopWindowsAgentProcess();
  await appendWindowsSummary();
  printWindowsAgentLogs();
  cleanupWindowsJobArtifacts();
  logInfo("Hook phase=post platform=windows runtime=vm status=completed");
}
