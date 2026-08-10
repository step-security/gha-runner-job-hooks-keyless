import { buildSharedAgentJsonForCurrentJob } from "../lib/agent-config";
import { logInfo, logWarning } from "../lib/common";
import { AgentFiles, WindowsAgentServiceConfig } from "../lib/config";
import { runConfiguredEndpointPreflight } from "../lib/preflight";
import {
  ensureWindowsAgentRoot,
  installWindowsAgent,
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

  // Stop first: a running service locks agent.exe and may hold config.json open,
  // so neither file can be replaced until the service is confirmed stopped.
  if (!(await stopWindowsAgentServiceIfRunning())) {
    // The service is still running with the previous job's config, and its lock
    // on agent.exe and config.json means this job cannot be configured. Leave it
    // alone: an agent with a stale correlation id beats no agent at all.
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
    // sc.exe create/config/start all need Administrator, so this is usually a
    // non-elevated runner. The job continues without an agent.
    logWarning(
      `WindowsAgent service=unavailable name=${WindowsAgentServiceConfig.name} action=job-unprotected`,
    );
  }

  logInfo("Hook phase=pre platform=windows runtime=vm status=completed");
}
