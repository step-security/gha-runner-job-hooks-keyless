export function toBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
