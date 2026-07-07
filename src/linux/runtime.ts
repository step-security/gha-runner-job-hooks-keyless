import * as fs from "fs";
import { LinuxHookMode } from "../lib/config";

export type LinuxRuntimeMode = "arc" | "vm";

export function isARCRunner(): boolean {
  const runnerUserAgent = process.env.GITHUB_ACTIONS_RUNNER_EXTRA_USER_AGENT;

  if (runnerUserAgent?.includes("actions-runner-controller/")) {
    return true;
  }

  return isSecondaryPod();
}

function isSecondaryPod(): boolean {
  const workDir = "/__w";
  const hasKubeEnv = process.env.KUBERNETES_PORT !== undefined;
  return fs.existsSync(workDir) && hasKubeEnv;
}

function parseExplicitLinuxHookMode(): LinuxRuntimeMode | "" {
  if (LinuxHookMode === "arc" || LinuxHookMode === "vm") {
    return LinuxHookMode;
  }

  return "";
}

export function detectLinuxRuntimeMode(): LinuxRuntimeMode {
  const explicitMode = parseExplicitLinuxHookMode();
  if (explicitMode) {
    return explicitMode;
  }

  if (isARCRunner()) {
    return "arc";
  }

  return "vm";
}
