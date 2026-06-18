import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import type { TsgraphConfig } from "./types.ts";
import { CONFIG_DEFAULTS } from "./types.ts";

export function loadConfig(projectDir: string): TsgraphConfig {
  const tomlPath = join(projectDir, "tsgraph.toml");
  if (!existsSync(tomlPath)) return { ...CONFIG_DEFAULTS };

  const raw = parse(readFileSync(tomlPath, "utf8")) as Record<string, unknown>;
  const build = (raw.build ?? {}) as Record<string, unknown>;
  const include = (raw.include ?? {}) as Record<string, unknown>;
  const exclude = (raw.exclude ?? {}) as Record<string, unknown>;

  return {
    chunkSize: typeof build.chunk_size === "number" ? build.chunk_size : CONFIG_DEFAULTS.chunkSize,
    include: Array.isArray(include.patterns)
      ? (include.patterns as string[])
      : CONFIG_DEFAULTS.include,
    exclude: Array.isArray(exclude.patterns)
      ? (exclude.patterns as string[])
      : CONFIG_DEFAULTS.exclude,
  };
}
