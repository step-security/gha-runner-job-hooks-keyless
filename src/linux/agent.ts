import * as fs from "fs";

import {
  assetChecksumSha256,
  isArtifactoryConfigured,
  readCurrentSha256,
  writeCurrentSha256,
} from "../lib/artifactory";
import {
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../lib/common";
import { AgentFiles, AgentRuntimeConfig, ArtifactoryConfig, Urls } from "../lib/config";
import { readCorrelationIdFromAgentJson } from "../lib/files";
import {
  processExists,
  readPidFile,
  removePidFile,
  trySignalProcess,
} from "../lib/process";
import { appendJobSummary } from "../lib/summary";
import {
  downloadLinuxAgentFromArtifactory,
  downloadLinuxAgentFromRelease,
  fetchAgentRelease,
  fetchAgentReleaseFromArtifactory,
  selectAgentReleaseAsset,
} from "./agent-release";
import { verifyReleaseChecksum } from "../lib/agent-release";

type AgentBuildInfo = {
  raw: string;
  name: string;
  branch: string;
  tag: string;
  commit: string;
};

export function ensureLinuxAgentRoot(): void {
  const mkdirResult = runCommand("sudo", [
    "mkdir",
    "-p",
    AgentRuntimeConfig.linuxRoot,
  ]);
  logCommandFailure(`Creating ${AgentRuntimeConfig.linuxRoot}`, mkdirResult);

  const chownResult = runCommand("sudo", [
    "chown",
    "-R",
    `${getCurrentUid()}:${getCurrentGid()}`,
    AgentRuntimeConfig.linuxRoot,
  ]);
  logCommandFailure(
    `Changing ownership for ${AgentRuntimeConfig.linuxRoot}`,
    chownResult,
  );
}

export async function ensureLatestBravoLinuxAgent(): Promise<void> {
  const buildInfo = detectAgentBuildInfo();
  if (buildInfo && AgentRuntimeConfig.disableLinuxAgentUpdate) {
    logInfo("Automatic agent update is disabled; skipping update check");
    return;
  }

  const useArtifactory = isArtifactoryConfigured(ArtifactoryConfig);
  const release = useArtifactory
    ? await fetchAgentReleaseFromArtifactory()
    : await fetchAgentRelease(AgentRuntimeConfig.linuxAgentVersion);

  if (!release) {
    logUnavailableReleaseWarning(useArtifactory);
    return;
  }

  const asset = selectAgentReleaseAsset(release);
  if (!asset) {
    logWarning(
      `No matching AgentBravo release asset found for ${release.tag} on ${process.arch}`,
    );
    return;
  }

  const expectedSha256 = assetChecksumSha256(asset.checksum);
  if (useArtifactory) {
    const currentSha256 = readCurrentSha256(AgentFiles.linux.currentSha256);
    if (
      expectedSha256 &&
      currentSha256 === expectedSha256 &&
      fs.existsSync(AgentFiles.linux.agentBinary)
    ) {
      logInfo(
        `AgentBravo status=already-serving version=${buildInfo?.tag || release.tag || "unknown"} sha256=${expectedSha256}`,
      );
      return;
    }
  }

  if (buildInfo) {
    logInfo(
      `AgentBravo status=detected version=${buildInfo.tag || "unknown"} name=${buildInfo.name || "AgentBravo"} commit=${buildInfo.commit || "unknown"} branch=${buildInfo.branch || "unknown"}`,
    );
    if (
      !useArtifactory &&
      normalizeVersionTag(buildInfo.tag) === normalizeVersionTag(release.tag)
    ) {
      return;
    }
  }

  if (buildInfo && useArtifactory) {
    logInfo(
      `AgentBravo action=refresh source=artifactory current_version=${buildInfo.tag || "unknown"} target_version=${release.tag}`,
    );
  } else if (buildInfo) {
    logInfo(
      `AgentBravo action=update source=release-api current_version=${buildInfo.tag || "unknown"} target_version=${release.tag}`,
    );
  } else {
    logInfo(`AgentBravo action=install target_version=${release.tag}`);
  }

  const archivePath = `/tmp/${asset.asset_name}`;
  try {
    if (useArtifactory) {
      await downloadLinuxAgentFromArtifactory(
        asset,
        release.tag,
        archivePath,
      );
    } else {
      await downloadLinuxAgentFromRelease(asset, archivePath);
    }

    if (!verifyReleaseChecksum(archivePath, asset)) {
      throw new Error(`Checksum validation failed for ${asset.asset_name}`);
    }

    logInfo(
      `AgentBravo action=extract asset=${asset.asset_name} destination=${AgentRuntimeConfig.linuxRoot}`,
    );
    const extractResult = runCommand("sudo", [
      "tar",
      "-xzf",
      archivePath,
      "-C",
      AgentRuntimeConfig.linuxRoot,
    ]);
    logCommandFailure(`Extracting ${archivePath}`, extractResult);
    if (!extractResult || extractResult.status !== 0) {
      throw new Error(
        `Failed to extract ${asset.asset_name} to ${AgentRuntimeConfig.linuxRoot}`,
      );
    }
  } finally {
    const cleanupResult = runCommand("rm", ["-f", archivePath], {
      silent: true,
    });
    logCommandFailure(`Removing ${archivePath}`, cleanupResult);
  }

  const chmodResult = runCommand("sudo", [
    "chmod",
    "+x",
    AgentFiles.linux.agentBinary,
  ]);
  logCommandFailure(
    `Making ${AgentFiles.linux.agentBinary} executable`,
    chmodResult,
  );

  if (expectedSha256) {
    writeCurrentSha256(AgentFiles.linux.currentSha256, expectedSha256);
  }
}

function normalizeVersionTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function logUnavailableReleaseWarning(useArtifactory: boolean): void {
  const resolvedFrom = useArtifactory
    ? "Artifactory-served agent"
    : "release API";

  if (fs.existsSync(AgentFiles.linux.agentBinary)) {
    logWarning(
      `Unable to resolve the current ${resolvedFrom}; continuing with existing agent binary at ${AgentFiles.linux.agentBinary}`,
    );
    return;
  }

  logWarning(
    `Unable to resolve the current ${resolvedFrom} and no existing agent binary is available at ${AgentFiles.linux.agentBinary}`,
  );
}

function detectAgentBuildInfo(): AgentBuildInfo | null {
  if (!fs.existsSync(AgentFiles.linux.agentBinary)) {
    return null;
  }

  const result = runCommand(AgentFiles.linux.agentBinary, ["-b"], {
    captureOutput: true,
  });

  if (!result || result.status !== 0) {
    const details =
      result && result.error
        ? result.error.message
        : `exit code ${result ? result.status : "unknown"}`;
    logWarning(`Failed to detect agent build info: ${details}`);
    return null;
  }

  const output = String(result.stdout || "").trim();
  const buildInfoLine = output
    .split(/\r?\n/)
    .find((line: string) => line.includes("[buildInfo]"));
  if (!buildInfoLine) {
    logWarning("Failed to detect agent build info: missing [buildInfo] output");
    return null;
  }

  const info: AgentBuildInfo = {
    raw: buildInfoLine,
    name: "",
    branch: "",
    tag: "",
    commit: "",
  };

  for (const match of buildInfoLine.matchAll(/(\w+)=([^\s]+)/g)) {
    const [, key, value] = match;
    if (key in info) {
      info[key as keyof AgentBuildInfo] = value;
    }
  }

  return info;
}

export function killExistingAgentProcess(): void {
  const pid = readPidFile(AgentFiles.linux.agentPid);
  if (!pid) {
    return;
  }

  if (!processExists(pid)) {
    removePidFile(AgentFiles.linux.agentPid);
    return;
  }

  logInfo(`AgentBravo process=kill signal=SIGKILL pid=${pid}`);
  const message = trySignalProcess(pid, "SIGKILL");
  if (message) {
    logWarning(
      `AgentBravo process=signal-failed signal=SIGKILL pid=${pid} error=${message}`,
    );
    if (processExists(pid)) {
      return;
    }
  }
  removePidFile(AgentFiles.linux.agentPid);
}

export async function startAgentProcess(): Promise<void> {
  killExistingAgentProcess();

  if (!fs.existsSync(AgentFiles.linux.agentBinary)) {
    throw new Error(`Agent binary is missing: ${AgentFiles.linux.agentBinary}`);
  }

  for (const filePath of [
    AgentFiles.linux.agentStatus,
    AgentFiles.linux.agentDone,
    AgentFiles.linux.agentLog,
    AgentFiles.linux.agentStdout,
  ]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  const logStream = fs.openSync(AgentFiles.linux.agentStdout, "a");
  const childProcess =
    require("child_process") as typeof import("child_process");
  const agentProcess = childProcess.spawn(
    "sudo",
    [AgentFiles.linux.agentBinary],
    {
      cwd: AgentRuntimeConfig.linuxRoot,
      detached: true,
      stdio: ["ignore", logStream, logStream],
    },
  );
  agentProcess.unref();

  fs.writeFileSync(AgentFiles.linux.agentPid, `${agentProcess.pid}\n`, "utf8");
  logInfo(`AgentBravo process=started pid=${agentProcess.pid}`);

  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.linux.agentStatus),
    30,
    300,
  );

  if (!matched) {
    logWarning("AgentBravo process=init status=timeout");
    return;
  }

  logInfo("AgentBravo process=init status=ready");
}

