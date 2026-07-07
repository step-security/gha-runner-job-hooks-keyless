export const AgentRoot = process.env.STEP_AGENT_ROOT || "/home/agent";
export const DisableAgentUpdate =
  process.env.STEP_DISABLE_AGENT_UPDATE === "true";
export const AgentVersionLinux =
  process.env.STEP_AGENT_VERSION_LINUX || "latest";
export const LinuxHookMode = process.env.STEP_LINUX_HOOK_MODE || "vm";
export const WindowsHookMode = process.env.STEP_WINDOWS_HOOK_MODE || "vm";
export const AgentRootWindows =
  process.env.STEP_AGENT_ROOT_WINDOWS || "C:\\agent";
export const IsEphemeralLinux = process.env.STEP_IS_EPHEMERAL === "false";

export const AgentFiles = {
  linux: {
    agentJson: `${AgentRoot}/agent.json`,
    agentStatus: `${AgentRoot}/agent.status`,
    agentDone: `${AgentRoot}/done.json`,
    agentBinary: `${AgentRoot}/agent`,
    agentLog: `${AgentRoot}/agent.log`,
    agentStdout: `${AgentRoot}/agent.stdout`,
    agentPid: `${AgentRoot}/agent.pid`,
  },
  windows: {
    agentJson: `${AgentRootWindows}\\agent.json`,
    agentStatus: `${AgentRootWindows}\\agent.status`,
    agentDone: `${AgentRootWindows}\\done.json`,
    agentBinary: `${AgentRootWindows}\\agent.exe`,
    agentLog: `${AgentRootWindows}\\agent.log`,
    agentConfig: `${AgentRootWindows}\\config.json`,
    agentService: "StepSecurityAgent",
    prejobReadyPrefix: `${AgentRootWindows}\\prejob_policy_ready_`,
    postjobCleanupPrefix: `${AgentRootWindows}\\postjob_cleanup_done_`,
  },
} as const;

export const Urls = {
  stepSecurityApi: process.env.STEP_API || "https://int.api.stepsecurity.io/v1",
  stepSecurityTelemetry:
    process.env.STEP_TELEMETRY_URL || "https://int.app-api.stepsecurity.io/v1",
} as const;
