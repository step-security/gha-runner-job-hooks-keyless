#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runLinuxPreJobHook } from "./linux/pre";
import { runWindowsPreJobHook } from "./windows/pre";

async function main(): Promise<void> {
  console.log("[StepSecurity] pre job-hook");

  if (process.platform === "linux") {
    await runLinuxPreJobHook();
    return;
  }

  if (process.platform === "win32") {
    await runWindowsPreJobHook();
    return;
  }

  logWarning(`Unsupported platform: ${process.platform}`);
}

main().catch((error: unknown) => {
  handleFatalError(error);
});
