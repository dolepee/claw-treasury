import path from "node:path";

export function getDataDir(): string {
  const configured = process.env.CLAW_TREASURY_DATA_DIR;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return path.join(process.cwd(), "data");
}
