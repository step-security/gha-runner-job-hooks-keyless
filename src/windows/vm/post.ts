import { logInfo, logWarning } from "../../lib/common";
import { AgentFiles, AgentRootWindows } from "../../lib/config";
import { emitWindowsHookSignal, removeMatchingFiles } from "../utils";
import { waitForFile } from "../../lib/common";

export async function runWindowsVmPostJobHook(): Promise<void> {
  logInfo("POST-JOB HOOK: Signalling agent to clean up...");

  removeMatchingFiles(AgentRootWindows, "postjob_cleanup_done_");

  const nonce = require("crypto").randomUUID() as string;
  const completionFile = `${AgentFiles.windows.postjobCleanupPrefix}${nonce}.json`;

  emitWindowsHookSignal(`step_cleanup_postjob_${nonce}`);

  const done = await waitForFile(completionFile, 60);
  if (done) {
    try {
      require("fs").rmSync(completionFile, { force: true });
    } catch {
      // ignore
    }
    logInfo("POST-JOB HOOK: Cleanup completed successfully");
  } else {
    logWarning("POST-JOB HOOK: Cleanup timed out after 60s; continuing");
  }

}
