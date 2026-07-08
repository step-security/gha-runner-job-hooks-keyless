#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runLinuxPostJobHook } from "./linux/post";

async function main(): Promise<void> {
  console.log("[StepSecurity] post job-hook");

  if (process.platform === "linux") {
    await runLinuxPostJobHook();
    return;
  }

  logWarning(`Unsupported platform: ${process.platform}`);
}

main().catch((error: unknown) => {
  handleFatalError(error);
});
