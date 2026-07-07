import { logWarning } from "../lib/common";
import { WindowsHookMode } from "../lib/config";

export type WindowsRuntimeMode = "vm" | "custom_vm";

export function detectWindowsRuntimeMode(): WindowsRuntimeMode {
  if (WindowsHookMode === "vm" || WindowsHookMode === "custom_vm") {
    return WindowsHookMode;
  }

  if (WindowsHookMode) {
    logWarning(
      `Invalid STEP_WINDOWS_HOOK_MODE: ${WindowsHookMode}; defaulting to vm`,
    );
  }

  return "vm";
}
