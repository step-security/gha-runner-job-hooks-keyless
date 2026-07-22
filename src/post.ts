#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runConfiguredEndpointPreflight } from "./lib/preflight";
import { runLinuxPostJobHook } from "./linux/post";
import { runWindowsPostJobHook } from "./windows/post";
import { HookVersion } from "./version";

async function main(): Promise<void> {
  console.log("[StepSecurity] post job-hook");
  console.log(`[StepSecurity] job-hook version=${HookVersion}`);
  await runConfiguredEndpointPreflight({ stepSecurityApiOnly: true });

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
