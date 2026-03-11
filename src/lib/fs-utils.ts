import fs from "node:fs/promises";
import path from "node:path";

export async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(target: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(target, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(target: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function listFiles(targetDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(targetDir, entry.name));
  } catch {
    return [];
  }
}

export async function tailLines(target: string, limit = 120): Promise<string[]> {
  try {
    const raw = await fs.readFile(target, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}
