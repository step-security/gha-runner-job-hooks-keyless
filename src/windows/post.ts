import * as fs from "fs";
import * as cp from "child_process";

import { logInfo, logWarning } from "../lib/common";
import {
  AgentFiles,
  AgentRuntimeConfig,
  WindowsAgentServiceConfig,
} from "../lib/config";
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
import {
  queryWindowsServiceState,
  stopWindowsAgentService,
  windowsServiceExists,
} from "./service";

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

  // In service mode there is no PID file, so a PID-only check would skip the
  // whole post hook. Treat a RUNNING service as the agent being up.
  const serviceRunning =
    WindowsAgentServiceConfig.enabled &&
    queryWindowsServiceState() === "RUNNING";

  if (!serviceRunning && !isAgentRunning(AgentFiles.windows.agentPid)) {
    logWarning("Hook phase=post platform=windows runtime=vm status=skipped reason=agent-not-running");
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

  // Stop whichever mode actually started the agent: the pre-hook falls back to
  // process mode when the service cannot be brought up, so both are possible.
  if (WindowsAgentServiceConfig.enabled && windowsServiceExists()) {
    await stopWindowsAgentService();
  }

  if (fs.existsSync(AgentFiles.windows.agentPid)) {
    await stopWindowsAgentProcess();
  }

  await appendWindowsSummary();
  printWindowsAgentLogs();
  cleanupWindowsJobArtifacts();
  logInfo("Hook phase=post platform=windows runtime=vm status=completed");
}
