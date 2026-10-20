import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export interface LoadedEnvFile {
  file: string;
  /** Variables this file set; those already present were left alone. */
  variables: number;
}

/**
 * Reads `.env` from each directory in order and sets the variables that are still missing in
 * `env`. Variables from the shell win over every file, earlier directories over later ones.
 * Values are never returned or printed.
 */
export function loadEnvFiles(
  dirs: readonly string[],
  env: Record<string, string | undefined>,
): LoadedEnvFile[] {
  const loaded: LoadedEnvFile[] = [];
  for (const dir of [...new Set(dirs.map((entry) => path.resolve(entry)))]) {
    const file = path.join(dir, ".env");
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, "utf8"));
    let variables = 0;
    for (const [name, value] of Object.entries(parsed)) {
      if (env[name] !== undefined || value === undefined) continue;
      env[name] = value;
      variables += 1;
    }
    loaded.push({ file, variables });
  }
  return loaded;
}
