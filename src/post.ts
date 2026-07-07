#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runLinuxPostJobHook } from "./linux/post";
import { runWindowsPostJobHook } from "./windows/post";

async function main(): Promise<void> {
  console.log("[StepSecurity] post job-hook");

  if (process.platform === "linux") {
    await runLinuxPostJobHook();
    return;
  }

  if (process.platform === "win32") {
    await runWindowsPostJobHook();
    return;
  }

  logWarning(`Unsupported platform: ${process.platform}`);
}

main().catch((error: unknown) => {
  handleFatalError(error);
});
