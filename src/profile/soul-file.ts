import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";
import { settingsFile } from "../config/configuration.js";
import type { Config } from "../config/types/config.js";
export function soulFile(config: Config, path = settingsFile()): string {
  if (config.paths.length) {
    const candidates = config.paths.map((root) =>
      resolve(dirname(path), root, "SOUL.md"),
    );
    return (
      candidates.find((candidate) => {
        try {
          return statSync(candidate).isFile();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      }) ?? candidates[0]!
    );
  }
  return resolve(dirname(path), config.soulFile ?? "SOUL.md");
}