export async function stopAgentProcess(): Promise<void> {
  const pid = readPidFile(AgentFiles.linux.agentPid);
  if (!pid) {
    logWarning("AgentBravo process=stop status=pid-not-found");
    return;
  }

  if (!processExists(pid)) {
    logInfo(`AgentBravo process=stop status=not-running pid=${pid}`);
    removePidFile(AgentFiles.linux.agentPid);
    return;
  }

  logInfo(`AgentBravo process=stop signal=SIGTERM pid=${pid}`);
  {
    const message = trySignalProcess(pid, "SIGTERM");
    if (message) {
      logWarning(
        `AgentBravo process=signal-failed signal=SIGTERM pid=${pid} error=${message}`,
      );
      if (!processExists(pid)) {
        removePidFile(AgentFiles.linux.agentPid);
      }
      return;
    }
  }

  const { matched } = await waitForCondition(
    () => !processExists(pid),
    10,
    1000,
  );

  if (matched) {
    logInfo(`AgentBravo process=stopped mode=graceful pid=${pid}`);
    removePidFile(AgentFiles.linux.agentPid);
    return;
  }

  logWarning("AgentBravo process=stop status=timeout next_signal=SIGKILL");

  if (processExists(pid)) {
    const message = trySignalProcess(pid, "SIGKILL");
    if (message) {
      logWarning(
        `AgentBravo process=signal-failed signal=SIGKILL pid=${pid} error=${message}`,
      );
    }
  }

  const { matched: killed } = await waitForCondition(
    () => !processExists(pid),
    3,
    1000,
  );

  if (killed) {
    logInfo(`AgentBravo process=stopped mode=forced pid=${pid}`);
  } else {
    logWarning(`AgentBravo process=stop status=still-running pid=${pid}`);
  }

  removePidFile(AgentFiles.linux.agentPid);
}

