import * as fs from "fs";
import { HookModeConfig } from "../lib/config";

import { existsSync } from "fs";

const SERVICE_ACCOUNT_TOKEN_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";

export function isRunningInKubernetes(): boolean {
  if (
    Boolean(process.env.KUBERNETES_SERVICE_HOST) ||
    existsSync(SERVICE_ACCOUNT_TOKEN_PATH)
  ) {
    return true;
  }

  return isARCRunner();
}

export type LinuxRuntimeMode = "k8s" | "vm";

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
  if (HookModeConfig.linux === "k8s" || HookModeConfig.linux === "vm") {
    return HookModeConfig.linux;
  }

  return "";
}

export function detectLinuxRuntimeMode(): LinuxRuntimeMode {
  const explicitMode = parseExplicitLinuxHookMode();
  if (explicitMode) {
    return explicitMode;
  }

  if (isRunningInKubernetes()) {
    return "k8s";
  }

  return "vm";
}
