const fs = require("fs") as typeof import("fs");
const https = require("https") as typeof import("https");
const childProcess = require("child_process") as typeof import("child_process");

type RunCommandOptions = {
  captureOutput?: boolean;
  silent?: boolean;
};

type HttpHeaders = Record<string, string>;

export function logWarning(message: string): void {
  console.error(`[StepSecurity] Warning: ${message}`);
}

export function logError(message: string): void {
  console.error(`[StepSecurity] Error: ${message}`);
}

export function logInfo(message: string): void {
  console.log(`[StepSecurity] ${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function httpGet(
  url: string | URL,
  headers: HttpHeaders = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 5000, headers }, (response) => {
      let data = "";

      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        data += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode || 0, body: data });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });

    request.on("error", (error: Error) => {
      reject(error);
    });
  });
}

export async function getWithRetry(
  url: string | URL,
  headers: HttpHeaders = {},
): Promise<{ statusCode: number; body: string }> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await httpGet(url, headers);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(1000);
      }
    }
  }

  throw lastError;
}

export function findEchoCommand(): string {
  for (const echoPath of ["/usr/bin/echo", "/bin/echo"]) {
    try {
      fs.accessSync(echoPath, fs.constants.X_OK);
      return echoPath;
    } catch {
      // continue
    }
  }

  return "";
}

export function requireEchoCommand(): string {
  const echoCommand = findEchoCommand();
  if (!echoCommand) {
    logError("external echo binary not found");
    throw new Error("external echo binary not found");
  }

  return echoCommand;
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): ReturnType<typeof childProcess.spawnSync> {
  return childProcess.spawnSync(command, args, {
    stdio: options.captureOutput
      ? ["ignore", "pipe", "pipe"]
      : options.silent
        ? "ignore"
        : "inherit",
    encoding: options.captureOutput ? "utf8" : undefined,
  });
}

export function logCommandFailure(
  action: string,
  result: ReturnType<typeof childProcess.spawnSync> | null | undefined,
): void {
  if (!result || result.status === 0) {
    return;
  }

  const details = result.error
    ? result.error.message
    : `exit code ${result.status}`;
  logWarning(`${action} failed: ${details}`);
}

export async function waitForCondition(
  predicate: () => boolean,
  maxAttempts: number,
  intervalMs = 1000,
): Promise<{ matched: boolean; attempts: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return { matched: true, attempts: attempt };
    }

    await sleep(intervalMs);
  }

  return { matched: predicate(), attempts: maxAttempts };
}

export async function waitForFile(
  filePath: string,
  maxAttempts: number,
  intervalMs = 1000,
): Promise<boolean> {
  const { matched } = await waitForCondition(
    () => fs.existsSync(filePath),
    maxAttempts,
    intervalMs,
  );
  return matched;
}

export function handleFatalError(error: unknown): never {
  const message =
    error instanceof Error && error.stack
      ? error.stack
      : error instanceof Error && error.message
        ? error.message
        : String(error);
  logError(message);
  process.exit(0);
}
