export const AgentRuntimeConfig = {
  linuxRoot: process.env.STEP_AGENT_ROOT || "/home/agent",
  windowsRoot: process.env.STEP_AGENT_ROOT_WINDOWS || "C:\\agent",
  disableLinuxAgentUpdate: process.env.STEP_DISABLE_AGENT_UPDATE === "true",
  linuxAgentVersion: process.env.STEP_AGENT_VERSION_LINUX || "latest",
  isEphemeralLinux: process.env.STEP_IS_EPHEMERAL === "true",
} as const;

export const WindowsAgentReleaseConfig = {
  windowsAgentVersion: process.env.STEP_AGENT_VERSION_WINDOWS || "latest",
} as const;

export const HookModeConfig = {
  linux: process.env.STEP_LINUX_HOOK_MODE || "",
} as const;

export const ApiKeyConfig = {
  envApiKey: process.env.STEP_API_KEY || "",
  roleArn: process.env.STEP_API_KEY_ROLE_ARN || "",
  secretName: process.env.STEP_API_KEY_SECRET_NAME || "stepsecurity/orgs/<owner>/vm-api-key",
  secretRegion: process.env.STEP_API_KEY_SECRET_REGION || "us-west-2",
  secretField: process.env.STEP_API_KEY_SECRET_FIELD || "api_key",
} as const;

export const AgentFiles = {
  linux: {
    agentJson: `${AgentRuntimeConfig.linuxRoot}/agent.json`,
    agentStatus: `${AgentRuntimeConfig.linuxRoot}/agent.status`,
    agentDone: `${AgentRuntimeConfig.linuxRoot}/done.json`,
    agentBinary: `${AgentRuntimeConfig.linuxRoot}/agent`,
    agentLog: `${AgentRuntimeConfig.linuxRoot}/agent.log`,
    agentStdout: `${AgentRuntimeConfig.linuxRoot}/agent.stdout`,
    agentPid: `${AgentRuntimeConfig.linuxRoot}/agent.pid`,
  },
  windows: {
    agentJson: `${AgentRuntimeConfig.windowsRoot}\\config.json`,
    agentStatus: `${AgentRuntimeConfig.windowsRoot}\\agent.status`,
    agentDone: `${AgentRuntimeConfig.windowsRoot}\\done.json`,
    agentBinary: `${AgentRuntimeConfig.windowsRoot}\\agent.exe`,
    agentLog: `${AgentRuntimeConfig.windowsRoot}\\agent.log`,
    agentPid: `${AgentRuntimeConfig.windowsRoot}\\agent.pid`,
    postEvent: `${AgentRuntimeConfig.windowsRoot}\\post_event.json`,
  },
} as const;

export const Urls = {
  stepSecurityApi: process.env.STEP_API || "https://agent.api.stepsecurity.io/v1",
  stepSecurityTelemetry:
    process.env.STEP_TELEMETRY_URL || "https://prod.app-api.stepsecurity.io/v1",
} as const;
