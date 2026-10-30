import { join, resolve, relative, isAbsolute } from "node:path";
import { lstatSync } from "node:fs";
import { ProcessRunner } from "../runtime/process-runner.js";
import { ScopePolicy } from "./scope-policy.js";
export class Workspace {
  constructor(
    private readonly directory: string,
    private readonly runner = new ProcessRunner(),
  ) {}
  async prepare(
    runId: string,
    repositories: { name: string; path: string }[],
    products: string[],
  ): Promise<Record<string, string>> {
    new ScopePolicy().assert(
      repositories.map((r) => r.name),
      products,
    );
    const paths: Record<string, string> = {};
    for (const repo of repositories) {
      const target = join(this.directory, "worktrees", runId, repo.name);
      const check = await this.runner.run(
        "git",
        ["worktree", "list", "--porcelain"],
        repo.path,
      );
      if (check.code) throw new Error("Cannot inspect repository worktrees");
      if (check.stdout.includes(`worktree ${target}\n`)) {
        paths[repo.name] = target;
        continue;
      }
      const result = await this.runner.run(
        "git",
        ["worktree", "add", "-b", `codex/scabbers-${runId}`, target, "HEAD"],
        repo.path,
      );
      if (result.code)
        throw new Error(
          "Cannot create isolated task worktree; existing branch is preserved",
        );
      paths[repo.name] = target;
    }
    return paths;
  }
  validatePlan(paths: Record<string, string>, files: string[]): void {
    if (!files.length) throw new Error("A bounded file plan is required");
    for (const file of files) {
      const [repository, ...parts] = file.split("/");
      const root = paths[repository!];
      const path = parts.join("/");
      if (
        !root ||
        !path ||
        isAbsolute(path) ||
        path.split("/").some((x) => x === ".." || x === ".git") ||
        /(^|\/)(?:AGENTS\.md|CLAUDE\.md|\.env[^/]*|\.gitlab-ci\.yml|package-lock\.json)$/.test(
          path,
        )
      )
        throw new Error("File plan outside authorized source scope");
      let current = root;
      for (const part of parts) {
        current = resolve(current, part);
        try {
          if (lstatSync(current).isSymbolicLink())
            throw new Error("Symlinks in edit plan require human review");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (relative(root, resolve(root, path)).startsWith(".."))
        throw new Error("Path escaped worktree");
    }
  }
  async changed(paths: Record<string, string>): Promise<string[]> {
    const files: string[] = [];
    for (const [name, path] of Object.entries(paths)) {
      const r = await this.runner.run(
        "git",
        ["status", "--porcelain", "-uall"],
        path,
      );
      if (r.code) throw new Error("Cannot verify changed files");
      for (const line of r.stdout.split("\n").filter(Boolean)) {
        if (line.includes(" -> "))
          throw new Error("Renames need an explicit plan review");
        files.push(name + "/" + line.slice(3).replace(/^"|"$/g, ""));
      }
    }
    return files;
  }
}
