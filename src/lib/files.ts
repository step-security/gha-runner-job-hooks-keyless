import * as fs from "fs";

export function readJsonFile(
  filePath: string,
): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

export function writeJsonFile(
  filePath: string,
  value: Record<string, unknown>,
): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function updateJsonFile(
  filePath: string,
  updater: (value: Record<string, unknown>) => Record<string, unknown>,
): boolean {
  const current = readJsonFile(filePath);
  if (!current) {
    return false;
  }

  writeJsonFile(filePath, updater(current));
  return true;
}

export function printFileIfExists(
  filePath: string,
  options: { header?: string; groupTitle?: string } = {},
): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (options.groupTitle) {
    console.log(`::group::${options.groupTitle}`);
  } else if (options.header) {
    console.log(options.header);
  }

  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }

  if (options.groupTitle) {
    console.log("::endgroup::");
  }

  return true;
}
