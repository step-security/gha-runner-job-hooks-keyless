import { logInfo } from "../lib/common";
import { runWindowsCustomVmPostJobHook } from "./custom-vm/post";
import { detectWindowsRuntimeMode } from "./runtime";
import { runWindowsVmPostJobHook } from "./vm/post";

export async function runWindowsPostJobHook(): Promise<void> {
  const mode = detectWindowsRuntimeMode();

  if (mode === "custom_vm") {
    logInfo("Running Windows custom VM post-hook");
    await runWindowsCustomVmPostJobHook();
    return;
  }

  logInfo("Running Windows VM post-hook");
  await runWindowsVmPostJobHook();
}
