import { logInfo } from "../lib/common";
import { runWindowsCustomVmPreJobHook } from "./custom-vm/pre";
import { detectWindowsRuntimeMode } from "./runtime";
import { runWindowsVmPreJobHook } from "./vm/pre";

export async function runWindowsPreJobHook(): Promise<void> {
  const mode = detectWindowsRuntimeMode();

  if (mode === "custom_vm") {
    logInfo("Running Windows custom VM pre-hook");
    await runWindowsCustomVmPreJobHook();
    return;
  }

  logInfo("Running Windows VM pre-hook");
  await runWindowsVmPreJobHook();
}
