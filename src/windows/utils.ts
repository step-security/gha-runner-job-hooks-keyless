import * as fs from "fs";
import * as path from "path";

import { logWarning, runCommand } from "../lib/common";
import { printFileIfExists } from "../lib/files";

export function printWindowsAgentLog(logPath: string): void {
  printFileIfExists(logPath, { header: "[StepSecurity] Agent log:" });
}

export function removeMatchingFiles(
  directoryPath: string,
  filenamePrefix: string,
): void {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath)) {
    if (!entry.startsWith(filenamePrefix)) {
      continue;
    }

    try {
      fs.rmSync(path.join(directoryPath, entry), { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`Failed to remove ${entry}: ${message}`);
    }
  }
}

export function emitWindowsHookSignal(signal: string): void {
  runCommand("cmd.exe", ["/c", `echo ${signal}`], { silent: true });
}

export function getWindowsWorkflowPath(): string {
  return (process.env.GITHUB_WORKFLOW_REF || "")
    .replace(/^[^/]+\/[^/]+\//, "")
    .replace(/@.*$/, "");
}
