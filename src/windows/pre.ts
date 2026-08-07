import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { logInfo, logWarning } from "../lib/common";
import { AgentFiles, WindowsAgentServiceConfig } from "../lib/config";
import { runConfiguredEndpointPreflight } from "../lib/preflight";
import {
  ensureWindowsAgentRoot,
  installWindowsAgent,
  startWindowsAgentProcess,
  waitForWindowsAgentStatus,
} from "./agent";
import {
  ensureAndStartWindowsAgentService,
  stopWindowsAgentServiceIfRunning,
} from "./service";

async function buildAgentConfig(): Promise<void> {
  await buildSharedAgentJsonForCurrentJob({
    agentJsonPath: AgentFiles.windows.agentJson,
    isPersistent: false,
    isGithubHosted: true,
    isDebug: false,
    egressPolicyAlwaysAudit: false,
    logJobDetails: true,
  });
}

export async function runWindowsPreJobHook(): Promise<void> {
  logInfo("Hook phase=pre platform=windows runtime=vm");
  if (process.arch === "arm64") {
    logInfo("Hook phase=pre platform=windows runtime=vm status=skipped reason=unsupported-arch arch=arm64");
    return;
  }
  await runConfiguredEndpointPreflight({ requireVmApiKey: true });
  ensureWindowsAgentRoot();

  if (!WindowsAgentServiceConfig.enabled) {
    await buildAgentConfig();
    await installWindowsAgent();
    await startWindowsAgentProcess();
    logInfo("Hook phase=pre platform=windows runtime=vm status=completed");
    return;
  }

  // Stop first: a running service locks agent.exe and may hold config.json open,
  // so neither file can be replaced until the service is confirmed stopped.
  if (!(await stopWindowsAgentServiceIfRunning())) {
    // The service is still running with the previous job's config. Starting a
    // second agent here would leave two agents contending for the same
    // interception state and state files, which is worse than one agent with a
    // stale correlation id, so stop rather than fall back to process mode.
    logWarning(
      `WindowsAgent service=stop-failed name=${WindowsAgentServiceConfig.name} action=left-running`,
    );
    return;
  }

  await installWindowsAgent();
  await buildAgentConfig();

  if (await ensureAndStartWindowsAgentService()) {
    await waitForWindowsAgentStatus();
  } else {
    logWarning("WindowsAgent service=unavailable action=fallback-to-process");
    await startWindowsAgentProcess();
  }

  logInfo("Hook phase=pre platform=windows runtime=vm status=completed");
}
