import * as fs from "fs";

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(pidFilePath: string): number | null {
  if (!fs.existsSync(pidFilePath)) {
    return null;
  }

  const pid = Number.parseInt(fs.readFileSync(pidFilePath, "utf8").trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function isAgentRunning(pidFilePath: string): boolean {
  const pid = readPidFile(pidFilePath);
  if (!pid) {
    return false;
  }

  if (!processExists(pid)) {
    removePidFile(pidFilePath);
    return false;
  }

  return true;
}

export function removePidFile(pidFilePath: string): void {
  if (fs.existsSync(pidFilePath)) {
    fs.unlinkSync(pidFilePath);
  }
}

export function trySignalProcess(
  pid: number,
  signal: NodeJS.Signals | number,
): string | null {
  try {
    process.kill(pid, signal);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