export function printLinuxAgentLogs(): void {
  if (fs.existsSync(AgentFiles.linux.agentLog)) {
    console.log("::group::[StepSecurity] HardenRunner logs");
    const agentLog = fs.readFileSync(AgentFiles.linux.agentLog, "utf8");
    process.stdout.write(agentLog);
    if (!agentLog.endsWith("\n")) {
      process.stdout.write("\n");
    }
    console.log("::endgroup::");
  }

  if (fs.existsSync(AgentFiles.linux.agentStdout)) {
    console.log("::group::[StepSecurity] HardenRunner stdout");
    const agentStdout = fs.readFileSync(AgentFiles.linux.agentStdout, "utf8");
    process.stdout.write(agentStdout);
    if (!agentStdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
    console.log("::endgroup::");
  }
}

export function cleanupLinuxJobArtifacts(): void {
  const cleanupResult = runCommand("sudo", [
    "rm",
    "-f",
    AgentFiles.linux.agentJson,
    AgentFiles.linux.agentPid,
    AgentFiles.linux.agentStatus,
    AgentFiles.linux.agentDone,
    AgentFiles.linux.agentLog,
    AgentFiles.linux.agentStdout,
  ]);
  logCommandFailure("Removing Linux agent job artifacts", cleanupResult);
}

export async function appendLinuxSummary(): Promise<void> {
  const correlationId = readCorrelationIdFromAgentJson(
    AgentFiles.linux.agentJson,
  );
  await appendJobSummary({
    correlationId,
    environment: "SelfHostedVM",
  });
}

function getCurrentUid(): string {
  return String(typeof process.getuid === "function" ? process.getuid() : 0);
}

function getCurrentGid(): string {
  return String(typeof process.getgid === "function" ? process.getgid() : 0);
}
