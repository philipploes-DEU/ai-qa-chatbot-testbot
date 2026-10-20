import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** All .yaml and .yml files below a directory, sorted by path. */
export async function listYamlFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      found.push(...(await listYamlFiles(full)));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Forward slashes for display, whatever the platform. */
export function toPosix(target: string): string {
  return target.split(path.sep).join("/");
}
