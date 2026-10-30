import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Config } from "./types/config.js";

/** Discovers supported web repositories without executing code from the checkout. */
export class RepositoryCatalog {
  private readonly supported = new Set([
    "arcca-pdv",
    "arccanet-frontend",
    "arccanet-backend",
  ]);
  resolve(config: Config): Config {
    const repositories = new Map(
      config.repositories.map((repo) => [repo.name, { ...repo }]),
    );
    const found = new Map<string, string>();
    for (const configured of config.paths) {
      const root = resolve(configured);
      if (!existsSync(root))
        throw new Error(
          `Repository discovery directory does not exist: ${root}`,
        );
      if (!lstatSync(root).isDirectory())
        throw new Error(
          `Repository discovery path must be a directory: ${root}`,
        );
      const candidates = this.supported.has(basename(root))
        ? [root]
        : readdirSync(root, { withFileTypes: true })
            .filter(
              (entry) => entry.isDirectory() && this.supported.has(entry.name),
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry) => join(root, entry.name));
      for (const candidate of candidates) {
        if (!existsSync(join(candidate, ".git"))) continue;
        const name = basename(
          candidate,
        ) as Config["repositories"][number]["name"];
        const path = realpathSync(candidate);
        const previous = found.get(name);
        if (previous && previous !== path)
          throw new Error(
            `Ambiguous repository ${name} in paths; select one workspace root`,
          );
        found.set(name, path);
        const explicit = repositories.get(name);
        if (explicit && realpathSync(explicit.path) !== path)
          throw new Error(
            `Repository ${name} override conflicts with paths discovery`,
          );
        repositories.set(name, {
          name,
          path,
          baseBranch: "master",
          stagingRef: "staging",
          ...explicit,
        });
      }
    }
    return { ...config, repositories: [...repositories.values()] };
  }
}
