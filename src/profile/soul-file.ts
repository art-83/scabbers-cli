import { dirname, resolve } from "node:path";
import { settingsFile } from "../config/configuration.js";
import type { Config } from "../config/types/config.js";

// Keep personal profiles beside the selected settings file, outside project repositories.
export function soulFile(config: Config, path = settingsFile()): string {
  return resolve(dirname(path), config.soulFile ?? "SOUL.md");
}
